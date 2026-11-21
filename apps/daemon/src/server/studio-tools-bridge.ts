import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  mcpConfigErrors,
  normalizeMcpConfig,
  whatsAppNumberForms,
  type AgentAllowedFolder,
  type AnexoChat,
  type ArquivoStudio,
  type AskUserQuestion,
  type ChatVisualMeta,
  type MarketplaceSourceFilter,
  type McpAcessoAgentes,
  type McpServidorConfig,
  type MemoriaInclusao,
  type MensagemChat,
  type ToolDefinition,
} from "@criativo/contracts";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  WHATSAPP_MAX_POST_CHARS,
  WhatsAppArchiveService,
  type WhatsAppOrchestrator,
  type WhatsAppSessionManager,
} from "@criativo/whatsapp";
import type { CriativoDatabase } from "../database/client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { ROSTER_15_AGENTES } from "../engine/runner/roster-defaults.ts";
import type { CatalogService } from "../marketplace/catalog-service.ts";
import { NativeAppConnectionsStore } from "../marketplace/native-app-connections-store.ts";
import type { SkillsManager } from "../marketplace/skills-manager.ts";
import {
  fetchMetaAccountAndMediaInsights,
  resolveMetaCredentials,
  validateMetaIntegration,
  type MetaCredentialsResolved,
  type MetaInsightsQueryInput,
  type MetaInsightsReport,
  type MetaValidationReport,
} from "../engine/tools/meta-insights.ts";
import { metaPublishTool, type MetaPublishParams } from "../engine/tools/meta-publish.ts";
import {
  saveBrandIdentity,
  setSetupAssistantState,
  setVpsAssistantState,
} from "./brand-onboarding-service.ts";
import type { McpGateway } from "../mcp/mcp-gateway.ts";
import {
  maskMcpServerForClient,
  redactMcpPayload,
  redactMcpSecrets,
} from "../mcp/mcp-redaction.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import type { LabeledImageInput } from "../providers/antigravity-acp-service.ts";
import {
  executeRoutineToolCall,
  isRoutineToolName,
  ROUTINE_AGENT_TOOLS_SCHEMA,
  type RoutineToolExecutionContext,
  type RoutineToolsDeps,
} from "../routines/routine-agent-tools.ts";
import {
  executeWorkflowToolCall,
  isWorkflowToolName,
  WORKFLOW_TOOL_DEFINITIONS,
  WORKFLOW_TOOL_NAMES,
} from "../workflows/workflow-tools.ts";
import type { WorkflowEngine } from "../workflows/workflow-engine.ts";
import type { AgentTasksService } from "../threads/agent-tasks-service.ts";
import type { AgentWaitsService } from "../waits/agent-waits-service.ts";
import type { QueueControlsService } from "../queue/queue-controls-service.ts";
import type { ContextResetService } from "../chat/context-reset-service.ts";
import type { MessagePinsService } from "../chat/message-pins-service.ts";
import type { SharedTablesService } from "../agent-data/shared-tables-service.ts";
import { MemoryManager } from "../engine/runner/memory-manager.ts";
import type { MemoryReviewService } from "../engine/runner/memory-review-service.ts";
import type { SkillLearningService } from "../engine/runner/skill-learning-service.ts";
import type { HistorySearchService } from "../engine/runner/history-search-service.ts";
import type { LibraryFoldersService } from "../engine/runner/library-folders-service.ts";
import type { CanalMensagemRow, HandoffBus } from "../engine/runner/handoff-bus.ts";
import type { ChatVisualPreviewService } from "../engine/runner/chat-visual-preview-service.ts";
import type { UiBlockRegistry } from "../engine/runner/ui-block-registry.ts";
import type { ApiKeysBridge, OrigemTurnoApiKey } from "../vault/api-keys-bridge.ts";
import type { LicenseClientService } from "../license/license-service.ts";
import type { WorkflowStore } from "../workflows/workflow-store.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { WebSocketHub } from "./websocket-hub.ts";
import type {
  BackupModelsConfig,
  BrowserTakeoverReason,
  BrowserTargetSelector,
  PermissionLevel,
} from "@criativo/contracts";
import type { RemoteClaimService } from "../servers/remote-claim-service.ts";
import type {
  BrowserAutomationService,
  BrowserCdpActionName,
} from "../engine/tools/browser-automation.ts";
import { readVideoTool } from "../engine/tools/video-reader.ts";
import { readImageTool } from "../engine/tools/image-reader.ts";
import {
  generateImageTool,
  MAX_REFERENCES_BY_ENGINE,
  resolveVaultSecretCaseInsensitive,
  type ImageProviderEngine,
} from "../engine/tools/generate-image.ts";
import {
  generateVideoTool,
  MAX_VIDEO_REFERENCE_IMAGES,
} from "../engine/tools/generate-video.ts";
import type { ScreenCaptureBridge } from "../engine/tools/screen-capture-bridge.ts";
import { parseBackupModelsJson } from "../engine/runner/backup-models-resolver.ts";
import type { TranscriptionService } from "../voice/transcription-service.ts";
import { executeSidebarTool, SIDEBAR_AGENT_TOOL_NAMES } from "./sidebar-service.ts";
import type { AgentWakeupService } from "../waits/agent-wakeup-service.ts";
import { listAgentsWithAliases, resolveAgentIdFromDb } from "./agent-resolver.ts";
import { loadSkillPromptBySlug, getSkillUpgradePackage } from "./analytics-skills-service.ts";
import {
  executeShowcaseTool,
  SHOWCASE_AGENT_TOOL_NAMES,
  type ShowcaseSiteService,
} from "./showcase-service.ts";

export {
  isRoutineToolName,
  isWorkflowToolName,
  ROUTINE_AGENT_TOOLS_SCHEMA,
  WORKFLOW_TOOL_DEFINITIONS,
  WORKFLOW_TOOL_NAMES,
};

export {
  fetchMetaAccountAndMediaInsights,
  resolveMetaCredentials,
  validateMetaIntegration,
  type MetaCredentialsResolved,
  type MetaInsightsQueryInput,
  type MetaInsightsReport,
  type MetaValidationReport,
};

export const INSTAGRAM_TOOL_NAMES = new Set([
  "validar_integracao_meta",
  "consultar_metricas_meta",
  "meta_publicar",
]);

export const WHATSAPP_TOOL_NAMES = new Set([
  "messaging_list_places",
  "messaging_history",
  "messaging_post",
  "messaging_remember",
  "messaging_forget_memory",
]);

export function resolveNativeAppConnectionsStore(deps: {
  db: CriativoDatabase;
  vault?: VaultService;
  nativeStore?: NativeAppConnectionsStore;
  catalogService?: CatalogService;
}): NativeAppConnectionsStore | null {
  if (deps.nativeStore) return deps.nativeStore;
  if (deps.catalogService?.nativeStore) return deps.catalogService.nativeStore;
  if (deps.vault) {
    return new NativeAppConnectionsStore({ db: deps.db, vault: deps.vault });
  }
  return null;
}

export function isAgentAuthorizedForStudioTool(
  toolName: string,
  agenteId: string | null | undefined,
  deps: {
    db: CriativoDatabase;
    vault?: VaultService;
    nativeStore?: NativeAppConnectionsStore;
    catalogService?: CatalogService;
  }
): boolean {
  const store = resolveNativeAppConnectionsStore(deps);
  if (!store) return true;
  if (INSTAGRAM_TOOL_NAMES.has(toolName)) {
    return store.isAgentAuthorizedForNativeApp("instagram", agenteId);
  }
  if (WHATSAPP_TOOL_NAMES.has(toolName)) {
    return store.isAgentAuthorizedForNativeApp("whatsapp", agenteId);
  }
  return true;
}

export const UPGRADE_PACKAGE_SLUGS = {
  bonus: [
    "gerador-de-entregaveis",
    "engenharia-reversa-concorrentes",
    "consistencia-personagem",
  ],
  video: [
    "criar-video-reels",
    "roteirista-faceless",
    "roteirista-talking-head",
  ],
} as const;

/**
 * Verifica se um pacote modular (`base`, `bonus` ou `video`) está desbloqueado na instalação.
 * Quando o licenciamento está ativo (produção ou enforceLicense), exige entitlement assinado Ed25519.
 */
export function isUpgradeUnlocked(
  db: CriativoDatabase,
  workspaceRoot: string,
  pacote: "base" | "bonus" | "video",
  licenseService?: LicenseClientService,
  productRoot?: string,
): boolean {
  if (pacote === "base") return true;

  if (licenseService && !licenseService.isBypassedForTests()) {
    return licenseService.hasSignedUpgradeEntitlement(pacote);
  }

  try {
    const row = db.connection
      .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'upgrades_instalados';`)
      .get() as { valor_json: string } | undefined;
    if (row) {
      const list = JSON.parse(row.valor_json) as unknown;
      if (Array.isArray(list) && list.includes(pacote)) {
        return true;
      }
    }
  } catch {
    // ignora erro de leitura
  }

  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return false;
  }

  const required = UPGRADE_PACKAGE_SLUGS[pacote];
  const candidateRoots = [
    resolve(workspaceRoot, ".agents", "skills"),
    productRoot ? resolve(productRoot, ".agents", "skills") : null,
    process.env.CRIATIVO_PRODUCT_ROOT ? resolve(process.env.CRIATIVO_PRODUCT_ROOT, ".agents", "skills") : null,
  ].filter((d): d is string => Boolean(d));

  return candidateRoots.some((skillsDir) =>
    required.some((slug) => existsSync(join(skillsDir, slug, "SKILL.md"))),
  );
}

const STUDIO_MEDIA_MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export interface ScannedWorkspaceFile {
  nome_original: string;
  caminho_relativo: string;
  mime_type: string;
  tamanho_bytes: number;
  tipo_uso: ArquivoStudio["tipo_uso"];
  criado_em: string;
  diskPath: string;
}

/**
 * Escaneia arquivos reais presentes nas pastas do workspace (`recursos/` e `saidas/`)
 * para exibição no Cockpit Web e injeção no contexto/ImagePaths dos agentes.
 */
export function scanWorkspaceMediaFiles(workspaceRoot: string, limit = 120): ScannedWorkspaceFile[] {
  const roots: Array<{ dir: string; tipoUso: ArquivoStudio["tipo_uso"] }> = [
    { dir: resolve(workspaceRoot, "recursos", "referencias"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "recursos", "fotos"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "recursos", "logos"), tipoUso: "logo" },
    { dir: resolve(workspaceRoot, "recursos", "personagens"), tipoUso: "personagem" },
    { dir: resolve(workspaceRoot, "recursos", "uploads"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "saidas"), tipoUso: "gerado" },
  ];

  const found: ScannedWorkspaceFile[] = [];

  const walk = (dir: string, defaultUso: ArquivoStudio["tipo_uso"]): void => {
    if (found.length >= limit || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) break;
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, defaultUso);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      const mime = STUDIO_MEDIA_MIME_MAP[ext];
      if (!mime) continue;
      try {
        const st = statSync(fullPath);
        if (st.size <= 0) continue;
        const rel = relative(workspaceRoot, fullPath).replaceAll("\\", "/");
        const tipoUso: ArquivoStudio["tipo_uso"] =
          mime.startsWith("video/") && defaultUso === "gerado" ? "video" : defaultUso;
        found.push({
          nome_original: basename(entry.name),
          caminho_relativo: rel,
          mime_type: mime,
          tamanho_bytes: st.size,
          tipo_uso: tipoUso,
          criado_em: st.mtime.toISOString(),
          diskPath: fullPath,
        });
      } catch {
        // ignora arquivo inacessível
      }
    }
  };

  for (const r of roots) {
    walk(r.dir, r.tipoUso);
  }

  return found.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}

/**
 * Sincroniza de forma idempotente arquivos do disco para `projecao_arquivos` no SQLite.
 */
export function syncWorkspaceFilesToDatabase(db: CriativoDatabase, workspaceRoot: string): number {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") return 0;

  const existingRows = db.connection
    .prepare(`SELECT caminho_relativo FROM projecao_arquivos;`)
    .all() as Array<{ caminho_relativo: string }>;
  const known = new Set(existingRows.map((r) => r.caminho_relativo.replaceAll("\\", "/")));

  const scanned = scanWorkspaceMediaFiles(workspaceRoot);
  const insertStmt = db.connection.prepare(
    `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?);`
  );

  let added = 0;
  for (const item of scanned) {
    if (known.has(item.caminho_relativo)) continue;
    insertStmt.run(
      `arq-${randomUUID().slice(0, 8)}`,
      item.nome_original,
      item.caminho_relativo,
      item.mime_type,
      item.tamanho_bytes,
      item.tipo_uso,
      item.criado_em
    );
    known.add(item.caminho_relativo);
    added += 1;
  }
  return added;
}

export interface LabeledVisualAsset extends LabeledImageInput {
  relPath: string;
}

/**
 * Seleciona ativos visuais para geração de imagem/vídeo.
 * Quando o agente informa listas explícitas (`specificImages`, `specificFotos` ou `specificReferencias`),
 * respeita exatamente a quantidade escolhida até `maxTotal` sem corte artificial em 3 fotos.
 */
export function selectBalancedVisualAssets(
  db: CriativoDatabase,
  workspaceRoot: string,
  options: {
    explicitAttachments?: AnexoChat[];
    usarFotosReais?: boolean;
    specificImages?: string[];
    specificFotos?: string[];
    specificReferencias?: string[];
    maxFotos?: number;
    maxReferencias?: number;
    maxLogos?: number;
    maxTotal?: number;
  } = {}
): LabeledVisualAsset[] {
  const maxFotos = options.maxFotos ?? 3;
  const maxReferencias = options.maxReferencias ?? 2;
  const maxLogos = options.maxLogos ?? 1;
  const maxTotal =
    typeof options.maxTotal === "number" && Number.isFinite(options.maxTotal)
      ? Math.max(0, Math.trunc(options.maxTotal))
      : 14;
  const usarFotosReais = options.usarFotosReais !== false;

  const picked: LabeledVisualAsset[] = [];
  const seenAbs = new Set<string>();

  const inferRoleFromRelPath = (relPath: string): LabeledImageInput["role"] => {
    const lower = relPath.toLowerCase();
    if (lower.includes("/fotos/") || lower.startsWith("recursos/fotos/") || lower.includes("/personagens/") || lower.startsWith("recursos/personagens/")) {
      return "foto_real";
    }
    if (lower.includes("/logos/") || lower.startsWith("recursos/logos/")) {
      return "logo";
    }
    return "referencia_estilo";
  };

  const pushAsset = (relRaw: string, role: LabeledImageInput["role"]) => {
    if (picked.length >= maxTotal) return;
    const cleanRel = relRaw.replaceAll("\\", "/").replace(/^\/+/, "");
    if (!cleanRel || cleanRel.includes("..")) return;
    const abs = resolve(workspaceRoot, cleanRel);
    if (seenAbs.has(abs) || !existsSync(abs)) return;
    seenAbs.add(abs);
    picked.push({
      path: abs,
      relPath: cleanRel,
      role,
      label: cleanRel,
    });
  };

  for (const att of options.explicitAttachments ?? []) {
    if (att?.caminho_relativo) {
      pushAsset(att.caminho_relativo, "anexo_usuario");
    }
  }

  for (const rel of options.specificImages ?? []) {
    pushAsset(rel, inferRoleFromRelPath(rel));
  }
  for (const rel of options.specificFotos ?? []) {
    pushAsset(rel, "foto_real");
  }
  for (const rel of options.specificReferencias ?? []) {
    pushAsset(rel, "referencia_estilo");
  }

  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return picked;
  }

  if (usarFotosReais && maxFotos > 0) {
    const fotoRows = db.connection
      .prepare(
        `SELECT caminho_relativo FROM projecao_arquivos
         WHERE (caminho_relativo LIKE 'recursos/fotos/%'
                OR caminho_relativo LIKE 'recursos/personagens/%'
                OR tipo_uso = 'personagem')
           AND mime_type LIKE 'image/%'
           AND mime_type NOT LIKE '%svg%'
         ORDER BY CASE
           WHEN caminho_relativo LIKE 'recursos/fotos/%' THEN 0
           WHEN caminho_relativo LIKE 'recursos/personagens/%' THEN 1
           ELSE 2
         END, criado_em DESC
         LIMIT 24;`
      )
      .all() as Array<{ caminho_relativo: string }>;
    for (const row of fotoRows) {
      if (picked.length >= maxTotal) break;
      if (picked.filter((p) => p.role === "foto_real").length >= maxFotos) break;
      pushAsset(row.caminho_relativo, "foto_real");
    }
  }

  if (maxReferencias > 0) {
    const refRows = db.connection
      .prepare(
        `SELECT caminho_relativo FROM projecao_arquivos
         WHERE (caminho_relativo LIKE 'recursos/referencias/%' OR tipo_uso = 'referencia')
           AND caminho_relativo NOT LIKE 'recursos/fotos/%'
           AND mime_type LIKE 'image/%'
           AND mime_type NOT LIKE '%svg%'
         ORDER BY criado_em DESC
         LIMIT 24;`
      )
      .all() as Array<{ caminho_relativo: string }>;
    for (const row of refRows) {
      if (picked.length >= maxTotal) break;
      if (picked.filter((p) => p.role === "referencia_estilo").length >= maxReferencias) break;
      pushAsset(row.caminho_relativo, "referencia_estilo");
    }
  }

  if (maxLogos > 0) {
    const logoRows = db.connection
      .prepare(
        `SELECT caminho_relativo FROM projecao_arquivos
         WHERE (caminho_relativo LIKE 'recursos/logos/%' OR tipo_uso = 'logo')
           AND mime_type LIKE 'image/%'
           AND mime_type NOT LIKE '%svg%'
         ORDER BY criado_em DESC
         LIMIT 6;`
      )
      .all() as Array<{ caminho_relativo: string }>;
    for (const row of logoRows) {
      if (picked.length >= maxTotal) break;
      if (picked.filter((p) => p.role === "logo").length >= maxLogos) break;
      pushAsset(row.caminho_relativo, "logo");
    }
  }

  return picked;
}

function readBrandSnippetIfRich(filePath: string, maxChars: number): string {
  if (!existsSync(filePath)) return "";
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return "";
    const onlyTemplates =
      raw.includes("[A PREENCHER]") && raw.includes("[NOME_DA_MARCA]") && raw.length < 300;
    return onlyTemplates ? "" : raw.slice(0, maxChars);
  } catch {
    return "";
  }
}

/**
 * Monta o Contexto Vivo seguro do Studio para injetar no systemPrompt de qualquer agente no Chat.
 */
export function buildStudioLiveContext(deps: {
  db: CriativoDatabase;
  vault?: VaultService;
  providerConnection: ProviderConnectionService;
  workspaceRoot: string;
  agenteId?: string | null;
  memoryManager?: MemoryManager;
  userPrompt?: string;
  compact?: boolean;
}): string {
  if (deps.compact) {
    const onboarding = deps.providerConnection.getOnboardingState();
    const marcaConfig = deps.providerConnection.getStudioConfig<Record<string, unknown>>(
      "identidade_marca",
      {}
    );
    const metaCreds = resolveMetaCredentials(deps.vault);
    const compactLines: string[] = [
      "## Contexto Enxuto do Criativo AI Studio Online",
      `- Marca: ${String(marcaConfig.marca_nome ?? onboarding.marca_nome)} (${String(
        marcaConfig.perfil_handle ?? onboarding.perfil_handle
      )})`,
      ...(typeof marcaConfig.nicho === "string" && marcaConfig.nicho
        ? [`- Nicho: ${marcaConfig.nicho}`]
        : []),
      `- Meta/Instagram: ${metaCreds.configured ? "Conectado no Cofre" : "Não configurado"}`,
      "- Recursos sob demanda: use `load_skill` quando precisar do guia completo de execução e `list_agents` para consultar especialistas/@apelidos.",
    ];
    if (deps.agenteId) {
      const gov = readAgentGovernance(deps.db, deps.agenteId);
      if (gov.allowedFolders.length > 0) {
        const listText = gov.allowedFolders
          .map((f) => `${f.path} (${f.mode === "read" ? "leitura" : "leitura e escrita"})`)
          .join("; ");
        compactLines.push(`- Pastas Autorizadas do Agente: ${listText}`);
      }
    }
    return compactLines.join("\n");
  }

  syncWorkspaceFilesToDatabase(deps.db, deps.workspaceRoot);

  const onboarding = deps.providerConnection.getOnboardingState();
  const marcaConfig = deps.providerConnection.getStudioConfig<Record<string, unknown>>(
    "identidade_marca",
    {}
  );
  const metaCreds = resolveMetaCredentials(deps.vault);

  const secretsMeta = deps.vault ? deps.vault.listSecretsMetadata() : [];
  const secretNames = new Set(secretsMeta.map((s) => s.chave_nome));
  const hasEleven = secretNames.has("elevenlabs_api_key") || secretNames.has("ELEVENLABS_API_KEY");
  const hasTelegram = secretNames.has("telegram_bot_token") || secretNames.has("TELEGRAM_BOT_TOKEN");

  const files = deps.db.connection
    .prepare(
      `SELECT nome_original, caminho_relativo, tipo_uso FROM projecao_arquivos ORDER BY criado_em DESC LIMIT 20;`
    )
    .all() as Array<{ nome_original: string; caminho_relativo: string; tipo_uso: string }>;

  const canReadDisk = process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1";
  const perfilFileSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "conteudos", "perfil-da-marca.md"), 1200)
    : "";
  const idVisualSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "conteudos", "identidade-visual.yml"), 800)
    : "";
  const brandbookSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "recursos", "brand", "brandbook.md"), 800)
    : "";
  const designSystemSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "recursos", "brand", "design-system.md"), 600)
    : "";

  const lines: string[] = [
    "## Contexto Vivo do Criativo AI Studio Online",
    `- Marca configurada: ${String(marcaConfig.marca_nome ?? onboarding.marca_nome)} (${String(
      marcaConfig.perfil_handle ?? onboarding.perfil_handle
    )})`,
    ...(typeof marcaConfig.nicho === "string" && marcaConfig.nicho
      ? [`- Nicho/Segmento: ${marcaConfig.nicho}`]
      : []),
    ...(typeof marcaConfig.tom_voz === "string" && marcaConfig.tom_voz
      ? [`- Tom de Voz: ${marcaConfig.tom_voz}`]
      : []),
    `- Cofre AES-256-GCM (SQLite) — Meta/Instagram: ${
      metaCreds.configured
        ? "CONFIGURADO (token e account ID salvos no Cofre; nunca peça token no chat)"
        : "NÃO CONFIGURADO (oriente salvar em Conexões -> Apps & Canais -> Instagram)"
    }`,
    `- Cofre — ElevenLabs TTS: ${hasEleven ? "Configurado" : "Não configurado (fallback edge-tts)"}`,
    `- Cofre — Telegram Bot: ${hasTelegram ? "Configurado" : "Não configurado"}`,
    `- Regra de Ouro do Studio Online: As credenciais NÃO ficam em .env visível; ficam cifradas no Cofre SQLite e validadas pela ferramenta nativa 'validar_integracao_meta' (ou via 'npm run validar:integracoes').`,
  ];

  if (deps.agenteId) {
    const gov = readAgentGovernance(deps.db, deps.agenteId);
    if (gov.allowedFolders.length > 0) {
      const folderDesc = gov.allowedFolders
        .map((f) => `\`${f.path}\` (${f.mode === "read" ? "somente leitura" : "leitura e escrita"})`)
        .join(", ");
      lines.push(`- Pastas Autorizadas do Agente fora do workspace: ${folderDesc}.`);
    }
  }

  if (files.length > 0) {
    const fotosReais = files.filter(
      (f) =>
        f.caminho_relativo.startsWith("recursos/fotos/") ||
        f.caminho_relativo.startsWith("recursos/personagens/") ||
        f.tipo_uso === "personagem"
    );
    const refsEstilo = files.filter(
      (f) => f.caminho_relativo.startsWith("recursos/referencias/") && !fotosReais.includes(f)
    );
    const logosMarca = files.filter(
      (f) => (f.caminho_relativo.startsWith("recursos/logos/") || f.tipo_uso === "logo") && !fotosReais.includes(f)
    );
    const outrosArqs = files.filter(
      (f) => !fotosReais.includes(f) && !refsEstilo.includes(f) && !logosMarca.includes(f)
    );
    lines.push(
      `- Fotos reais do usuário (${fotosReais.length}): ${
        fotosReais.length > 0
          ? fotosReais.map((f) => `${f.nome_original} (${f.caminho_relativo})`).join("; ")
          : "nenhuma em recursos/fotos/"
      }`,
      `- Referências de estilo (${refsEstilo.length}): ${
        refsEstilo.length > 0
          ? refsEstilo.map((f) => `${f.nome_original} (${f.caminho_relativo})`).join("; ")
          : "nenhuma em recursos/referencias/"
      }`,
      ...(logosMarca.length > 0
        ? [`- Logos da marca (${logosMarca.length}): ${logosMarca.map((f) => f.caminho_relativo).join("; ")}`]
        : []),
      ...(outrosArqs.length > 0
        ? [`- Outras mídias/entregáveis (${outrosArqs.length}): ${outrosArqs.slice(0, 6).map((f) => f.caminho_relativo).join("; ")}`]
        : [])
    );
  } else {
    lines.push(
      "- Arquivos/Referências/ImagePaths disponíveis: nenhuma mídia salva ainda em recursos/fotos/, recursos/referencias/ ou recursos/logos/."
    );
  }

  if (perfilFileSnippet) {
    lines.push("", "### Memória Estratégica (conteudos/perfil-da-marca.md)", perfilFileSnippet);
  }
  if (idVisualSnippet) {
    lines.push("", "### Identidade Visual (conteudos/identidade-visual.yml)", idVisualSnippet);
  }
  if (brandbookSnippet) {
    lines.push("", "### Brandbook da Marca (recursos/brand/brandbook.md)", brandbookSnippet);
  }
  if (designSystemSnippet) {
    lines.push("", "### Design System (recursos/brand/design-system.md)", designSystemSnippet);
  }

  const includeFullRoster =
    !deps.agenteId ||
    deps.agenteId === "orquestrador" ||
    Boolean(deps.userPrompt && /(@|handoff|equipe|time|especialista|delegar|quem faz)/i.test(deps.userPrompt));

  const rosterWithAliases = listAgentsWithAliases(deps.db);
  lines.push(
    "",
    "### Equipe de Colegas para Handoff",
    ...(includeFullRoster
      ? [
          rosterWithAliases
            .map((a) =>
              a.apelido === a.agente_id
                ? `- \`@${a.agente_id}\`: ${a.nome} — ${a.papel}`
                : `- \`@${a.apelido}\` (ID \`${a.agente_id}\`): ${a.nome} — ${a.papel}`
            )
            .join("\n"),
        ]
      : [
          `- Especialistas disponíveis: ${rosterWithAliases.map((a) => `@${a.apelido}`).join(", ")}.`,
        ]),
    "IMPORTANTE SOBRE HANDOFF: Só emita `[HANDOFF:agente_id]` sob pedido prático explícito que exija outro especialista. Nunca emita handoff ao se apresentar ou tirar dúvidas simples."
  );

  try {
    if (deps.db.hasTable("projecao_agente_rotinas")) {
      const rotinasRows = deps.db.connection
        .prepare(
          `SELECT nome, owner_id, trigger_kind, ativa FROM projecao_agente_rotinas ORDER BY atualizado_em DESC LIMIT 15;`
        )
        .all() as Array<{ nome: string; owner_id: string; trigger_kind: string; ativa: number }>;
      const ativasCount = rotinasRows.filter((r) => r.ativa === 1).length;
      lines.push(
        "",
        "### Rotinas, Webhooks e Agenda",
        `- Rotinas registradas no estúdio: ${rotinasRows.length} (${ativasCount} ativas).`,
        "- Use `create_routine`, `update_routine`, `delete_routine`, `list_routines` ou `test_routine` para gerenciar rotinas agendadas; `create_webhook_routine`/`update_webhook_routine` apenas mediante pedido explícito humano no chat; e `routine_no_update`/`routine_report_failure` quando rodando em turno automático."
      );
    }
  } catch {
    // Tabela opcional em contextos legados
  }

  try {
    if (deps.agenteId) {
      const memMgr = deps.memoryManager ?? new MemoryManager(deps.db);
      const snap = memMgr.getEssentialContextSnapshot(deps.agenteId);
      const xmlBlock =
        snap.contextBlock || `<agent_memories count="${snap.memorias.length}"></agent_memories>`;
      lines.push(
        "",
        "### Memórias Essenciais, Shared Tables e Generative UI",
        xmlBlock,
        "- Use `remember` / `forget_memory` para gravar decisões duráveis, `memory_recall` para buscar memórias `searchable` via FTS5, `list_tables` / `query_data` / `execute_data` para o banco SQL compartilhado entre agentes, `html_render` para painéis interativos em sandbox e `ask_user` / `ask_ui` / `acknowledge_request` / `request_api_key` para cards bloqueantes.",
      );
    }
  } catch {
    // Ignora caso tabela de memórias não esteja pronta em ambiente mínimo
  }

  lines.push(
    "",
    "### Navegador CDP, Mídia, Geração de Imagens/Vídeos, Sidebar & Showcase",
    "- Use `criativo_browser` (action: open, list_tabs, navigate, snapshot, click, type, fill_fields, press, scroll, screenshot, request_takeover, submit_secret, close_tab) para operar o Chromium real.",
    "- Use `generate_image` para artes reais (Gemini Nano Banana 2.1 até 14 referências, GPT Image 2.6/2.5 até 16 referências via API Key ou Antigravity); você decide quantas e quais referências enviar via `imagens_referencia`.",
    "- Use `generate_video` para gerar vídeos MP4 com áudio nativo sincronizado via Gemini Omni 1.2 Flash (3 a 15s, até 6 imagens de referência via `imagens_referencia`).",
    "- Use `read_video(url, frames?)`, `read_image(path)` e `capture_screen(purpose)` para inspeção visual; `list_sections`/`assign_agent_section` para Sidebar e `list_sites`/`publish_site` para Showcase.",
  );

  return lines.join("\n");
}

export interface StudioExtensionToolDeps {
  db: CriativoDatabase;
  vault?: VaultService;
  wsHub?: WebSocketHub;
  workspaceRoot?: string;
  agenteId?: string;
  canalId?: string | null;
  mcpGateway?: McpGateway;
  catalogService?: CatalogService;
  nativeStore?: NativeAppConnectionsStore;
  providerConnection?: ProviderConnectionService;
  skillsManager?: SkillsManager;
  whatsappManager?: WhatsAppSessionManager;
  whatsappOrchestrator?: WhatsAppOrchestrator;
  fetchImpl?: FetchLike;
  onImageProgress?: (evt: {
    status: "executando" | "concluido" | "erro";
    formato: string;
    mensagem: string;
    stepId: string;
  }) => void;
}

export const PHASE10_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "messaging_list_places",
    description:
      "Lista as contas WhatsApp configuradas, contatos/grupos autorizados e conversas recentes disponíveis para envio ou consulta.",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "Opcional: filtra por ID da conta WhatsApp." },
      },
    },
  },
  {
    name: "messaging_history",
    description:
      "Consulta o histórico recente de mensagens WhatsApp armazenadas (padrão 30, máximo 100 mensagens).",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "ID da conta WhatsApp." },
        chatJid: { type: "string", description: "JID do chat/contato/grupo." },
        limit: { type: "number", description: "Quantidade máxima de mensagens (1 a 100, padrão 30)." },
      },
    },
  },
  {
    name: "messaging_post",
    description:
      "Envia mensagem de texto (máximo 8.000 caracteres) e anexo de mídia opcional para um contato ou grupo autorizado no WhatsApp.",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "ID da conta WhatsApp (padrão: whatsapp-principal)." },
        chatJid: { type: "string", description: "JID ou número de telefone autorizado do destinatário." },
        text: { type: "string", description: "Texto da mensagem (até 8.000 caracteres)." },
        mediaPath: {
          type: "string",
          description: "Caminho relativo seguro em recursos/, saidas/ ou previas/ para anexo.",
        },
        caption: { type: "string", description: "Legenda opcional para imagem/vídeo/documento." },
        asAudioPtt: { type: "boolean", description: "Se áudio, envia como mensagem de voz (PTT)." },
      },
      required: ["chatJid"],
    },
  },
  {
    name: "messaging_remember",
    description:
      "Registra uma memória operacional durável para uma conta ou conversa específica do WhatsApp.",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "ID da conta WhatsApp (padrão: whatsapp-principal)." },
        chatJid: { type: "string", description: "Opcional: JID do chat associado à memória." },
        texto: { type: "string", description: "Regra, preferência ou contexto operacional a lembrar." },
      },
      required: ["texto"],
    },
  },
  {
    name: "messaging_forget_memory",
    description: "Remove uma memória operacional registrada anteriormente no canal WhatsApp.",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "ID da conta WhatsApp (padrão: whatsapp-principal)." },
        memoriaId: { type: "string", description: "ID exato da memória a esquecer." },
        texto: { type: "string", description: "Texto exato ou trecho da memória a remover." },
        chatJid: { type: "string", description: "Opcional: JID do chat associado." },
      },
    },
  },
  {
    name: "list_mcp_servers",
    description:
      "Lista todos os servidores MCP cadastrados, status de conexão, quantidade de ferramentas, status OAuth e escopo de agentes (sem expor segredos).",
    parameters: {
      type: "object",
      properties: {
        includeDisabled: { type: "boolean", description: "Incluir servidores desativados (padrão true)." },
        agentId: { type: "string", description: "Opcional: filtra servidores autorizados para este agente." },
      },
    },
  },
  {
    name: "save_mcp_server",
    description:
      "Cria ou atualiza um servidor MCP STDIO ou Streamable HTTP no estúdio, armazenando segredos com segurança no Cofre.",
    parameters: {
      type: "object",
      properties: {
        mcp_id: { type: "string", description: "Opcional ao criar; obrigatório para atualizar servidor específico." },
        nome: { type: "string", description: "Nome identificador do servidor MCP." },
        transporte: { type: "string", enum: ["stdio", "http"] },
        comando: { type: "string", description: "Executável STDIO (ex.: npx, node)." },
        args: { type: "array", items: { type: "string" } },
        env: { type: "object", additionalProperties: { type: "string" } },
        envPassthrough: { type: "array", items: { type: "string" } },
        workingDirectory: { type: "string" },
        url: { type: "string", description: "URL HTTP/HTTPS para transporte Streamable HTTP." },
        headers: { type: "object", additionalProperties: { type: "string" } },
        acesso: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["everyone", "agents"] },
            agentIds: { type: "array", items: { type: "string" } },
          },
        },
        ativo: { type: "boolean" },
        testar: { type: "boolean", description: "Quando true, executa sondagem real após salvar." },
      },
      required: ["nome"],
    },
  },
  {
    name: "test_mcp_server",
    description:
      "Executa sondagem real em um servidor MCP salvo, retornando ferramentas descobertas ou solicitando OAuth se necessário.",
    parameters: {
      type: "object",
      properties: {
        mcpId: { type: "string", description: "ID do servidor MCP a testar." },
      },
      required: ["mcpId"],
    },
  },
  {
    name: "set_mcp_server_enabled",
    description: "Ativa ou desativa um servidor MCP cadastrado sem apagá-lo.",
    parameters: {
      type: "object",
      properties: {
        mcpId: { type: "string" },
        ativo: { type: "boolean" },
      },
      required: ["mcpId", "ativo"],
    },
  },
  {
    name: "remove_mcp_server",
    description: "Remove um servidor MCP e revoga credenciais OAuth e segredos associados no Cofre.",
    parameters: {
      type: "object",
      properties: {
        mcpId: { type: "string" },
      },
      required: ["mcpId"],
    },
  },
  {
    name: "suggest_marketplace_app",
    description:
      "Sugere ao usuário um aplicativo oficial do catálogo da Loja Unificada inline no chat com prompts prontos.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Slug do app (ex.: canva, figma, notion, elevenlabs, github)." },
        query: { type: "string", description: "Termo de busca caso não saiba o slug exato." },
      },
    },
  },
  {
    name: "list_local_skills",
    description: "Lista habilidades instaladas e disponíveis no catálogo local da Loja.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        source: { type: "string", enum: ["all", "verified", "public"] },
        agentId: { type: "string" },
        category: { type: "string" },
      },
    },
  },
  {
    name: "read_local_skill",
    description: "Lê os metadados e o conteúdo completo do SKILL.md de uma habilidade instalada ou do catálogo.",
    parameters: {
      type: "object",
      properties: {
        slugOrId: { type: "string", description: "Slug ou skillId da habilidade." },
      },
      required: ["slugOrId"],
    },
  },
  {
    name: "create_skill",
    description:
      "Cria uma nova habilidade personalizada (SKILL.md) em dados/skills-loja/ e opcionalmente vincula aos agentes.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        slug: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        instructions: { type: "string", description: "Conteúdo Markdown completo das instruções." },
        agentIds: { type: "array", items: { type: "string" } },
      },
      required: ["name", "description", "instructions"],
    },
  },
  {
    name: "revise_skill",
    description: "Atualiza instruções e metadados de uma habilidade local não-nativa.",
    parameters: {
      type: "object",
      properties: {
        slugOrId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        instructions: { type: "string" },
      },
      required: ["slugOrId", "instructions"],
    },
  },
  {
    name: "install_local_skill",
    description: "Instala uma habilidade do catálogo da Loja para o disco local e vincula aos agentes informados.",
    parameters: {
      type: "object",
      properties: {
        slugOrId: { type: "string" },
        targetAgentIds: { type: "array", items: { type: "string" } },
      },
      required: ["slugOrId"],
    },
  },
  {
    name: "set_skill_enabled",
    description: "Habilita ou desabilita uma habilidade vinculada para um agente específico.",
    parameters: {
      type: "object",
      properties: {
        agenteId: { type: "string" },
        slugOrId: { type: "string" },
        habilitada: { type: "boolean" },
      },
      required: ["agenteId", "slugOrId", "habilitada"],
    },
  },
  {
    name: "uninstall_skill",
    description: "Desinstala uma habilidade da Loja, GitHub ou personalizada (habilidades nativas são protegidas).",
    parameters: {
      type: "object",
      properties: {
        slugOrId: { type: "string" },
      },
      required: ["slugOrId"],
    },
  },
  {
    name: "validar_integracao_meta",
    description:
      "Valida as credenciais Meta/Instagram armazenadas no Cofre AES-256-GCM contra a Meta Graph API v27.0 oficial sem expor tokens.",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "Opcional: ID da conta Instagram nativa salva na Loja." },
      },
    },
  },
  {
    name: "consultar_metricas_meta",
    description:
      "Consulta métricas reais da conta Instagram Business/Creator e dos posts/Reels recentes via Meta Graph API v27.0 (views, reach, saved, shares, total_interactions, taxa de salvamento e ig_reels_avg_watch_time).",
    parameters: {
      type: "object",
      properties: {
        periodo: {
          type: "string",
          enum: ["7d", "28d", "30d", "90d"],
          description: "Janela de análise desejada (padrão 30d).",
        },
        limite_posts: {
          type: "number",
          description: "Quantidade máxima de publicações recentes a inspecionar (1 a 25, padrão 15).",
        },
        incluir_reels: {
          type: "boolean",
          description: "Incluir métricas de retenção de Reels (padrão true).",
        },
        conta_id: {
          type: "string",
          description: "Opcional: ID da conta Instagram salva na Loja.",
        },
      },
    },
  },
  {
    name: "meta_publicar",
    description:
      "Publica criativo aprovado no Instagram via Meta Graph API v27.0 (bloqueado se approved_by_human != true ou se o agente não tiver permissão ao app Instagram).",
    parameters: {
      type: "object",
      properties: {
        media_type: { type: "string", enum: ["IMAGE", "CAROUSEL", "REELS", "STORIES"] },
        media_urls: { type: "array", items: { type: "string" } },
        caption: { type: "string" },
        approved_by_human: { type: "boolean" },
        conta_id: { type: "string" },
      },
      required: ["media_type", "media_urls", "caption", "approved_by_human"],
    },
  },
  {
    name: "salvar_identidade_marca",
    description:
      "Salva ou atualiza os dados estruturados da marca (nome comercial, @handle, nicho, público-alvo, oferta principal, tom de voz, cores e fontes) em conteudos/perfil-da-marca.md e SQLite.",
    parameters: {
      type: "object",
      properties: {
        marca_nome: { type: "string" },
        perfil_handle: { type: "string" },
        nicho: { type: "string" },
        publico_alvo: { type: "string" },
        oferta_principal: { type: "string" },
        tom_voz: { type: "string" },
        cores: {
          type: "object",
          properties: {
            fundo: { type: "string" },
            texto: { type: "string" },
            primaria: { type: "string" },
            secundaria: { type: "string" },
            acento: { type: "string" },
          },
        },
        fontes: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            texto: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "concluir_setup_inicial",
    description:
      "Marca o setup inicial assistido como concluído (setup_assistant_dismissed = true) e oculta automaticamente o agente Assistente de Configuração da Sidebar.",
    parameters: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Resumo curto do que foi concluído ou dispensado." },
      },
    },
  },
  {
    name: "concluir_conexao_vps",
    description:
      "Marca o fluxo guiado de conexão de servidor VPS como concluído/encerrado (vps_assistant_visible = false) e oculta o Especialista em Servidor VPS da Sidebar.",
    parameters: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Resumo curto da conexão concluída ou motivo do encerramento." },
      },
    },
  },
  {
    name: "generate_image",
    description:
      "Gera uma imagem ou arte visual real via Gemini Nano Banana 2.1 (até 14 referências), OpenAI GPT Image 2.6/2.5 (até 16 referências via /images/edits), Flux ou Antigravity. Você decide quantas e quais referências enviar via `imagens_referencia` (ou `fotos_especificas`/`referencias_especificas`).",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Briefing visual detalhado da arte (cena, texto na arte, composição e preservação da foto real).",
        },
        formato: {
          type: "string",
          enum: ["3:4", "9:16", "1:1", "16:9"],
          description: "Proporção desejada: '3:4' (post feed), '9:16' (stories), '1:1' ou '16:9'.",
        },
        motor: {
          type: "string",
          enum: ["auto", "gemini", "openai", "antigravity", "flux"],
          description: "Motor de geração preferido. Padrão 'auto' prioriza API Keys configuradas (Nano Banana 2.1 / GPT Image 2.6) ou conta Antigravity.",
        },
        modelo: {
          type: "string",
          description: "Modelo explícito opcional (ex.: 'gemini-nano-banana-2.1', 'gpt-image-2.6-sunburst', 'gpt-image-2.5-sunburst').",
        },
        resolucao: {
          type: "string",
          enum: ["1K", "2K", "4K"],
          description: "Resolução desejada no Gemini Nano Banana 2.1 (padrão '2K').",
        },
        qualidade: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Qualidade desejada no GPT Image (padrão 'high').",
        },
        usar_fotos_reais: {
          type: "boolean",
          description: "Se false, evita incluir fotos reais automaticamente quando nenhuma lista explícita for passada.",
        },
        imagens_referencia: {
          type: "array",
          items: { type: "string" },
          description: "Lista livre escolhida pelo agente com caminhos relativos de fotos, referências estéticas e/ou logos (até 14 no Gemini ou 16 no GPT Image).",
        },
        fotos_especificas: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos relativos opcionais de fotos específicas em recursos/fotos/.",
        },
        referencias_especificas: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos relativos opcionais de referências de estilo em recursos/referencias/.",
        },
        max_fotos: {
          type: "number",
          description: "Quantidade máxima opcional de fotos reais para busca automática quando nenhuma lista explícita for informada.",
        },
        max_referencias: {
          type: "number",
          description: "Quantidade máxima opcional de referências estéticas para busca automática.",
        },
        max_logos: {
          type: "number",
          description: "Quantidade máxima opcional de logos para busca automática.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_video",
    description:
      "Gera um vídeo MP4 curto com áudio nativo sincronizado usando Gemini Omni 1.2 Flash (`gemini-omni-1.2-flash`), com duração de 3 a 15s e até 6 imagens de referência à escolha do agente, salvando em saidas/videos/.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Descrição cinematográfica detalhada da cena, movimento de câmera, ação, falas/áudio ambiente e ritmo visual.",
        },
        formato: {
          type: "string",
          enum: ["9:16", "16:9", "1:1"],
          description: "Proporção do vídeo: '9:16' (Reels/Shorts/Stories), '16:9' (landscape) ou '1:1'. Padrão '9:16'.",
        },
        duracao_segundos: {
          type: "number",
          description: "Duração do clipe em segundos inteiros (mínimo 3, máximo 15, padrão 8).",
        },
        resolucao: {
          type: "string",
          enum: ["360p", "720p", "1080p", "4k"],
          description: "Resolução de saída desejada (padrão '720p').",
        },
        modelo: {
          type: "string",
          description: "Modelo opcional (padrão 'gemini-omni-1.2-flash').",
        },
        usar_fotos_reais: {
          type: "boolean",
          description: "Se true (padrão quando não passar imagens_referencia), inclui fotos reais da marca para consistência.",
        },
        imagens_referencia: {
          type: "array",
          items: { type: "string" },
          description: "Lista livre escolhida pelo agente com até 6 imagens de referência (personagem, produto, cenário).",
        },
        fotos_especificas: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos relativos opcionais de fotos específicas em recursos/fotos/.",
        },
        referencias_especificas: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos relativos opcionais de referências visuais em recursos/referencias/.",
        },
        max_fotos: { type: "number" },
        max_referencias: { type: "number" },
      },
      required: ["prompt"],
    },
  },
];

export const PHASE10_TOOL_NAMES: ReadonlySet<string> = new Set(
  PHASE10_TOOL_DEFINITIONS.map((t) => t.name)
);

export function isPhase10ExtensionTool(name: string): boolean {
  return PHASE10_TOOL_NAMES.has(name);
}

function readStringArg(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = args[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

function readStringArrayArg(args: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const val = args[key];
    if (Array.isArray(val)) {
      return val.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    }
  }
  return [];
}

function readStringRecordArg(
  args: Record<string, unknown>,
  ...keys: string[]
): Record<string, string> | undefined {
  for (const key of keys) {
    const val = args[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  }
  return undefined;
}

export function resolveSafeStudioMediaPath(workspaceRoot: string, rawMediaPath: string): string {
  const trimmed = rawMediaPath.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error("Caminho de mídia inválido.");
  }

  const allowedRoots = [
    resolve(workspaceRoot, "recursos"),
    resolve(workspaceRoot, "saidas"),
    resolve(workspaceRoot, "previas"),
  ];
  const resolvedTarget = isAbsolute(trimmed)
    ? resolve(trimmed)
    : resolve(workspaceRoot, trimmed);

  const contained = allowedRoots.some((root) => {
    const rel = relative(root, resolvedTarget);
    return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel);
  });

  if (!contained) {
    throw new Error(
      "Acesso negado: o anexo de mídia deve estar contido em recursos/, saidas/ ou previas/."
    );
  }

  if (!existsSync(resolvedTarget) || !statSync(resolvedTarget).isFile()) {
    throw new Error(`Arquivo de mídia não encontrado: ${rawMediaPath}`);
  }

  return resolvedTarget;
}

function normalizeTargetWhatsAppJid(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, "");
  return digits ? `${digits}@s.whatsapp.net` : trimmed;
}

function isRecipientAuthorizedForAccount(
  db: CriativoDatabase,
  contaId: string,
  targetJid: string
): boolean {
  const account = db.connection
    .prepare(`SELECT jid_proprio, numero_telefone FROM whatsapp_contas WHERE conta_id = ? LIMIT 1;`)
    .get(contaId) as { jid_proprio?: string | null; numero_telefone?: string | null } | undefined;

  const targetForms = new Set(whatsAppNumberForms(targetJid));
  if (account) {
    const ownForms = new Set([
      ...(account.jid_proprio ? whatsAppNumberForms(account.jid_proprio) : []),
      ...(account.numero_telefone ? whatsAppNumberForms(account.numero_telefone) : []),
    ]);
    for (const form of targetForms) {
      if (ownForms.has(form)) return true;
    }
  }

  const rows = db.connection
    .prepare(
      `SELECT tipo, identificador_jid, telefone_normalizado, variantes_json
       FROM whatsapp_contatos_autorizados
       WHERE conta_id = ? AND permitido = 1;`
    )
    .all(contaId) as Array<{
    tipo: string;
    identificador_jid: string;
    telefone_normalizado: string | null;
    variantes_json: string;
  }>;

  for (const row of rows) {
    if (row.identificador_jid === targetJid) return true;
    if (row.tipo === "contato") {
      if (row.telefone_normalizado && targetForms.has(row.telefone_normalizado)) return true;
      try {
        const variants = JSON.parse(row.variantes_json) as unknown;
        if (Array.isArray(variants) && variants.some((v) => typeof v === "string" && targetForms.has(v))) {
          return true;
        }
      } catch {
        // ignora JSON inválido
      }
      if (whatsAppNumberForms(row.identificador_jid).some((f) => targetForms.has(f))) {
        return true;
      }
    }
  }

  return false;
}

export async function executeStudioExtensionTool(
  toolName: string,
  args: Record<string, unknown>,
  deps: StudioExtensionToolDeps
): Promise<unknown> {
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();
  const nativeStore = resolveNativeAppConnectionsStore(deps);

  if (!isAgentAuthorizedForStudioTool(toolName, deps.agenteId, { ...deps, nativeStore: nativeStore ?? undefined })) {
    const appLabel = INSTAGRAM_TOOL_NAMES.has(toolName) ? "Instagram / Meta" : "WhatsApp Studio";
    throw new Error(
      `Acesso bloqueado: o agente '${deps.agenteId ?? "atual"}' não tem permissão ao aplicativo nativo '${appLabel}' na Loja.`
    );
  }

  const getArchive = () =>
    new WhatsAppArchiveService({
      db: deps.db.connection,
      workspaceRoot,
    });

  switch (toolName) {
    // ------------------------------------------------------------------
    // 5 Tools WhatsApp (WAPP-03 / D-04)
    // ------------------------------------------------------------------
    case "messaging_list_places": {
      const contaId = readStringArg(args, "contaId", "conta_id");
      return getArchive().listPlaces(contaId);
    }

    case "messaging_history": {
      const contaId = readStringArg(args, "contaId", "conta_id");
      const chatJid = readStringArg(args, "chatJid", "chat_jid");
      const rawLimit = typeof args.limit === "number" ? args.limit : Number(args.limit ?? 30);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(100, Math.max(1, Math.trunc(rawLimit)))
        : 30;
      const mensagens = getArchive().listHistory({ contaId, chatJid, limit });
      return {
        contaId: contaId ?? null,
        chatJid: chatJid ?? null,
        limit,
        total: mensagens.length,
        mensagens,
      };
    }

    case "messaging_post": {
      if (!deps.whatsappOrchestrator) {
        throw new Error("Orquestrador WhatsApp não está ativo neste daemon.");
      }
      const contaId = readStringArg(args, "contaId", "conta_id") ?? DEFAULT_WHATSAPP_ACCOUNT_ID;
      const rawTarget = readStringArg(args, "chatJid", "chat_jid", "to", "destinatario");
      if (!rawTarget) {
        throw new Error("Informe 'chatJid' do destinatário autorizado para envio.");
      }
      const targetJid = normalizeTargetWhatsAppJid(rawTarget);
      if (!isRecipientAuthorizedForAccount(deps.db, contaId, targetJid)) {
        throw new Error(
          `Destinatário '${rawTarget}' não está autorizado na conta WhatsApp '${contaId}'.`
        );
      }

      const text = typeof args.text === "string"
        ? args.text
        : typeof args.texto === "string"
          ? args.texto
          : "";
      if (text.length > WHATSAPP_MAX_POST_CHARS) {
        throw new Error(
          `Mensagem excede o limite de ${WHATSAPP_MAX_POST_CHARS} caracteres por envio no WhatsApp.`
        );
      }

      const rawMediaPath = readStringArg(args, "mediaPath", "media_path");
      const safeMediaPath = rawMediaPath
        ? resolveSafeStudioMediaPath(workspaceRoot, rawMediaPath)
        : undefined;

      if (!text.trim() && !safeMediaPath) {
        throw new Error("Informe 'text' ou 'mediaPath' para enviar no WhatsApp.");
      }

      const registro = await deps.whatsappOrchestrator.sendMessageAndArchive(
        contaId,
        targetJid,
        {
          text,
          mediaPath: safeMediaPath,
          caption: readStringArg(args, "caption", "legenda"),
          asAudioPtt: typeof args.asAudioPtt === "boolean" ? args.asAudioPtt : undefined,
        }
      );

      return { ok: true, mensagem: registro };
    }

    case "messaging_remember": {
      if (!deps.whatsappOrchestrator) {
        throw new Error("Orquestrador WhatsApp não está ativo neste daemon.");
      }
      const texto = readStringArg(args, "texto", "text", "memory");
      if (!texto) {
        throw new Error("Informe o campo 'texto' para gravar a memória operacional.");
      }
      const contaId = readStringArg(args, "contaId", "conta_id") ?? DEFAULT_WHATSAPP_ACCOUNT_ID;
      const chatJid = readStringArg(args, "chatJid", "chat_jid");
      const memoria = deps.whatsappOrchestrator.rememberChannelMemory({
        contaId,
        chatJid,
        texto,
        origem: "manual",
      });
      return { ok: Boolean(memoria), memoria };
    }

    case "messaging_forget_memory": {
      if (!deps.whatsappOrchestrator) {
        throw new Error("Orquestrador WhatsApp não está ativo neste daemon.");
      }
      const contaId = readStringArg(args, "contaId", "conta_id") ?? DEFAULT_WHATSAPP_ACCOUNT_ID;
      const memoriaId = readStringArg(args, "memoriaId", "memoria_id", "id");
      const texto = readStringArg(args, "texto", "text");
      const chatJid = readStringArg(args, "chatJid", "chat_jid");
      if (!memoriaId && !texto) {
        throw new Error("Informe 'memoriaId' ou 'texto' para remover a memória do canal.");
      }
      const removed = deps.whatsappOrchestrator.forgetChannelMemory({
        contaId,
        memoriaId,
        texto,
        chatJid,
      });
      return { ok: removed, removed };
    }

    // ------------------------------------------------------------------
    // 5 Tools MCP + Sugestão de App (MCP-03 / STORE-02 / D-07)
    // ------------------------------------------------------------------
    case "list_mcp_servers": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const includeDisabled =
        typeof args.includeDisabled === "boolean" ? args.includeDisabled : true;
      const agentId = readStringArg(args, "agentId", "agenteId");
      const servers = deps.mcpGateway.store
        .listServersForClient({ includeDisabled, agentId })
        .map((srv) => ({
          ...maskMcpServerForClient(srv),
          oauthStatus: deps.mcpGateway!.oauthProvider.getOAuthStatus(srv.mcp_id),
        }));

      return { total: servers.length, servidores: servers };
    }

    case "save_mcp_server": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const rawAcesso = (args.acesso ?? args.access) as Partial<McpAcessoAgentes> | undefined;
      const payload: Partial<McpServidorConfig> = {
        mcp_id: readStringArg(args, "mcp_id", "mcpId"),
        nome: readStringArg(args, "nome", "name"),
        transporte:
          args.transporte === "http" || args.transport === "http"
            ? "http"
            : args.transporte === "stdio" || args.transport === "stdio"
              ? "stdio"
              : undefined,
        comando: readStringArg(args, "comando", "command"),
        args: readStringArrayArg(args, "args"),
        env: readStringRecordArg(args, "env"),
        envPassthrough: readStringArrayArg(args, "envPassthrough", "env_passthrough"),
        workingDirectory:
          args.workingDirectory === null || args.working_directory === null
            ? null
            : readStringArg(args, "workingDirectory", "working_directory"),
        url: args.url === null ? null : readStringArg(args, "url"),
        headers: readStringRecordArg(args, "headers"),
        acesso:
          rawAcesso && typeof rawAcesso === "object"
            ? {
                mode: rawAcesso.mode === "agents" ? "agents" : "everyone",
                agentIds: Array.isArray(rawAcesso.agentIds)
                  ? rawAcesso.agentIds.filter((id): id is string => typeof id === "string")
                  : [],
              }
            : undefined,
        ativo: typeof args.ativo === "boolean" ? args.ativo : true,
      };

      const normalized = normalizeMcpConfig(payload);
      const errors = mcpConfigErrors(normalized);
      const firstErr = errors.nome ?? errors.comando ?? errors.url ?? errors.acesso;
      if (firstErr) {
        throw new Error(firstErr);
      }

      const saved = deps.mcpGateway.store.saveServer(payload);
      deps.mcpGateway.invalidateServer(saved.mcp_id);
      deps.mcpGateway.refreshProxyRoutes();

      const shouldProbe = args.testar === true || args.probe === true;
      const probe = shouldProbe ? await deps.mcpGateway.testServer(saved.mcp_id) : undefined;
      const latest = deps.mcpGateway.store.getServer(saved.mcp_id, false) ?? saved;
      const oauthStatus = deps.mcpGateway.oauthProvider.getOAuthStatus(saved.mcp_id);

      deps.wsHub?.broadcast("mcp.status_atualizado", {
        mcp_id: latest.mcp_id,
        ativo: latest.ativo,
        oauth_status: oauthStatus,
        qtd_ferramentas: probe?.toolCount ?? latest.qtdFerramentas,
        ultimo_erro: latest.ultimoErro ?? null,
      });

      return redactMcpPayload(
        {
          ok: true,
          servidor: maskMcpServerForClient({ ...latest, oauthStatus }),
          ...(probe ? { probe } : {}),
        },
        []
      );
    }

    case "test_mcp_server": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const mcpId = readStringArg(args, "mcpId", "mcp_id");
      if (!mcpId) {
        throw new Error("Informe 'mcpId' do servidor MCP a testar.");
      }

      const resultado = await deps.mcpGateway.testServer(mcpId);
      const server = deps.mcpGateway.store.getServer(mcpId, false);
      if (resultado.status === "needs_sign_in") {
        const motivo = resultado.error ?? `Autenticação OAuth necessária para '${server?.nome ?? mcpId}'.`;
        deps.wsHub?.broadcast("mcp.oauth_solicitado", {
          mcp_id: mcpId,
          nome: server?.nome ?? mcpId,
          app_slug: server?.origemAppSlug ?? null,
          authorize_url: resultado.authUrl ?? null,
          canal_id: deps.canalId ?? null,
          agente_id: deps.agenteId ?? null,
          motivo,
        });
        return redactMcpPayload(
          {
            ...resultado,
            ok: false,
            action: "sign_in",
            mcpId,
            nome: server?.nome ?? mcpId,
            appSlug: server?.origemAppSlug ?? null,
            motivo,
          },
          []
        );
      }

      return redactMcpPayload({ ...resultado, mcpId }, []);
    }

    case "set_mcp_server_enabled": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const mcpId = readStringArg(args, "mcpId", "mcp_id");
      if (!mcpId || typeof args.ativo !== "boolean") {
        throw new Error("Informe 'mcpId' e 'ativo' (boolean).");
      }

      const updated = deps.mcpGateway.store.setServerEnabled(mcpId, args.ativo);
      deps.mcpGateway.invalidateServer(mcpId);
      deps.mcpGateway.refreshProxyRoutes();
      const oauthStatus = deps.mcpGateway.oauthProvider.getOAuthStatus(mcpId);

      deps.wsHub?.broadcast("mcp.status_atualizado", {
        mcp_id: updated.mcp_id,
        ativo: updated.ativo,
        oauth_status: oauthStatus,
        qtd_ferramentas: updated.qtdFerramentas,
        ultimo_erro: updated.ultimoErro ?? null,
      });

      return {
        ok: true,
        servidor: maskMcpServerForClient({ ...updated, oauthStatus }),
      };
    }

    case "remove_mcp_server": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const mcpId = readStringArg(args, "mcpId", "mcp_id");
      if (!mcpId) {
        throw new Error("Informe 'mcpId' do servidor MCP a remover.");
      }

      await deps.mcpGateway.oauthProvider.signOut(mcpId).catch(() => undefined);
      deps.mcpGateway.invalidateServer(mcpId);
      const removed = deps.mcpGateway.store.removeServer(mcpId);
      deps.mcpGateway.refreshProxyRoutes();

      if (removed) {
        deps.wsHub?.broadcast("mcp.status_atualizado", {
          mcp_id: mcpId,
          ativo: false,
          oauth_status: "disconnected",
          qtd_ferramentas: 0,
          ultimo_erro: null,
        });
      }

      return { ok: removed, removed, mcpId };
    }

    case "suggest_marketplace_app": {
      if (!deps.catalogService) {
        throw new Error("CatalogService não inicializado neste daemon.");
      }
      const slug = readStringArg(args, "slug");
      const query = readStringArg(args, "query", "q");
      let app = slug ? deps.catalogService.findAppBySlug(slug) : null;
      if (!app && (query || slug)) {
        app = deps.catalogService.searchCatalogApps(query ?? slug ?? "", 1)[0] ?? null;
      }

      if (!app) {
        return {
          type: "marketplace_app_suggestion",
          found: false,
          app: null,
        };
      }

      return {
        type: "marketplace_app_suggestion",
        app: {
          slug: app.slug,
          name: app.name,
          tagline: app.tagline,
          category: app.category,
          verified: app.verified,
          prompts: app.prompts,
        },
      };
    }

    // ------------------------------------------------------------------
    // 7 Tools Skills (STORE-03 / D-09)
    // ------------------------------------------------------------------
    case "list_local_skills": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const skills = deps.skillsManager.listSkills({
        query: readStringArg(args, "query", "q"),
        source: (readStringArg(args, "source", "fonte") as MarketplaceSourceFilter) ?? "all",
        agentId: readStringArg(args, "agentId", "agenteId"),
        category: readStringArg(args, "category", "categoria"),
      });
      return { total: skills.length, skills };
    }

    case "read_local_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!slugOrId) {
        throw new Error("Informe 'slugOrId' da habilidade.");
      }
      const result = deps.skillsManager.readSkill(slugOrId);
      if (!result) {
        throw new Error(`Habilidade '${slugOrId}' não encontrada.`);
      }
      return result;
    }

    case "create_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const name = readStringArg(args, "name", "nome");
      const description = readStringArg(args, "description", "descricao");
      const instructions = readStringArg(args, "instructions", "instrucoes");
      if (!name || !description || !instructions) {
        throw new Error("Informe 'name', 'description' e 'instructions' para criar a habilidade.");
      }
      const created = deps.skillsManager.createCustomSkill({
        name,
        slug: readStringArg(args, "slug"),
        description,
        category: readStringArg(args, "category", "categoria") ?? "Automação & Rotinas",
        instructions,
        agentIds: readStringArrayArg(args, "agentIds", "agentes"),
      });
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: created.skillId,
        acao: "criada",
      });
      return { ok: true, skill: created };
    }

    case "revise_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      const instructions = readStringArg(args, "instructions", "instrucoes");
      if (!slugOrId || !instructions) {
        throw new Error("Informe 'slugOrId' e 'instructions' para revisar a habilidade.");
      }
      const updated = deps.skillsManager.reviseSkill(slugOrId, {
        name: readStringArg(args, "name", "nome"),
        description: readStringArg(args, "description", "descricao"),
        category: readStringArg(args, "category", "categoria"),
        instructions,
      });
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: updated.skillId,
        acao: "atualizada",
      });
      return { ok: true, skill: updated };
    }

    case "install_local_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!slugOrId) {
        throw new Error("Informe 'slugOrId' da habilidade a instalar.");
      }
      const targetAgentIds = readStringArrayArg(args, "targetAgentIds", "agentIds", "agentes");
      const installed = deps.skillsManager.installCatalogSkill(slugOrId, targetAgentIds);
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: installed.skillId,
        acao: "instalada",
      });
      return { ok: true, skill: installed };
    }

    case "set_skill_enabled": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const agenteId = readStringArg(args, "agenteId", "agentId") ?? deps.agenteId;
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!agenteId || !slugOrId || typeof args.habilitada !== "boolean") {
        throw new Error("Informe 'agenteId', 'slugOrId' e 'habilitada' (boolean).");
      }
      const res = deps.skillsManager.setSkillEnabledForAgent(agenteId, slugOrId, args.habilitada);
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: res.skillId,
        acao: "vinculada",
      });
      return { ok: true, ...res };
    }

    case "uninstall_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!slugOrId) {
        throw new Error("Informe 'slugOrId' da habilidade a desinstalar.");
      }
      const res = deps.skillsManager.uninstallSkill(slugOrId);
      if (res.removed && res.skillId) {
        deps.wsHub?.broadcast("loja.skill_atualizada", {
          skill_id: res.skillId,
          acao: "removida",
        });
      }
      return { ok: res.removed, ...res };
    }

    case "validar_integracao_meta": {
      const contaId = readStringArg(args, "contaId", "conta_id");
      return await validateMetaIntegration(deps.vault, deps.fetchImpl, {
        nativeStore: nativeStore ?? undefined,
        contaId: contaId ?? null,
      });
    }

    case "consultar_metricas_meta": {
      const rawPeriodo = readStringArg(args, "periodo");
      const periodo: "7d" | "28d" | "30d" | "90d" =
        rawPeriodo === "7d" || rawPeriodo === "28d" || rawPeriodo === "30d" || rawPeriodo === "90d"
          ? rawPeriodo
          : "30d";
      const rawLimit =
        typeof args.limite_posts === "number" ? args.limite_posts : Number(args.limite_posts ?? 15);
      const incluirReels = typeof args.incluir_reels === "boolean" ? args.incluir_reels : true;
      const contaId = readStringArg(args, "conta_id", "contaId");
      return await fetchMetaAccountAndMediaInsights(
        {
          periodo,
          limite_posts: Number.isFinite(rawLimit) ? rawLimit : 15,
          incluir_reels: incluirReels,
          conta_id: contaId,
        },
        {
          vault: deps.vault,
          nativeStore: nativeStore ?? undefined,
          fetchImpl: deps.fetchImpl,
        }
      );
    }

    case "meta_publicar": {
      if (!deps.vault) {
        throw new Error("Cofre AES-256-GCM indisponível neste contexto.");
      }
      return await metaPublishTool(
        {
          media_type: (readStringArg(args, "media_type") ?? "IMAGE") as MetaPublishParams["media_type"],
          media_urls: readStringArrayArg(args, "media_urls"),
          caption: readStringArg(args, "caption") ?? "",
          approved_by_human: args.approved_by_human === true,
          conta_id: readStringArg(args, "conta_id", "contaId"),
        },
        {
          vault: deps.vault,
          nativeStore: nativeStore ?? undefined,
          fetchImpl: deps.fetchImpl,
        }
      );
    }

    case "salvar_identidade_marca": {
      if (!deps.providerConnection) {
        throw new Error("Serviço de configurações/onboarding indisponível para salvar identidade da marca.");
      }
      const patch: Record<string, unknown> = {};
      for (const k of [
        "marca_nome",
        "perfil_handle",
        "nicho",
        "publico_alvo",
        "oferta_principal",
        "tom_voz",
      ]) {
        const val = readStringArg(args, k);
        if (val !== undefined) patch[k] = val;
      }
      if (args.cores && typeof args.cores === "object" && !Array.isArray(args.cores)) {
        patch.cores = args.cores;
      }
      if (args.fontes && typeof args.fontes === "object" && !Array.isArray(args.fontes)) {
        patch.fontes = args.fontes;
      }
      const identidade = await saveBrandIdentity(
        deps.providerConnection,
        workspaceRoot,
        patch as Parameters<typeof saveBrandIdentity>[2]
      );
      const updatedOnboarding = deps.providerConnection.getOnboardingState();
      deps.wsHub?.broadcast("onboarding:updated", {
        onboarding: updatedOnboarding,
        setup_assistant_visible: updatedOnboarding.setup_assistant_dismissed !== true,
      });
      return { ok: true, identidade, onboarding: updatedOnboarding };
    }

    case "concluir_setup_inicial": {
      if (!deps.providerConnection) {
        throw new Error("Serviço de onboarding indisponível para concluir setup.");
      }
      const state = setSetupAssistantState(
        deps.db,
        deps.providerConnection,
        workspaceRoot,
        "dismiss"
      );
      deps.wsHub?.broadcast("onboarding:updated", {
        onboarding: state.onboarding,
        setup_assistant_visible: state.setup_assistant_visible,
      });
      return {
        ok: true,
        motivo: readStringArg(args, "motivo") ?? "Setup inicial concluído.",
        setup_assistant_visible: false,
        onboarding: state.onboarding,
      };
    }

    case "concluir_conexao_vps": {
      if (!deps.providerConnection) {
        throw new Error("Serviço de estado indisponível para ocultar o especialista VPS.");
      }
      const state = setVpsAssistantState(deps.db, deps.providerConnection, "dismiss");
      deps.wsHub?.broadcast("vps_assistant:updated", state);
      return {
        ok: true,
        motivo: readStringArg(args, "motivo") ?? "Fluxo VPS concluído.",
        vps_assistant_visible: false,
      };
    }

    case "generate_image": {
      const promptImg = readStringArg(args, "prompt", "descricao", "briefing");
      if (!promptImg) {
        throw new Error("Informe 'prompt' para gerar a imagem.");
      }
      const rawFmt = readStringArg(args, "formato", "aspect_ratio") ?? "3:4";
      const formato: "3:4" | "9:16" | "1:1" | "16:9" =
        rawFmt === "9:16" || rawFmt === "3:4" || rawFmt === "1:1" || rawFmt === "16:9"
          ? rawFmt
          : "3:4";

      const rawMotor = (readStringArg(args, "motor", "engine") ?? "auto").toLowerCase();
      const modeloSolicitado = readStringArg(args, "modelo", "model");
      const rawRes = readStringArg(args, "resolucao", "resolution");
      const resolucao = rawRes === "1K" || rawRes === "2K" || rawRes === "4K" ? rawRes : undefined;
      const rawQual = readStringArg(args, "qualidade", "quality");
      const qualidade = rawQual === "low" || rawQual === "medium" || rawQual === "high" ? rawQual : undefined;

      const usarFotosReais = args.usar_fotos_reais !== false;
      const specificImages = readStringArrayArg(args, "imagens_referencia", "image_paths");
      const specificFotos = readStringArrayArg(args, "fotos_especificas", "fotos");
      const specificReferencias = readStringArrayArg(args, "referencias_especificas", "referencias");
      const explicitAny =
        specificImages.length > 0 || specificFotos.length > 0 || specificReferencias.length > 0;

      const maxFotos =
        typeof args.max_fotos === "number" && Number.isFinite(args.max_fotos)
          ? Math.max(0, Math.trunc(args.max_fotos))
          : explicitAny
            ? 0
            : usarFotosReais
              ? 6
              : 0;
      const maxReferencias =
        typeof args.max_referencias === "number" && Number.isFinite(args.max_referencias)
          ? Math.max(0, Math.trunc(args.max_referencias))
          : explicitAny
            ? 0
            : 4;
      const maxLogos =
        typeof args.max_logos === "number" && Number.isFinite(args.max_logos)
          ? Math.max(0, Math.trunc(args.max_logos))
          : explicitAny
            ? 0
            : 1;

      const hasGeminiKey = Boolean(
        deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "gemini_api_key", "google_api_key")
      );
      const hasOpenAiKey = Boolean(
        deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "openai_api_key")
      );
      const hasFalKey = Boolean(
        deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "fal_api_key", "flux_api_key")
      );
      const agService = deps.providerConnection?.getAntigravityService() ?? null;
      const agSnapshot = agService ? await agService.getLiveSnapshot(false).catch(() => null) : null;
      const hasAntigravityAccount = Boolean(
        agSnapshot?.contas?.some((c) => c.estado === "conectado" || Boolean(c.token_valido))
      );

      type ImageCandidateEngine = ImageProviderEngine | "antigravity";
      const engineQueue: ImageCandidateEngine[] = [];

      if (
        rawMotor === "gemini" ||
        rawMotor === "openai" ||
        rawMotor === "flux" ||
        rawMotor === "antigravity"
      ) {
        if (rawMotor === "gemini" && !hasGeminiKey) {
          throw new Error("GEMINI_API_KEY ausente no Cofre para gerar via Gemini Nano Banana 2.1.");
        }
        if (rawMotor === "openai" && !hasOpenAiKey) {
          throw new Error("OPENAI_API_KEY ausente no Cofre para gerar via OpenAI GPT Image.");
        }
        if (rawMotor === "flux" && !hasFalKey) {
          throw new Error("FAL_API_KEY / FLUX_API_KEY ausente no Cofre para gerar via Flux.");
        }
        if (rawMotor === "antigravity" && (!agService || !hasAntigravityAccount)) {
          throw new Error("Nenhuma conta Google/Antigravity conectada para gerar imagem.");
        }
        engineQueue.push(rawMotor);
      } else {
        if (hasGeminiKey) engineQueue.push("gemini");
        if (hasAntigravityAccount && agService) {
          engineQueue.push("antigravity");
          if (hasOpenAiKey) engineQueue.push("openai");
        } else if (hasOpenAiKey) {
          engineQueue.push("openai");
        }
        if (hasFalKey) engineQueue.push("flux");
      }

      if (engineQueue.length === 0) {
        throw new Error(
          "Nenhum motor de geração de imagem configurado. Salve uma Gemini API Key (Nano Banana 2.1), OpenAI API Key (GPT Image 2.6/2.5), Flux Key no Cofre ou conecte uma conta Google/Antigravity em Conexões."
        );
      }

      const maxTotalRefs = engineQueue[0] === "openai" ? MAX_REFERENCES_BY_ENGINE.openai : MAX_REFERENCES_BY_ENGINE.gemini;
      const assets = selectBalancedVisualAssets(deps.db, workspaceRoot, {
        usarFotosReais,
        specificImages,
        specificFotos,
        specificReferencias,
        maxFotos,
        maxReferencias,
        maxLogos,
        maxTotal: maxTotalRefs,
      });

      const imgStepId = `step-img-${randomUUID().slice(0, 8)}`;
      deps.onImageProgress?.({
        status: "executando",
        formato,
        mensagem: `Gerando arte ${formato} com ${assets.length} referência(s)...`,
        stepId: imgStepId,
      });

      try {
        const onboarding = deps.providerConnection?.getOnboardingState() ?? {
          marca_nome: "[NOME_DA_MARCA]",
          perfil_handle: "[@SEU_PERFIL]",
        };
        const dirArtes = resolve(workspaceRoot, "saidas", "artes");
        mkdirSync(dirArtes, { recursive: true });
        const arquivoId = `arte-${randomUUID().slice(0, 8)}`;
        const hasFacialRef = assets.some((a) => a.role === "foto_real");
        const composedPrompt = `Crie uma arte profissional de Instagram (${formato}) para ${onboarding.marca_nome} (${onboarding.perfil_handle}). Preserve fielmente as fotos reais do usuário rotuladas como [FOTO REAL DO USUÁRIO]. Instrução visual: ${promptImg}`;

        let lastErr: unknown = null;
        for (const candidateEngine of engineQueue) {
          try {
            let fileName = `${arquivoId}.png`;
            let diskPath = resolve(dirArtes, fileName);
            let mimeType = "image/png";
            let modelUsed = "";
            let referencesLoaded = assets.length;

            if (candidateEngine === "antigravity" && agService && agSnapshot) {
              const imgGen = await agService.executeCodeAssistGenerate({
                model: modeloSolicitado || agSnapshot.imageGenerationModelIds[0] || "gemini-3.1-flash-image",
                messages: [{ role: "user", text: composedPrompt }],
                imagePaths: assets.map((a) => a.path),
                labeledImages: assets,
                generateImage: true,
                agentId: deps.agenteId,
              });
              if (imgGen.images.length === 0) {
                throw new Error("O modelo de imagem Antigravity não retornou arquivo visual neste turno.");
              }
              const firstImg = imgGen.images[0]!;
              mimeType = firstImg.mimeType;
              const ext = mimeType.includes("png") ? ".png" : mimeType.includes("webp") ? ".webp" : ".jpg";
              fileName = `${arquivoId}${ext}`;
              diskPath = resolve(dirArtes, fileName);
              writeFileSync(diskPath, Buffer.from(firstImg.dataBase64, "base64"));
              modelUsed = imgGen.modelUsed;
            } else if (deps.vault && candidateEngine !== "antigravity") {
              const imgRes = await generateImageTool(
                {
                  aspect_ratio: formato,
                  prompt: composedPrompt,
                  image_paths: assets.map((a) => a.path),
                  facial_consistency: hasFacialRef || usarFotosReais,
                  output_path: diskPath,
                  engine: candidateEngine,
                  model: modeloSolicitado,
                  resolution: resolucao,
                  quality: qualidade,
                },
                { vault: deps.vault, fetchImpl: deps.fetchImpl }
              );
              mimeType = imgRes.mime_type;
              modelUsed = imgRes.model_used;
              referencesLoaded = imgRes.references_loaded;
            } else {
              continue;
            }

            const buf = readFileSync(diskPath);
            const relPath = `saidas/artes/${fileName}`;
            const urlRaw = `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`;
            const agora = new Date().toISOString();
            deps.db.connection
              .prepare(
                `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
                 VALUES (?, ?, ?, ?, ?, 'gerado', ?, NULL, ?);`
              )
              .run(arquivoId, fileName, relPath, mimeType, buf.length, deps.agenteId ?? null, agora);

            const anexo: AnexoChat = {
              arquivo_id: arquivoId,
              nome: fileName,
              caminho_relativo: relPath,
              url: urlRaw,
              mime_type: mimeType,
              tamanho_bytes: buf.length,
              tipo_uso: "gerado",
            };

            deps.onImageProgress?.({
              status: "concluido",
              formato,
              mensagem: `Arte gerada (${(buf.length / 1024).toFixed(0)} KB · ${modelUsed})`,
              stepId: imgStepId,
            });

            return {
              ok: true,
              anexo,
              caminho_relativo: relPath,
              url: urlRaw,
              formato,
              engine_used: candidateEngine,
              modelUsed,
              references_loaded: referencesLoaded,
              tamanho_bytes: buf.length,
              fotos_utilizadas: assets.filter((a) => a.role === "foto_real").map((a) => a.relPath),
              referencias_utilizadas: assets.filter((a) => a.role === "referencia_estilo").map((a) => a.relPath),
            };
          } catch (attemptErr) {
            lastErr = attemptErr;
            if (rawMotor !== "auto") throw attemptErr;
          }
        }

        throw lastErr instanceof Error ? lastErr : new Error("Falha na geração visual.");
      } catch (err) {
        deps.onImageProgress?.({
          status: "erro",
          formato,
          mensagem: err instanceof Error ? err.message.slice(0, 90) : "Falha na geração visual.",
          stepId: imgStepId,
        });
        throw err;
      }
    }

    case "generate_video": {
      if (!deps.vault) {
        throw new Error("VaultService indisponível para gerar vídeo com Gemini Omni 1.2 Flash.");
      }
      const promptVid = readStringArg(args, "prompt", "descricao", "briefing");
      if (!promptVid) {
        throw new Error("Informe 'prompt' para gerar o vídeo.");
      }
      const rawFmt = readStringArg(args, "formato", "aspect_ratio") ?? "9:16";
      const formato: "9:16" | "16:9" | "1:1" =
        rawFmt === "16:9" || rawFmt === "1:1" || rawFmt === "9:16" ? rawFmt : "9:16";
      const duracaoSeg =
        typeof args.duracao_segundos === "number" && Number.isFinite(args.duracao_segundos)
          ? Math.round(args.duracao_segundos)
          : typeof args.duration_seconds === "number" && Number.isFinite(args.duration_seconds)
            ? Math.round(args.duration_seconds)
            : 8;
      const rawRes = readStringArg(args, "resolucao", "resolution");
      const resolucao =
        rawRes === "360p" || rawRes === "720p" || rawRes === "1080p" || rawRes === "4k"
          ? rawRes
          : "720p";
      const modeloSolicitado = readStringArg(args, "modelo", "model");

      const specificImages = readStringArrayArg(args, "imagens_referencia", "image_paths");
      const specificFotos = readStringArrayArg(args, "fotos_especificas", "fotos");
      const specificReferencias = readStringArrayArg(args, "referencias_especificas", "referencias");
      const explicitAny =
        specificImages.length > 0 || specificFotos.length > 0 || specificReferencias.length > 0;
      const usarFotosReais = args.usar_fotos_reais !== false;

      const maxFotos =
        typeof args.max_fotos === "number" && Number.isFinite(args.max_fotos)
          ? Math.max(0, Math.trunc(args.max_fotos))
          : explicitAny
            ? 0
            : usarFotosReais
              ? 3
              : 0;
      const maxReferencias =
        typeof args.max_referencias === "number" && Number.isFinite(args.max_referencias)
          ? Math.max(0, Math.trunc(args.max_referencias))
          : explicitAny
            ? 0
            : 2;

      const assets =
        !explicitAny && args.usar_fotos_reais === false && maxReferencias === 0
          ? []
          : selectBalancedVisualAssets(deps.db, workspaceRoot, {
              usarFotosReais,
              specificImages,
              specificFotos,
              specificReferencias,
              maxFotos,
              maxReferencias,
              maxLogos: 0,
              maxTotal: MAX_VIDEO_REFERENCE_IMAGES,
            });

      const vidStepId = `step-vid-${randomUUID().slice(0, 8)}`;
      deps.onImageProgress?.({
        status: "executando",
        formato,
        mensagem: `Gerando vídeo ${formato} (${duracaoSeg}s · ${resolucao}) com ${assets.length} referência(s)...`,
        stepId: vidStepId,
      });

      try {
        const onboarding = deps.providerConnection?.getOnboardingState() ?? {
          marca_nome: "[NOME_DA_MARCA]",
          perfil_handle: "[@SEU_PERFIL]",
        };
        const dirVideos = resolve(workspaceRoot, "saidas", "videos");
        mkdirSync(dirVideos, { recursive: true });
        const arquivoId = `video-${randomUUID().slice(0, 8)}`;
        const fileName = `${arquivoId}.mp4`;
        const diskPath = resolve(dirVideos, fileName);

        const vidRes = await generateVideoTool(
          {
            prompt: `Vídeo criativo para ${onboarding.marca_nome} (${onboarding.perfil_handle}). ${promptVid}`,
            aspect_ratio: formato,
            duration_seconds: duracaoSeg,
            resolution: resolucao,
            image_paths: assets.map((a) => a.path),
            output_path: diskPath,
            model: modeloSolicitado,
          },
          {
            vault: deps.vault,
            fetchImpl: deps.fetchImpl,
            onProgress: (msg) => {
              deps.onImageProgress?.({
                status: "executando",
                formato,
                mensagem: msg,
                stepId: vidStepId,
              });
            },
          }
        );

        const relPath = `saidas/videos/${fileName}`;
        const urlRaw = `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`;
        const agora = new Date().toISOString();
        deps.db.connection
          .prepare(
            `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
             VALUES (?, ?, ?, 'video/mp4', ?, 'video', ?, NULL, ?);`
          )
          .run(arquivoId, fileName, relPath, vidRes.size_bytes, deps.agenteId ?? null, agora);

        const anexo: AnexoChat = {
          arquivo_id: arquivoId,
          nome: fileName,
          caminho_relativo: relPath,
          url: urlRaw,
          mime_type: "video/mp4",
          tamanho_bytes: vidRes.size_bytes,
          tipo_uso: "video",
        };

        deps.onImageProgress?.({
          status: "concluido",
          formato,
          mensagem: `Vídeo gerado (${(vidRes.size_bytes / 1024).toFixed(0)} KB · ${vidRes.duration_seconds}s · ${vidRes.model_used})`,
          stepId: vidStepId,
        });

        return {
          ok: true,
          anexo,
          caminho_relativo: relPath,
          url: urlRaw,
          formato,
          duracao_segundos: vidRes.duration_seconds,
          resolucao: vidRes.resolution,
          modelUsed: vidRes.model_used,
          references_loaded: vidRes.references_loaded,
          tamanho_bytes: vidRes.size_bytes,
          interaction_id: vidRes.interaction_id,
        };
      } catch (err) {
        deps.onImageProgress?.({
          status: "erro",
          formato,
          mensagem: err instanceof Error ? err.message.slice(0, 90) : "Falha na geração de vídeo.",
          stepId: vidStepId,
        });
        throw err;
      }
    }

    default:
      throw new Error(`Ferramenta de extensão desconhecida: ${toolName}`);
  }
}

export async function executeStudioRoutineTool(
  toolName: string,
  args: Record<string, unknown>,
  options: {
    agenteId: string;
    turnOrigin?: RoutineToolExecutionContext["turnOrigin"];
    execucaoId?: string | null;
    routineToolsDeps?: RoutineToolsDeps;
    flags?: RoutineToolExecutionContext["flags"];
  }
): Promise<unknown> {
  if (!options.routineToolsDeps) {
    throw new Error("Serviço de rotinas e webhooks ainda não inicializado neste daemon.");
  }
  const ctx: RoutineToolExecutionContext = {
    agenteId: options.agenteId,
    turnOrigin: options.turnOrigin ?? "human",
    execucaoId: options.execucaoId ?? null,
    flags: options.flags ?? { noUpdateCalled: false, failureReason: null },
  };
  return await executeRoutineToolCall(
    {
      id: `studio-rot-${randomUUID().slice(0, 8)}`,
      name: toolName,
      arguments: args,
    },
    ctx,
    options.routineToolsDeps
  );
}

export function getChatWorkflowToolCatalog(): ToolDefinition[] {
  return WORKFLOW_TOOL_DEFINITIONS;
}

export async function executeChatWorkflowTool(
  toolName: string,
  args: Record<string, unknown>,
  options: {
    store?: WorkflowStore;
    engine?: WorkflowEngine;
    wsHub?: WebSocketHub;
    agenteId?: string;
    requestSeed?: string;
  }
): Promise<unknown> {
  if (!options.store || !options.engine) {
    throw new Error("Serviço de workflows em grafo ainda não inicializado neste daemon.");
  }
  return await executeWorkflowToolCall(toolName, args, {
    store: options.store,
    engine: options.engine,
    wsHub: options.wsHub,
    agenteId: options.agenteId,
    requestSeed: options.requestSeed,
  });
}

export const PHASE13_TOOL_NAMES = new Set([
  "start_task",
  "await_event",
  "close_wait",
  "list_waits",
  "interrupt_agent",
  "start_new_chat",
  "pin_message",
  "schedule_wakeup",
  "list_wakeups",
  "cancel_wakeup",
]);

export function isPhase13ToolName(name: string): boolean {
  return PHASE13_TOOL_NAMES.has(name);
}

export const PHASE13_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "start_task",
    description:
      "Inicia uma sub-tarefa paralela em uma nova thread isolada sem bloquear o chat principal. Disponível apenas no chat principal do agente ou em thread de rotina.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Título curto da tarefa paralela (1 a 140 caracteres)",
        },
        brief: {
          type: "string",
          description: "Briefing completo e instruções para o agente executar na sub-thread",
        },
      },
      required: ["title", "brief"],
    },
  },
  {
    name: "await_event",
    description:
      "Registra uma espera longa (>15 min) para acordar o agente automaticamente quando uma rotina futura ou webhook com waitId disparar.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Resumo do que está sendo aguardado e o que fazer quando despertar (1 a 2000 caracteres)",
        },
        routineId: {
          type: "string",
          description: "ID opcional da rotina específica vinculada a esta espera",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "close_wait",
    description: "Encerra definitivamente uma espera aberta após ela ter sido resolvida ou cancelada.",
    parameters: {
      type: "object",
      properties: {
        waitId: { type: "string", description: "ID da espera (waitId) a encerrar" },
        agentId: { type: "string", description: "ID opcional do agente dono da espera" },
      },
      required: ["waitId"],
    },
  },
  {
    name: "list_waits",
    description: "Lista todas as esperas abertas no agente informado (ou no agente atual).",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID opcional do agente alvo" },
      },
    },
  },
  {
    name: "interrupt_agent",
    description:
      "Cancela mensagens pendentes que você enviou para outro agente e interrompe o turno dele se estiver executando exclusivamente trabalho seu.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID do agente alvo (nunca você mesmo)" },
        reason: { type: "string", description: "Motivo breve exibido ao agente interrompido" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "start_new_chat",
    description:
      "Inicia um novo chat limpo para o modelo ao final do turno quando a fila estiver vazia, salvando memórias essenciais e preservando todo o histórico visual.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "pin_message",
    description:
      "Fixa ou desafixa uma mensagem importante nesta conversa. Sem quote, fixa a última mensagem do usuário no turno atual.",
    parameters: {
      type: "object",
      properties: {
        quote: {
          type: "string",
          description: "Trecho exato (1 a 500 chars) de uma mensagem anterior para localizar e fixar",
        },
        pinned: {
          type: "boolean",
          description: "true para fixar (padrão) ou false para desafixar (apenas pins do agente)",
        },
      },
    },
  },
  {
    name: "schedule_wakeup",
    description:
      "Agenda um timer persistido no SQLite (10s a 86400s, único ou recorrente até 50 ciclos) para retomar este agente automaticamente na mesma conversa/tópico (ou WhatsApp). Use sempre que precisar checar respostas, aguardar intervalos curtos (< 3 min) ou executar follow-ups cronometrados.",
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "ID ou @apelido do agente (opcional; padrão é o agente atual).",
        },
        delaySeconds: {
          type: "number",
          description: "Intervalo em segundos até o disparo (10 a 86400; padrão 60).",
        },
        recurring: {
          type: "boolean",
          description: "Se true, reagenda automaticamente a cada ciclo até maxIterations ou cancel_wakeup.",
        },
        maxIterations: {
          type: "number",
          description: "Máximo de ciclos para wakeups recorrentes (1 a 50; padrão 10 quando recorrente).",
        },
        instruction: {
          type: "string",
          description: "Instrução clara do que verificar e fazer ao despertar neste timer.",
        },
      },
      required: ["instruction"],
    },
  },
  {
    name: "list_wakeups",
    description:
      "Lista wakeups/timers agendados ou em execução do agente (ou de outro agente por ID/@apelido).",
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "ID ou @apelido do agente (opcional; padrão é o agente atual).",
        },
        includeInactive: {
          type: "boolean",
          description: "Se true, inclui também concluídos, cancelados e com falha.",
        },
      },
    },
  },
  {
    name: "cancel_wakeup",
    description:
      "Cancela um wakeup ativo previamente criado com schedule_wakeup (use ao encerrar um ciclo recorrente de checagem).",
    parameters: {
      type: "object",
      properties: {
        wakeupId: {
          type: "string",
          description: "Identificador do wakeup (ex.: 'wk_...').",
        },
        agentId: {
          type: "string",
          description: "ID ou @apelido do agente proprietário (opcional).",
        },
      },
      required: ["wakeupId"],
    },
  },
];

export interface Phase13ToolServices {
  db?: CriativoDatabase;
  tasksService?: AgentTasksService;
  waitsService?: AgentWaitsService;
  wakeupService?: AgentWakeupService;
  queueControls?: QueueControlsService;
  contextReset?: ContextResetService;
  pinsService?: MessagePinsService;
}

export interface Phase13ToolContext {
  agenteId: string;
  turnoId: string;
  callId: string;
  threadId: string | null;
  canalId: string | null;
  entregaOrigemId: string;
  pedidoTexto: string;
  isRoutine?: boolean;
  isResumingWait?: boolean;
  channelOrigin?: "web" | "whatsapp";
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
}

/**
 * Executa de maneira segura e corrigível qualquer uma das 7 ferramentas nativas da Fase 13.
 */
export async function executePhase13Tool(
  callName: string,
  args: Record<string, unknown>,
  context: Phase13ToolContext,
  services: Phase13ToolServices,
): Promise<{ handled: boolean; result?: unknown }> {
  if (!isPhase13ToolName(callName)) {
    return { handled: false };
  }

  try {
    switch (callName) {
      case "start_task": {
        if (!services.tasksService) {
          return { handled: true, result: { erro: "AgentTasksService indisponível." } };
        }
        const title = readStringArg(args, "title", "titulo") ?? "";
        const brief = readStringArg(args, "brief", "instrucao", "conteudo") ?? "";
        const result = services.tasksService.startTaskFromTool(
          {
            agenteId: context.agenteId,
            callerThreadId: context.threadId,
            callerChannelId: context.canalId,
            turnoId: context.turnoId,
            callId: context.callId,
          },
          { title, brief },
        );
        return { handled: true, result };
      }

      case "schedule_wakeup": {
        if (!services.wakeupService) {
          return { handled: true, result: { erro: "AgentWakeupService indisponível." } };
        }
        const instruction = readStringArg(args, "instruction", "instrucao", "prompt", "note") ?? "";
        const agentId = readStringArg(args, "agentId", "agenteId", "agente_id") ?? undefined;
        const delaySeconds =
          typeof args.delaySeconds === "number"
            ? args.delaySeconds
            : typeof args.delay_seconds === "number"
              ? args.delay_seconds
              : undefined;
        const recurring = typeof args.recurring === "boolean" ? args.recurring : undefined;
        const maxIterations =
          typeof args.maxIterations === "number"
            ? args.maxIterations
            : typeof args.max_iterations === "number"
              ? args.max_iterations
              : undefined;
        const result = services.wakeupService.scheduleWakeup(
          {
            agenteId: context.agenteId,
            canalId: context.canalId,
            threadId: context.threadId,
            channelOrigin: context.channelOrigin ?? "web",
            whatsappContaId: context.whatsappContaId ?? null,
            whatsappChatJid: context.whatsappChatJid ?? null,
          },
          {
            agentId,
            delaySeconds,
            recurring,
            maxIterations,
            instruction,
          },
        );
        return { handled: true, result };
      }

      case "list_wakeups": {
        if (!services.wakeupService) {
          return { handled: true, result: { erro: "AgentWakeupService indisponível." } };
        }
        const rawTargetAgent = readStringArg(args, "agentId", "agenteId", "agente_id") ?? context.agenteId;
        const targetAgent =
          (services.db ? resolveAgentIdFromDb(services.db, rawTargetAgent) : null) ?? rawTargetAgent;
        const items = services.wakeupService.listWakeups(
          targetAgent,
          Boolean(args.includeInactive),
        );
        return {
          handled: true,
          result: {
            agentId: targetAgent,
            total: items.length,
            wakeups: items,
          },
        };
      }

      case "cancel_wakeup": {
        if (!services.wakeupService) {
          return { handled: true, result: { erro: "AgentWakeupService indisponível." } };
        }
        const wakeupId = readStringArg(args, "wakeupId", "wakeup_id", "id") ?? "";
        const agentId = readStringArg(args, "agentId", "agenteId", "agente_id") ?? undefined;
        const result = services.wakeupService.cancelWakeup(wakeupId, agentId);
        return { handled: true, result };
      }

      case "await_event": {
        if (!services.waitsService) {
          return { handled: true, result: { erro: "AgentWaitsService indisponível." } };
        }
        const note = readStringArg(args, "note", "nota") ?? "";
        const routineId = readStringArg(args, "routineId", "rotinaId", "rotina_id") ?? undefined;
        const result = services.waitsService.openWaitFromTool(
          {
            agenteId: context.agenteId,
            entregaOrigemId: context.entregaOrigemId,
            pedidoTexto: context.pedidoTexto,
            callerThreadId: context.threadId,
            callerIsRoutine: Boolean(context.isRoutine),
            isResumingWait: context.isResumingWait,
          },
          { note, routineId },
        );
        return { handled: true, result };
      }

      case "close_wait": {
        if (!services.waitsService) {
          return { handled: true, result: { erro: "AgentWaitsService indisponível." } };
        }
        const waitId = readStringArg(args, "waitId", "esperaId", "espera_id") ?? "";
        const agentId = readStringArg(args, "agentId", "agenteId", "agente_id") ?? undefined;
        if (!waitId) {
          return { handled: true, result: { erro: "Informe 'waitId' para encerrar a espera." } };
        }
        const result = services.waitsService.closeWait(waitId, agentId);
        return { handled: true, result };
      }

      case "list_waits": {
        if (!services.waitsService) {
          return { handled: true, result: { erro: "AgentWaitsService indisponível." } };
        }
        const targetAgent =
          readStringArg(args, "agentId", "agenteId", "agente_id") ?? context.agenteId;
        const result = services.waitsService.listWaitsFromTool(targetAgent);
        return { handled: true, result };
      }

      case "interrupt_agent": {
        if (!services.queueControls) {
          return { handled: true, result: { erro: "QueueControlsService indisponível." } };
        }
        const rawTargetAgent = readStringArg(args, "agentId", "agenteId", "agente_id") ?? "";
        const targetAgent =
          (services.db && rawTargetAgent ? resolveAgentIdFromDb(services.db, rawTargetAgent) : null) ??
          rawTargetAgent;
        const reason = readStringArg(args, "reason", "motivo") ?? undefined;
        if (!targetAgent) {
          return { handled: true, result: { erro: "Informe 'agentId' do agente alvo." } };
        }
        const result = services.queueControls.interruptAgentFromTool(
          context.agenteId,
          targetAgent,
          reason,
        );
        return { handled: true, result };
      }

      case "start_new_chat": {
        if (!services.contextReset) {
          return { handled: true, result: { erro: "ContextResetService indisponível." } };
        }
        const result = services.contextReset.requestNewChat({
          agenteId: context.agenteId,
          threadId: context.threadId,
        });
        return { handled: true, result };
      }

      case "pin_message": {
        if (!services.pinsService) {
          return { handled: true, result: { erro: "MessagePinsService indisponível." } };
        }
        const quote = readStringArg(args, "quote", "trecho") ?? undefined;
        const pinned = typeof args.pinned === "boolean" ? args.pinned : true;
        const result = services.pinsService.pinFromTool({
          agenteId: context.agenteId,
          threadId: context.threadId ?? `main:${context.agenteId}`,
          currentTurnId: context.turnoId,
          quote,
          pinned,
        });
        return { handled: true, result };
      }

      default:
        return { handled: false };
    }
  } catch (err) {
    return {
      handled: true,
      result: {
        ok: false,
        erro: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function readAgentContextCutoffAt(db: CriativoDatabase, agenteId: string): string | null {
  const row = db.connection
    .prepare("SELECT config_json FROM projecao_agentes WHERE agente_id = ?;")
    .get(agenteId) as { config_json: string } | undefined;
  if (!row) return null;
  try {
    const cfg = JSON.parse(row.config_json) as { context_cutoff_at?: unknown };
    return typeof cfg.context_cutoff_at === "string" && cfg.context_cutoff_at.length > 0
      ? cfg.context_cutoff_at
      : null;
  } catch {
    return null;
  }
}

export function buildPhase13SystemGuidance(options?: {
  allowStartTask?: boolean;
  wokenWaitsBlock?: string | null;
}): string {
  const parts: string[] = [
    "## Sub-tarefas, Wakeups/Timers, Esperas, Fila & Contexto (Ferramentas Nativas)",
    "- Use `start_task(title, brief)` quando uma solicitação envolver uma entrega pesada paralela ou múltiplos eixos que possam rodar sem travar o chat principal.",
    "- Use `schedule_wakeup(delaySeconds, instruction, recurring?, maxIterations?)` (10s–86400s), `list_wakeups()` e `cancel_wakeup(wakeupId)` para timers curtos (< 3 min), checagens periódicas de resposta ou retomadas automáticas na mesma conversa/tópico. PROIBIDO afirmar que agendou timer/checagem sem ter executado `schedule_wakeup` com sucesso (`ok: true`).",
    "- Use `await_event(note, routineId?)` para processos externos longos (>15 min) ligados a uma rotina/webhook e `close_wait(waitId)` / `list_waits()` quando concluir.",
    "- Use `pin_message(quote?, pinned?)` para fixar decisões-chave desta conversa, e `start_new_chat()` quando a conversa mudar totalmente de tópico e precisar renovar o contexto.",
  ];
  if (options?.wokenWaitsBlock) {
    parts.push("", options.wokenWaitsBlock);
  }
  return parts.join("\n");
}


// ============================================================================
// Fase 14 — 21 Ferramentas Nativas (+ Aliases Compatíveis):
// Memória/FTS5, Histórico, Shared SQL, Generative UI, Cards/API Keys,
// Biblioteca Hierárquica, Reação Emoji 1:1 e send_message Inter-Agentes
// ============================================================================

export const PHASE14_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "remember",
    description:
      "Registra ou atualiza uma memória de longo prazo no agente atual (em staging até a conclusão do turno). Respeita o orçamento de 8.192 bytes para 'essential' e protege memórias manuais do usuário.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Texto conciso da regra, preferência ou aprendizado durável." },
        memoryId: { type: "string", description: "ID opcional de memória anterior a atualizar." },
        inclusion: {
          type: "string",
          enum: ["essential", "searchable"],
          description: "'essential' entra sempre no prompt vivo; 'searchable' fica disponível via memory_recall.",
        },
        site: { type: "string", description: "Domínio opcional associado à memória (ex.: instagram.com)." },
      },
      required: ["text"],
    },
  },
  {
    name: "forget_memory",
    description:
      "Agenda a remoção de uma memória automática obsoleta ao concluir o turno (memórias manuais controladas pelo usuário são protegidas).",
    parameters: {
      type: "object",
      properties: {
        memoryId: { type: "string", description: "ID da memória a esquecer." },
        text: { type: "string", description: "Texto exato alternativo caso não possua o ID." },
      },
    },
  },
  {
    name: "memory_recall",
    description:
      "Busca memórias via SQLite FTS5 BM25 ('search'), lista memórias paginadas ('list') ou ajusta inclusão ('set_inclusion').",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["search", "list", "set_inclusion"],
          description: "Operação desejada (padrão: 'search' quando query presente, senão 'list').",
        },
        query: { type: "string", description: "Termos de busca FTS5." },
        site: { type: "string", description: "Domínio opcional para filtrar memórias." },
        limit: { type: "number", description: "Limite de itens retornados (1 a 50)." },
        after: { type: "string", description: "Cursor temporal ISO para paginação em 'list'." },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              memoryId: { type: "string" },
              inclusion: { type: "string", enum: ["essential", "searchable"] },
            },
            required: ["memoryId", "inclusion"],
          },
        },
      },
    },
  },
  {
    name: "search_memories",
    description: "Alias direto para buscar memórias do agente via FTS5 BM25.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        site: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description: "Alias direto para listar memórias paginadas do agente.",
    parameters: {
      type: "object",
      properties: {
        inclusion: { type: "string", enum: ["essential", "searchable"] },
        site: { type: "string" },
        after: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "set_memory_inclusion",
    description: "Altera a categoria ('essential' | 'searchable') de memórias automáticas do agente.",
    parameters: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              memoryId: { type: "string" },
              inclusion: { type: "string", enum: ["essential", "searchable"] },
            },
            required: ["memoryId", "inclusion"],
          },
        },
      },
      required: ["changes"],
    },
  },
  {
    name: "history_search",
    description:
      "Pesquisa conversas, threads e mensagens anteriores do agente com filtro temporal ('24h', '7d', 'YYYY-MM-DD') ou lê trecho contextual ao redor de uma mensagem.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID opcional da tarefa ou thread para restringir a busca." },
        query: { type: "string", description: "Texto a localizar nas mensagens anteriores." },
        after: { type: "string", description: "Filtro temporal relativo ('24h', '7d') ou data ISO." },
        cursor: { type: "string", description: "Cursor base64url retornado em nextCursor." },
        limit: { type: "number", description: "Quantidade máxima de resultados (1 a 50)." },
        messageId: { type: "string", description: "Se informado, lê trecho de mensagens até este messageId." },
        before: { type: "string", description: "Timestamp ISO opcional para ler mensagens anteriores." },
        offset: { type: "number" },
        includeWorkSteps: { type: "boolean" },
        workStepsOffset: { type: "number" },
      },
    },
  },
  {
    name: "history_read",
    description: "Lê um trecho cronológico de mensagens anteriores de uma conversa ou thread do agente.",
    parameters: {
      type: "object",
      properties: {
        canalId: { type: "string" },
        messageId: { type: "string" },
        before: { type: "string" },
        offset: { type: "number" },
        limit: { type: "number" },
        includeWorkSteps: { type: "boolean" },
        workStepsOffset: { type: "number" },
      },
    },
  },
  {
    name: "list_tables",
    description:
      "Lista todas as tabelas SQL colaborativas em shared-tables.db com schema CREATE TABLE, contagem de linhas e agente proprietário.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "query_data",
    description:
      "Executa uma única consulta SQL somente-leitura (SELECT, VALUES ou EXPLAIN) no banco compartilhado entre agentes.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Instrução SQL SELECT/VALUES única." },
        params: {
          type: "array",
          items: {
            type: "string",
            description: "Parâmetro posicional (?): texto, número ou booleano.",
          },
          description: "Parâmetros posicionais opcionais (?).",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "execute_data",
    description:
      "Executa uma única instrução DML/DDL (CREATE, INSERT, UPDATE, DELETE, ALTER, DROP) no banco SQL compartilhado respeitando posse por agente.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Instrução SQL DML/DDL única." },
        params: {
          type: "array",
          items: {
            type: "string",
            description: "Parâmetro posicional (?): texto, número ou booleano.",
          },
          description: "Parâmetros posicionais opcionais (?).",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "delete_table",
    description: "Remove uma tabela do banco SQL compartilhado caso pertença ao agente atual.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome exato da tabela a excluir." },
      },
      required: ["name"],
    },
  },
  {
    name: "html_render",
    description:
      "Renderiza um widget, gráfico, calculadora ou painel HTML interativo em iframe sandboxed no chat com suporte à ponte window.criativoPage.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "Código HTML completo ou fragmento (até 512.000 caracteres)." },
        title: { type: "string", description: "Título curto exibido no cabeçalho do painel." },
        height: { type: "number", description: "Altura inicial sugerida em pixels (80 a 2000)." },
      },
      required: ["html", "title"],
    },
  },
  {
    name: "html_preview",
    description:
      "Valida e pré-renderiza fora de vista um documento HTML antes de exibi-lo ao usuário, retornando altura medida e mensagens de console.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string" },
        width: { type: "number", description: "Largura da viewport de teste (240 a 1600, padrão 728)." },
        appearance: { type: "string", enum: ["dark", "light"] },
      },
      required: ["html"],
    },
  },
  {
    name: "ask_user",
    description:
      "Exibe um cartão interativo com 1 a 3 perguntas estruturadas (opções, múltipla escolha ou entrada secreta mascarada) e aguarda a resposta do usuário.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              header: { type: "string" },
              question: { type: "string" },
              detail: { type: "string" },
              isSecret: { type: "boolean" },
              multiSelect: { type: "boolean" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["label"],
                },
              },
            },
            required: ["question"],
          },
        },
      },
      required: ["questions"],
    },
  },
  {
    name: "ask_ui",
    description:
      "Exibe um cartão de aprovação, formulário estruturado ou confirmação crítica (com suporte a confirmHold para ações destrutivas) e suspende o turno até decisão.",
    parameters: {
      type: "object",
      properties: {
        blockId: { type: "string" },
        block: {
          type: "object",
          properties: {
            type: { type: "string" },
            variant: {
              type: "string",
              enum: ["confirm", "quick_replies", "choice", "form", "approval", "progress", "block_run"],
            },
            title: { type: "string" },
            description: { type: "string" },
            preview: { type: "string" },
            markdownPreview: { type: "string" },
            danger: { type: "boolean" },
            confirmHold: {
              type: "object",
              properties: {
                label: { type: "string" },
                durationMs: { type: "number" },
              },
              description: "Configuração opcional de segurar para confirmar (ou ativação).",
            },
            fields: { type: "array", items: { type: "object" } },
            actions: { type: "array", items: { type: "object" } },
          },
          required: ["title"],
        },
      },
      required: ["block"],
    },
  },
  {
    name: "acknowledge_request",
    description:
      "Apresenta um plano prévio resumido em etapas com contagem regressiva opcional (planStartAfterMs) antes de iniciar uma execução longa.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        message: { type: "string" },
        summaryMarkdown: { type: "string" },
        steps: { type: "array", items: { type: "string" }, description: "De 1 a 4 etapas resumidas." },
        startLabel: { type: "string" },
        cancelLabel: { type: "string" },
        alternativeLabel: { type: "string" },
        planStartAfterMs: { type: "number" },
      },
      required: ["steps"],
    },
  },
  {
    name: "request_api_key",
    description:
      "Solicita ao usuário uma chave de API através de um cartão seguro cifrado diretamente no Cofre AES-256-GCM (sem expor o segredo ao histórico).",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Identificador em maiúsculas (/^[A-Z][A-Z0-9_]{0,63}$/, ex.: ELEVENLABS_API_KEY).",
        },
        title: { type: "string" },
        label: { type: "string" },
        description: { type: "string" },
        docsUrl: { type: "string" },
        placeholder: { type: "string" },
        submit: { type: "string" },
        defaultScope: { type: "string", enum: ["todos_agentes", "agente_especifico"] },
      },
      required: ["name"],
    },
  },
  {
    name: "list_api_keys",
    description:
      "Lista apenas os nomes e escopos das chaves de API configuradas no Cofre visíveis ao agente (jamais retorna valores).",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "save_api_key",
    description:
      "Salva uma chave de API cifrada no Cofre AES-256-GCM (permitido exclusivamente em turnos iniciados diretamente pelo usuário local).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        key: { type: "string" },
        scope: { type: "string", enum: ["todos_agentes", "agente_especifico"] },
        notes: { type: "string" },
      },
      required: ["name", "key"],
    },
  },
  {
    name: "remove_api_key",
    description:
      "Remove uma chave de API exclusiva deste agente no Cofre (chaves globais compartilhadas só podem ser removidas pelo usuário).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_library_folders",
    description:
      "Lista a árvore de pastas hierárquicas da Biblioteca do agente, seus arquivos (até 200) e contagem de itens sem pasta.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Caminho ou ID opcional da pasta para filtrar." },
      },
    },
  },
  {
    name: "attach_files_to_response",
    description:
      "Anexa arquivos gerados/existentes de recursos/, conteudos/, saidas/ ou previas/ na resposta do chat e opcionalmente os organiza em uma pasta hierárquica.",
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos relativos dos arquivos dentro do workspace.",
        },
        folder: {
          type: "string",
          description: "Caminho hierárquico opcional (até 4 níveis, ex.: 'Campanha Outono/Carrossel').",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "react_to_user_message",
    description:
      "Adiciona exatamente 1 grafema emoji Unicode à mensagem atual do usuário (disponível apenas em chat 1:1 com o usuário).",
    parameters: {
      type: "object",
      properties: {
        emoji: { type: "string", description: "Exatamente 1 emoji Unicode (ex.: '🔥', '✅', '🎯')." },
      },
      required: ["emoji"],
    },
  },
  {
    name: "send_message",
    description:
      "Envia mensagem assíncrona estruturada para 1 a 32 colegas agentes com correlação por replyToMessageId, expectsReply e roteamento steer vs queue.",
    parameters: {
      type: "object",
      properties: {
        recipientAgentIds: {
          type: "array",
          items: { type: "string" },
          description: "Lista de 1 a 32 IDs de agentes destinatários distintos.",
        },
        text: { type: "string", description: "Mensagem ou instrução completa para os destinatários." },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Até 10 caminhos relativos seguros do workspace para anexar.",
        },
        replyToMessageId: {
          type: "string",
          description: "ID da mensagem inter-agente anterior que está sendo respondida.",
        },
        expectsReply: {
          type: "boolean",
          description: "Se true (padrão), aguarda retorno na conversa de origem; se false, entrega informativa final.",
        },
      },
      required: ["recipientAgentIds", "text"],
    },
  },
  {
    name: "load_skill",
    description:
      "Carrega sob demanda o manual SKILL.md completo de uma habilidade específica ou da habilidade principal do agente atual. Use apenas quando precisar das instruções técnicas detalhadas.",
    parameters: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Slug da habilidade (ex.: 'criar-carrossel'). Se omitido, carrega a habilidade padrão do agente atual.",
        },
      },
    },
  },
  {
    name: "list_agents",
    description:
      "Lista todos os agentes e especialistas configurados no estúdio (incluindo customizados) com seus IDs canônicos e @apelidos.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

export const PHASE14_TOOL_NAMES: ReadonlySet<string> = new Set(
  PHASE14_TOOLS_SCHEMA.map((t) => t.name),
);

export function isPhase14ToolName(name: string): boolean {
  return PHASE14_TOOL_NAMES.has(name);
}

export interface Phase14ToolServices {
  db: CriativoDatabase;
  wsHub?: WebSocketHub;
  sharedTables?: SharedTablesService;
  memoryManager?: MemoryManager;
  memoryReview?: MemoryReviewService;
  skillLearning?: SkillLearningService;
  historySearch?: HistorySearchService;
  libraryFolders?: LibraryFoldersService;
  handoffBus?: HandoffBus;
  visualPreview?: ChatVisualPreviewService;
  uiBlockRegistry?: UiBlockRegistry;
  apiKeysBridge?: ApiKeysBridge;
  licenseService?: LicenseClientService;
  workspaceRoot?: string;
  productRoot?: string;
  isAgentBusy?: (agenteId: string) => { busy: boolean; policy: "steer" | "queue" };
  onSteerMessage?: (recipientId: string, row: CanalMensagemRow) => void;
  onDispatchQueuedInterAgent?: (
    recipientId: string,
    row: CanalMensagemRow,
    nextHopDepth: number,
  ) => void;
}

export interface Phase14ToolContext {
  agenteId: string;
  canalId: string;
  threadId?: string | null;
  tarefaId?: string | null;
  turnId: string;
  origemTurno: OrigemTurnoApiKey;
  isOneToOneUserChat: boolean;
  lastUserMessageId?: string | null;
  hopDepth?: number;
  generatedArtifacts?: string[];
  generatedAnexos?: AnexoChat[];
  persistVisualMessage?: boolean;
  onVisualMessage?: (meta: ChatVisualMeta, itemType: string) => void;
}

function validateSingleEmojiGrapheme(rawEmoji: string): string {
  const trimmed = String(rawEmoji ?? "").trim();
  if (!trimmed) {
    throw new Error("Informe um emoji não vazio em 'emoji'.");
  }
  const segmenter = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
  const graphemes = Array.from(segmenter.segment(trimmed));
  if (graphemes.length !== 1) {
    throw new Error(
      `react_to_user_message aceita exatamente 1 grafema emoji Unicode (recebidos: ${graphemes.length}).`,
    );
  }
  const single = graphemes[0]!.segment;
  if (!/\p{Extended_Pictographic}/u.test(single)) {
    throw new Error(`O caractere '${single}' não é um pictograma emoji Unicode válido.`);
  }
  return single;
}

/**
 * Roteador unificado para todas as 21 ferramentas (+ aliases) da Fase 14,
 * usado tanto pelo AgentRunner quanto pelo loop interativo do Chat.
 */
export async function executePhase14ToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Phase14ToolContext,
  services: Phase14ToolServices,
): Promise<unknown> {
  const memMgr = services.memoryManager ?? new MemoryManager(services.db);
  const redact = (text: string): string =>
    services.apiKeysBridge ? services.apiKeysBridge.redactSecretValues(text) : text;

  switch (toolName) {
    // -------------------------------------------------------------------------
    // 1. Memória & Histórico (LRN-01, LRN-02)
    // -------------------------------------------------------------------------
    case "remember": {
      const rawText = readStringArg(args, "text", "texto") ?? "";
      if (!rawText) {
        throw new Error("Informe o texto da memória em 'text'.");
      }
      const safeText = redact(rawText);
      const memoryId = readStringArg(args, "memoryId", "memoriaId", "memoria_id");
      const rawInclusion = readStringArg(args, "inclusion", "categoria");
      const inclusion: MemoriaInclusao =
        rawInclusion === "essential" ? "essential" : "searchable";
      const site = readStringArg(args, "site", "escopoSite", "escopo_site") ?? null;

      const staged = memMgr.stageTurnMutation(ctx.turnId, ctx.agenteId, {
        action: "remember",
        memoriaId: memoryId,
        texto: safeText,
        categoria: inclusion,
        escopoSite: site,
      });
      return staged;
    }

    case "forget_memory": {
      const memoryId = readStringArg(args, "memoryId", "memoriaId", "memoria_id");
      const text = readStringArg(args, "text", "texto");
      if (!memoryId && !text) {
        throw new Error("Informe 'memoryId' ou 'text' da memória a esquecer.");
      }
      return memMgr.stageTurnMutation(ctx.turnId, ctx.agenteId, {
        action: "forget",
        memoriaId: memoryId,
        texto: text,
      });
    }

    case "search_memories": {
      const query = readStringArg(args, "query", "busca") ?? "";
      const site = readStringArg(args, "site") ?? null;
      const limit = typeof args.limit === "number" ? args.limit : 15;
      const items = memMgr.searchMemoriesFts(ctx.agenteId, query, {
        limit,
        site,
        redact,
      });
      return { action: "search", count: items.length, memories: items };
    }

    case "list_memories": {
      const rawCat = readStringArg(args, "inclusion", "categoria");
      const categoria: MemoriaInclusao | undefined =
        rawCat === "essential" || rawCat === "searchable" ? rawCat : undefined;
      const site = readStringArg(args, "site") ?? null;
      const after = readStringArg(args, "after");
      const limit = typeof args.limit === "number" ? args.limit : 30;
      const listed = memMgr.listMemoriesPaginated(ctx.agenteId, {
        categoria,
        site,
        after,
        limit,
      });
      return {
        action: "list",
        memories: listed.items.map((m) => ({ ...m, texto: redact(m.texto) })),
        nextCursor: listed.nextCursor,
      };
    }

    case "set_memory_inclusion": {
      const rawChanges = Array.isArray(args.changes) ? args.changes : [];
      const parsedChanges: Array<{ memoriaId: string; categoria: MemoriaInclusao }> = [];
      for (const item of rawChanges) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const id = readStringArg(rec, "memoryId", "memoriaId", "memoria_id");
        const inc = readStringArg(rec, "inclusion", "categoria");
        if (id && (inc === "essential" || inc === "searchable")) {
          parsedChanges.push({ memoriaId: id, categoria: inc });
        }
      }
      if (parsedChanges.length === 0) {
        throw new Error("Informe ao menos um item válido em 'changes'.");
      }
      const snap = memMgr.setMemoryInclusion(ctx.agenteId, parsedChanges, false);
      return {
        action: "set_inclusion",
        usedBytes: snap.usedBytes,
        budgetBytes: snap.budgetBytes,
        updated: parsedChanges.length,
      };
    }

    case "memory_recall": {
      const query = readStringArg(args, "query", "busca");
      const explicitAction = readStringArg(args, "action");
      const effectiveAction =
        explicitAction ??
        (Array.isArray(args.changes)
          ? "set_inclusion"
          : query
            ? "search"
            : "list");

      if (effectiveAction === "set_inclusion") {
        return await executePhase14ToolCall("set_memory_inclusion", args, ctx, services);
      }
      if (effectiveAction === "search") {
        return await executePhase14ToolCall(
          "search_memories",
          { ...args, query: query ?? "" },
          ctx,
          services,
        );
      }
      return await executePhase14ToolCall("list_memories", args, ctx, services);
    }

    case "history_read": {
      if (!services.historySearch) {
        throw new Error("HistorySearchService não inicializado neste daemon.");
      }
      return services.historySearch.readConversationExcerpt({
        agenteId: ctx.agenteId,
        canalId: readStringArg(args, "canalId", "canal_id") ?? null,
        messageId: readStringArg(args, "messageId", "mensagem_id") ?? null,
        before: readStringArg(args, "before") ?? null,
        offset: typeof args.offset === "number" ? args.offset : 0,
        limit: typeof args.limit === "number" ? args.limit : 20,
        includeWorkSteps: Boolean(args.includeWorkSteps),
        workStepsOffset: typeof args.workStepsOffset === "number" ? args.workStepsOffset : 0,
      });
    }

    case "history_search": {
      if (!services.historySearch) {
        throw new Error("HistorySearchService não inicializado neste daemon.");
      }
      const messageId = readStringArg(args, "messageId", "mensagem_id");
      const before = readStringArg(args, "before");
      if (messageId || before || args.includeWorkSteps === true) {
        return services.historySearch.readConversationExcerpt({
          agenteId: ctx.agenteId,
          canalId: readStringArg(args, "taskId", "canalId") ?? null,
          messageId: messageId ?? null,
          before: before ?? null,
          offset: typeof args.offset === "number" ? args.offset : 0,
          limit: typeof args.limit === "number" ? args.limit : 20,
          includeWorkSteps: Boolean(args.includeWorkSteps),
          workStepsOffset: typeof args.workStepsOffset === "number" ? args.workStepsOffset : 0,
        });
      }
      return services.historySearch.searchHistory({
        agenteId: ctx.agenteId,
        taskId: readStringArg(args, "taskId", "threadId") ?? null,
        query: readStringArg(args, "query", "busca") ?? null,
        after: readStringArg(args, "after") ?? null,
        cursor: readStringArg(args, "cursor") ?? null,
        limit: typeof args.limit === "number" ? args.limit : 20,
      });
    }

    // -------------------------------------------------------------------------
    // 2. Banco SQL Compartilhado (Shared Tables — LRN-03)
    // -------------------------------------------------------------------------
    case "list_tables": {
      if (!services.sharedTables) {
        throw new Error("SharedTablesService não inicializado neste daemon.");
      }
      const tables = await services.sharedTables.listTables();
      return { tables };
    }

    case "query_data": {
      if (!services.sharedTables) {
        throw new Error("SharedTablesService não inicializado neste daemon.");
      }
      const sql = typeof args.sql === "string" ? args.sql : "";
      const params = Array.isArray(args.params) ? args.params : undefined;
      return await services.sharedTables.queryData(sql, params, ctx.agenteId);
    }

    case "execute_data": {
      if (!services.sharedTables) {
        throw new Error("SharedTablesService não inicializado neste daemon.");
      }
      const sql = typeof args.sql === "string" ? args.sql : "";
      const params = Array.isArray(args.params) ? args.params : undefined;
      return await services.sharedTables.executeData(sql, params, ctx.agenteId);
    }

    case "delete_table": {
      if (!services.sharedTables) {
        throw new Error("SharedTablesService não inicializado neste daemon.");
      }
      const name = readStringArg(args, "name", "tableName", "nome") ?? "";
      return await services.sharedTables.deleteTable(name, ctx.agenteId);
    }

    // -------------------------------------------------------------------------
    // 3. Generative UI em Sandbox (CHAT-01)
    // -------------------------------------------------------------------------
    case "html_render": {
      if (!services.visualPreview) {
        throw new Error("ChatVisualPreviewService não inicializado neste daemon.");
      }
      const html = typeof args.html === "string" ? args.html : "";
      const title = readStringArg(args, "title", "titulo") ?? "Painel Interativo";
      const height = typeof args.height === "number" ? args.height : undefined;

      const rendered = services.visualPreview.renderAndPersistPage({
        agenteId: ctx.agenteId,
        canalId: ctx.canalId,
        html,
        title,
        height,
        tarefaId: ctx.tarefaId ?? null,
      });

      const visualMeta: ChatVisualMeta = {
        arquivo_id: rendered.arquivoId,
        titulo: rendered.title,
        altura_inicial: rendered.height,
        url: rendered.url,
      };

      ctx.generatedArtifacts?.push(rendered.relPath);
      ctx.onVisualMessage?.(visualMeta, rendered.itemType);

      if (ctx.persistVisualMessage !== false) {
        const msgId = randomUUID();
        const agora = new Date().toISOString();
        const threadId =
          ctx.threadId ??
          (ctx.canalId.startsWith("agente:") ? `main:${ctx.agenteId}` : ctx.canalId);
        const agentRow = services.db.connection
          .prepare("SELECT nome FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
          .get(ctx.agenteId) as { nome?: string } | undefined;
        const autorNome = agentRow?.nome ?? ctx.agenteId;

        services.db.connection
          .prepare(
            `INSERT INTO projecao_conversas_chat (
              mensagem_id, canal_id, agente_id, autor, autor_nome,
              conteudo_markdown, anexos_json, steps_json, tarefa_id,
              thread_id, turno_id, item_type, status, metadados_json, lida, criado_em
            ) VALUES (?, ?, ?, 'agente', ?, ?, '[]', '[]', ?, ?, ?, ?, 'completed', ?, 1, ?);`,
          )
          .run(
            msgId,
            ctx.canalId,
            ctx.agenteId,
            autorNome,
            `Painel visual: **${rendered.title}**`,
            ctx.tarefaId ?? null,
            threadId,
            ctx.turnId,
            rendered.itemType,
            JSON.stringify({ visual_page: visualMeta }),
            agora,
          );

        const chatMsg: MensagemChat = {
          mensagem_id: msgId,
          canal_id: ctx.canalId,
          agente_id: ctx.agenteId,
          autor: "agente",
          autor_nome: autorNome,
          conteudo_markdown: `Painel visual: **${rendered.title}**`,
          anexos: [],
          steps: [],
          tarefa_id: ctx.tarefaId ?? null,
          thread_id: threadId,
          turno_id: ctx.turnId,
          item_type: rendered.itemType,
          status: "completed",
          visual_page: visualMeta,
          metadados: { visual_page: visualMeta },
          lida: true,
          criado_em: agora,
        };
        services.wsHub?.broadcast("chat:message", {
          canal_id: ctx.canalId,
          agente_id: ctx.agenteId,
          mensagem: chatMsg,
        });
      }

      return {
        ok: true,
        arquivoId: rendered.arquivoId,
        title: rendered.title,
        height: rendered.height,
        url: rendered.url,
      };
    }

    case "html_preview": {
      if (!services.visualPreview) {
        throw new Error("ChatVisualPreviewService não inicializado neste daemon.");
      }
      const html = typeof args.html === "string" ? args.html : "";
      const width = typeof args.width === "number" ? args.width : undefined;
      const appearance = args.appearance === "light" ? "light" : "dark";
      return await services.visualPreview.previewHtmlOffscreen({
        html,
        width,
        appearance,
      });
    }

    // -------------------------------------------------------------------------
    // 4. Cards Bloqueantes & Cofre de API Keys (CHAT-02)
    // -------------------------------------------------------------------------
    case "ask_user": {
      if (!services.uiBlockRegistry) {
        throw new Error("UiBlockRegistry não inicializado neste daemon.");
      }
      const rawQuestions = Array.isArray(args.questions) ? args.questions : [];
      if (rawQuestions.length < 1 || rawQuestions.length > 3) {
        throw new Error("ask_user requer entre 1 e 3 perguntas em 'questions'.");
      }

      const questions: AskUserQuestion[] = rawQuestions.map((q, idx) => {
        const rec = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
        const questionText = readStringArg(rec, "question", "pergunta") ?? "";
        if (!questionText) {
          throw new Error(`A pergunta #${idx + 1} de ask_user não possui texto em 'question'.`);
        }
        const rawOptions = Array.isArray(rec.options) ? rec.options : undefined;
        return {
          id: readStringArg(rec, "id") ?? `q${idx + 1}`,
          header: readStringArg(rec, "header", "cabecalho"),
          question: questionText,
          detail: readStringArg(rec, "detail", "detalhe"),
          isSecret: Boolean(rec.isSecret),
          multiSelect: Boolean(rec.multiSelect),
          options: rawOptions
            ?.map((opt) => {
              if (typeof opt === "string") return { label: opt };
              if (opt && typeof opt === "object") {
                const oRec = opt as Record<string, unknown>;
                const label = readStringArg(oRec, "label", "value") ?? "";
                return label
                  ? { label, description: readStringArg(oRec, "description") }
                  : null;
              }
              return null;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null),
        };
      });

      const title = readStringArg(args, "title", "titulo");
      return await services.uiBlockRegistry.openBlockingBlock({
        agenteId: ctx.agenteId,
        canalId: ctx.canalId,
        threadId: ctx.threadId,
        turnoId: ctx.turnId,
        tipoFerramenta: "ask_user",
        spec: {
          kind: "ask_user",
          ...(title ? { title } : {}),
          questions,
        },
        conteudoMarkdown: title ?? questions[0]!.question,
      });
    }

    case "ask_ui": {
      if (!services.uiBlockRegistry) {
        throw new Error("UiBlockRegistry não inicializado neste daemon.");
      }
      const rawBlock =
        args.block && typeof args.block === "object" && !Array.isArray(args.block)
          ? (args.block as Record<string, unknown>)
          : args;

      const title = readStringArg(rawBlock, "title", "titulo") ?? "Confirmação Necessária";
      const rawVariant = readStringArg(rawBlock, "variant", "type") ?? "confirm";
      const markdownPreview = readStringArg(rawBlock, "markdownPreview", "preview");
      const description = readStringArg(rawBlock, "description", "descricao");
      const danger = Boolean(rawBlock.danger);

      let confirmHold: { label?: string; durationMs?: number } | boolean | undefined;
      if (typeof rawBlock.confirmHold === "number") {
        confirmHold = {
          durationMs: Math.max(400, Math.min(3000, Math.round(rawBlock.confirmHold))),
        };
      } else if (typeof rawBlock.confirmHold === "boolean") {
        confirmHold = rawBlock.confirmHold;
      } else if (rawBlock.confirmHold && typeof rawBlock.confirmHold === "object") {
        const ch = rawBlock.confirmHold as Record<string, unknown>;
        const dur =
          typeof ch.durationMs === "number"
            ? Math.max(400, Math.min(3000, Math.round(ch.durationMs)))
            : 1200;
        confirmHold = {
          label: readStringArg(ch, "label"),
          durationMs: dur,
        };
      }

      const rawActions = Array.isArray(rawBlock.actions) ? rawBlock.actions.slice(0, 4) : [];
      const actions =
        rawActions.length > 0
          ? rawActions.map((a, idx) => {
              const ar = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
              return {
                id: readStringArg(ar, "id") ?? `action_${idx + 1}`,
                label: readStringArg(ar, "label") ?? `Ação ${idx + 1}`,
                tone: readStringArg(ar, "tone") ?? (idx === 0 ? (danger ? "danger" : "primary") : "default"),
                ...(ar.confirmHold !== undefined ? { confirmHold: ar.confirmHold } : {}),
              };
            })
          : [
              {
                id: "confirm",
                label: danger ? "Confirmar exclusão" : "Aprovar e continuar",
                tone: danger ? "danger" : "primary",
                ...(confirmHold ? { confirmHold } : {}),
              },
              { id: "cancel", label: "Cancelar operação", tone: "default" },
            ];

      return await services.uiBlockRegistry.openBlockingBlock({
        agenteId: ctx.agenteId,
        canalId: ctx.canalId,
        threadId: ctx.threadId,
        turnoId: ctx.turnId,
        tipoFerramenta: "ask_ui",
        spec: {
          kind: "ask_ui",
          variant: rawVariant,
          title,
          ...(description ? { description } : {}),
          ...(markdownPreview ? { markdownPreview } : {}),
          danger,
          ...(confirmHold !== undefined ? { confirmHold } : {}),
          ...(Array.isArray(rawBlock.options) ? { options: rawBlock.options } : {}),
          ...(typeof rawBlock.multiSelect === "boolean"
            ? { multiSelect: rawBlock.multiSelect }
            : {}),
          ...(Array.isArray(rawBlock.fields) ? { fields: rawBlock.fields } : {}),
          actions,
        },
        conteudoMarkdown: title,
      });
    }

    case "acknowledge_request": {
      if (!services.uiBlockRegistry) {
        throw new Error("UiBlockRegistry não inicializado neste daemon.");
      }
      const steps = readStringArrayArg(args, "steps", "etapas").slice(0, 4);
      if (steps.length === 0) {
        throw new Error("acknowledge_request requer de 1 a 4 etapas em 'steps'.");
      }
      const title = readStringArg(args, "title", "titulo") ?? "Plano de Execução";
      const summaryMarkdown =
        readStringArg(args, "summaryMarkdown", "message", "resumo") ?? title;
      const startLabel = readStringArg(args, "startLabel") ?? "Iniciar plano";
      const cancelLabel = readStringArg(args, "cancelLabel") ?? "Cancelar plano";
      const alternativeLabel = readStringArg(args, "alternativeLabel");
      const autoStartAfterMs =
        typeof args.planStartAfterMs === "number" ? args.planStartAfterMs : undefined;

      return await services.uiBlockRegistry.openBlockingBlock({
        agenteId: ctx.agenteId,
        canalId: ctx.canalId,
        threadId: ctx.threadId,
        turnoId: ctx.turnId,
        tipoFerramenta: "acknowledge_request",
        autoStartAfterMs,
        spec: {
          kind: "acknowledge_request",
          title,
          summaryMarkdown,
          steps,
          startLabel,
          cancelLabel,
          ...(alternativeLabel ? { alternativeLabel } : {}),
        },
        conteudoMarkdown: title,
      });
    }

    case "request_api_key": {
      if (!services.uiBlockRegistry || !services.apiKeysBridge) {
        throw new Error("UiBlockRegistry / ApiKeysBridge não inicializados neste daemon.");
      }
      const rawName = readStringArg(args, "name", "nome") ?? "";
      const validName = services.apiKeysBridge.validateKeyName(rawName);
      const label = readStringArg(args, "label", "title", "titulo") ?? `Configurar ${validName}`;
      const description = readStringArg(args, "description", "descricao");
      const docsUrl = readStringArg(args, "docsUrl");
      const placeholder = readStringArg(args, "placeholder");
      const submit = readStringArg(args, "submit") ?? "Salvar no Cofre";
      const defaultScope =
        args.defaultScope === "agente_especifico" ? "agente_especifico" : "todos_agentes";

      return await services.uiBlockRegistry.openBlockingBlock({
        agenteId: ctx.agenteId,
        canalId: ctx.canalId,
        threadId: ctx.threadId,
        turnoId: ctx.turnId,
        tipoFerramenta: "request_api_key",
        spec: {
          kind: "request_api_key",
          name: validName,
          label,
          ...(description ? { description } : {}),
          ...(docsUrl ? { docsUrl } : {}),
          ...(placeholder ? { placeholder } : {}),
          submit,
          defaultScope,
        },
        conteudoMarkdown: label,
      });
    }

    case "list_api_keys": {
      if (!services.apiKeysBridge) {
        throw new Error("ApiKeysBridge não inicializado neste daemon.");
      }
      return {
        keys: services.apiKeysBridge.listApiKeys(ctx.agenteId),
      };
    }

    case "save_api_key": {
      if (!services.apiKeysBridge) {
        throw new Error("ApiKeysBridge não inicializado neste daemon.");
      }
      const name = readStringArg(args, "name", "nome") ?? "";
      const key = typeof args.key === "string" ? args.key : typeof args.value === "string" ? args.value : "";
      const scope =
        args.scope === "agente_especifico" ? "agente_especifico" : "todos_agentes";
      return services.apiKeysBridge.saveApiKey({
        name,
        value: key,
        scope,
        agenteId: ctx.agenteId,
        origemTurno: ctx.origemTurno,
      });
    }

    case "remove_api_key": {
      if (!services.apiKeysBridge) {
        throw new Error("ApiKeysBridge não inicializado neste daemon.");
      }
      const name = readStringArg(args, "name", "nome") ?? "";
      return services.apiKeysBridge.removeApiKey({
        name,
        agenteId: ctx.agenteId,
        byUser: false,
      });
    }

    // -------------------------------------------------------------------------
    // 5. Biblioteca Hierárquica & Reação Emoji 1:1 (CHAT-03)
    // -------------------------------------------------------------------------
    case "list_library_folders": {
      if (!services.libraryFolders) {
        throw new Error("LibraryFoldersService não inicializado neste daemon.");
      }
      const folder = readStringArg(args, "folder", "pasta");
      return services.libraryFolders.listLibraryFoldersForAgent(ctx.agenteId, folder);
    }

    case "attach_files_to_response": {
      if (!services.libraryFolders) {
        throw new Error("LibraryFoldersService não inicializado neste daemon.");
      }
      const paths = readStringArrayArg(args, "paths", "arquivos");
      if (paths.length === 0) {
        throw new Error("Informe ao menos 1 caminho relativo em 'paths'.");
      }
      const folder = readStringArg(args, "folder", "pasta") ?? null;
      const resolved = services.libraryFolders.resolveSafeWorkspaceFiles(paths, {
        agenteId: ctx.agenteId,
        tarefaId: ctx.tarefaId ?? null,
        folderPath: folder,
      });

      for (const arq of resolved) {
        ctx.generatedArtifacts?.push(arq.caminho_relativo);
        ctx.generatedAnexos?.push({
          nome: arq.nome_original,
          caminho_relativo: arq.caminho_relativo,
          url: arq.url || `/api/arquivos/raw/${encodeURIComponent(arq.caminho_relativo)}`,
          mime_type: arq.mime_type,
          tamanho_bytes: arq.tamanho_bytes,
          tipo_uso: arq.tipo_uso,
        });
      }

      return {
        ok: true,
        attachedCount: resolved.length,
        files: resolved.map((a) => ({
          arquivo_id: a.arquivo_id,
          nome: a.nome_original,
          caminho_relativo: a.caminho_relativo,
          folder_path: a.folder_path ?? null,
        })),
      };
    }

    case "react_to_user_message": {
      if (!ctx.isOneToOneUserChat) {
        return {
          ok: false,
          erro: "react_to_user_message é permitido exclusivamente em conversas 1:1 diretas com o usuário.",
        };
      }
      const validEmoji = validateSingleEmojiGrapheme(
        typeof args.emoji === "string" ? args.emoji : "",
      );

      let targetMsgId = ctx.lastUserMessageId ?? null;
      if (!targetMsgId) {
        const lastRow = services.db.connection
          .prepare(
            `SELECT mensagem_id FROM projecao_conversas_chat
             WHERE canal_id = ? AND autor = 'usuario'
             ORDER BY criado_em DESC
             LIMIT 1;`,
          )
          .get(ctx.canalId) as { mensagem_id?: string } | undefined;
        targetMsgId = lastRow?.mensagem_id ?? null;
      }

      if (!targetMsgId) {
        return {
          ok: false,
          erro: "Nenhuma mensagem do usuário encontrada nesta conversa para reagir.",
        };
      }

      services.db.connection
        .prepare("UPDATE projecao_conversas_chat SET reacao_emoji = ? WHERE mensagem_id = ?;")
        .run(validEmoji, targetMsgId);

      services.wsHub?.broadcast("chat:reaction", {
        canal_id: ctx.canalId,
        mensagem_id: targetMsgId,
        emoji: validEmoji,
        agente_id: ctx.agenteId,
      });

      return {
        ok: true,
        mensagem_id: targetMsgId,
        emoji: validEmoji,
      };
    }

    // -------------------------------------------------------------------------
    // 6. Mensageria Assíncrona Multi-Agente (send_message — CHAT-04)
    // -------------------------------------------------------------------------
    case "send_message": {
      if (!services.handoffBus) {
        throw new Error("HandoffBus não inicializado neste daemon.");
      }
      const recipientAgentIds = readStringArrayArg(
        args,
        "recipientAgentIds",
        "para_agentes",
        "recipients",
      );
      const text = readStringArg(args, "text", "texto", "instrucao") ?? "";
      const rawPaths = readStringArrayArg(args, "paths", "artefatos");

      let safePaths: string[] = [];
      if (rawPaths.length > 0) {
        if (services.libraryFolders) {
          const checked = services.libraryFolders.resolveSafeWorkspaceFiles(rawPaths, {
            agenteId: ctx.agenteId,
            tarefaId: ctx.tarefaId ?? null,
          });
          safePaths = checked.map((c) => c.caminho_relativo);
        } else {
          safePaths = rawPaths;
        }
      }

      const replyToMessageId =
        readStringArg(args, "replyToMessageId", "reply_to_message_id") ?? null;
      const expectsReply = typeof args.expectsReply === "boolean" ? args.expectsReply : true;

      return services.handoffBus.sendMessageAsync({
        senderAgentId: ctx.agenteId,
        sourceCanalId: ctx.canalId,
        sourceThreadId: ctx.threadId ?? null,
        tarefaId: ctx.tarefaId ?? null,
        hopDepth: ctx.hopDepth ?? 0,
        recipientAgentIds,
        text,
        paths: safePaths,
        replyToMessageId,
        expectsReply,
        wsHub: services.wsHub,
        isAgentBusy: services.isAgentBusy,
        onSteerMessage: services.onSteerMessage,
        onDispatchQueued: services.onDispatchQueuedInterAgent,
      });
    }

    case "load_skill": {
      const requestedSlug = readStringArg(args, "slug", "skill", "habilidade");
      let targetSlug = requestedSlug ? requestedSlug.trim() : "";
      let candidatePaths: string[] = [];

      if (!targetSlug) {
        const agentRow = services.db.connection
          .prepare("SELECT config_json, skills_paths_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
          .get(ctx.agenteId) as { config_json?: string; skills_paths_json?: string } | undefined;
        if (agentRow?.config_json) {
          try {
            const parsedCfg = JSON.parse(agentRow.config_json) as { skill_slug?: unknown };
            if (typeof parsedCfg.skill_slug === "string" && parsedCfg.skill_slug.trim()) {
              targetSlug = parsedCfg.skill_slug.trim();
            }
          } catch {
            // ignora json inválido
          }
        }
        if (agentRow?.skills_paths_json) {
          try {
            const parsedPaths = JSON.parse(agentRow.skills_paths_json) as unknown;
            if (Array.isArray(parsedPaths)) {
              candidatePaths = parsedPaths.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
            }
          } catch {
            // ignora json inválido
          }
        }
        if (!targetSlug && candidatePaths.length > 0) {
          const matchedSlug = candidatePaths[0]!.match(/([^/\\]+)[/\\]SKILL\.md$/i);
          if (matchedSlug?.[1]) {
            targetSlug = matchedSlug[1];
          }
        }
        if (!targetSlug) {
          const def = ROSTER_15_AGENTES.find((a) => a.agente_id === ctx.agenteId);
          if (def?.skill_slug) targetSlug = def.skill_slug;
        }
      }

      if (targetSlug) {
        const upgradePkg = getSkillUpgradePackage(targetSlug);
        if (
          upgradePkg &&
          !isUpgradeUnlocked(
            services.db,
            services.workspaceRoot ?? process.cwd(),
            upgradePkg,
            services.licenseService,
            services.productRoot
          )
        ) {
          return {
            ok: false,
            slug: targetSlug,
            erro: `Habilidade '${targetSlug}' pertence ao módulo '${upgradePkg}', não liberado na licença ativa.`,
          };
        }
        const loaded = loadSkillPromptBySlug(targetSlug, undefined, services.workspaceRoot, {
          db: services.db,
          licenseService: services.licenseService,
          productRoot: services.productRoot,
        });
        if (loaded) {
          return {
            ok: true,
            slug: targetSlug,
            path: loaded.path,
            tokensEst: loaded.tokensEst,
            content: loaded.body,
          };
        }
      }

      for (const relPath of candidatePaths) {
        const absPath = isAbsolute(relPath) ? relPath : resolve(process.cwd(), relPath);
        if (existsSync(absPath)) {
          try {
            const body = readFileSync(absPath, "utf8");
            return {
              ok: true,
              slug: targetSlug || ctx.agenteId,
              path: absPath,
              tokensEst: Math.max(80, Math.round(body.length / 4)),
              content: body,
            };
          } catch {
            // continua tentando outros caminhos
          }
        }
      }

      return {
        ok: false,
        slug: targetSlug || null,
        erro: targetSlug
          ? `SKILL.md da habilidade '${targetSlug}' não encontrado.`
          : "Nenhuma habilidade configurada para este agente.",
      };
    }

    case "list_agents": {
      const agents = listAgentsWithAliases(services.db);
      return {
        total: agents.length,
        agents,
      };
    }

    default:
      throw new Error(`Ferramenta da Fase 14 desconhecida: ${toolName}`);
  }
}

// ============================================================================
// Fase 15 — Chromium CDP, Mídia (read_video/read_image/capture_screen),
// Governança de Permissão, Sidebar & Showcase Local
// ============================================================================

export interface AgentGovernanceState {
  agenteId: string;
  permissionLevel: PermissionLevel;
  allowNewChat: boolean;
  allowQuickAck: boolean;
  browserProfileId: string | null;
  backupModels: BackupModelsConfig;
  allowedFolders: AgentAllowedFolder[];
  autoMemoryEnabled: boolean;
}

const MAX_AGENT_ALLOWED_FOLDERS = 20;

const BLOCKED_SYSTEM_PATHS_LOWER = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata",
  "c:\\$recycle.bin",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/system",
  "/library",
  "/private/etc",
  "/var/root",
];

function normalizePathForCompare(p: string): string {
  const clean = resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? clean.toLowerCase() : clean;
}

function isDriveOrRoot(p: string): boolean {
  const clean = p.trim();
  if (clean === "/" || clean === "\\") return true;
  if (/^[a-zA-Z]:[\\/]?$/.test(clean)) return true;
  return false;
}

export function validateAllowedFolderPath(rawPath: string):
  | { ok: true; normalized: string }
  | { ok: false; error: string } {
  const trimmed = String(rawPath ?? "").trim();
  if (!trimmed || trimmed.includes("\0")) {
    return { ok: false, error: "Informe um caminho de pasta válido." };
  }
  if (!isAbsolute(trimmed)) {
    return {
      ok: false,
      error: "A pasta autorizada deve ser um caminho absoluto (ex.: D:\\Projetos\\Marca ou /home/usuario/projetos).",
    };
  }
  const normalized = resolve(trimmed).replace(/([\\/]+)$/, (m) =>
    isDriveOrRoot(resolve(trimmed)) ? m[0]! : "",
  );
  if (isDriveOrRoot(normalized)) {
    return {
      ok: false,
      error: "Por segurança, não é permitido autorizar a unidade/raiz inteira do sistema (ex.: C:\\ ou /).",
    };
  }

  const lower = normalized.toLowerCase();
  const home = homedir();
  const sensitiveUserDirs = [
    join(home, ".ssh"),
    join(home, ".gnupg"),
    join(home, ".aws"),
  ].map((d) => normalizePathForCompare(d));

  for (const sensitive of sensitiveUserDirs) {
    if (lower === sensitive || lower.startsWith(sensitive + sep) || lower.startsWith(sensitive + "/")) {
      return {
        ok: false,
        error: "Por segurança, pastas sensíveis de credenciais (.ssh, .gnupg, .aws) não podem ser autorizadas.",
      };
    }
  }

  if (/[\\/]\.(?:ssh|gnupg|aws)(?:[\\/]|$)/i.test(normalized)) {
    return {
      ok: false,
      error: "Por segurança, pastas sensíveis de credenciais (.ssh, .gnupg, .aws) não podem ser autorizadas.",
    };
  }

  for (const blocked of BLOCKED_SYSTEM_PATHS_LOWER) {
    const bNorm = blocked.replace(/[\\/]+$/, "");
    if (
      lower === bNorm ||
      lower.startsWith(bNorm + "\\") ||
      lower.startsWith(bNorm + "/")
    ) {
      return {
        ok: false,
        error: `Por segurança, diretórios críticos do sistema (${normalized}) não podem ser autorizados.`,
      };
    }
  }

  return { ok: true, normalized };
}

export function normalizeAllowedFolders(raw: unknown): AgentAllowedFolder[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AgentAllowedFolder[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { path?: unknown; mode?: unknown; added_at?: unknown };
    if (typeof rec.path !== "string") continue;
    const validated = validateAllowedFolderPath(rec.path);
    if (!validated.ok) continue;
    const key = normalizePathForCompare(validated.normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      path: validated.normalized,
      mode: rec.mode === "read" ? "read" : "read_write",
      ...(typeof rec.added_at === "string" && rec.added_at ? { added_at: rec.added_at } : {}),
    });
    if (out.length >= MAX_AGENT_ALLOWED_FOLDERS) break;
  }
  return out;
}

export function sanitizeAllowedFoldersList(
  raw: unknown,
): { ok: true; folders: AgentAllowedFolder[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Campo 'allowed_folders' deve ser uma lista." };
  }
  if (raw.length > MAX_AGENT_ALLOWED_FOLDERS) {
    return {
      ok: false,
      error: `Limite máximo de ${MAX_AGENT_ALLOWED_FOLDERS} pastas autorizadas por agente.`,
    };
  }
  const seen = new Set<string>();
  const out: AgentAllowedFolder[] = [];
  for (const item of raw) {
    const rawPath =
      typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string"
          ? (item as { path: string }).path
          : "";
    const validated = validateAllowedFolderPath(rawPath);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }
    const key = normalizePathForCompare(validated.normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    const modeRaw =
      item && typeof item === "object" ? (item as { mode?: unknown }).mode : undefined;
    const addedAtRaw =
      item && typeof item === "object" ? (item as { added_at?: unknown }).added_at : undefined;
    out.push({
      path: validated.normalized,
      mode: modeRaw === "read" ? "read" : "read_write",
      added_at: typeof addedAtRaw === "string" && addedAtRaw ? addedAtRaw : new Date().toISOString(),
    });
  }
  return { ok: true, folders: out };
}

export function isPathInsideAllowedFolders(
  absTarget: string,
  folders: readonly AgentAllowedFolder[],
  operation: "read" | "write" | "publish",
): boolean {
  if (!folders || folders.length === 0) return false;
  const resolvedTarget = resolve(absTarget);
  const normTarget =
    process.platform === "win32" ? resolvedTarget.toLowerCase() : resolvedTarget;
  for (const folder of folders) {
    if (operation !== "read" && folder.mode === "read") {
      continue;
    }
    const baseResolved = resolve(folder.path);
    const normBase =
      process.platform === "win32" ? baseResolved.toLowerCase() : baseResolved;
    const rel = relative(normBase, normTarget);
    if (
      rel === "" ||
      (!rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel))
    ) {
      return true;
    }
  }
  return false;
}

export function readAgentGovernance(
  db: CriativoDatabase,
  agenteId: string,
): AgentGovernanceState {
  const row = db.connection
    .prepare(
      `SELECT permission_level, allow_new_chat, allow_quick_ack, browser_profile_id, backup_models_json, config_json
       FROM projecao_agentes
       WHERE agente_id = ?
       LIMIT 1;`,
    )
    .get(agenteId) as
    | {
        permission_level?: string | null;
        allow_new_chat?: number | null;
        allow_quick_ack?: number | null;
        browser_profile_id?: string | null;
        backup_models_json?: string | null;
        config_json?: string | null;
      }
    | undefined;

  const perm: PermissionLevel =
    row?.permission_level === "ask" || row?.permission_level === "full"
      ? row.permission_level
      : "workspace";

  let parsedCfg: Record<string, unknown> = {};
  if (row?.config_json) {
    try {
      const p = JSON.parse(row.config_json) as Record<string, unknown>;
      if (p && typeof p === "object") parsedCfg = p;
    } catch {
      parsedCfg = {};
    }
  }

  return {
    agenteId,
    permissionLevel: perm,
    allowNewChat: row?.allow_new_chat !== 0,
    allowQuickAck: row?.allow_quick_ack !== 0,
    browserProfileId: row?.browser_profile_id ?? null,
    backupModels: parseBackupModelsJson(row?.backup_models_json),
    allowedFolders: normalizeAllowedFolders(parsedCfg.allowed_folders),
    autoMemoryEnabled: parsedCfg.auto_memory_enabled !== false,
  };
}

export class PermissionEscalationRequiredError extends Error {
  public readonly code = "permission_ask_required";
  constructor(message: string) {
    super(message);
    this.name = "PermissionEscalationRequiredError";
  }
}

export function assertAgentPermissionForPath(params: {
  rawPath: string;
  workspaceRoot: string;
  permissionLevel: PermissionLevel;
  agenteId: string;
  operation: "read" | "write" | "publish";
  allowedFolders?: readonly AgentAllowedFolder[];
}): void {
  const trimmed = String(params.rawPath ?? "").trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error("Caminho de arquivo inválido.");
  }

  const rootAbs = resolve(params.workspaceRoot);
  const absTarget = isAbsolute(trimmed) ? resolve(trimmed) : resolve(rootAbs, trimmed);

  if (
    params.allowedFolders &&
    params.allowedFolders.length > 0 &&
    isPathInsideAllowedFolders(absTarget, params.allowedFolders, params.operation)
  ) {
    return;
  }

  const relToRoot = relative(rootAbs, absTarget);
  const insideWorkspace =
    relToRoot === "" ||
    (!relToRoot.startsWith("..") && !relToRoot.includes(`..${sep}`) && !isAbsolute(relToRoot));

  if (!insideWorkspace) {
    if (params.permissionLevel === "ask" && params.operation !== "read") {
      throw new PermissionEscalationRequiredError(
        `Nível de permissão 'ask': confirme com o usuário antes de ${params.operation === "publish" ? "publicar" : "gravar"} fora do workspace (${trimmed}).`,
      );
    }
    throw new Error(
      `Acesso bloqueado fora do workspace raiz e das Pastas Autorizadas (${trimmed}) no nível de permissão '${params.permissionLevel}'.`,
    );
  }

  if (params.permissionLevel === "workspace") {
    const allowedWorkspaceRoots = [
      resolve(rootAbs, "recursos"),
      resolve(rootAbs, "saidas"),
      resolve(rootAbs, "previas"),
      resolve(rootAbs, "dados", "agentes", params.agenteId),
    ];
    const inStrictDirs = allowedWorkspaceRoots.some((allowed) => {
      const subRel = relative(allowed, absTarget);
      return (
        subRel === "" ||
        (!subRel.startsWith("..") && !subRel.includes(`..${sep}`) && !isAbsolute(subRel))
      );
    });
    if (!inStrictDirs) {
      throw new Error(
        `Nível de permissão 'workspace': '${trimmed}' está fora de recursos/, saidas/, previas/, dados/agentes/${params.agenteId}/ ou Pastas Autorizadas do agente. Adicione a pasta ou altere a permissão em Controle se necessário.`,
      );
    }
  } else if (params.permissionLevel === "ask" && params.operation !== "read") {
    const allowedWriteRoots = [
      resolve(rootAbs, "recursos"),
      resolve(rootAbs, "saidas"),
      resolve(rootAbs, "previas"),
    ];
    const inStandardOut = allowedWriteRoots.some((allowed) => {
      const subRel = relative(allowed, absTarget);
      return (
        subRel === "" ||
        (!subRel.startsWith("..") && !subRel.includes(`..${sep}`) && !isAbsolute(subRel))
      );
    });
    if (!inStandardOut) {
      throw new PermissionEscalationRequiredError(
        `Nível de permissão 'ask': operação '${params.operation}' em '${trimmed}' requer confirmação humana.`,
      );
    }
  }
}

export const BROWSER_DIRECT_ALIASES = [
  "browser_open",
  "browser_list_tabs",
  "browser_status",
  "browser_navigate",
  "browser_go_back",
  "browser_go_forward",
  "browser_reload",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_fill_fields",
  "browser_press",
  "browser_hover",
  "browser_scroll",
  "browser_select_option",
  "browser_set_checked",
  "browser_drag",
  "browser_upload_files",
  "browser_wait_for",
  "browser_evaluate",
  "browser_screenshot",
  "browser_set_environment",
  "browser_handle_dialog",
  "browser_request_takeover",
  "browser_release_takeover",
  "browser_submit_secret",
  "browser_close_tab",
] as const;

export const HIDDEN_CATALOG_TOOL_NAMES: ReadonlySet<string> = new Set<string>(BROWSER_DIRECT_ALIASES);

export const BROWSER_TARGET_SCHEMA = {
  type: "object",
  description:
    "Seletor do elemento alvo no snapshot/DOM ({ ref: 'e12' }, { selector: '#btn' }, { role: 'button', name: 'Enviar' }, { text: 'Continuar' } ou { x, y }).",
  properties: {
    kind: {
      type: "string",
      enum: ["ref", "role", "text", "css", "point"],
      description: "Tipo explícito do seletor (opcional; inferido automaticamente quando omitido).",
    },
    ref: {
      type: "string",
      description: "Referência curta obtida no snapshot (ex.: 'e12').",
    },
    revision: {
      type: "number",
      description: "Revisão do snapshot associada à ref.",
    },
    role: {
      type: "string",
      description: "Papel ARIA do elemento (ex.: 'button', 'textbox').",
    },
    name: {
      type: "string",
      description: "Nome acessível do elemento ARIA.",
    },
    text: {
      type: "string",
      description: "Texto visível do elemento.",
    },
    exact: {
      type: "boolean",
      description: "Exige correspondência exata de name/text.",
    },
    selector: {
      type: "string",
      description: "Seletor CSS para o elemento (ex.: '#campo-busca').",
    },
    nth: {
      type: "number",
      description: "Índice baseado em zero quando houver múltiplos elementos.",
    },
    x: {
      type: "number",
      description: "Coordenada X na viewport em pixels.",
    },
    y: {
      type: "number",
      description: "Coordenada Y na viewport em pixels.",
    },
  },
} as const;

export function normalizeBrowserTargetInput(raw: unknown): BrowserTargetSelector | undefined {
  if (raw === null || raw === undefined) return undefined;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (/^e\d+$/i.test(trimmed)) {
      return { kind: "ref", ref: trimmed };
    }
    return { kind: "css", selector: trimmed };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const obj = raw as Record<string, unknown>;
  const explicitKind = typeof obj.kind === "string" ? obj.kind.trim().toLowerCase() : "";
  const nth = typeof obj.nth === "number" && Number.isFinite(obj.nth) ? obj.nth : undefined;
  const exact = typeof obj.exact === "boolean" ? obj.exact : undefined;

  if (explicitKind === "ref" || (!explicitKind && typeof obj.ref === "string" && obj.ref.trim())) {
    const ref = typeof obj.ref === "string" ? obj.ref.trim() : "";
    if (!ref) return undefined;
    const revision =
      typeof obj.revision === "number" && Number.isFinite(obj.revision) ? obj.revision : undefined;
    return {
      kind: "ref",
      ref,
      ...(revision !== undefined ? { revision } : {}),
    };
  }

  const cssCandidate =
    typeof obj.selector === "string" && obj.selector.trim()
      ? obj.selector.trim()
      : typeof obj.css === "string" && obj.css.trim()
        ? obj.css.trim()
        : "";
  if (explicitKind === "css" || (!explicitKind && cssCandidate)) {
    if (!cssCandidate) return undefined;
    return {
      kind: "css",
      selector: cssCandidate,
      ...(nth !== undefined ? { nth } : {}),
    };
  }

  if (
    explicitKind === "point" ||
    (!explicitKind && typeof obj.x === "number" && typeof obj.y === "number")
  ) {
    const x = Number(obj.x);
    const y = Number(obj.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return { kind: "point", x, y };
  }

  if (explicitKind === "role" || (!explicitKind && typeof obj.role === "string" && obj.role.trim())) {
    const role = typeof obj.role === "string" ? obj.role.trim() : "";
    if (!role) return undefined;
    const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : undefined;
    return {
      kind: "role",
      role,
      ...(name !== undefined ? { name } : {}),
      ...(exact !== undefined ? { exact } : {}),
      ...(nth !== undefined ? { nth } : {}),
    };
  }

  if (explicitKind === "text" || (!explicitKind && typeof obj.text === "string" && obj.text.trim())) {
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    if (!text) return undefined;
    return {
      kind: "text",
      text,
      ...(exact !== undefined ? { exact } : {}),
      ...(nth !== undefined ? { nth } : {}),
    };
  }

  if (typeof obj.name === "string" && obj.name.trim()) {
    return {
      kind: "text",
      text: obj.name.trim(),
      ...(exact !== undefined ? { exact } : {}),
      ...(nth !== undefined ? { nth } : {}),
    };
  }

  return undefined;
}

export const PHASE15_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "criativo_browser",
    description:
      "Controla o navegador real Chromium embutido via Chrome DevTools Protocol (open, list_tabs, status, navigate, go_back, go_forward, reload, snapshot, click, type, fill_fields, press, hover, scroll, select_option, set_checked, drag, upload_files, wait_for, evaluate, screenshot, set_environment, handle_dialog, request_takeover, release_takeover, submit_secret, close_tab).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "open",
            "list_tabs",
            "status",
            "navigate",
            "go_back",
            "go_forward",
            "reload",
            "snapshot",
            "click",
            "type",
            "fill_fields",
            "press",
            "hover",
            "scroll",
            "select_option",
            "set_checked",
            "drag",
            "upload_files",
            "wait_for",
            "evaluate",
            "screenshot",
            "set_environment",
            "handle_dialog",
            "request_takeover",
            "release_takeover",
            "submit_secret",
            "close_tab",
          ],
        },
        tabId: { type: "string" },
        perfilId: { type: "string" },
        url: { type: "string" },
        target: BROWSER_TARGET_SCHEMA,
        toTarget: BROWSER_TARGET_SCHEMA,
        text: { type: "string" },
        clear: { type: "boolean" },
        pressEnter: { type: "boolean" },
        key: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              target: BROWSER_TARGET_SCHEMA,
              value: { type: "string" },
            },
            required: ["target", "value"],
          },
        },
        deltaX: { type: "number" },
        deltaY: { type: "number" },
        values: { type: "array", items: { type: "string" } },
        checked: { type: "boolean" },
        paths: { type: "array", items: { type: "string" } },
        waitKind: { type: "string", enum: ["text", "selector", "url", "load"] },
        waitValue: { type: "string" },
        timeoutMs: { type: "number" },
        image: { type: "boolean" },
        expression: { type: "string" },
        accept: { type: "boolean" },
        promptText: { type: "string" },
        viewport: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        userAgent: { type: "string" },
        locale: { type: "string" },
        timezoneId: { type: "string" },
        colorScheme: { type: "string", enum: ["dark", "light"] },
        reason: {
          type: "string",
          enum: ["login", "2fa", "captcha", "passkey", "payment", "sign-in-blocked", "manual"],
        },
        waitForTakeover: { type: "boolean" },
        method: { type: "string", enum: ["password", "otp", "authenticator"] },
        targets: { type: "array", items: BROWSER_TARGET_SCHEMA },
        loginId: { type: "string" },
        username: { type: "string" },
        submission: { type: "string", enum: ["enter", "click", "none"] },
        submitTarget: BROWSER_TARGET_SCHEMA,
      },
      required: ["action"],
    },
  },
  ...BROWSER_DIRECT_ALIASES.map((aliasName): ToolDefinition => ({
    name: aliasName,
    description: `Atalho direto para criativo_browser(action="${aliasName.slice("browser_".length)}").`,
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        perfilId: { type: "string" },
        url: { type: "string" },
        target: BROWSER_TARGET_SCHEMA,
        toTarget: BROWSER_TARGET_SCHEMA,
        text: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              target: BROWSER_TARGET_SCHEMA,
              value: { type: "string" },
            },
            required: ["target", "value"],
          },
        },
        key: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
        expression: { type: "string" },
        reason: { type: "string" },
        image: { type: "boolean" },
      },
    },
  })),
  {
    name: "read_video",
    description:
      "Lê vídeo público (Reels, TikTok, YouTube ou MP4 direto) extraindo metadados, legendas/transcrição e até 12 frames-chave JPEG.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL pública http(s) do vídeo." },
        frames: { type: "number", description: "Quantidade de frames-chave JPEG (0 a 12, padrão 6)." },
        timeoutMs: { type: "number" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_image",
    description:
      "Lê uma imagem PNG/JPEG/WebP do workspace permitido, validando assinatura binária e retornando imagem redimensionada com orientação EXIF correta.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Caminho relativo no workspace permitido." },
        maxDimension: { type: "number", description: "Dimensão máxima em pixels (padrão 1568)." },
      },
      required: ["path"],
    },
  },
  {
    name: "capture_screen",
    description:
      "Solicita ao usuário autorização explícita via getDisplayMedia() no navegador para capturar uma imagem única da tela ou janela atual.",
    parameters: {
      type: "object",
      properties: {
        purpose: {
          type: "string",
          description: "Explicação clara para o usuário sobre o motivo da captura pontual.",
        },
        targetHint: { type: "string", description: "Sugestão opcional de aba/janela alvo." },
        timeoutMs: { type: "number" },
      },
      required: ["purpose"],
    },
  },
  {
    name: "list_sections",
    description: "Lista todas as seções hierárquicas da Sidebar e os vínculos de agentes.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_section",
    description: "Cria uma nova seção na Sidebar (até 3 níveis de profundidade e máx 40 seções).",
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string" },
        parentId: { type: "string" },
      },
      required: ["nome"],
    },
  },
  {
    name: "rename_section",
    description: "Renomeia uma seção existente da Sidebar.",
    parameters: {
      type: "object",
      properties: {
        sectionId: { type: "string" },
        nome: { type: "string" },
      },
      required: ["sectionId", "nome"],
    },
  },
  {
    name: "delete_section",
    description: "Remove uma seção da Sidebar promovendo suas subseções e agentes sem apagar nenhum agente.",
    parameters: {
      type: "object",
      properties: {
        sectionId: { type: "string" },
      },
      required: ["sectionId"],
    },
  },
  {
    name: "assign_agent_section",
    description: "Move ou ordena um agente para dentro de uma seção da Sidebar (ou raiz com sectionId=null).",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        sectionId: { type: "string" },
        beforeAgentId: { type: "string" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "list_sites",
    description: "Lista os sites estáticos locais publicados no Showcase (/showcase/:slug/).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "publish_site",
    description: "Publica um diretório estático do workspace no Showcase local (/showcase/:slug/) mediante aprovação humana.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string" },
        titulo: { type: "string" },
        descricao: { type: "string" },
        sourceDir: { type: "string" },
        spaFallback: { type: "boolean" },
        aprovadoPorHumano: { type: "boolean" },
      },
      required: ["slug", "titulo", "sourceDir"],
    },
  },
  {
    name: "replace_site",
    description: "Atualiza/substitui os arquivos estáticos de um site Showcase local mediante aprovação humana.",
    parameters: {
      type: "object",
      properties: {
        siteId: { type: "string" },
        sourceDir: { type: "string" },
        titulo: { type: "string" },
        descricao: { type: "string" },
        spaFallback: { type: "boolean" },
        aprovadoPorHumano: { type: "boolean" },
      },
      required: ["siteId", "sourceDir"],
    },
  },
  {
    name: "delete_site",
    description: "Remove um site estático publicado no Showcase local mediante aprovação humana.",
    parameters: {
      type: "object",
      properties: {
        siteId: { type: "string" },
        aprovadoPorHumano: { type: "boolean" },
      },
      required: ["siteId"],
    },
  },
  {
    name: "create_server_install_command",
    description:
      "Gera comando único de instalação e pareamento (CRIATIVO_CLAIM) com validade de 15 minutos para conectar uma VPS Linux ao Criativo AI Studio (fluxo 'Configurar com um agente'). Nunca registre o token em memórias permanentes.",
    parameters: {
      type: "object",
      properties: {
        server_name: { type: "string", description: "Nome amigável do servidor VPS" },
        aprovadoPorHumano: {
          type: "boolean",
          description: "Confirmação explícita do usuário antes de executar instalação em VPS.",
        },
      },
      required: ["server_name"],
    },
  },
  {
    name: "gerar_comando_claim_vps",
    description:
      "Gera um novo comando shell único (CRIATIVO_CLAIM válido por 15 minutos) para instalar e conectar uma VPS Linux ao Criativo AI Studio Online.",
    parameters: {
      type: "object",
      properties: {
        server_name: { type: "string", description: "Nome amigável opcional do servidor VPS." },
      },
    },
  },
  {
    name: "instalar_parear_servidor_vps",
    description:
      "Instala via SSH (quando host e chave SSH são fornecidos) ou verifica saúde HTTP (/health) de um servidor VPS Linux para conectá-lo ao Criativo AI Studio Online.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["install", "health_check"],
          description: "Ação desejada: 'install' executa o instalador via SSH; 'health_check' verifica http://host:port/health.",
        },
        host: { type: "string", description: "IP público ou domínio SSH/HTTP da VPS Linux." },
        port: { type: "number", description: "Porta SSH (padrão 22)." },
        username: { type: "string", description: "Usuário SSH (padrão 'root')." },
        private_key_path: { type: "string", description: "Caminho local opcional para chave privada SSH." },
        claim_secret: { type: "string", description: "Token CRIATIVO_CLAIM opcional; se omitido em 'install', gera um novo automaticamente." },
        server_name: { type: "string", description: "Nome amigável do servidor VPS." },
        server_port: { type: "number", description: "Porta do daemon do Criativo na VPS (padrão 3000)." },
      },
    },
  },
];

export const PHASE15_TOOL_NAMES: ReadonlySet<string> = new Set(
  PHASE15_TOOLS_SCHEMA.map((t) => t.name),
);

export function isPhase15ToolName(name: string): boolean {
  return PHASE15_TOOL_NAMES.has(name);
}

export interface Phase15ToolServices {
  db: CriativoDatabase;
  wsHub?: WebSocketHub;
  workspaceRoot: string;
  browserService?: BrowserAutomationService;
  screenCapture?: ScreenCaptureBridge;
  showcaseService?: ShowcaseSiteService;
  transcription?: TranscriptionService;
  remoteClaimService?: RemoteClaimService;
}

export interface Phase15ToolContext {
  agenteId: string;
  canalId: string;
  permissionLevel?: PermissionLevel;
  browserProfileId?: string | null;
  aprovadoPorHumano?: boolean;
  generatedArtifacts?: string[];
}

export async function executePhase15ToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Phase15ToolContext,
  services: Phase15ToolServices,
): Promise<unknown> {
  const governance = readAgentGovernance(services.db, ctx.agenteId);
  const permissionLevel = ctx.permissionLevel ?? governance.permissionLevel;
  const browserProfileId = ctx.browserProfileId ?? governance.browserProfileId;

  if (toolName === "criativo_browser" || toolName.startsWith("browser_")) {
    if (!services.browserService) {
      throw new Error("BrowserAutomationService não inicializado neste daemon.");
    }
    const rawAction =
      toolName === "criativo_browser"
        ? readStringArg(args, "action", "acao")
        : toolName.slice("browser_".length);
    if (!rawAction) {
      throw new Error("Informe 'action' para criativo_browser.");
    }
    const action = rawAction as BrowserCdpActionName;

    if (action === "upload_files") {
      const paths = readStringArrayArg(args, "paths", "files");
      for (const p of paths) {
        assertAgentPermissionForPath({
          rawPath: p,
          workspaceRoot: services.workspaceRoot,
          permissionLevel,
          agenteId: ctx.agenteId,
          operation: "read",
          allowedFolders: governance.allowedFolders,
        });
      }
    }

    if (action === "submit_secret") {
      const tabId = readStringArg(args, "tabId");
      if (!tabId) {
        throw new Error("Informe 'tabId' em submit_secret.");
      }
      const loginId = readStringArg(args, "loginId");
      const targets = Array.isArray(args.targets)
        ? args.targets
            .map((raw) => normalizeBrowserTargetInput(raw))
            .filter((item): item is BrowserTargetSelector => Boolean(item))
        : [];
      const normalizedSubmitTarget = normalizeBrowserTargetInput(args.submitTarget) ?? null;
      const method =
        args.method === "otp" || args.method === "authenticator" ? args.method : "password";

      if (loginId) {
        return await services.browserService.submitSecret({
          tabId,
          method,
          targets,
          loginId,
          username: readStringArg(args, "username") ?? null,
          submission:
            args.submission === "click" || args.submission === "none" ? args.submission : "enter",
          submitTarget: normalizedSubmitTarget,
        });
      }

      const tab = services.browserService.sessionManager.getTab(tabId);
      let host = "site";
      try {
        host = new URL(tab?.page ? tab.page.url() : tab?.virtualUrl || "https://example.invalid").hostname;
      } catch {
        host = "site";
      }

      return {
        ok: false,
        requiresSecretInput: true,
        secretRequest: {
          requestId: `sec-${randomUUID().slice(0, 8)}`,
          tabId,
          agenteId: ctx.agenteId,
          canalId: ctx.canalId,
          host,
          method,
          targets,
          digits: typeof args.digits === "number" ? args.digits : method === "otp" ? 6 : undefined,
          loginId: null,
          username: readStringArg(args, "username") ?? null,
          submission:
            args.submission === "click" || args.submission === "none" ? args.submission : "enter",
          submitTarget: normalizedSubmitTarget,
        },
      };
    }

    const normalizedFields = Array.isArray(args.fields)
      ? args.fields
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const rec = item as Record<string, unknown>;
            const target = normalizeBrowserTargetInput(rec.target);
            if (!target) return null;
            return {
              target,
              value: typeof rec.value === "string" ? rec.value : String(rec.value ?? ""),
            };
          })
          .filter((entry): entry is { target: BrowserTargetSelector; value: string } => Boolean(entry))
      : undefined;

    return await services.browserService.executeAction({
      action,
      agenteId: ctx.agenteId,
      canalId: ctx.canalId,
      perfilId: readStringArg(args, "perfilId") ?? browserProfileId ?? undefined,
      permissionLevel,
      tabId: readStringArg(args, "tabId"),
      url: readStringArg(args, "url"),
      target: normalizeBrowserTargetInput(args.target),
      toTarget: normalizeBrowserTargetInput(args.toTarget),
      text: typeof args.text === "string" ? args.text : undefined,
      clear: typeof args.clear === "boolean" ? args.clear : undefined,
      pressEnter: typeof args.pressEnter === "boolean" ? args.pressEnter : undefined,
      key: readStringArg(args, "key"),
      fields: normalizedFields,
      deltaX: typeof args.deltaX === "number" ? args.deltaX : undefined,
      deltaY: typeof args.deltaY === "number" ? args.deltaY : undefined,
      values: Array.isArray(args.values) ? args.values.map(String) : undefined,
      checked: typeof args.checked === "boolean" ? args.checked : undefined,
      paths: Array.isArray(args.paths) ? args.paths.map(String) : undefined,
      waitKind:
        args.waitKind === "text" ||
        args.waitKind === "selector" ||
        args.waitKind === "url" ||
        args.waitKind === "load"
          ? args.waitKind
          : undefined,
      waitValue: readStringArg(args, "waitValue"),
      timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
      image: typeof args.image === "boolean" ? args.image : undefined,
      expression: typeof args.expression === "string" ? args.expression : undefined,
      accept: typeof args.accept === "boolean" ? args.accept : undefined,
      promptText: typeof args.promptText === "string" ? args.promptText : undefined,
      viewport:
        args.viewport && typeof args.viewport === "object"
          ? (args.viewport as { width: number; height: number })
          : undefined,
      userAgent: readStringArg(args, "userAgent"),
      locale: readStringArg(args, "locale"),
      timezoneId: readStringArg(args, "timezoneId"),
      colorScheme:
        args.colorScheme === "dark" || args.colorScheme === "light" ? args.colorScheme : undefined,
      reason: readStringArg(args, "reason") as BrowserTakeoverReason | undefined,
      waitForTakeover: typeof args.waitForTakeover === "boolean" ? args.waitForTakeover : undefined,
    });
  }

  if (toolName === "read_video") {
    const url = readStringArg(args, "url") ?? "";
    const frames = typeof args.frames === "number" ? args.frames : undefined;
    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
    return await readVideoTool(
      { url, frames, timeoutMs },
      { transcription: services.transcription },
    );
  }

  if (toolName === "read_image") {
    const rawPath = readStringArg(args, "path", "caminho") ?? "";
    assertAgentPermissionForPath({
      rawPath,
      workspaceRoot: services.workspaceRoot,
      permissionLevel,
      agenteId: ctx.agenteId,
      operation: "read",
      allowedFolders: governance.allowedFolders,
    });
    const maxDimension =
      typeof args.maxDimension === "number" ? args.maxDimension : undefined;
    return await readImageTool({ path: rawPath, maxDimension }, services.workspaceRoot);
  }

  if (toolName === "capture_screen") {
    if (!services.screenCapture) {
      throw new Error("ScreenCaptureBridge não inicializado neste daemon.");
    }
    const purpose = readStringArg(args, "purpose", "motivo") ?? "Inspecionar a tela atual.";
    const targetHint = readStringArg(args, "targetHint") ?? null;
    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
    return await services.screenCapture.requestCapture({
      agenteId: ctx.agenteId,
      canalId: ctx.canalId,
      purpose,
      targetHint,
      timeoutMs,
    });
  }

  if ((SIDEBAR_AGENT_TOOL_NAMES as readonly string[]).includes(toolName)) {
    return executeSidebarTool(services.db, toolName, args, services.wsHub);
  }

  if ((SHOWCASE_AGENT_TOOL_NAMES as readonly string[]).includes(toolName)) {
    if (!services.showcaseService) {
      throw new Error("ShowcaseSiteService não inicializado neste daemon.");
    }
    const sourceDir = readStringArg(args, "sourceDir", "source_dir");
    if (sourceDir && (toolName === "publish_site" || toolName === "replace_site")) {
      assertAgentPermissionForPath({
        rawPath: sourceDir,
        workspaceRoot: services.workspaceRoot,
        permissionLevel,
        agenteId: ctx.agenteId,
        operation: "publish",
        allowedFolders: governance.allowedFolders,
      });
    }
    return executeShowcaseTool(services.showcaseService, toolName, args, {
      agenteId: ctx.agenteId,
      aprovadoPorHumano: ctx.aprovadoPorHumano,
    });
  }

  if (toolName === "create_server_install_command") {
    if (!services.remoteClaimService) {
      throw new Error("RemoteClaimService não inicializado neste daemon.");
    }
    const serverName = readStringArg(args, "server_name", "nome") ?? "Servidor VPS";
    const approved = ctx.aprovadoPorHumano === true || args.aprovadoPorHumano === true;
    if (!approved) {
      return {
        requiresApproval: true,
        action: "create_server_install_command",
        server_name: serverName,
        mensagem: `Confirme que deseja gerar o comando único de instalação para a VPS '${serverName}' (expira em 15 minutos).`,
      };
    }
    const ticket = await services.remoteClaimService.createRemoteClaim(serverName);
    return {
      ok: true,
      claim_id: ticket.claim_id,
      server_name: ticket.server_name,
      expires_at: ticket.expires_at,
      ttl_seconds: ticket.ttl_seconds,
      command_bash: ticket.command_bash,
      aviso_seguranca:
        "Comando de uso único (15 minutos). Não salve o token CRIATIVO_CLAIM em arquivos permanentes ou memórias.",
    };
  }

  if (toolName === "gerar_comando_claim_vps") {
    if (!services.remoteClaimService) {
      throw new Error("RemoteClaimService não inicializado neste daemon.");
    }
    const serverName = readStringArg(args, "server_name", "nome") ?? "Servidor VPS";
    const claim = await services.remoteClaimService.createRemoteClaim(serverName);
    return {
      ok: true,
      claim,
    };
  }

  if (toolName === "instalar_parear_servidor_vps") {
    const action = readStringArg(args, "action") === "health_check" ? "health_check" : "install";
    const host = readStringArg(args, "host")?.trim() ?? "";
    const sshPort = typeof args.port === "number" && args.port > 0 ? Math.floor(args.port) : 22;
    const username = readStringArg(args, "username")?.trim() || "root";
    const privateKeyPath = readStringArg(args, "private_key_path")?.trim() || "";
    const serverName = readStringArg(args, "server_name", "nome") ?? "Servidor VPS";
    const serverPort =
      typeof args.server_port === "number" && args.server_port > 0 ? Math.floor(args.server_port) : 3000;

    if (!host) {
      const claim = services.remoteClaimService
        ? await services.remoteClaimService.createRemoteClaim(serverName).catch(() => null)
        : null;
      return {
        ok: false,
        requires_manual_ssh_or_key: true,
        diagnostico:
          "Nenhum host/IP da VPS foi informado ainda. Peça ao usuário o IP/domínio e chave SSH (ou peça para colar o comando seguro diretamente no console SSH da VPS).",
        command_bash: claim?.command_bash ?? null,
        claim_id: claim?.claim_id ?? null,
      };
    }

    const checkVpsHealth = async () => {
      const healthUrl = `http://${host}:${serverPort}/health`;
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        const bodyText = await res.text().catch(() => "");
        return {
          reachable: res.ok,
          status: res.status,
          url: healthUrl,
          body: bodyText.slice(0, 300),
        };
      } catch (err) {
        return {
          reachable: false,
          status: 0,
          url: healthUrl,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    if (action === "health_check") {
      const health = await checkVpsHealth();
      return {
        ok: health.reachable,
        action: "health_check",
        host,
        server_port: serverPort,
        health,
      };
    }

    if (!privateKeyPath) {
      const claim = services.remoteClaimService
        ? await services.remoteClaimService.createRemoteClaim(serverName).catch(() => null)
        : null;
      const health = await checkVpsHealth();
      return {
        ok: false,
        requires_manual_ssh_or_key: true,
        diagnostico:
          "Para executar instalação remota automática a partir deste computador, informe `private_key_path` (caminho da chave SSH sem senha interativa) ou execute o comando abaixo diretamente na VPS via SSH/console do provedor.",
        command_bash: claim?.command_bash ?? null,
        claim_id: claim?.claim_id ?? null,
        health,
      };
    }

    if (!existsSync(privateKeyPath)) {
      return {
        ok: false,
        error: `Arquivo de chave privada SSH não encontrado em '${privateKeyPath}'.`,
      };
    }

    let commandToRun = "";
    let claimSecret = readStringArg(args, "claim_secret")?.trim() || "";
    let claimId: string | null = null;
    if (services.remoteClaimService) {
      const ticket = await services.remoteClaimService.createRemoteClaim(serverName);
      claimId = ticket.claim_id;
      if (claimSecret) {
        commandToRun = ticket.command_bash.replace(/CRIATIVO_CLAIM=[^; ]+/, `CRIATIVO_CLAIM=${claimSecret}`);
      } else {
        commandToRun = ticket.command_bash;
      }
    } else if (claimSecret) {
      commandToRun = `{ echo CRIATIVO_CLAIM=${claimSecret}; curl -fsSL https://painel.criativoaistudio.com.br/api/releases/install-server.sh; } | sudo bash -s -- --name "${serverName.replace(/[^a-zA-Z0-9 _.-]/g, "") || "Servidor VPS"}"`;
    } else {
      throw new Error("RemoteClaimService indisponível e nenhum claim_secret informado.");
    }

    const execFileAsync = promisify(execFile);
    const sshArgs = [
      "-i",
      privateKeyPath,
      "-p",
      String(sshPort),
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "StrictHostKeyChecking=accept-new",
      `${username}@${host}`,
      commandToRun,
    ];

    try {
      const { stdout, stderr } = await execFileAsync("ssh", sshArgs, {
        timeout: 180_000,
        windowsHide: true,
      });
      const health = await checkVpsHealth();
      return {
        ok: true,
        action: "install",
        host,
        claim_id: claimId,
        health,
        stdout_tail: String(stdout || "").slice(-1500),
        stderr_tail: String(stderr || "").slice(-800),
      };
    } catch (err) {
      const e = err as { message?: string; stdout?: string; stderr?: string };
      return {
        ok: false,
        action: "install",
        host,
        claim_id: claimId,
        error: e?.message || String(err),
        diagnostico:
          "Falha ao executar SSH não-interativo. Verifique IP, usuário, porta, permissões da chave SSH ou execute o comando diretamente na VPS.",
        command_bash: commandToRun,
        stdout_tail: String(e?.stdout || "").slice(-1000),
        stderr_tail: String(e?.stderr || "").slice(-1000),
      };
    }
  }

  throw new Error(`Ferramenta da Fase 15 desconhecida: ${toolName}`);
}

export async function executePhase15ChatTool(params: {
  toolName: string;
  args: Record<string, unknown>;
  agenteId: string;
  canalId: string;
  deps: Phase15ToolServices;
  aprovadoPorHumano?: boolean;
}): Promise<unknown> {
  return await executePhase15ToolCall(
    params.toolName,
    params.args,
    {
      agenteId: params.agenteId,
      canalId: params.canalId,
      aprovadoPorHumano: params.aprovadoPorHumano,
    },
    params.deps,
  );
}

