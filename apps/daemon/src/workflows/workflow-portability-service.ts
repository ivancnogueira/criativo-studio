import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import {
  WORKFLOW_PORTABLE_FORMAT,
  normalizeWorkflowGraph,
  type ArquivoStudio,
  type PortableWorkflowAgentRef,
  type PortableWorkflowAsset,
  type PortableWorkflowBundle,
  type WorkflowImportResult,
  type WorkflowNo,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { inferTipoUso, RAW_MIME_MAP, sanitizeFileName } from "../server/routes/route-helpers.ts";
import { WorkflowValidationError, type WorkflowStore } from "./workflow-store.ts";

export const MAX_PORTABLE_ASSETS_BYTES = 50 * 1024 * 1024;

const SENSITIVE_KEY_RE =
  /(secret|token|apikey|api_key|password|passwd|authorization|auth_header|webhook_secret|vault_key|bearer|private_key)/i;
const SENSITIVE_VALUE_RE =
  /\b(sk-[a-zA-Z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|whsec_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/gi;

const ALLOWED_TIPO_USO = new Set<ArquivoStudio["tipo_uso"]>([
  "referencia",
  "logo",
  "personagem",
  "gerado",
  "video",
  "documento",
]);

function scrubSensitiveValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    return val.replace(SENSITIVE_VALUE_RE, "");
  }
  if (Array.isArray(val)) {
    return val.map(scrubSensitiveValue);
  }
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (
        SENSITIVE_KEY_RE.test(k) ||
        k === "webhook_route_id" ||
        k === "webhook_url" ||
        k === "webhook_secret_vault_key" ||
        k === "secretHint"
      ) {
        continue;
      }
      out[k] = scrubSensitiveValue(v);
    }
    return out;
  }
  return val;
}

/**
 * Remove recursivamente quaisquer segredos, tokens, chaves de cofre e webhook hints de um nó.
 */
export function sanitizeWorkflowNodeForPortability(node: WorkflowNo): WorkflowNo {
  const cleaned = scrubSensitiveValue(node) as WorkflowNo;
  const cfg =
    cleaned.config && typeof cleaned.config === "object" && !Array.isArray(cleaned.config)
      ? { ...cleaned.config }
      : {};

  if (cleaned.trigger && typeof cleaned.trigger === "object" && "secretHint" in cleaned.trigger) {
    const tCopy = { ...(cleaned.trigger as Record<string, unknown>) };
    delete tCopy.secretHint;
    cleaned.trigger = tCopy as WorkflowNo["trigger"];
  }
  delete cfg.secretHint;
  delete cfg.webhook_route_id;
  delete cfg.webhook_url;
  delete cfg.webhook_secret_vault_key;

  return {
    ...cleaned,
    config: cfg,
  };
}

function resolveFileWithinWorkspace(workspaceRoot: string, relPath: string): string {
  const absRoot = resolve(workspaceRoot);
  const cleaned = relPath.trim();
  if (!cleaned || cleaned.includes("\0") || cleaned.includes("..")) {
    throw new WorkflowValidationError("Caminho de asset inválido ou fora do workspace.", 400);
  }
  const resolved = resolve(absRoot, cleaned);
  if (resolved !== absRoot && !resolved.startsWith(absRoot + sep)) {
    throw new WorkflowValidationError("Caminho de asset fora dos limites do workspace.", 400);
  }
  return resolved;
}

/**
 * Exporta um fluxo portável (`.workflow.json`) com assets locais embutidos (SHA-256 + Base64)
 * sem jamais consultar o `VaultService` ou exportar segredos.
 */
export function exportPortableWorkflow(
  deps: { db: CriativoDatabase; store: WorkflowStore; workspaceRoot: string },
  workflowId: string
): PortableWorkflowBundle {
  const detail = deps.store.getWorkflowDetail(workflowId);
  if (!detail) {
    throw new WorkflowValidationError(`Workflow '${workflowId}' não encontrado.`, 404);
  }

  const normalized = normalizeWorkflowGraph({
    nos: detail.workflow.nos,
    arestas: detail.workflow.arestas,
    tracos: detail.workflow.tracos,
  });

  const assets: PortableWorkflowAsset[] = [];
  const assetRefByKey = new Map<string, string>();
  const warnings: string[] = [];
  let totalAssetBytes = 0;

  const findArchivoStmt = deps.db.connection.prepare(
    `SELECT arquivo_id, nome_original, caminho_relativo, mime_type, tipo_uso
     FROM projecao_arquivos
     WHERE arquivo_id = ? OR caminho_relativo = ?
     LIMIT 1;`
  );

  const sanitizedNos = normalized.nos.map((rawNode) => {
    const node = sanitizeWorkflowNodeForPortability(rawNode);
    const refCandidate =
      node.fileId ??
      (typeof node.config.fileId === "string" ? node.config.fileId : undefined) ??
      (typeof node.config.caminho_relativo === "string"
        ? node.config.caminho_relativo
        : undefined);

    if (refCandidate && refCandidate.trim()) {
      const refKey = refCandidate.trim();
      let assetRefId = assetRefByKey.get(refKey);
      if (!assetRefId) {
        const row = findArchivoStmt.get(refKey, refKey) as
          | {
              arquivo_id: string;
              nome_original: string;
              caminho_relativo: string;
              mime_type: string;
              tipo_uso: ArquivoStudio["tipo_uso"];
            }
          | undefined;
        const relPath = row?.caminho_relativo ?? refKey;
        try {
          const absPath = resolveFileWithinWorkspace(deps.workspaceRoot, relPath);
          if (!existsSync(absPath)) {
            warnings.push(`Asset '${relPath}' não encontrado no disco e foi omitido.`);
          } else {
            const buf = readFileSync(absPath);
            if (totalAssetBytes + buf.length > MAX_PORTABLE_ASSETS_BYTES) {
              warnings.push(
                `Asset '${relPath}' excedeu o limite agregado de 50 MB do pacote portável.`
              );
            } else {
              totalAssetBytes += buf.length;
              assetRefId = `asset-${assets.length + 1}`;
              assetRefByKey.set(refKey, assetRefId);
              const fileName = row?.nome_original || basename(absPath);
              const mimeType =
                row?.mime_type ||
                RAW_MIME_MAP[extname(fileName).toLowerCase()] ||
                "application/octet-stream";
              const tipoUso: ArquivoStudio["tipo_uso"] = ALLOWED_TIPO_USO.has(row?.tipo_uso as ArquivoStudio["tipo_uso"])
                ? row!.tipo_uso
                : inferTipoUso(mimeType);

              assets.push({
                assetRefId,
                originalFileId: row?.arquivo_id ?? refKey,
                fileName,
                mimeType,
                tipoUso,
                sizeBytes: buf.length,
                sha256: createHash("sha256").update(buf).digest("hex"),
                base64: buf.toString("base64"),
              });
            }
          }
        } catch (err) {
          warnings.push(err instanceof Error ? err.message : `Asset '${refKey}' ignorado.`);
        }
      }

      if (assetRefId) {
        node.fileId = assetRefId;
        node.config = { ...node.config, fileId: assetRefId };
        delete node.config.caminho_relativo;
      }
    }

    return node;
  });

  const usedAgentIds = new Set<string>();
  for (const n of sanitizedNos) {
    const agId =
      n.agenteId ??
      (typeof n.config.agenteId === "string" ? n.config.agenteId : undefined);
    if (agId?.trim()) usedAgentIds.add(agId.trim());
  }

  const agents: PortableWorkflowAgentRef[] = [];
  if (usedAgentIds.size > 0) {
    const agentStmt = deps.db.connection.prepare(
      `SELECT agente_id, nome FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`
    );
    for (const agId of usedAgentIds) {
      const row = agentStmt.get(agId) as { agente_id: string; nome: string } | undefined;
      if (row) {
        agents.push({ agenteId: row.agente_id, nome: row.nome });
      }
    }
  }

  return {
    format: WORKFLOW_PORTABLE_FORMAT,
    exportedAt: new Date().toISOString(),
    workflow: {
      nome: detail.workflow.nome,
      descricao: detail.workflow.descricao,
      nos: sanitizedNos,
      arestas: normalized.arestas,
      tracos: normalized.tracos,
    },
    agents,
    assets,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Importa um bundle `.workflow.json`, valida integridade SHA-256 dos assets embutidos,
 * remapeia agentes e cria o fluxo obrigatoriamente pausado (`ativo: false`).
 */
export function importPortableWorkflow(
  deps: { db: CriativoDatabase; store: WorkflowStore; workspaceRoot: string },
  rawBundle: unknown
): WorkflowImportResult {
  if (!rawBundle || typeof rawBundle !== "object") {
    throw new WorkflowValidationError("Pacote de workflow inválido.", 400);
  }
  const bundle = rawBundle as Partial<PortableWorkflowBundle>;
  if (bundle.format !== WORKFLOW_PORTABLE_FORMAT) {
    throw new WorkflowValidationError(
      `Formato de workflow incompatível (esperado '${WORKFLOW_PORTABLE_FORMAT}').`,
      400
    );
  }
  if (!bundle.workflow || !Array.isArray(bundle.workflow.nos) || !Array.isArray(bundle.workflow.arestas)) {
    throw new WorkflowValidationError("Pacote não contém definição válida de nós/arestas.", 400);
  }

  const bundleAssets = Array.isArray(bundle.assets) ? bundle.assets : [];
  const bundleAgents = Array.isArray(bundle.agents) ? bundle.agents : [];
  const warnings: string[] = [...(Array.isArray(bundle.warnings) ? bundle.warnings : [])];

  // 1. Valida e prepara assets em memória antes de persistir
  const decodedAssets: Array<{
    assetRefId: string;
    cleanName: string;
    mimeType: string;
    tipoUso: ArquivoStudio["tipo_uso"];
    buffer: Buffer;
  }> = [];
  let totalDecodedBytes = 0;

  for (const item of bundleAssets) {
    if (!item || typeof item.assetRefId !== "string" || typeof item.base64 !== "string") {
      throw new WorkflowValidationError("Asset embutido inválido no pacote.", 400);
    }
    const rawName = String(item.fileName || "asset.bin");
    if (rawName.includes("..") || rawName.includes("/") || rawName.includes("\\") || rawName.includes("\0")) {
      throw new WorkflowValidationError(`Nome de arquivo inseguro no pacote: '${rawName}'.`, 400);
    }
    const buffer = Buffer.from(item.base64, "base64");
    if (buffer.length === 0) {
      throw new WorkflowValidationError(`Asset '${rawName}' possui conteúdo vazio ou base64 inválido.`, 400);
    }
    totalDecodedBytes += buffer.length;
    if (totalDecodedBytes > MAX_PORTABLE_ASSETS_BYTES) {
      throw new WorkflowValidationError("Tamanho total dos assets embutidos excede 50 MB.", 400);
    }
    const actualHash = createHash("sha256").update(buffer).digest("hex");
    if (typeof item.sha256 !== "string" || actualHash !== item.sha256.toLowerCase()) {
      throw new WorkflowValidationError(
        `Falha de integridade SHA-256 ao importar asset '${rawName}'.`,
        400
      );
    }
    const cleanName = sanitizeFileName(rawName);
    const mimeType =
      typeof item.mimeType === "string" && item.mimeType.trim()
        ? item.mimeType.trim()
        : RAW_MIME_MAP[extname(cleanName).toLowerCase()] ?? "application/octet-stream";
    const tipoUso: ArquivoStudio["tipo_uso"] = ALLOWED_TIPO_USO.has(item.tipoUso)
      ? item.tipoUso
      : inferTipoUso(mimeType);

    decodedAssets.push({
      assetRefId: item.assetRefId,
      cleanName,
      mimeType,
      tipoUso,
      buffer,
    });
  }

  // 2. Mapeia assets em disco e no SQLite
  const assetIdMap = new Map<string, string>();
  const uploadDir = resolve(deps.workspaceRoot, "recursos", "uploads");
  if (decodedAssets.length > 0) {
    mkdirSync(uploadDir, { recursive: true });
  }
  const nowIso = new Date().toISOString();
  const insertFileStmt = deps.db.connection.prepare(
    `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?);`
  );

  for (const dec of decodedAssets) {
    const arquivoId = `arq-${randomUUID().slice(0, 8)}`;
    const storedName = `${arquivoId}-${dec.cleanName}`;
    const relPath = `recursos/uploads/${storedName}`;
    const absTarget = resolveFileWithinWorkspace(deps.workspaceRoot, relPath);
    writeFileSync(absTarget, dec.buffer);
    insertFileStmt.run(
      arquivoId,
      dec.cleanName.slice(0, 140),
      relPath,
      dec.mimeType,
      dec.buffer.length,
      dec.tipoUso,
      nowIso
    );
    assetIdMap.set(dec.assetRefId, arquivoId);
  }

  // 3. Mapeia agentes existentes no destino por ID -> Nome (case-insensitive) -> Fallback
  const existingAgents = deps.db.connection
    .prepare(`SELECT agente_id, nome FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
    .all() as Array<{ agente_id: string; nome: string }>;
  const existingIds = new Set(existingAgents.map((a) => a.agente_id));
  const agentNameById = new Map(bundleAgents.map((a) => [a.agenteId, a.nome]));
  const fallbackAgent =
    existingAgents.find((a) => a.agente_id === "estrategista")?.agente_id ??
    existingAgents[0]?.agente_id ??
    "estrategista";

  const remappedAgents: WorkflowImportResult["remappedAgents"] = [];
  const nextNos: WorkflowNo[] = bundle.workflow.nos.map((rawNode) => {
    const clean = sanitizeWorkflowNodeForPortability(rawNode);
    const refFile =
      clean.fileId ?? (typeof clean.config.fileId === "string" ? clean.config.fileId : undefined);
    if (refFile && assetIdMap.has(refFile)) {
      const mappedFileId = assetIdMap.get(refFile)!;
      clean.fileId = mappedFileId;
      clean.config = { ...clean.config, fileId: mappedFileId };
    }

    const wantedAgentId =
      clean.agenteId ??
      (typeof clean.config.agenteId === "string" ? clean.config.agenteId : undefined);
    if (wantedAgentId && clean.tipo === "agente") {
      if (existingIds.has(wantedAgentId)) {
        remappedAgents.push({ from: wantedAgentId, to: wantedAgentId, by: "id" });
      } else {
        const expectedName = agentNameById.get(wantedAgentId)?.trim().toLowerCase();
        const byName = expectedName
          ? existingAgents.find((a) => a.nome.trim().toLowerCase() === expectedName)
          : undefined;
        const chosen = byName?.agente_id ?? fallbackAgent;
        const by: "name" | "fallback" = byName ? "name" : "fallback";
        clean.agenteId = chosen;
        clean.config = { ...clean.config, agenteId: chosen };
        remappedAgents.push({ from: wantedAgentId, to: chosen, by });
        if (!byName) {
          warnings.push(`Agente '${wantedAgentId}' não encontrado; mapeado para '${chosen}'.`);
        }
      }
    }

    return clean;
  });

  // 4. Cria workflow SEMPRE pausado (`ativo: false`)
  const nome =
    typeof bundle.workflow.nome === "string" && bundle.workflow.nome.trim()
      ? `${bundle.workflow.nome.trim()} (Importado)`
      : "Fluxo Importado";
  const descricao = typeof bundle.workflow.descricao === "string" ? bundle.workflow.descricao : "";

  const detail = deps.store.createWorkflow({
    nome,
    descricao,
    nos: nextNos,
    arestas: bundle.workflow.arestas,
    tracos: Array.isArray(bundle.workflow.tracos) ? bundle.workflow.tracos : [],
    ativo: false,
  });

  return {
    workflow: detail.workflow,
    detail,
    importedAssets: decodedAssets.length,
    remappedAgents,
    pausedOnImport: true,
    warnings,
  };
}
