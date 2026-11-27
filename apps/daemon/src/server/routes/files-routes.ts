import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import {
  resolveMetaGraphApiVersion,
  type AgentAllowedFolder,
  type AgentNotificationLevel,
  type AnexoChat,
  type AprendizadoConfig,
  type ArquivoStudio,
  type AvatarStyle,
  type BackupModelChoice,
  type BackupModelsConfig,
  type CanalEquipe,
  type CanalMemoria,
  type CanalNavegadorModo,
  type ChatVisualMeta,
  type ConversationMessage,
  type ConversationUiBlock,
  type DeletedNativeAgentInfo,
  type MemoriaInclusao,
  type MemoryReviewAlteracao,
  type MensagemChat,
  type OnboardingEstado,
  type PassoChat,
  type PermissionLevel,
  type ProviderName,
  type SkillSugestaoItem,
  type ToolDefinition,
  type UiBlockSubmitPayload,
  type UsageLimitAskPayload,
  type WorkflowAresta,
  type WorkflowNo,
  type WorkflowTraco,
  type WorkflowVisual,
} from "@criativo/contracts";
import {
  activateUpgradePackage,
  computeUnlockedAgentsSummary,
  evaluateAndSyncSetupCompletion,
  getBrandIdentity,
  hasConfiguredBrand,
  importBrandPdfFromBuffer,
  interpolateBrandPlaceholders,
  isSetupAssistantVisible,
  isVpsAssistantVisible,
  listUpgradePackages,
  saveBrandIdentity,
  setSetupAssistantState,
  setVpsAssistantState,
  syncBrandPlaceholdersInDatabase,
} from "../brand-onboarding-service.ts";
import {
  buildPhase13SystemGuidance,
  buildStudioLiveContext,
  executeChatWorkflowTool,
  executePhase13Tool,
  executePhase14ToolCall,
  executePhase15ChatTool,
  executeStudioExtensionTool,
  executeStudioRoutineTool,
  getChatWorkflowToolCatalog,
  HIDDEN_CATALOG_TOOL_NAMES,
  isAgentAuthorizedForStudioTool,
  isPhase10ExtensionTool,
  isPhase13ToolName,
  isPhase14ToolName,
  isPhase15ToolName,
  isRoutineToolName,
  isUpgradeUnlocked,
  isWorkflowToolName,
  PHASE10_TOOL_DEFINITIONS,
  PHASE13_TOOLS_SCHEMA,
  PHASE14_TOOLS_SCHEMA,
  PHASE15_TOOLS_SCHEMA,
  readAgentContextCutoffAt,
  readAgentGovernance,
  ROUTINE_AGENT_TOOLS_SCHEMA,
  sanitizeAllowedFoldersList,
  selectBalancedVisualAssets,
  syncWorkspaceFilesToDatabase,
  validateMetaIntegration,
  type LabeledVisualAsset,
  type Phase14ToolServices,
} from "../studio-tools-bridge.ts";
import { readRawBody as defaultReadRawBody } from "../daemon-http-utils.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { inferTipoUso, RAW_MIME_MAP, sanitizeFileName } from "./route-helpers.ts";

export const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_JSON_RAW_BYTES = 140 * 1024 * 1024;

function sendUploadTooLarge(
  sendJson: StudioRouteContext["deps"]["sendJson"],
  res: StudioRouteContext["res"],
  sizeBytes?: number
): void {
  const sizeLabel =
    typeof sizeBytes === "number" && sizeBytes > 0
      ? ` (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB)`
      : "";
  const sugestao =
    "Para vídeos ou arquivos maiores que 100 MB, envie o caminho completo do arquivo no chat ou autorize a pasta do vídeo em Inspetor do Agente → Pastas Autorizadas.";
  sendJson(res, 413, {
    ok: false,
    codigo: "CRV-UPLOAD-413",
    limite_mb: 100,
    erro: `Arquivo${sizeLabel} excede o limite de 100 MB para upload direto. ${sugestao}`,
    sugestao,
  });
}

export async function tryHandleFilesRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody, providerConnection } = deps;
  const readRawBody = deps.readRawBody ?? defaultReadRawBody;

  // 6. Arquivos, Uploads (ImagePaths) & Leitura Segura
  if (method === "GET" && path === "/api/arquivos") {
    syncWorkspaceFilesToDatabase(db, workspaceRoot);
    const tipo = url.searchParams.get("tipo");
    const rows = tipo
      ? (db.connection
          .prepare(`SELECT * FROM projecao_arquivos WHERE tipo_uso = ? ORDER BY criado_em DESC LIMIT 100;`)
          .all(tipo) as Array<{
          arquivo_id: string;
          nome_original: string;
          caminho_relativo: string;
          mime_type: string;
          tamanho_bytes: number;
          tipo_uso: ArquivoStudio["tipo_uso"];
          agente_id: string | null;
          tarefa_id: string | null;
          criado_em: string;
        }>)
      : (db.connection
          .prepare(`SELECT * FROM projecao_arquivos ORDER BY criado_em DESC LIMIT 100;`)
          .all() as Array<{
          arquivo_id: string;
          nome_original: string;
          caminho_relativo: string;
          mime_type: string;
          tamanho_bytes: number;
          tipo_uso: ArquivoStudio["tipo_uso"];
          agente_id: string | null;
          tarefa_id: string | null;
          criado_em: string;
        }>);

    const arquivos: ArquivoStudio[] = rows.map((row) => ({
      ...row,
      url: `/api/arquivos/raw?path=${encodeURIComponent(row.caminho_relativo)}`,
    }));

    sendJson(res, 200, { arquivos });
    return true;
  }

  if (method === "POST" && path === "/api/arquivos/upload") {
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    const isJsonPayload = contentType.includes("application/json");
    let rawFileName = "";
    let rawMimeType = "";
    let rawCategoria = "";
    let rawTipoUso: string | undefined;
    let agenteId: string | null = null;
    let tarefaId: string | null = null;
    let buffer: Buffer;

    if (!isJsonPayload) {
      const contentLen = Number(req.headers["content-length"] ?? 0);
      if (Number.isFinite(contentLen) && contentLen > MAX_UPLOAD_FILE_BYTES) {
        req.resume();
        sendUploadTooLarge(sendJson, res, contentLen);
        return true;
      }
      try {
        buffer = await readRawBody(req, MAX_UPLOAD_FILE_BYTES);
      } catch (err) {
        if ((err as { statusCode?: number })?.statusCode === 413) {
          sendUploadTooLarge(sendJson, res);
          return true;
        }
        throw err;
      }
      if (buffer.length === 0) {
        sendJson(res, 400, { erro: "Corpo do arquivo binário vazio." });
        return true;
      }
      const headerName = req.headers["x-file-name"];
      rawFileName =
        url.searchParams.get("nome")?.trim() ||
        (typeof headerName === "string" ? decodeURIComponent(headerName).trim() : "") ||
        "arquivo.bin";
      rawMimeType =
        url.searchParams.get("mime_type")?.trim() ||
        (contentType && !contentType.includes("application/octet-stream") ? contentType.split(";")[0].trim() : "");
      rawCategoria =
        url.searchParams.get("categoria") ??
        url.searchParams.get("tipo_uso") ??
        "";
      rawTipoUso = url.searchParams.get("tipo_uso") ?? undefined;
      agenteId = url.searchParams.get("agente_id")?.trim() || null;
      tarefaId = url.searchParams.get("tarefa_id")?.trim() || null;
    } else {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req, MAX_UPLOAD_JSON_RAW_BYTES);
      } catch (err) {
        if ((err as { statusCode?: number })?.statusCode === 413) {
          sendUploadTooLarge(sendJson, res);
          return true;
        }
        throw err;
      }
      if (typeof body.nome !== "string" || typeof body.conteudo_base64 !== "string") {
        sendJson(res, 400, { erro: "Campos obrigatórios: 'nome' e 'conteudo_base64'." });
        return true;
      }

      const base64Clean = body.conteudo_base64.replace(/^data:[^;]+;base64,/, "").trim();
      buffer = Buffer.from(base64Clean, "base64");
      if (buffer.length === 0) {
        sendJson(res, 400, { erro: "Conteúdo base64 vazio ou inválido." });
        return true;
      }
      if (buffer.length > MAX_UPLOAD_FILE_BYTES) {
        sendUploadTooLarge(sendJson, res, buffer.length);
        return true;
      }

      rawFileName = body.nome;
      rawMimeType = typeof body.mime_type === "string" ? body.mime_type : "";
      rawCategoria =
        (typeof body.categoria === "string" ? body.categoria : null) ??
        url.searchParams.get("categoria") ??
        (typeof body.tipo_uso === "string" ? body.tipo_uso : "");
      rawTipoUso = typeof body.tipo_uso === "string" ? body.tipo_uso : undefined;
      agenteId = typeof body.agente_id === "string" ? body.agente_id : null;
      tarefaId = typeof body.tarefa_id === "string" ? body.tarefa_id : null;
    }

    const cleanName = sanitizeFileName(rawFileName);
    const arquivoId = `arq-${randomUUID().slice(0, 8)}`;
    const storedName = `${arquivoId}-${cleanName}`;
    const mimeType =
      rawMimeType.length > 0
        ? rawMimeType
        : RAW_MIME_MAP[extname(cleanName).toLowerCase()] ?? "application/octet-stream";
    const categoria = rawCategoria.trim().toLowerCase();
    const mappedRequestedTipoUso =
      categoria === "foto"
        ? "personagem"
        : categoria === "ficha_pdf"
          ? "documento"
          : rawTipoUso;
    const tipoUso = inferTipoUso(mimeType, mappedRequestedTipoUso);

    const relFolder =
      categoria === "ficha_pdf" || categoria === "ficha"
        ? "conteudos/ficha"
        : categoria === "foto" || categoria === "fotos"
          ? "recursos/fotos"
          : categoria === "logo" || categoria === "logos"
            ? "recursos/logos"
            : categoria === "personagem" || categoria === "personagens"
              ? "recursos/personagens"
              : categoria === "referencia" || categoria === "referencias"
                ? "recursos/referencias"
                : tipoUso === "logo"
                  ? "recursos/logos"
                  : tipoUso === "personagem"
                    ? "recursos/personagens"
                    : tipoUso === "referencia"
                      ? "recursos/referencias"
                      : "recursos/uploads";
    const targetDir = resolve(workspaceRoot, relFolder);
    mkdirSync(targetDir, { recursive: true });

    const targetPath = resolve(targetDir, storedName);
    writeFileSync(targetPath, buffer);

    const relPath = `${relFolder}/${storedName}`;
    const agora = new Date().toISOString();

    db.connection
      .prepare(
        `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        arquivoId,
        rawFileName.slice(0, 140),
        relPath,
        mimeType,
        buffer.length,
        tipoUso,
        agenteId,
        tarefaId,
        agora
      );

    let brandExtraction: Awaited<ReturnType<typeof importBrandPdfFromBuffer>> | undefined;
    if (categoria === "ficha_pdf" || (mimeType === "application/pdf" && relFolder === "conteudos/ficha")) {
      brandExtraction = await importBrandPdfFromBuffer(
        providerConnection,
        workspaceRoot,
        buffer,
        db
      ).catch(() => undefined);
    }

    const syncedSetup = evaluateAndSyncSetupCompletion(db, providerConnection, workspaceRoot);

    const arquivo: ArquivoStudio = {
      arquivo_id: arquivoId,
      nome_original: rawFileName.slice(0, 140),
      caminho_relativo: relPath,
      url: `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`,
      mime_type: mimeType,
      tamanho_bytes: buffer.length,
      tipo_uso: tipoUso,
      agente_id: agenteId,
      tarefa_id: tarefaId,
      criado_em: agora,
    };

    sendJson(res, 201, {
      arquivo,
      ...(brandExtraction ? { brandExtraction } : {}),
      onboarding: syncedSetup.onboarding,
    });
    return true;
  }

  const deleteArquivoMatch = path.match(/^\/api\/arquivos\/([^/]+)$/);
  if (
    method === "DELETE" &&
    deleteArquivoMatch &&
    deleteArquivoMatch[1] !== "raw" &&
    deleteArquivoMatch[1] !== "upload"
  ) {
    const arquivoId = decodeURIComponent(deleteArquivoMatch[1]);
    const row = db.connection
      .prepare(`SELECT arquivo_id, caminho_relativo FROM projecao_arquivos WHERE arquivo_id = ? LIMIT 1;`)
      .get(arquivoId) as { arquivo_id: string; caminho_relativo: string } | undefined;

    if (!row) {
      sendJson(res, 404, { erro: "Arquivo não encontrado." });
      return true;
    }

    const relClean = row.caminho_relativo.replaceAll("\\", "/");
    if (
      !relClean ||
      relClean.includes("..") ||
      relClean.startsWith("/") ||
      relClean.startsWith("\\")
    ) {
      sendJson(res, 403, { erro: "Caminho não permitido para exclusão." });
      return true;
    }

    const deleteRoots = [
      resolve(workspaceRoot, "recursos"),
      resolve(workspaceRoot, "saidas"),
    ];
    const resolvedTarget = resolve(workspaceRoot, relClean);
    const isDeleteAllowed = deleteRoots.some((root) => {
      const rel = relative(root, resolvedTarget);
      return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`);
    });

    if (!isDeleteAllowed) {
      sendJson(res, 403, { erro: "Exclusão permitida apenas dentro de recursos/ ou saidas/." });
      return true;
    }

    try {
      if (existsSync(resolvedTarget)) {
        unlinkSync(resolvedTarget);
      }
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "ENOENT") {
        sendJson(res, 500, { erro: err instanceof Error ? err.message : "Erro ao remover arquivo físico." });
        return true;
      }
    }

    db.connection
      .prepare(`DELETE FROM projecao_arquivos WHERE arquivo_id = ?;`)
      .run(row.arquivo_id);

    sendJson(res, 200, {
      ok: true,
      arquivo_id: row.arquivo_id,
      caminho_relativo: row.caminho_relativo,
    });
    return true;
  }

  if (method === "GET" && (path === "/api/arquivos/raw" || path.startsWith("/api/arquivos/raw/"))) {
    const requestedRel = path.startsWith("/api/arquivos/raw/")
      ? decodeURIComponent(path.slice("/api/arquivos/raw/".length))
      : (url.searchParams.get("path") ?? "");
    if (!requestedRel || requestedRel.includes("..") || requestedRel.startsWith("/") || requestedRel.startsWith("\\")) {
      sendJson(res, 403, { erro: "Caminho não permitido." });
      return true;
    }

    const allowedRoots = [
      resolve(workspaceRoot, "recursos"),
      resolve(workspaceRoot, "conteudos"),
      resolve(workspaceRoot, "saidas"),
      resolve(workspaceRoot, "previas"),
    ];
    const resolvedTarget = resolve(workspaceRoot, requestedRel);
    const isAllowed = allowedRoots.some((root) => {
      const rel = relative(root, resolvedTarget);
      return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
    });

    if (!isAllowed) {
      sendJson(res, 403, { erro: "Acesso negado fora dos diretórios de mídia permitidos." });
      return true;
    }

    if (!existsSync(resolvedTarget) || !statSync(resolvedTarget).isFile()) {
      sendJson(res, 404, { erro: "Arquivo não encontrado." });
      return true;
    }

    const mime = RAW_MIME_MAP[extname(resolvedTarget).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "private, max-age=300",
    });
    res.end(readFileSync(resolvedTarget));
    return true;
  }

  return false;
}
