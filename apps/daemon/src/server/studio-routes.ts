import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, relative, resolve, sep } from "node:path";
import type {
  AnexoChat,
  ArquivoStudio,
  CanalEquipe,
  ConversationMessage,
  MensagemChat,
  OnboardingEstado,
  PassoChat,
  ProviderName,
  ToolDefinition,
  WorkflowAresta,
  WorkflowNo,
  WorkflowVisual,
} from "@criativo/contracts";
import type { WhatsAppOrchestrator, WhatsAppSessionManager } from "@criativo/whatsapp";
import type { CriativoDatabase } from "../database/client.ts";
import type { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import { HandoffBus } from "../engine/runner/handoff-bus.ts";
import { ROSTER_15_AGENTES } from "../engine/runner/roster-defaults.ts";
import { SkillLoader } from "../engine/runner/skill-loader.ts";
import type { CatalogService } from "../marketplace/catalog-service.ts";
import type { GithubImporter } from "../marketplace/github-importer.ts";
import type { SkillsManager } from "../marketplace/skills-manager.ts";
import type { McpGateway, McpOAuthRequiredNotice } from "../mcp/mcp-gateway.ts";
import { redactMcpPayload, redactMcpSecrets } from "../mcp/mcp-redaction.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import type { FifoQueueManager } from "../queue/fifo-queue.ts";
import type { VaultService } from "../vault/vault-service.ts";
import {
  buildConnectorsList,
  computeHostAnalytics,
  importOpenBotTelemetryIfAvailable,
  listInstalledSkills,
  loadSkillPromptBySlug,
  recordChatTurnUsage,
  recordSkillLoadUsage,
} from "./analytics-skills-service.ts";
import {
  activateUpgradePackage,
  getBrandIdentity,
  listUpgradePackages,
  saveBrandIdentity,
} from "./brand-onboarding-service.ts";
import { tryHandleWhatsAppMcpStoreRoute } from "./routes-whatsapp-mcp-store.ts";
import {
  buildStudioLiveContext,
  executeStudioExtensionTool,
  executeStudioRoutineTool,
  isPhase10ExtensionTool,
  isRoutineToolName,
  isUpgradeUnlocked,
  PHASE10_TOOL_DEFINITIONS,
  ROUTINE_AGENT_TOOLS_SCHEMA,
  syncWorkspaceFilesToDatabase,
  validateMetaIntegration,
} from "./studio-tools-bridge.ts";
import type { RoutineToolsDeps } from "../routines/routine-agent-tools.ts";
import type { WebSocketHub } from "./websocket-hub.ts";

export interface StudioRoutesDeps {
  db: CriativoDatabase;
  queue: FifoQueueManager;
  vault?: VaultService;
  providers: ProviderRegistry;
  providerConnection: ProviderConnectionService;
  wsHub: WebSocketHub;
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  readJsonBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  workspaceRoot?: string;
  mcpGateway?: McpGateway;
  catalogService?: CatalogService;
  githubImporter?: GithubImporter;
  skillsManager?: SkillsManager;
  whatsappManager?: WhatsAppSessionManager;
  whatsappOrchestrator?: WhatsAppOrchestrator;
  routineToolsDeps?: RoutineToolsDeps;
}

const RAW_MIME_MAP: Record<string, string> = {
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
  ".srt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
};

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sanitizeFileName(rawName: string): string {
  const base = basename(rawName || "anexo.png")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || `anexo-${Date.now()}.bin`;
}

function inferTipoUso(mime: string, requested?: string): ArquivoStudio["tipo_uso"] {
  if (
    requested === "referencia" ||
    requested === "logo" ||
    requested === "personagem" ||
    requested === "gerado" ||
    requested === "video" ||
    requested === "documento"
  ) {
    return requested;
  }
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "referencia";
  return "documento";
}

function mapChatRow(row: {
  mensagem_id: string;
  canal_id: string;
  agente_id: string | null;
  autor: string;
  autor_nome: string | null;
  conteudo_markdown: string;
  anexos_json: string | null;
  steps_json: string | null;
  tarefa_id: string | null;
  lida: number;
  criado_em: string;
}): MensagemChat {
  return {
    mensagem_id: row.mensagem_id,
    canal_id: row.canal_id,
    agente_id: row.agente_id,
    autor: (row.autor as MensagemChat["autor"]) ?? "agente",
    autor_nome: row.autor_nome ?? undefined,
    conteudo_markdown: row.conteudo_markdown,
    anexos: safeJsonParse<AnexoChat[]>(row.anexos_json, []),
    steps: safeJsonParse<PassoChat[]>(row.steps_json, []),
    tarefa_id: row.tarefa_id,
    lida: row.lida !== 0,
    criado_em: row.criado_em,
  };
}

function mapWorkflowRow(row: {
  workflow_id: string;
  nome: string;
  descricao: string | null;
  nos_json: string;
  arestas_json: string;
  ativo: number;
  ultima_execucao_em: string | null;
  atualizado_em: string;
}): WorkflowVisual {
  return {
    workflow_id: row.workflow_id,
    nome: row.nome,
    descricao: row.descricao ?? "",
    nos: safeJsonParse<WorkflowNo[]>(row.nos_json, []),
    arestas: safeJsonParse<WorkflowAresta[]>(row.arestas_json, []),
    ativo: row.ativo !== 0,
    ultima_execucao_em: row.ultima_execucao_em,
    atualizado_em: row.atualizado_em,
  };
}

function extractMentionedAgentIds(text: string, excludeId?: string): string[] {
  const found = new Set<string>();
  const validIds = new Set(ROSTER_15_AGENTES.map((a) => a.agente_id));

  // Detecta [HANDOFF:agente_id] ou @agente_id no texto do usuário
  for (const m of text.matchAll(/\[HANDOFF:([a-z0-9_]+)\]/gi)) {
    const id = m[1].toLowerCase();
    if (validIds.has(id) && id !== excludeId) found.add(id);
  }
  for (const m of text.matchAll(/@([a-z0-9_]+)/gi)) {
    const id = m[1].toLowerCase();
    if (validIds.has(id) && id !== excludeId) found.add(id);
  }
  return Array.from(found);
}

function extractExplicitAgentHandoffTags(text: string, excludeId?: string): string[] {
  const found = new Set<string>();
  const validIds = new Set(ROSTER_15_AGENTES.map((a) => a.agente_id));
  for (const m of text.matchAll(/\[HANDOFF:([a-z0-9_]+)\]/gi)) {
    const id = m[1].toLowerCase();
    if (validIds.has(id) && id !== excludeId) found.add(id);
  }
  return Array.from(found);
}

const EXPLICIT_CREATION_ACTION_RE =
  /(?:^|\b)(crie|criar|gere|gerar|fa[cç]a|fazer|produza|produzir|monte|montar|desenhe|desenhar|refa[cç]a|refazer|ajuste|ajustar|renderize|renderizar|cria|gera|faz|quero um|quero uma|preciso de um|preciso de uma)\b/i;

const IMPERATIVE_OR_WANT_RE =
  /(?:^|\b)(crie|gere|fa[cç]a|produza|monte|desenhe|refa[cç]a|ajuste|renderize|quero um|quero uma|preciso de um|preciso de uma)\b/i;

const EXPLICIT_VISUAL_ASSET_NOUN_RE =
  /\b(imagem|imagens|arte|artes|banner|capa|post|posts|carrossel|carross[eé]is|slide|slides|l[aâ]mina|l[aâ]minas|storie|stories|story|criativo|criativos|an[uú]ncio|an[uú]ncios)\b/i;

const DIRECT_IMAGE_NOUN_RE =
  /\b(imagem|imagens|arte|artes|foto|fotos|banner|capa|ilustra[cç][aã]o)\b/i;

export function isGreetingOrCapabilityQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const clean = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:]+$/g, "")
    .trim();

  if (
    /^(oi+|ola+|e ai|opa|eae|hello|hi|bom dia|boa tarde|boa noite|tudo bem|td bem|teste|ok|obrigad[oa]|valeu|tente novamente|novamente)$/i.test(
      clean
    )
  ) {
    return true;
  }

  const isCapabilityOrAccessQuestion =
    /(o que (voce|vc|voces|vcs) (pode|consegue|sabe|faz)|quais (sao )?(as )?(suas )?(funcoes|capacidades|pastas|referencias|arquivos)|como (voce|vc|isso|o studio) funciona|(voce|vc) tem acesso|tem acesso a|pode me explicar|me explique|quem e voce|quem eh voce)/i.test(
      clean
    ) && clean.length < 180;

  if (isCapabilityOrAccessQuestion && !IMPERATIVE_OR_WANT_RE.test(clean)) {
    return true;
  }

  if (EXPLICIT_CREATION_ACTION_RE.test(trimmed)) return false;

  return false;
}

export function hasExplicitVisualGenerationIntent(
  userPrompt: string,
  agentId: string,
  isHandoff = false
): boolean {
  if (isGreetingOrCapabilityQuestion(userPrompt)) return false;
  if (!EXPLICIT_CREATION_ACTION_RE.test(userPrompt)) return false;

  const isVisualAgent = agentId.startsWith("designer_") || agentId === "consistencia_visual";
  if (isVisualAgent) {
    return EXPLICIT_VISUAL_ASSET_NOUN_RE.test(userPrompt);
  }
  if (isHandoff) {
    return false;
  }
  // Agentes não-visuais (estrategista, copywriter, etc.) só geram imagem se o usuário pedir explicitamente uma imagem/arte
  return DIRECT_IMAGE_NOUN_RE.test(userPrompt);
}

function enrichAgentRow(
  db: CriativoDatabase,
  row: {
    agente_id: string;
    nome: string;
    papel: string;
    modelo_padrao: string;
    status: string;
    skills_paths_json: string;
    memoria_resumo: string | null;
    ordem_exibicao: number;
    config_json: string;
    atualizado_em: string;
  },
  workspaceRoot = process.cwd()
) {
  const canalId = `agente:${row.agente_id}`;
  const unreadRow = db.connection
    .prepare(
      `SELECT COUNT(*) as total FROM projecao_conversas_chat WHERE canal_id = ? AND lida = 0;`
    )
    .get(canalId) as { total: number };
  const lastRow = db.connection
    .prepare(
      `SELECT conteudo_markdown, criado_em FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em DESC LIMIT 1;`
    )
    .get(canalId) as { conteudo_markdown: string; criado_em: string } | undefined;

  const def = ROSTER_15_AGENTES.find((a) => a.agente_id === row.agente_id);
  const parsedConfig = safeJsonParse<Record<string, unknown>>(row.config_json, {});
  const pacote = (
    parsedConfig.pacote === "bonus" || parsedConfig.pacote === "video"
      ? parsedConfig.pacote
      : def?.pacote ?? "base"
  ) as "base" | "bonus" | "video";
  const upgradeDesbloqueado = isUpgradeUnlocked(db, workspaceRoot, pacote);
  const promptBase =
    typeof parsedConfig.prompt_base === "string" && parsedConfig.prompt_base.trim().length > 0
      ? parsedConfig.prompt_base
      : def?.prompt_base ?? "";

  const config = {
    ...parsedConfig,
    pacote,
    upgrade_desbloqueado: upgradeDesbloqueado,
    skill_slug: parsedConfig.skill_slug ?? def?.skill_slug,
    ferramentas: Array.isArray(parsedConfig.ferramentas)
      ? parsedConfig.ferramentas
      : def?.ferramentas ?? ["handoff_agente"],
    prompt_base: promptBase,
  };

  return {
    ...row,
    config,
    nao_lidas: Number(unreadRow?.total ?? 0),
    ultima_mensagem: lastRow ? lastRow.conteudo_markdown.replace(/\s+/g, " ").slice(0, 96) : null,
    ultima_mensagem_em: lastRow?.criado_em ?? row.atualizado_em,
  };
}

interface ChatProgressReport {
  fase: "iniciado" | "etapa" | "chunk" | "concluido" | "erro";
  mensagem_status?: string;
  step?: PassoChat;
  delta?: string;
}

async function generateAgentChatReply(
  deps: StudioRoutesDeps,
  agente: {
    agente_id: string;
    nome: string;
    papel: string;
    modelo_padrao: string;
    config_json: string;
  },
  userPrompt: string,
  anexos: AnexoChat[],
  history: MensagemChat[],
  onProgress?: (evt: ChatProgressReport) => void,
  options?: {
    isHandoff?: boolean;
    originalUserPrompt?: string;
  }
): Promise<{
  markdown: string;
  steps: PassoChat[];
  tarefaCriadaId: string | null;
  anexosGerados: AnexoChat[];
}> {
  onProgress?.({
    fase: "iniciado",
    mensagem_status: `Carregando habilidade e memórias de ${agente.nome}...`,
  });
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();
  const config = safeJsonParse<Record<string, unknown>>(agente.config_json, {});
  const onboarding = deps.providerConnection.getOnboardingState();
  const skillSlug = typeof config.skill_slug === "string" ? config.skill_slug : agente.agente_id;
  const loadedSkill =
    process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1"
      ? null
      : loadSkillPromptBySlug(skillSlug, undefined, workspaceRoot);
  const chatSkillLoader = new SkillLoader([], workspaceRoot);
  const linkedSkills = chatSkillLoader.loadLinkedAgentSkills(deps.db, agente.agente_id);

  // Carrega memórias persistidas do agente para contextualizar respostas reais
  const memories = deps.db.connection
    .prepare(`SELECT texto FROM projecao_agente_memorias WHERE agente_id = ? ORDER BY criado_em DESC LIMIT 8;`)
    .all(agente.agente_id) as Array<{ texto: string }>;

  const liveStudioContext = buildStudioLiveContext({
    db: deps.db,
    vault: deps.vault,
    providerConnection: deps.providerConnection,
    workspaceRoot,
  });

  const promptBaseParts = [
    typeof config.prompt_base === "string" && config.prompt_base.length > 0
      ? config.prompt_base
      : `Você é ${agente.nome} (${agente.papel}) do Criativo AI Studio para ${onboarding.marca_nome} (${onboarding.perfil_handle}).`,
    liveStudioContext,
  ];
  if (loadedSkill) {
    promptBaseParts.push(`Instruções oficiais da habilidade ${skillSlug}:\n${loadedSkill.body.slice(0, 2800)}`);
  }
  const extraLinkedSkills = linkedSkills.filter((s) => s.slug !== skillSlug || !loadedSkill);
  if (extraLinkedSkills.length > 0) {
    promptBaseParts.push(
      extraLinkedSkills
        .map((s) => `Habilidade vinculada ${s.name} (${s.slug}):\n${s.body.slice(0, 1800)}`)
        .join("\n\n")
    );
  }
  if (memories.length > 0) {
    promptBaseParts.push(`Memórias do agente:\n${memories.map((m) => `- ${m.texto}`).join("\n")}`);
  }

  // Ponte nativa para validação real da Meta Graph API (sem expor tokens)
  const lowerCheck = userPrompt.toLowerCase();
  const asksMetaValidation =
    agente.agente_id === "engenheiro_meta" &&
    /(validar|valida|valide|testar|teste|status|diagn[oó]stico|integra[cç][aã]o|meta|instagram|credencia)/i.test(
      lowerCheck
    );

  let metaValidationSummary: Awaited<ReturnType<typeof validateMetaIntegration>> | null = null;
  if (asksMetaValidation && deps.vault) {
    const tMeta0 = Date.now();
    metaValidationSummary = await validateMetaIntegration(deps.vault);
    const metaStep: PassoChat = {
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "validar_integracao_meta",
      titulo: metaValidationSummary.ok
        ? `Meta Graph API v21.0 validada (HTTP ${metaValidationSummary.detalhes.httpStatus} · Estágio ${metaValidationSummary.estagio})`
        : `Diagnóstico Meta (Estágio ${metaValidationSummary.estagio}): ${metaValidationSummary.resumo.slice(0, 80)}`,
      detalhes: JSON.stringify({
        tokenConfigurado: metaValidationSummary.detalhes.tokenConfigurado,
        accountIdConfigurado: metaValidationSummary.detalhes.accountIdConfigurado,
        graphApiOk: metaValidationSummary.detalhes.graphApiOk,
        username: metaValidationSummary.detalhes.username,
        followersCount: metaValidationSummary.detalhes.followersCount,
        mediaCount: metaValidationSummary.detalhes.mediaCount,
      }),
      status: metaValidationSummary.ok ? "concluido" : "erro",
      duracao_ms: Date.now() - tMeta0,
    };
    onProgress?.({
      fase: "etapa",
      mensagem_status: metaValidationSummary.resumo,
      step: metaStep,
    });
    promptBaseParts.push(
      `## Resultado Real Executado Agora por validar_integracao_meta (Cofre SQLite + Graph API v21.0)\n${JSON.stringify(
        metaValidationSummary,
        null,
        2
      )}\nBaseie sua resposta exclusivamente neste diagnóstico real sem jamais pedir ou exibir tokens.`
    );
  }

  const promptBase = promptBaseParts.join("\n\n");
  const mcpTools = deps.mcpGateway
    ? await deps.mcpGateway.getToolsForAgent(agente.agente_id).catch(() => [])
    : [];
  const availableChatToolsMap = new Map<string, ToolDefinition>();
  const studioRoutineTools = deps.routineToolsDeps ? ROUTINE_AGENT_TOOLS_SCHEMA : [];
  for (const t of [...PHASE10_TOOL_DEFINITIONS, ...studioRoutineTools, ...mcpTools]) {
    if (!availableChatToolsMap.has(t.name)) {
      availableChatToolsMap.set(t.name, t);
    }
  }
  const availableChatTools = Array.from(availableChatToolsMap.values());

  const providerName = deps.providers.resolveProviderName(agente.modelo_padrao);
  const agService = deps.providerConnection.getAntigravityService();
  const [statusList, agSnapshot] = await Promise.all([
    deps.providerConnection.getProvidersStatus(false),
    agService.getLiveSnapshot(false),
  ]);
  const providerStatus = statusList.find((item) => item.provedor === providerName);
  const claudeOAuthStatus = statusList.find((item) => item.provedor === "claude");
  const openaiOAuthStatus = statusList.find((item) => item.provedor === "openai");
  const opencodeStatus = statusList.find((item) => item.provedor === "opencode");

  const hasAntigravityAccount = agSnapshot.contas.some((c) => c.estado === "conectado" || Boolean(c.token_valido));
  const modelBelongsToAntigravity =
    hasAntigravityAccount &&
    (providerName === "gemini" || agSnapshot.modelos.some((m) => m.id === agente.modelo_padrao));
  const hasClaudeOAuthAccount = Boolean(claudeOAuthStatus?.contas && claudeOAuthStatus.contas.length > 0);
  const hasOpenAIOAuthAccount = Boolean(openaiOAuthStatus?.contas && openaiOAuthStatus.contas.length > 0);
  const canCallOpenCode = providerName === "opencode" && Boolean(opencodeStatus?.conectado);
  const canCallVaultOrLocal =
    Boolean(providerStatus?.vault_configurado) || (providerName === "ollama" && Boolean(providerStatus?.conectado));

  const skillStep: PassoChat = {
    id: `step-${randomUUID().slice(0, 8)}`,
    ferramenta: `skill:${skillSlug}`,
    titulo: loadedSkill
      ? `Habilidade ${skillSlug} carregada de SKILL.md (${loadedSkill.tokensEst} tokens)`
      : `Contexto do especialista ${agente.nome} carregado (${agente.modelo_padrao})`,
    status: "concluido",
    duracao_ms: 45,
  };
  const steps: PassoChat[] = [skillStep];
  if (metaValidationSummary) {
    steps.push({
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "validar_integracao_meta",
      titulo: metaValidationSummary.ok
        ? `Meta Graph API v21.0 validada (HTTP ${metaValidationSummary.detalhes.httpStatus} · @${metaValidationSummary.detalhes.username ?? "conectado"})`
        : `Diagnóstico Meta (Estágio ${metaValidationSummary.estagio}): ${metaValidationSummary.resumo.slice(0, 90)}`,
      detalhes: metaValidationSummary.resumo,
      status: metaValidationSummary.ok ? "concluido" : "erro",
      duracao_ms: 95,
    });
  }
  onProgress?.({
    fase: "etapa",
    mensagem_status: loadedSkill
      ? `Habilidade ${skillSlug} carregada — preparando execução...`
      : `Contexto de ${agente.nome} carregado...`,
    step: skillStep,
  });

  const turnId = `turn-${randomUUID().slice(0, 8)}`;
  const sessionId = `chat:${agente.agente_id}`;

  if (loadedSkill) {
    recordSkillLoadUsage(deps.db, {
      agentId: agente.agente_id,
      sessionId,
      turnId,
      provider: hasAntigravityAccount ? "antigravity" : providerName,
      model: agente.modelo_padrao,
      skill: skillSlug,
      tokens: loadedSkill.tokensEst,
    });
  }

  if (anexos.length > 0) {
    steps.push({
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "image_paths_attach",
      titulo: `${anexos.length} arquivo(s) anexado(s) para referência visual / ImagePaths`,
      detalhes: anexos.map((a) => a.caminho_relativo).join(", "),
      status: "concluido",
      duracao_ms: 28,
    });
  }

  // Verifica intenção explícita de produção / geração visual sem disparar em saudações ou dúvidas
  const intentSourcePrompt = options?.originalUserPrompt ?? userPrompt;
  const greetingOrCapability = isGreetingOrCapabilityQuestion(intentSourcePrompt);
  const lower = intentSourcePrompt.toLowerCase();
  let tarefaCriadaId: string | null = null;

  const asksProduction =
    !greetingOrCapability &&
    EXPLICIT_CREATION_ACTION_RE.test(intentSourcePrompt) &&
    EXPLICIT_VISUAL_ASSET_NOUN_RE.test(intentSourcePrompt);
  const asksVisualAsset = hasExplicitVisualGenerationIntent(
    intentSourcePrompt,
    agente.agente_id,
    Boolean(options?.isHandoff)
  );

  if (asksProduction) {
    const tipoInferido = lower.includes("carrossel")
      ? "carrossel"
      : lower.includes("reel") || /v[ií]deo/.test(lower)
        ? "reels"
        : lower.includes("storie")
          ? "stories"
          : "post_individual";

    const tarefa = deps.queue.enqueueTask({
      agente_id: agente.agente_id,
      canal_origem: "web",
      tipo: tipoInferido,
      titulo: userPrompt.slice(0, 80),
      prioridade: 3,
      payload: {
        tema: userPrompt,
        modelo: agente.modelo_padrao,
        effort: config.effort ?? "medio",
        image_paths: anexos.map((a) => a.caminho_relativo),
      },
    });
    tarefaCriadaId = tarefa.tarefa_id;
    deps.wsHub.broadcast("task:queued", {
      tarefa_id: tarefa.tarefa_id,
      tipo: tarefa.tipo,
      titulo: tarefa.titulo,
      prioridade: tarefa.prioridade,
      canal_origem: tarefa.canal_origem,
    });
    steps.push({
      id: `step-${randomUUID().slice(0, 8)}`,
      ferramenta: "fifo_queue_enqueue",
      titulo: `Tarefa #${tarefa.tarefa_id.slice(0, 8)} enviada à Fila FIFO (${tipoInferido})`,
      status: "concluido",
      duracao_ms: 35,
    });
  }

  const anexosGerados: AnexoChat[] = [];
  let resolvedImageDiskPaths = anexos
    .map((a) => resolve(workspaceRoot, a.caminho_relativo))
    .filter((p) => existsSync(p));

  // Quando o usuário não anexou na mensagem e é um turno visual/designer, carrega referências da marca do disco/SQLite
  if (
    resolvedImageDiskPaths.length === 0 &&
    (asksVisualAsset || agente.agente_id.startsWith("designer_") || agente.agente_id === "consistencia_visual") &&
    process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1"
  ) {
    const refRows = deps.db.connection
      .prepare(
        `SELECT caminho_relativo FROM projecao_arquivos
         WHERE tipo_uso IN ('referencia', 'logo', 'personagem')
           AND mime_type LIKE 'image/%'
           AND mime_type NOT LIKE '%svg%'
         ORDER BY CASE
           WHEN caminho_relativo LIKE 'recursos/referencias/%' THEN 0
           WHEN caminho_relativo LIKE 'recursos/fotos/%' THEN 1
           WHEN caminho_relativo LIKE 'recursos/logos/%' THEN 2
           ELSE 3
         END, criado_em DESC
         LIMIT 4;`
      )
      .all() as Array<{ caminho_relativo: string }>;
    resolvedImageDiskPaths = refRows
      .map((r) => resolve(workspaceRoot, r.caminho_relativo))
      .filter((p) => existsSync(p));
  }

  // Se houver conta conectada e pedido visual explícito, gera arte real via gemini-3.1-flash-image
  if (hasAntigravityAccount && asksVisualAsset) {
    const tImgStart = Date.now();
    try {
      const imgGen = await agService.executeCodeAssistGenerate({
        model: agSnapshot.imageGenerationModelIds[0] ?? "gemini-3.1-flash-image",
        messages: [
          {
            role: "user",
            text: `Crie uma arte profissional de Instagram para ${onboarding.marca_nome} (${onboarding.perfil_handle}). Solicitação do usuário: ${userPrompt}. Estética editorial contemporânea, alta legibilidade e contraste, sem marcas d'água.`,
          },
        ],
        imagePaths: resolvedImageDiskPaths,
        generateImage: true,
        agentId: agente.agente_id,
        preferredAccountId: typeof config.provider_account_id === "string" ? config.provider_account_id : null,
      });

      if (imgGen.images.length > 0) {
        const firstImg = imgGen.images[0];
        const ext = firstImg.mimeType.includes("png") ? ".png" : firstImg.mimeType.includes("webp") ? ".webp" : ".jpg";
        const arquivoId = `arte-${randomUUID().slice(0, 8)}`;
        const dirArtes = resolve(workspaceRoot, "saidas", "artes");
        mkdirSync(dirArtes, { recursive: true });
        const fileName = `${arquivoId}${ext}`;
        const diskPath = resolve(dirArtes, fileName);
        const buf = Buffer.from(firstImg.dataBase64, "base64");
        writeFileSync(diskPath, buf);

        const relPath = `saidas/artes/${fileName}`;
        const urlRaw = `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`;
        const agora = new Date().toISOString();

        deps.db.connection
          .prepare(
            `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
             VALUES (?, ?, ?, ?, ?, 'gerado', ?, ?, ?);`
          )
          .run(arquivoId, fileName, relPath, firstImg.mimeType, buf.length, agente.agente_id, tarefaCriadaId, agora);

        anexosGerados.push({
          arquivo_id: arquivoId,
          nome: fileName,
          caminho_relativo: relPath,
          url: urlRaw,
          mime_type: firstImg.mimeType,
          tamanho_bytes: buf.length,
          tipo_uso: "gerado",
        });

        recordChatTurnUsage(deps.db, {
          agentId: agente.agente_id,
          sessionId,
          turnId: `${turnId}:img`,
          provider: "antigravity",
          model: imgGen.modelUsed,
          uncachedInput: imgGen.usage.uncachedInput,
          cachedInput: imgGen.usage.cachedInput,
          output: imgGen.usage.output,
        });

        if (tarefaCriadaId) {
          deps.queue.updateTaskStatus(tarefaCriadaId, "aguardando_aprovacao", {
            preview_url: urlRaw,
            imagem_caminho: relPath,
            titulo: userPrompt.slice(0, 80),
            formato: lower.includes("storie") ? "9:16" : "4:5",
            aprovado: false,
          });
          const tipoAprovacao = lower.includes("storie")
            ? "storie"
            : lower.includes("carrossel")
              ? "carrossel"
              : lower.includes("reel")
                ? "video_reels"
                : lower.includes("anuncio") || lower.includes("anúncio")
                  ? "post_anuncio"
                  : "post_individual";
          deps.wsHub.broadcast("task:awaiting_approval", {
            tarefa_id: tarefaCriadaId,
            tipo: tipoAprovacao,
            previews: [urlRaw],
            copy: userPrompt.slice(0, 80),
          });
        }

        steps.push({
          id: `step-${randomUUID().slice(0, 8)}`,
          ferramenta: `generate_image:${imgGen.modelUsed}`,
          titulo: `Arte real gerada (${(buf.length / 1024).toFixed(0)} KB · ${imgGen.modelUsed})`,
          detalhes: relPath,
          status: "concluido",
          duracao_ms: Date.now() - tImgStart,
        });
      }
    } catch (imgErr) {
      steps.push({
        id: `step-${randomUUID().slice(0, 8)}`,
        ferramenta: "generate_image",
        titulo: `Aviso na geração de imagem: ${imgErr instanceof Error ? imgErr.message.slice(0, 90) : "falha na chamada"}`,
        status: "erro",
        duracao_ms: Date.now() - tImgStart,
      });
    }
  }

  let lastExecutionError: string | null = null;
  let hadConnectedRoute = false;

  // 1. Execução via Claude OAuth / ChatGPT (Codex) OAuth conectados no navegador
  if (
    ((providerName === "claude" && hasClaudeOAuthAccount) ||
      (providerName === "openai" && hasOpenAIOAuthAccount)) &&
    !providerStatus?.vault_configurado
  ) {
    hadConnectedRoute = true;
    const providerLabel = providerName === "claude" ? "Claude" : "ChatGPT";
    const activeCliStepId = `step-${randomUUID().slice(0, 8)}`;
    onProgress?.({
      fase: "etapa",
      mensagem_status: `Consultando ${providerLabel} (${agente.modelo_padrao})...`,
      step: {
        id: activeCliStepId,
        ferramenta: `${providerName}:${agente.modelo_padrao}`,
        titulo: `Executando via ${providerLabel} (${agente.modelo_padrao})...`,
        status: "executando",
      },
    });
    const t0 = Date.now();
    try {
      const cliMsgs = history.slice(-8).map((item) => ({
        role: (item.autor === "usuario" ? "user" : "assistant") as "user" | "assistant",
        text: item.conteudo_markdown,
      }));
      cliMsgs.push({
        role: "user",
        text:
          anexos.length > 0
            ? `${userPrompt}\n\n[Anexos ImagePaths disponíveis: ${anexos.map((a) => a.caminho_relativo).join(", ")}]`
            : userPrompt,
      });

      const cliResult = await deps.providerConnection.getCliOAuthService().executeTurn({
        provedor: providerName as "claude" | "openai",
        modelId: agente.modelo_padrao,
        systemPrompt: `${promptBase}\nResponda em pt-br de forma prática e objetiva. Nunca invente handles ou marcas reais.`,
        messages: cliMsgs,
        preferredAccountId: typeof config.provider_account_id === "string" ? config.provider_account_id : null,
      });

      recordChatTurnUsage(deps.db, {
        agentId: agente.agente_id,
        sessionId,
        turnId,
        provider: providerName,
        model: cliResult.modelUsed,
        uncachedInput: cliResult.usage.uncachedInput,
        cachedInput: cliResult.usage.cachedInput,
        output: cliResult.usage.output,
      });

      steps.push({
        id: `step-${randomUUID().slice(0, 8)}`,
        ferramenta: `${providerName}:${cliResult.modelUsed}`,
        titulo: `Executado via ${cliResult.modelUsed}${cliResult.accountEmail ? ` (${cliResult.accountEmail})` : ""} · ${cliResult.usage.uncachedInput + cliResult.usage.cachedInput + cliResult.usage.output} tokens`,
        status: "concluido",
        duracao_ms: Date.now() - t0,
      });
      return { markdown: cliResult.text, steps, tarefaCriadaId, anexosGerados };
    } catch (cliErr) {
      lastExecutionError = cliErr instanceof Error ? cliErr.message : String(cliErr);
      steps.push({
        id: `step-${randomUUID().slice(0, 8)}`,
        ferramenta: `${providerName}:erro`,
        titulo: `Falha na execução ${providerName}: ${lastExecutionError.slice(0, 120)}`,
        status: "erro",
        duracao_ms: Date.now() - t0,
      });
    }
  }

  // 2. Execução via OpenCode local (modelos gratuitos ou com API key opencode_api_key)
  if (canCallOpenCode) {
    hadConnectedRoute = true;
    const activeOcStepId = `step-${randomUUID().slice(0, 8)}`;
    onProgress?.({
      fase: "etapa",
      mensagem_status: `Executando ${agente.modelo_padrao} via OpenCode...`,
      step: {
        id: activeOcStepId,
        ferramenta: `opencode:${agente.modelo_padrao}`,
        titulo: `Gerando resposta em tempo real (${agente.modelo_padrao})...`,
        status: "executando",
      },
    });
    const t0 = Date.now();
    try {
      const ocMsgs = history.slice(-8).map((item) => ({
        role: (item.autor === "usuario" ? "user" : "assistant") as "user" | "assistant",
        text: item.conteudo_markdown,
      }));
      ocMsgs.push({
        role: "user",
        text:
          anexos.length > 0
            ? `${userPrompt}\n\n[Anexos disponíveis: ${anexos.map((a) => a.caminho_relativo).join(", ")}]`
            : userPrompt,
      });

      const ocResult = await deps.providerConnection.getOpenCodeService().executePrompt({
        modelId: agente.modelo_padrao,
        systemPrompt: `${promptBase}\nResponda em pt-br de forma prática e especializada.`,
        messages: ocMsgs,
        agentId: agente.agente_id,
        onDelta: (delta) => {
          onProgress?.({
            fase: "chunk",
            mensagem_status: `Escrevendo resposta (${agente.modelo_padrao})...`,
            delta,
          });
        },
      });

      if (ocResult.text) {
        recordChatTurnUsage(deps.db, {
          agentId: agente.agente_id,
          sessionId,
          turnId,
          provider: "opencode",
          model: ocResult.modelUsed,
          uncachedInput: ocResult.usage.uncachedInput,
          cachedInput: ocResult.usage.cachedInput,
          output: ocResult.usage.output,
        });

        const doneStep: PassoChat = {
          id: activeOcStepId,
          ferramenta: `opencode:${ocResult.modelUsed}`,
          titulo: `Executado via OpenCode (${ocResult.modelUsed}) · ${ocResult.usage.uncachedInput + ocResult.usage.output} tokens`,
          status: "concluido",
          duracao_ms: Date.now() - t0,
        };
        steps.push(doneStep);
        onProgress?.({ fase: "etapa", step: doneStep });
        return { markdown: ocResult.text, steps, tarefaCriadaId, anexosGerados };
      }
    } catch (ocErr) {
      lastExecutionError = ocErr instanceof Error ? ocErr.message : String(ocErr);
      steps.push({
        id: `step-${randomUUID().slice(0, 8)}`,
        ferramenta: "opencode:erro",
        titulo: `Falha ao executar modelo OpenCode: ${lastExecutionError.slice(0, 120)}`,
        status: "erro",
        duracao_ms: Date.now() - t0,
      });
    }
  }

  // 3. Execução via API Key cadastrada no Cofre ou Ollama local (com loop multi-turn de tools até 6 iterações)
  if (canCallVaultOrLocal) {
    hadConnectedRoute = true;
    onProgress?.({
      fase: "etapa",
      mensagem_status: `Consultando ${providerName} (${agente.modelo_padrao})...`,
    });
    const t0 = Date.now();
    try {
      const client = deps.providers.getClientForModel(agente.modelo_padrao);
      const turnMessages: ConversationMessage[] = history.slice(-8).map((item) => ({
        role: (item.autor === "usuario" ? "user" : "assistant") as "user" | "assistant",
        content: item.conteudo_markdown,
      }));
      turnMessages.push({
        role: "user",
        content:
          anexos.length > 0
            ? `${userPrompt}\n\n[Anexos ImagePaths disponíveis: ${anexos.map((a) => a.caminho_relativo).join(", ")}]`
            : userPrompt,
      });

      const systemPromptChat = `${promptBase}\nResponda sempre em pt-br com objetividade, tabelas Markdown quando útil e zero dados fictícios de clientes reais.`;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let finalReplyText = "";

      for (let iter = 0; iter < 6; iter += 1) {
        const llmResult = await client.executeTurn({
          model: agente.modelo_padrao,
          systemPrompt: systemPromptChat,
          messages: turnMessages,
          tools: availableChatTools,
        });

        totalInputTokens += llmResult.usage?.inputTokens ?? 0;
        totalOutputTokens += llmResult.usage?.outputTokens ?? 0;

        if (!llmResult.toolCalls || llmResult.toolCalls.length === 0) {
          finalReplyText = llmResult.text?.trim() ?? "";
          break;
        }

        turnMessages.push({
          role: "assistant",
          content: llmResult.text ?? "",
          toolCalls: llmResult.toolCalls,
        });

        for (const call of llmResult.toolCalls) {
          const stepStart = Date.now();
          const runningStep: PassoChat = {
            id: `step-${randomUUID().slice(0, 8)}`,
            ferramenta: call.name,
            titulo: `Executando ${call.name}...`,
            status: "executando",
          };
          onProgress?.({
            fase: "etapa",
            mensagem_status: `Executando ferramenta ${call.name}...`,
            step: runningStep,
          });

          let toolOutput: unknown;
          let toolFailed = false;
          try {
            if (isPhase10ExtensionTool(call.name)) {
              toolOutput = await executeStudioExtensionTool(call.name, call.arguments, {
                db: deps.db,
                vault: deps.vault,
                wsHub: deps.wsHub,
                workspaceRoot,
                agenteId: agente.agente_id,
                canalId: `agente:${agente.agente_id}`,
                mcpGateway: deps.mcpGateway,
                catalogService: deps.catalogService,
                skillsManager: deps.skillsManager,
                whatsappManager: deps.whatsappManager,
                whatsappOrchestrator: deps.whatsappOrchestrator,
              });
            } else if (isRoutineToolName(call.name)) {
              toolOutput = await executeStudioRoutineTool(call.name, call.arguments, {
                agenteId: agente.agente_id,
                turnOrigin: "human",
                routineToolsDeps: deps.routineToolsDeps,
              });
            } else if (deps.mcpGateway && call.name.startsWith("mcp_")) {
              toolOutput = await deps.mcpGateway.callMcpTool(call.name, call.arguments, {
                agentId: agente.agente_id,
              });
            } else {
              toolFailed = true;
              toolOutput = { erro: `Ferramenta '${call.name}' indisponível no contexto atual.` };
            }
          } catch (toolErr) {
            toolFailed = true;
            const rawErrMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
            toolOutput = { erro: redactMcpSecrets(rawErrMsg, []) };
          }

          if (
            toolOutput &&
            typeof toolOutput === "object" &&
            (toolOutput as { action?: unknown }).action === "sign_in"
          ) {
            const notice = toolOutput as McpOAuthRequiredNotice;
            const safeReason = redactMcpSecrets(notice.motivo, []);
            deps.wsHub.broadcast("mcp.oauth_solicitado", {
              mcp_id: notice.mcpId,
              nome: notice.nome,
              app_slug: notice.appSlug ?? null,
              authorize_url: notice.authorizeUrl ?? null,
              canal_id: `agente:${agente.agente_id}`,
              agente_id: agente.agente_id,
              motivo: safeReason,
            });
            const promptPayload = {
              type: "mcp_oauth_prompt",
              mcpId: notice.mcpId,
              nome: notice.nome,
              appSlug: notice.appSlug ?? null,
              authorizeUrl: notice.authorizeUrl ?? null,
              motivo: safeReason,
            };
            steps.push({
              id: `step-${randomUUID().slice(0, 8)}`,
              ferramenta: "mcp_oauth_prompt",
              titulo: `Autenticação OAuth solicitada: ${notice.nome}`,
              detalhes: JSON.stringify(promptPayload),
              status: "erro",
              duracao_ms: Date.now() - stepStart,
            });
            anexosGerados.push({
              arquivo_id: `oauth-${notice.mcpId}`,
              nome: notice.nome,
              caminho_relativo: notice.mcpId,
              url: notice.authorizeUrl ?? "",
              mime_type: "application/vnd.criativo.mcp-oauth+json",
              tipo_uso: "mcp_oauth_prompt",
            });
          } else if (
            toolOutput &&
            typeof toolOutput === "object" &&
            (toolOutput as { type?: unknown }).type === "marketplace_app_suggestion" &&
            (toolOutput as { app?: { slug?: string; name?: string } | null }).app
          ) {
            const appInfo = (toolOutput as { app: { slug: string; name: string } }).app;
            steps.push({
              id: `step-${randomUUID().slice(0, 8)}`,
              ferramenta: "marketplace_app_suggestion",
              titulo: `App sugerido da Loja: ${appInfo.name}`,
              detalhes: JSON.stringify(toolOutput),
              status: "concluido",
              duracao_ms: Date.now() - stepStart,
            });
            anexosGerados.push({
              arquivo_id: `app-${appInfo.slug}`,
              nome: appInfo.name,
              caminho_relativo: appInfo.slug,
              url: `/loja/apps/${encodeURIComponent(appInfo.slug)}`,
              mime_type: "application/vnd.criativo.marketplace-app+json",
              tipo_uso: "marketplace_app_suggestion",
            });
          }

          const redactedOut = redactMcpPayload(toolOutput, []);
          const doneToolStep: PassoChat = {
            id: runningStep.id,
            ferramenta: call.name,
            titulo: toolFailed
              ? `Falha em ${call.name}`
              : `Ferramenta ${call.name} executada`,
            detalhes: JSON.stringify(redactedOut).slice(0, 800),
            status: toolFailed ? "erro" : "concluido",
            duracao_ms: Date.now() - stepStart,
          };
          steps.push(doneToolStep);
          onProgress?.({
            fase: "etapa",
            mensagem_status: doneToolStep.titulo,
            step: doneToolStep,
          });

          turnMessages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: JSON.stringify(redactedOut),
          });
        }

        if (iter === 5 && !finalReplyText) {
          const finalTurn = await client.executeTurn({
            model: agente.modelo_padrao,
            systemPrompt: systemPromptChat,
            messages: turnMessages,
          });
          totalInputTokens += finalTurn.usage?.inputTokens ?? 0;
          totalOutputTokens += finalTurn.usage?.outputTokens ?? 0;
          finalReplyText = finalTurn.text?.trim() ?? "";
        }
      }

      if (finalReplyText.length > 0) {
        const estIn = Math.max(50, Math.round((promptBase.length + userPrompt.length) / 4));
        const estOut = Math.max(20, Math.round(finalReplyText.length / 4));
        recordChatTurnUsage(deps.db, {
          agentId: agente.agente_id,
          sessionId,
          turnId,
          provider: providerName,
          model: agente.modelo_padrao,
          uncachedInput: totalInputTokens > 0 ? totalInputTokens : estIn,
          cachedInput: 0,
          output: totalOutputTokens > 0 ? totalOutputTokens : estOut,
        });

        steps.push({
          id: `step-${randomUUID().slice(0, 8)}`,
          ferramenta: `${providerName}:chat`,
          titulo: `Resposta gerada via ${agente.modelo_padrao}`,
          status: "concluido",
          duracao_ms: Date.now() - t0,
        });
        return { markdown: finalReplyText, steps, tarefaCriadaId, anexosGerados };
      }
    } catch (vaultErr) {
      lastExecutionError = vaultErr instanceof Error ? vaultErr.message : String(vaultErr);
      steps.push({
        id: `step-${randomUUID().slice(0, 8)}`,
        ferramenta: `${providerName}:erro`,
        titulo: `Falha API Key / Ollama: ${lastExecutionError.slice(0, 120)}`,
        status: "erro",
        duracao_ms: Date.now() - t0,
      });
    }
  }

  // 4. Execução real via Conta Google/Antigravity conectada no navegador (ACP aquecido / Code Assist)
  if (modelBelongsToAntigravity && hasAntigravityAccount) {
    hadConnectedRoute = true;
    const activeAgStepId = `step-${randomUUID().slice(0, 8)}`;
    onProgress?.({
      fase: "etapa",
      mensagem_status: `Executando ${agente.modelo_padrao} via Google Antigravity...`,
      step: {
        id: activeAgStepId,
        ferramenta: `antigravity:${agente.modelo_padrao}`,
        titulo: `Consultando ${agente.modelo_padrao} em tempo real...`,
        status: "executando",
      },
    });
    const t0 = Date.now();
    try {
      const historyMsgs = history.slice(-8).map((item) => ({
        role: (item.autor === "usuario" ? "user" : "assistant") as "user" | "assistant",
        text: item.conteudo_markdown,
      }));
      historyMsgs.push({
        role: "user",
        text:
          anexosGerados.length > 0
            ? `${userPrompt}\n\n[Uma imagem acabou de ser gerada e salva em: ${anexosGerados.map((a) => a.caminho_relativo).join(", ")}. Descreva o resultado e proponha legenda/próximos passos.]`
            : userPrompt,
      });

      const liveResult = await agService.executeCodeAssistGenerate({
        model: agente.modelo_padrao,
        systemPrompt: `${promptBase}\nResponda em pt-br de forma prática e especializada como ${agente.nome}. Use tabelas Markdown quando ajudar na organização. Nunca invente handles ou marcas reais: utilize apenas os informados pelo usuário.`,
        messages: historyMsgs,
        imagePaths: resolvedImageDiskPaths,
        agentId: agente.agente_id,
        preferredAccountId: typeof config.provider_account_id === "string" ? config.provider_account_id : null,
        onDelta: (delta) => {
          onProgress?.({
            fase: "chunk",
            mensagem_status: `Escrevendo resposta (${agente.modelo_padrao})...`,
            delta,
          });
        },
      });

      if (liveResult.text && liveResult.text.length > 0) {
        recordChatTurnUsage(deps.db, {
          agentId: agente.agente_id,
          sessionId,
          turnId,
          provider: "antigravity",
          model: liveResult.modelUsed,
          uncachedInput: liveResult.usage.uncachedInput,
          cachedInput: liveResult.usage.cachedInput,
          output: liveResult.usage.output,
        });

        steps.push({
          id: `step-${randomUUID().slice(0, 8)}`,
          ferramenta: `antigravity:${liveResult.modelUsed}`,
          titulo: `Executado via ${liveResult.modelUsed}${liveResult.accountEmail ? ` (${liveResult.accountEmail})` : ""} · ${liveResult.usage.uncachedInput + liveResult.usage.cachedInput + liveResult.usage.output} tokens`,
          status: "concluido",
          duracao_ms: Date.now() - t0,
        });
        return { markdown: liveResult.text, steps, tarefaCriadaId, anexosGerados };
      }
    } catch (liveErr) {
      lastExecutionError = liveErr instanceof Error ? liveErr.message : String(liveErr);
      steps.push({
        id: `step-${randomUUID().slice(0, 8)}`,
        ferramenta: "antigravity:erro",
        titulo: `Falha ao consultar conta Google conectada: ${lastExecutionError.slice(0, 120)}`,
        status: "erro",
        duracao_ms: Date.now() - t0,
      });
    }
  }

  if (metaValidationSummary) {
    const det = metaValidationSummary.detalhes;
    const metaReportMarkdown = [
      `### Diagnóstico Oficial da Integração Meta (Cofre AES-256-GCM + Graph API v21.0)`,
      "",
      `| Componente | Status | Detalhe |`,
      `|---|---|---|`,
      `| Token Meta no Cofre SQLite | ${det.tokenConfigurado ? "✅ Configurado" : "❌ Ausente"} | Criptografado localmente (nunca exposto) |`,
      `| Instagram Business Account ID | ${det.accountIdConfigurado ? "✅ Configurado" : "❌ Ausente"} | ID validado no Cofre |`,
      `| Meta Graph API v21.0 | ${det.graphApiOk ? `✅ HTTP ${det.httpStatus} OK` : `❌ Falha${det.httpStatus ? ` HTTP ${det.httpStatus}` : ""}`} | ${det.graphApiOk ? `Perfil @${det.username ?? "ativo"}` : det.erro ?? "Erro na consulta"} |`,
      "",
      `**Estágio atual:** ${metaValidationSummary.estagio} — ${metaValidationSummary.resumo}`,
    ].join("\n");
    return { markdown: metaReportMarkdown, steps, tarefaCriadaId, anexosGerados };
  }

  // 5. Resposta honesta: diferencia erro técnico em provedor conectado vs ausência real de conexão
  const statusLabel = hadConnectedRoute ? "Falha na chamada" : "Não conectado";
  const detailLine = hadConnectedRoute
    ? `Erro técnico ao executar **${agente.modelo_padrao}** (${providerName}): \`${lastExecutionError ?? "sem resposta do servidor"}\`. Tente novamente ou reautentique sua conta em **Conexões**.`
    : anexosGerados.length > 0
      ? `Arte gerada e salva em \`${anexosGerados[0].caminho_relativo}\`.`
      : `Nenhum provedor conectado para o modelo **${agente.modelo_padrao}** (\`${providerName}\`). Abra **Conexões** e clique para conectar via navegador (Google, Claude ou ChatGPT), utilize modelos gratuitos do **OpenCode** ou salve uma API Key.`;

  const structuredFallback = [
    `**${agente.nome}** recebeu sua solicitação para **${onboarding.marca_nome}** (\`${onboarding.perfil_handle}\`):`,
    "",
    `> ${userPrompt.slice(0, 200)}`,
    "",
    "| Etapa do Plano | Ação | Status |",
    "|---|---|---|",
    `| 1. Diagnóstico | Contexto de \`${skillSlug}\` (${agente.modelo_padrao}) | Pronto |`,
    `| 2. Execução IA | ${anexosGerados.length > 0 ? `Arte gerada em \`${anexosGerados[0].caminho_relativo}\`` : hadConnectedRoute ? `Falha técnica: ${(lastExecutionError ?? "erro").slice(0, 70)}` : "Aguardando conta conectada ou API Key"} | ${anexosGerados.length > 0 ? "Concluído" : statusLabel} |`,
    `| 3. Segurança Meta | Aprovação humana obrigatória antes da publicação | Ativo |`,
    "",
    detailLine,
  ].join("\n");

  return { markdown: structuredFallback, steps, tarefaCriadaId, anexosGerados };
}

export async function tryHandleStudioRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  url: URL,
  deps: StudioRoutesDeps
): Promise<boolean> {
  if (await tryHandleWhatsAppMcpStoreRoute(req, res, path, method, url, deps)) {
    return true;
  }

  const { db, sendJson, readJsonBody, providerConnection, wsHub } = deps;
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();

  // 1. Onboarding
  if (method === "GET" && path === "/api/onboarding") {
    sendJson(res, 200, { onboarding: providerConnection.getOnboardingState() });
    return true;
  }

  if (method === "PUT" && path === "/api/onboarding") {
    const body = await readJsonBody(req);
    const updated = providerConnection.updateOnboardingState(body as Partial<OnboardingEstado>);
    sendJson(res, 200, { onboarding: updated });
    return true;
  }

  // 2. Provedores, CLIs & Uso
  if (method === "GET" && path === "/api/provedores/status") {
    const force = url.searchParams.get("refresh") === "1";
    const provedores = await providerConnection.getProvidersStatus(force);
    sendJson(res, 200, { provedores });
    return true;
  }

  if (method === "POST" && path === "/api/provedores/conectar") {
    const body = await readJsonBody(req);
    if (typeof body.provedor !== "string") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'provedor'." });
      return true;
    }
    const status = await providerConnection.connectProvider(body.provedor as ProviderName, {
      apiKey: typeof body.api_key === "string" ? body.api_key : undefined,
      modo:
        typeof body.modo === "string"
          ? (body.modo as "cli" | "api_key" | "local" | "assinatura")
          : undefined,
    });
    wsHub.broadcast("provider:updated", {
      provedor: status.provedor,
      conectado: status.conectado,
      modo: status.modo_conexao,
    });
    sendJson(res, 200, { provedor: status });
    return true;
  }

  if (method === "POST" && path === "/api/provedores/desconectar") {
    const body = await readJsonBody(req);
    if (typeof body.provedor !== "string") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'provedor'." });
      return true;
    }
    const status = await providerConnection.disconnectProvider(body.provedor as ProviderName);
    wsHub.broadcast("provider:updated", {
      provedor: status.provedor,
      conectado: status.conectado,
      modo: status.modo_conexao,
    });
    sendJson(res, 200, { provedor: status });
    return true;
  }

  if (method === "GET" && path === "/api/provedores/uso") {
    const refresh = url.searchParams.get("refresh") === "1";
    const uso = await providerConnection.getUsageSnapshot(refresh);
    sendJson(res, 200, { uso });
    return true;
  }

  if (method === "GET" && path === "/api/uso/analytics") {
    if (url.searchParams.get("importOpenBot") === "1" || process.env.CRIATIVO_IMPORT_OPENBOT_DB === "1") {
      importOpenBotTelemetryIfAvailable(db);
    }
    const dias = Number(url.searchParams.get("dias") ?? "30");
    const agenteId = url.searchParams.get("agente_id");
    const relatorio = computeHostAnalytics(db, {
      dias: Number.isFinite(dias) ? dias : 30,
      agenteId: agenteId || null,
    });
    sendJson(res, 200, { analytics: relatorio });
    return true;
  }

  if (method === "GET" && path === "/api/habilidades") {
    sendJson(res, 200, { habilidades: listInstalledSkills(db, undefined, workspaceRoot) });
    return true;
  }

  const skillDetailMatch = path.match(/^\/api\/habilidades\/([^/]+)$/);
  if (method === "GET" && skillDetailMatch) {
    const slug = decodeURIComponent(skillDetailMatch[1]);
    const loaded = loadSkillPromptBySlug(slug, undefined, workspaceRoot);
    if (!loaded) {
      sendJson(res, 404, { erro: `Habilidade '${slug}' não encontrada.` });
      return true;
    }
    sendJson(res, 200, { slug, caminho: loaded.path, conteudo: loaded.body });
    return true;
  }

  // Marca & Onboarding Estratégico (6 Marcos)
  if (method === "GET" && path === "/api/marca/identidade") {
    sendJson(res, 200, { identidade: getBrandIdentity(providerConnection) });
    return true;
  }

  if (method === "PUT" && path === "/api/marca/identidade") {
    const body = await readJsonBody(req);
    const updated = await saveBrandIdentity(providerConnection, workspaceRoot, body);
    sendJson(res, 200, { identidade: updated, onboarding: providerConnection.getOnboardingState() });
    return true;
  }

  // Upgrades Modulares (Bônus & Vídeo em Etapas)
  if (method === "GET" && path === "/api/upgrades") {
    sendJson(res, 200, { upgrades: listUpgradePackages(db, workspaceRoot) });
    return true;
  }

  if (method === "POST" && path === "/api/upgrades/instalar") {
    const body = await readJsonBody(req);
    if (body.pacote !== "bonus" && body.pacote !== "video") {
      sendJson(res, 400, { erro: "Campo obrigatório: 'pacote' ('bonus' ou 'video')." });
      return true;
    }
    const upgrades = activateUpgradePackage(db, workspaceRoot, body.pacote);
    wsHub.broadcast("provider:updated", {
      provedor: "gemini",
      conectado: true,
      modo: "assinatura",
    });
    sendJson(res, 200, { ok: true, upgrades });
    return true;
  }

  if (method === "GET" && path === "/api/conectores") {
    if (!deps.vault) {
      sendJson(res, 200, { conectores: [] });
      return true;
    }
    sendJson(res, 200, { conectores: buildConnectorsList(db, deps.vault) });
    return true;
  }

  const conectorActionMatch = path.match(/^\/api\/conectores\/([^/]+)\/(configurar|testar)$/);
  if (method === "POST" && conectorActionMatch) {
    const conectorId = decodeURIComponent(conectorActionMatch[1]);
    const acao = conectorActionMatch[2];
    const body = await readJsonBody(req);

    if (acao === "configurar") {
      if (typeof body.agente_orquestrador_id === "string") {
        const curCfg = providerConnection.getStudioConfig<Record<string, string>>("conectores_orquestradores", {});
        curCfg[conectorId] = body.agente_orquestrador_id;
        providerConnection.setStudioConfig("conectores_orquestradores", curCfg);
      }
      if (deps.vault && body.segredos && typeof body.segredos === "object") {
        for (const [k, v] of Object.entries(body.segredos as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim().length > 0) {
            const val = v.trim();
            deps.vault.setSecret(k, val);
            // Sincroniza aliases Meta para compatibilidade entre UI, Chat e CLI
            if (k === "instagram_access_token") deps.vault.setSecret("META_ACCESS_TOKEN", val);
            if (k === "META_ACCESS_TOKEN") deps.vault.setSecret("instagram_access_token", val);
            if (k === "instagram_business_account_id") deps.vault.setSecret("META_IG_USER_ID", val);
            if (k === "META_IG_USER_ID") deps.vault.setSecret("instagram_business_account_id", val);
          }
        }
      }
      if (conectorId === "mcp" && typeof body.nome === "string" && typeof body.comando === "string") {
        const mcpId = `mcp-${randomUUID().slice(0, 8)}`;
        db.connection
          .prepare(
            `INSERT INTO projecao_mcp_servidores (mcp_id, nome, comando, args_json, env_json, ativo, atualizado_em)
             VALUES (?, ?, ?, ?, ?, 1, ?);`
          )
          .run(
            mcpId,
            body.nome.trim(),
            body.comando.trim(),
            JSON.stringify(Array.isArray(body.args) ? body.args : []),
            JSON.stringify(body.env && typeof body.env === "object" ? body.env : {}),
            new Date().toISOString()
          );
      }
      const lista = deps.vault ? buildConnectorsList(db, deps.vault) : [];
      sendJson(res, 200, { ok: true, conectores: lista });
      return true;
    }

    // acao === "testar"
    if (conectorId === "instagram" && deps.vault) {
      const report = await validateMetaIntegration(deps.vault);
      if (!report.detalhes.tokenConfigurado || !report.detalhes.accountIdConfigurado) {
        sendJson(res, 400, { ok: false, mensagem: "Preencha Access Token e Business Account ID antes de testar." });
        return true;
      }
      sendJson(res, 200, {
        ok: report.ok,
        mensagem: report.ok
          ? `Conectado a @${report.detalhes.username ?? "conta_business"}`
          : report.resumo,
        detalhes: report.detalhes,
      });
      return true;
    }

    if (conectorId === "telegram" && deps.vault) {
      const botToken = deps.vault.getSecret("telegram_bot_token");
      if (!botToken) {
        sendJson(res, 400, { ok: false, mensagem: "Salve o Telegram Bot Token antes de testar." });
        return true;
      }
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const tgJson = (await tgRes.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
        sendJson(res, 200, {
          ok: Boolean(tgJson.ok),
          mensagem: tgJson.ok ? `Bot @${tgJson.result?.username ?? "ativo"} respondendo` : tgJson.description ?? "Token rejeitado",
        });
        return true;
      } catch (err) {
        sendJson(res, 200, { ok: false, mensagem: err instanceof Error ? err.message : "Falha na API Telegram" });
        return true;
      }
    }

    sendJson(res, 200, { ok: true, mensagem: "Configuração validada localmente." });
    return true;
  }

  const browserSignInMatch = path.match(/^\/api\/provedores\/(gemini|claude|openai)\/conectar-navegador$/);
  if (method === "POST" && browserSignInMatch) {
    const provId = browserSignInMatch[1] as "gemini" | "claude" | "openai";
    const body = await readJsonBody(req);
    try {
      const result = await providerConnection.connectProviderViaBrowser(
        provId,
        typeof body.label === "string" ? body.label : undefined,
        (url) => {
          wsHub.broadcast("provider:auth_url", {
            provedor: provId,
            url,
          });
        }
      );
      const uso = await providerConnection.getUsageSnapshot(true);
      wsHub.broadcast("provider:updated", {
        provedor: provId,
        conectado: true,
        modo: "assinatura",
      });
      sendJson(res, 200, { ok: true, conta: result.conta, provedores: result.provedores, uso });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Falha ao concluir autenticação no navegador.";
      const isCanceled = /cancelad[oa] pelo usuário/i.test(msg);
      sendJson(res, isCanceled ? 200 : 400, {
        ok: false,
        canceled: isCanceled,
        erro: msg,
      });
    }
    return true;
  }

  const cancelSignInMatch = path.match(/^\/api\/provedores\/(gemini|claude|openai)\/cancelar-login$/);
  if (method === "POST" && cancelSignInMatch) {
    const provId = cancelSignInMatch[1] as "gemini" | "claude" | "openai";
    const canceled = providerConnection.cancelBrowserSignIn(provId);
    sendJson(res, 200, { ok: true, canceled });
    return true;
  }

  const visibilityMatch = path.match(
    /^\/api\/provedores\/(gemini|claude|openai|opencode|grok|ollama)\/modelos-visibilidade$/
  );
  if (method === "POST" && visibilityMatch) {
    const provId = visibilityMatch[1] as "gemini" | "claude" | "openai" | "opencode" | "grok" | "ollama";
    const body = await readJsonBody(req);
    const ocultos = Array.isArray(body.ocultos)
      ? body.ocultos.filter((item): item is string => typeof item === "string")
      : [];
    const provedores = await providerConnection.setHiddenModels(provId, ocultos);
    const updated = provedores.find((p) => p.provedor === provId);
    wsHub.broadcast("provider:updated", {
      provedor: provId,
      conectado: updated?.conectado ?? false,
      modo: updated?.modo_conexao ?? "nenhum",
    });
    sendJson(res, 200, { ok: true, provedores });
    return true;
  }

  const poolMatch = path.match(/^\/api\/provedores\/([^/]+)\/pool$/);
  if (method === "POST" && poolMatch) {
    const provId = decodeURIComponent(poolMatch[1]);
    const body = await readJsonBody(req);
    const patch = {
      habilitado: typeof body.habilitado === "boolean" ? body.habilitado : undefined,
      contas_excluidas: Array.isArray(body.contas_excluidas) ? (body.contas_excluidas as string[]) : undefined,
      conta_em_uso: typeof body.conta_em_uso === "string" || body.conta_em_uso === null ? body.conta_em_uso : undefined,
    };
    if (provId === "claude" || provId === "openai") {
      providerConnection.getCliOAuthService().setPoolSettings(provId, patch);
    } else {
      providerConnection.getAntigravityService().setPoolSettings(patch);
    }
    const provedores = await providerConnection.getProvidersStatus(true);
    sendJson(res, 200, { ok: true, provedores });
    return true;
  }

  const accountsAddMatch = path.match(/^\/api\/provedores\/([^/]+)\/contas$/);
  if (method === "POST" && accountsAddMatch) {
    const body = await readJsonBody(req);
    if (typeof body.email !== "string" || typeof body.access_token !== "string") {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'email' e 'access_token'." });
      return true;
    }
    const conta = providerConnection.getAntigravityService().addManualTokenAccount({
      email: body.email,
      label: typeof body.label === "string" ? body.label : undefined,
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    });
    const provedores = await providerConnection.getProvidersStatus(true);
    sendJson(res, 201, { conta, provedores });
    return true;
  }

  const accountDelMatch = path.match(/^\/api\/provedores\/([^/]+)\/contas\/([^/]+)$/);
  if (method === "DELETE" && accountDelMatch) {
    const provId = decodeURIComponent(accountDelMatch[1]);
    const contaId = decodeURIComponent(accountDelMatch[2]);
    const removed =
      provId === "claude" || provId === "openai"
        ? providerConnection.getCliOAuthService().removeAccount(provId, contaId)
        : providerConnection.getAntigravityService().removeAccount(contaId);
    const provedores = await providerConnection.getProvidersStatus(true);
    const uso = await providerConnection.getUsageSnapshot(true);
    sendJson(res, removed ? 200 : 404, { ok: removed, provedores, uso });
    return true;
  }

  // 3. Agentes enriquecidos + criação de customizado + edição completa
  if (method === "GET" && path === "/api/agentes") {
    const apenasDesbloqueados = url.searchParams.get("apenas_desbloqueados") === "1";
    const rows = db.connection
      .prepare(`SELECT * FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
      .all() as Array<Parameters<typeof enrichAgentRow>[1]>;
    const enriched = rows.map((row) => enrichAgentRow(db, row, workspaceRoot));
    const filtered = apenasDesbloqueados
      ? enriched.filter((a) => a.config.upgrade_desbloqueado !== false)
      : enriched;
    sendJson(res, 200, { agentes: filtered });
    return true;
  }

  if (method === "POST" && path === "/api/agentes") {
    const body = await readJsonBody(req);
    if (typeof body.nome !== "string" || body.nome.trim().length === 0) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'nome'." });
      return true;
    }
    const nome = body.nome.trim();
    const slugBase = nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const agenteId = `custom_${slugBase || "agente"}_${randomUUID().slice(0, 4)}`;
    const maxOrderRow = db.connection
      .prepare(`SELECT COALESCE(MAX(ordem_exibicao), 15) as max_ordem FROM projecao_agentes;`)
      .get() as { max_ordem: number };
    const agora = new Date().toISOString();

    const config = {
      frente: "custom",
      pasta: typeof body.pasta === "string" ? body.pasta : "Agentes Customizados",
      skill_slug: "custom-agent",
      avatar_shape: typeof body.avatar_shape === "string" ? body.avatar_shape : "rounded_square",
      avatar_color: typeof body.avatar_color === "string" ? body.avatar_color : "#38bdf8",
      effort: typeof body.effort === "string" ? body.effort : "alto",
      prompt_base:
        typeof body.prompt_base === "string" && body.prompt_base.trim().length > 0
          ? body.prompt_base.trim()
          : `Você é ${nome}, agente customizado do Criativo AI Studio para [NOME_DA_MARCA].`,
      customizado: true,
    };

    const papel =
      typeof body.papel === "string" && body.papel.trim().length > 0
        ? body.papel.trim()
        : config.prompt_base.slice(0, 120);
    const modeloPadrao =
      typeof body.modelo_padrao === "string" && body.modelo_padrao.trim().length > 0
        ? body.modelo_padrao.trim()
        : "gemini-2.5-flash";

    db.connection
      .prepare(
        `INSERT INTO projecao_agentes (
          agente_id, nome, papel, modelo_padrao, status,
          skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em
        ) VALUES (?, ?, ?, ?, 'ocioso', '[]', NULL, ?, ?, ?);`
      )
      .run(
        agenteId,
        nome,
        papel,
        modeloPadrao,
        Number(maxOrderRow.max_ordem) + 1,
        JSON.stringify(config),
        agora
      );

    // Mensagem inicial de apresentação na conversa
    db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em)
         VALUES (?, ?, ?, 'agente', ?, ?, '[]', '[]', NULL, 0, ?);`
      )
      .run(
        `msg-${randomUUID()}`,
        `agente:${agenteId}`,
        agenteId,
        nome,
        `Olá! Sou **${nome}**. ${config.prompt_base}\n\nEnvie sua instrução abaixo ou anexe imagens no botão **+**.`,
        agora
      );

    const createdRow = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1];

    sendJson(res, 201, { agente: enrichAgentRow(db, createdRow) });
    return true;
  }

  const agentUpdateMatch = path.match(/^\/api\/agentes\/([^/]+)$/);
  if (method === "PUT" && agentUpdateMatch) {
    const agenteId = decodeURIComponent(agentUpdateMatch[1]);
    const body = await readJsonBody(req);
    const existing = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1] | undefined;

    if (!existing) {
      sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
      return true;
    }

    const currentConfig = safeJsonParse<Record<string, unknown>>(existing.config_json, {});
    const incomingConfig =
      body.config && typeof body.config === "object"
        ? (body.config as Record<string, unknown>)
        : {};
    const nextConfig = {
      ...currentConfig,
      ...incomingConfig,
      ...(typeof body.effort === "string" ? { effort: body.effort } : {}),
      ...(typeof body.avatar_shape === "string" ? { avatar_shape: body.avatar_shape } : {}),
      ...(typeof body.avatar_color === "string" ? { avatar_color: body.avatar_color } : {}),
      ...(typeof body.prompt_base === "string" ? { prompt_base: body.prompt_base } : {}),
    };

    const nextModel =
      typeof body.modelo_padrao === "string" ? body.modelo_padrao : existing.modelo_padrao;
    const nextNome = typeof body.nome === "string" ? body.nome : existing.nome;
    const nextPapel = typeof body.papel === "string" ? body.papel : existing.papel;

    db.connection
      .prepare(
        `UPDATE projecao_agentes SET nome = ?, papel = ?, modelo_padrao = ?, config_json = ?, atualizado_em = ? WHERE agente_id = ?;`
      )
      .run(
        nextNome,
        nextPapel,
        nextModel,
        JSON.stringify(nextConfig),
        new Date().toISOString(),
        agenteId
      );

    const updated = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1];

    sendJson(res, 200, { agente: enrichAgentRow(db, updated, workspaceRoot) });
    return true;
  }

  const agentRestoreMatch = path.match(/^\/api\/agentes\/([^/]+)\/restaurar$/);
  if (method === "POST" && agentRestoreMatch) {
    const agenteId = decodeURIComponent(agentRestoreMatch[1]);
    const def = ROSTER_15_AGENTES.find((a) => a.agente_id === agenteId);
    if (!def) {
      sendJson(res, 404, { erro: `Agente padrão '${agenteId}' não encontrado.` });
      return true;
    }
    const restoredConfig = {
      frente: def.frente,
      pacote: def.pacote,
      pasta: def.pasta,
      skill_slug: def.skill_slug,
      avatar_shape: def.avatar_shape,
      avatar_color: def.avatar_color,
      effort: def.effort,
      ferramentas: def.ferramentas,
      prompt_base: def.prompt_base,
      customizado: false,
    };
    db.connection
      .prepare(
        `UPDATE projecao_agentes SET nome = ?, papel = ?, modelo_padrao = ?, config_json = ?, atualizado_em = ? WHERE agente_id = ?;`
      )
      .run(
        def.nome,
        def.papel,
        def.modelo_padrao,
        JSON.stringify(restoredConfig),
        new Date().toISOString(),
        agenteId
      );
    const updated = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof enrichAgentRow>[1];
    sendJson(res, 200, { agente: enrichAgentRow(db, updated, workspaceRoot) });
    return true;
  }

  // Memórias do agente
  const agentMemoriesMatch = path.match(/^\/api\/agentes\/([^/]+)\/memorias$/);
  if (agentMemoriesMatch && (method === "GET" || method === "POST")) {
    const agenteId = decodeURIComponent(agentMemoriesMatch[1]);
    if (method === "GET") {
      const memorias = db.connection
        .prepare(
          `SELECT * FROM projecao_agente_memorias WHERE agente_id = ? ORDER BY criado_em DESC LIMIT 40;`
        )
        .all(agenteId);
      sendJson(res, 200, { memorias });
      return true;
    }

    const body = await readJsonBody(req);
    if (typeof body.texto !== "string" || body.texto.trim().length === 0) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'texto'." });
      return true;
    }
    const memId = `mem-${randomUUID()}`;
    const agora = new Date().toISOString();
    db.connection
      .prepare(
        `INSERT INTO projecao_agente_memorias (memoria_id, agente_id, texto, origem, criado_em)
         VALUES (?, ?, ?, 'manual', ?);`
      )
      .run(memId, agenteId, body.texto.trim(), agora);
    sendJson(res, 201, { memoria_id: memId, texto: body.texto.trim(), criado_em: agora });
    return true;
  }

  // Mensagens do Agente (GET / POST / lidas)
  const agentReadMatch = path.match(/^\/api\/agentes\/([^/]+)\/mensagens\/lidas$/);
  if (method === "POST" && agentReadMatch) {
    const agenteId = decodeURIComponent(agentReadMatch[1]);
    db.connection
      .prepare(`UPDATE projecao_conversas_chat SET lida = 1 WHERE canal_id = ?;`)
      .run(`agente:${agenteId}`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const agentRoutineMsgMatch = path.match(/^\/api\/agentes\/([^/]+)\/rotinas\/([^/]+)\/mensagens$/);
  if (agentRoutineMsgMatch && method === "GET") {
    const rotinaId = decodeURIComponent(agentRoutineMsgMatch[2]);
    const canalId = `rotina:${rotinaId}`;
    const rows = db.connection
      .prepare(
        `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC LIMIT 120;`
      )
      .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
    sendJson(res, 200, { mensagens: rows.map(mapChatRow) });
    return true;
  }

  const agentMsgMatch = path.match(/^\/api\/agentes\/([^/]+)\/mensagens$/);
  if (agentMsgMatch && (method === "GET" || method === "POST")) {
    const agenteId = decodeURIComponent(agentMsgMatch[1]);
    const canalIdQuery = url.searchParams.get("canal_id");
    const canalId =
      method === "GET" && canalIdQuery && canalIdQuery.startsWith("rotina:")
        ? canalIdQuery
        : `agente:${agenteId}`;

    if (method === "GET") {
      const rows = db.connection
        .prepare(
          `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC LIMIT 120;`
        )
        .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
      sendJson(res, 200, { mensagens: rows.map(mapChatRow) });
      return true;
    }

    const agente = db.connection
      .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
      .get(agenteId) as Parameters<typeof generateAgentChatReply>[1] | undefined;

    if (!agente) {
      sendJson(res, 404, { erro: `Agente '${agenteId}' não encontrado.` });
      return true;
    }

    const body = await readJsonBody(req);
    const conteudo = typeof body.conteudo === "string" ? body.conteudo.trim() : "";
    const anexos = Array.isArray(body.anexos) ? (body.anexos as AnexoChat[]) : [];
    if (!conteudo && anexos.length === 0) {
      sendJson(res, 400, { erro: "Envie 'conteudo' ou ao menos um anexo." });
      return true;
    }

    const userMsg: MensagemChat = {
      mensagem_id: `msg-${randomUUID()}`,
      canal_id: canalId,
      agente_id: agenteId,
      autor: "usuario",
      autor_nome: "Você",
      conteudo_markdown: conteudo || "Referências enviadas para produção.",
      anexos,
      steps: [],
      tarefa_id: null,
      lida: true,
      criado_em: new Date().toISOString(),
    };

    const insertMsgStmt = db.connection.prepare(
      `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
    );

    insertMsgStmt.run(
      userMsg.mensagem_id,
      userMsg.canal_id,
      userMsg.agente_id,
      userMsg.autor,
      userMsg.autor_nome ?? "Você",
      userMsg.conteudo_markdown,
      JSON.stringify(userMsg.anexos),
      "[]",
      null,
      1,
      userMsg.criado_em
    );

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: agenteId,
      mensagem: userMsg,
    });

    const historyRows = db.connection
      .prepare(
        `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC LIMIT 20;`
      )
      .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
    const history = historyRows.map(mapChatRow);
    const liveTurnId = `turn-${randomUUID().slice(0, 8)}`;

    const reply = await generateAgentChatReply(
      deps,
      agente,
      userMsg.conteudo_markdown,
      anexos,
      history,
      (prog) => {
        wsHub.broadcast("chat:progress", {
          canal_id: canalId,
          agente_id: agenteId,
          turno_id: liveTurnId,
          ...prog,
        });
      }
    );

    wsHub.broadcast("chat:progress", {
      canal_id: canalId,
      agente_id: agenteId,
      turno_id: liveTurnId,
      fase: "concluido",
    });

    const agentMsg: MensagemChat = {
      mensagem_id: `msg-${randomUUID()}`,
      canal_id: canalId,
      agente_id: agenteId,
      autor: "agente",
      autor_nome: agente.nome,
      conteudo_markdown: reply.markdown,
      anexos: reply.anexosGerados,
      steps: reply.steps,
      tarefa_id: reply.tarefaCriadaId,
      lida: true,
      criado_em: new Date(Date.now() + 2).toISOString(),
    };

    insertMsgStmt.run(
      agentMsg.mensagem_id,
      agentMsg.canal_id,
      agentMsg.agente_id,
      agentMsg.autor,
      agentMsg.autor_nome ?? agente.nome,
      agentMsg.conteudo_markdown,
      JSON.stringify(agentMsg.anexos),
      JSON.stringify(agentMsg.steps),
      agentMsg.tarefa_id ?? null,
      1,
      agentMsg.criado_em
    );

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: agenteId,
      mensagem: agentMsg,
    });

    // Handoff 1:1 somente quando não for saudação/dúvida:
    // - do usuário: aceita @agente_id ou [HANDOFF:agente_id]
    // - da resposta do agente: exige [HANDOFF:agente_id] explícito (nunca @mencao em explicação)
    const isSimpleGreeting = isGreetingOrCapabilityQuestion(userMsg.conteudo_markdown);
    const handoffTargets = isSimpleGreeting
      ? []
      : Array.from(
          new Set([
            ...extractMentionedAgentIds(userMsg.conteudo_markdown, agenteId),
            ...extractExplicitAgentHandoffTags(agentMsg.conteudo_markdown, agenteId),
          ])
        ).slice(0, 2);
    const mensagensHandoff: MensagemChat[] = [];

    if (handoffTargets.length > 0) {
      const handoffBus = new HandoffBus(db, deps.queue);
      let chainHistory = [...history, agentMsg];
      for (let hIdx = 0; hIdx < handoffTargets.length; hIdx += 1) {
        const targetId = handoffTargets[hIdx];
        const targetAg = db.connection
          .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
          .get(targetId) as Parameters<typeof generateAgentChatReply>[1] | undefined;
        if (!targetAg) continue;

        handoffBus.dispatchHandoff({
          tarefa_id: agentMsg.tarefa_id ?? null,
          de_agente_id: agenteId,
          para_agente_id: targetId,
          instrucao: `Handoff de ${agente.nome}: ${userMsg.conteudo_markdown}`,
          artefatos: agentMsg.anexos.map((a) => a.caminho_relativo),
          enfileirarNovaTarefa: false,
        });

        const hReply = await generateAgentChatReply(
          deps,
          targetAg,
          `[Handoff recebido de ${agente.nome} (@${agenteId})]\nSolicitação original: ${userMsg.conteudo_markdown}\nEntrega do colega anterior:\n${agentMsg.conteudo_markdown}`,
          anexos,
          chainHistory,
          (prog) => {
            wsHub.broadcast("chat:progress", {
              canal_id: canalId,
              agente_id: targetId,
              turno_id: `${liveTurnId}-h${hIdx}`,
              ...prog,
            });
          },
          {
            isHandoff: true,
            originalUserPrompt: userMsg.conteudo_markdown,
          }
        );

        const hMsg: MensagemChat = {
          mensagem_id: `msg-${randomUUID()}`,
          canal_id: canalId,
          agente_id: targetId,
          autor: "agente",
          autor_nome: targetAg.nome,
          conteudo_markdown: hReply.markdown,
          anexos: hReply.anexosGerados,
          steps: [
            {
              id: `step-${randomUUID().slice(0, 8)}`,
              ferramenta: "handoff_agente",
              titulo: `Recebeu o bastão de ${agente.nome}`,
              status: "concluido",
              duracao_ms: 20,
            },
            ...hReply.steps,
          ],
          tarefa_id: hReply.tarefaCriadaId,
          lida: true,
          criado_em: new Date(Date.now() + 10 + hIdx * 10).toISOString(),
        };

        insertMsgStmt.run(
          hMsg.mensagem_id,
          canalId,
          targetId,
          "agente",
          targetAg.nome,
          hMsg.conteudo_markdown,
          JSON.stringify(hMsg.anexos),
          JSON.stringify(hMsg.steps),
          hMsg.tarefa_id ?? null,
          1,
          hMsg.criado_em
        );
        wsHub.broadcast("chat:message", {
          canal_id: canalId,
          agente_id: targetId,
          mensagem: hMsg,
        });
        mensagensHandoff.push(hMsg);
        chainHistory = [...chainHistory, hMsg];
      }
    }

    sendJson(res, 201, {
      mensagem_usuario: userMsg,
      mensagem_agente: agentMsg,
      mensagens_handoff: mensagensHandoff,
    });
    return true;
  }

  // 4. Canais em Equipe
  if (method === "GET" && path === "/api/canais") {
    const rows = db.connection
      .prepare(`SELECT * FROM projecao_grupos_equipe ORDER BY atualizado_em DESC;`)
      .all() as Array<{
      canal_id: string;
      nome: string;
      descricao: string | null;
      pasta: string;
      membros_agentes_json: string;
      criado_em: string;
      atualizado_em: string;
    }>;

    const canais: CanalEquipe[] = rows.map((row) => {
      const unreadRow = db.connection
        .prepare(
          `SELECT COUNT(*) as total FROM projecao_conversas_chat WHERE canal_id = ? AND lida = 0;`
        )
        .get(row.canal_id) as { total: number };
      const lastRow = db.connection
        .prepare(
          `SELECT conteudo_markdown FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em DESC LIMIT 1;`
        )
        .get(row.canal_id) as { conteudo_markdown: string } | undefined;

      return {
        canal_id: row.canal_id,
        nome: row.nome,
        descricao: row.descricao ?? "",
        pasta: row.pasta,
        membros_agentes: safeJsonParse<string[]>(row.membros_agentes_json, []),
        nao_lidas: Number(unreadRow?.total ?? 0),
        ultima_mensagem: lastRow ? lastRow.conteudo_markdown.slice(0, 90) : row.descricao,
        criado_em: row.criado_em,
        atualizado_em: row.atualizado_em,
      };
    });

    sendJson(res, 200, { canais });
    return true;
  }

  if (method === "POST" && path === "/api/canais") {
    const body = await readJsonBody(req);
    if (typeof body.nome !== "string" || body.nome.trim().length === 0) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'nome'." });
      return true;
    }
    const rawName = body.nome.trim();
    const formattedName = rawName.startsWith("#") ? rawName : `#${rawName}`;
    const membros = Array.isArray(body.membros_agentes)
      ? body.membros_agentes.filter((m): m is string => typeof m === "string")
      : ["estrategista", "copywriter", "designer_carrossel"];

    const canalId = `canal-${randomUUID().slice(0, 8)}`;
    const agora = new Date().toISOString();

    db.connection
      .prepare(
        `INSERT INTO projecao_grupos_equipe (canal_id, nome, descricao, pasta, membros_agentes_json, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        canalId,
        formattedName,
        typeof body.descricao === "string" ? body.descricao : "Canal colaborativo de agentes",
        typeof body.pasta === "string" ? body.pasta : "Canais em Equipe",
        JSON.stringify(membros),
        agora,
        agora
      );

    sendJson(res, 201, {
      canal: {
        canal_id: canalId,
        nome: formattedName,
        descricao: typeof body.descricao === "string" ? body.descricao : "Canal colaborativo de agentes",
        pasta: typeof body.pasta === "string" ? body.pasta : "Canais em Equipe",
        membros_agentes: membros,
        nao_lidas: 0,
        ultima_mensagem: null,
        criado_em: agora,
        atualizado_em: agora,
      },
    });
    return true;
  }

  const canalMsgMatch = path.match(/^\/api\/canais\/([^/]+)\/mensagens$/);
  if (canalMsgMatch && (method === "GET" || method === "POST")) {
    const canalId = decodeURIComponent(canalMsgMatch[1]);
    if (method === "GET") {
      const rows = db.connection
        .prepare(
          `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? ORDER BY criado_em ASC LIMIT 150;`
        )
        .all(canalId) as Array<Parameters<typeof mapChatRow>[0]>;
      sendJson(res, 200, { mensagens: rows.map(mapChatRow) });
      return true;
    }

    const canal = db.connection
      .prepare(`SELECT * FROM projecao_grupos_equipe WHERE canal_id = ?;`)
      .get(canalId) as { canal_id: string; nome: string; membros_agentes_json: string } | undefined;
    if (!canal) {
      sendJson(res, 404, { erro: `Canal '${canalId}' não encontrado.` });
      return true;
    }

    const body = await readJsonBody(req);
    const conteudo = typeof body.conteudo === "string" ? body.conteudo.trim() : "";
    const anexos = Array.isArray(body.anexos) ? (body.anexos as AnexoChat[]) : [];
    if (!conteudo && anexos.length === 0) {
      sendJson(res, 400, { erro: "Envie 'conteudo' para o canal." });
      return true;
    }

    const userMsg: MensagemChat = {
      mensagem_id: `msg-${randomUUID()}`,
      canal_id: canalId,
      agente_id: null,
      autor: "usuario",
      autor_nome: "Você",
      conteudo_markdown: conteudo,
      anexos,
      steps: [],
      tarefa_id: null,
      lida: true,
      criado_em: new Date().toISOString(),
    };

    const insertStmt = db.connection.prepare(
      `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
    );

    insertStmt.run(
      userMsg.mensagem_id,
      userMsg.canal_id,
      null,
      "usuario",
      "Você",
      userMsg.conteudo_markdown,
      JSON.stringify(anexos),
      "[]",
      null,
      1,
      userMsg.criado_em
    );

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: null,
      mensagem: userMsg,
    });

    const membrosConfig = safeJsonParse<string[]>(canal.membros_agentes_json, ["estrategista"]);
    const mencionados = extractMentionedAgentIds(userMsg.conteudo_markdown);
    const membrosAtivos =
      mencionados.length > 0
        ? Array.from(new Set([...mencionados, ...membrosConfig.filter((m) => mencionados.includes(m))]))
        : membrosConfig.slice(0, 4);

    // Carrega histórico recente real do canal em ordem cronológica
    const prevRowsDesc = db.connection
      .prepare(
        `SELECT * FROM projecao_conversas_chat WHERE canal_id = ? AND mensagem_id != ? ORDER BY criado_em DESC LIMIT 16;`
      )
      .all(canalId, userMsg.mensagem_id) as Array<Parameters<typeof mapChatRow>[0]>;
    const runningHistory: MensagemChat[] = [
      ...prevRowsDesc.reverse().map(mapChatRow),
      userMsg,
    ];

    const respostas: MensagemChat[] = [];
    const liveTurnId = `turn-${randomUUID().slice(0, 8)}`;
    const handoffBus = new HandoffBus(db, deps.queue);

    for (let idx = 0; idx < membrosAtivos.length; idx += 1) {
      const mId = membrosAtivos[idx];
      const ag = db.connection
        .prepare(`SELECT * FROM projecao_agentes WHERE agente_id = ?;`)
        .get(mId) as Parameters<typeof generateAgentChatReply>[1] | undefined;
      if (!ag) continue;

      const colegasAnteriores = respostas
        .map((r) => `### Contribuição anterior de ${r.autor_nome ?? r.agente_id} (@${r.agente_id}):\n${r.conteudo_markdown}`)
        .join("\n\n");

      const promptCanal =
        idx === 0 || !colegasAnteriores
          ? `[Canal ${canal.nome}] Pedido do usuário: ${userMsg.conteudo_markdown}\n(Sua equipe neste canal: ${membrosAtivos.map((id) => `@${id}`).join(", ")}. Entregue a parte da sua especialidade para o próximo colega continuar.)`
          : `[Canal ${canal.nome}] Pedido original: ${userMsg.conteudo_markdown}\n\n${colegasAnteriores}\n\nAgora é a sua vez (${ag.nome} / @${ag.agente_id}). Leia o que seus colegas produziram acima e execute a sua etapa especializada complementando e avançando a produção sem repetir o que já foi feito.`;

      if (idx > 0 && respostas[idx - 1]?.agente_id) {
        handoffBus.dispatchHandoff({
          tarefa_id: respostas[idx - 1].tarefa_id ?? null,
          de_agente_id: respostas[idx - 1].agente_id!,
          para_agente_id: ag.agente_id,
          instrucao: `Passagem de bastão no canal ${canal.nome}`,
          artefatos: respostas[idx - 1].anexos.map((a) => a.caminho_relativo),
          enfileirarNovaTarefa: false,
        });
      }

      const reply = await generateAgentChatReply(
        deps,
        ag,
        promptCanal,
        anexos,
        runningHistory,
        (prog) => {
          wsHub.broadcast("chat:progress", {
            canal_id: canalId,
            agente_id: ag.agente_id,
            turno_id: liveTurnId,
            ...prog,
          });
        },
        {
          isHandoff: idx > 0,
          originalUserPrompt: userMsg.conteudo_markdown,
        }
      );

      const agentMsg: MensagemChat = {
        mensagem_id: `msg-${randomUUID()}`,
        canal_id: canalId,
        agente_id: ag.agente_id,
        autor: "agente",
        autor_nome: ag.nome,
        conteudo_markdown: reply.markdown,
        anexos: reply.anexosGerados,
        steps:
          idx > 0 && respostas[idx - 1]
            ? [
                {
                  id: `step-${randomUUID().slice(0, 8)}`,
                  ferramenta: "handoff_agente",
                  titulo: `Recebeu contexto de ${respostas[idx - 1].autor_nome ?? respostas[idx - 1].agente_id}`,
                  status: "concluido",
                  duracao_ms: 18,
                },
                ...reply.steps,
              ]
            : reply.steps,
        tarefa_id: reply.tarefaCriadaId,
        lida: true,
        criado_em: new Date(Date.now() + 5 + idx * 5).toISOString(),
      };

      insertStmt.run(
        agentMsg.mensagem_id,
        canalId,
        ag.agente_id,
        "agente",
        ag.nome,
        agentMsg.conteudo_markdown,
        JSON.stringify(agentMsg.anexos),
        JSON.stringify(agentMsg.steps),
        agentMsg.tarefa_id ?? null,
        1,
        agentMsg.criado_em
      );
      wsHub.broadcast("chat:message", {
        canal_id: canalId,
        agente_id: ag.agente_id,
        mensagem: agentMsg,
      });
      respostas.push(agentMsg);
      runningHistory.push(agentMsg);
    }

    db.connection
      .prepare(`UPDATE projecao_grupos_equipe SET atualizado_em = ? WHERE canal_id = ?;`)
      .run(new Date().toISOString(), canalId);

    sendJson(res, 201, { mensagem_usuario: userMsg, mensagens_equipe: respostas });
    return true;
  }

  // 5. Fluxos de Trabalho Visuais (Workflows Dot-Grid)
  if (method === "GET" && path === "/api/workflows") {
    const rows = db.connection
      .prepare(`SELECT * FROM projecao_workflows ORDER BY atualizado_em DESC;`)
      .all() as Array<Parameters<typeof mapWorkflowRow>[0]>;
    sendJson(res, 200, { workflows: rows.map(mapWorkflowRow) });
    return true;
  }

  if (method === "POST" && path === "/api/workflows") {
    const body = await readJsonBody(req);
    const workflowId = `wf-${randomUUID().slice(0, 8)}`;
    const nome =
      typeof body.nome === "string" && body.nome.trim().length > 0
        ? body.nome.trim()
        : "Fluxo de trabalho sem título";
    const descricao = typeof body.descricao === "string" ? body.descricao : "";
    const nos = Array.isArray(body.nos) ? (body.nos as WorkflowNo[]) : [];
    const arestas = Array.isArray(body.arestas) ? (body.arestas as WorkflowAresta[]) : [];
    const agora = new Date().toISOString();

    db.connection
      .prepare(
        `INSERT INTO projecao_workflows (workflow_id, nome, descricao, nos_json, arestas_json, ativo, ultima_execucao_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, 1, NULL, ?);`
      )
      .run(workflowId, nome, descricao, JSON.stringify(nos), JSON.stringify(arestas), agora);

    const created = db.connection
      .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(workflowId) as Parameters<typeof mapWorkflowRow>[0];

    sendJson(res, 201, { workflow: mapWorkflowRow(created) });
    return true;
  }

  const wfExecMatch = path.match(/^\/api\/workflows\/([^/]+)\/executar$/);
  if (method === "POST" && wfExecMatch) {
    const wfId = decodeURIComponent(wfExecMatch[1]);
    const row = db.connection
      .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(wfId) as Parameters<typeof mapWorkflowRow>[0] | undefined;
    if (!row) {
      sendJson(res, 404, { erro: `Workflow '${wfId}' não encontrado.` });
      return true;
    }

    const wf = mapWorkflowRow(row);
    const nosExecutaveis = wf.nos.filter((n) => n.tipo !== "nota");
    if (nosExecutaveis.length === 0) {
      sendJson(res, 400, { erro: "Adicione ao menos um gatilho ou nó antes de executar o fluxo." });
      return true;
    }

    wsHub.broadcast("workflow:status", {
      workflow_id: wf.workflow_id,
      status: "executando",
      no_atual: nosExecutaveis[0]?.titulo ?? null,
    });

    const tarefasGeradas: string[] = [];
    for (const no of nosExecutaveis) {
      if (no.tipo === "gatilho") continue;
      const agId =
        typeof no.config?.agente_id === "string"
          ? no.config.agente_id
          : no.tipo === "render_video"
            ? "editor_video"
            : no.tipo === "gerar_imagem"
              ? "designer_individual"
              : "estrategista";

      const t = deps.queue.enqueueTask({
        agente_id: agId,
        canal_origem: "web",
        tipo: no.tipo === "render_video" ? "reels" : "workflow_step",
        titulo: `${wf.nome} -> ${no.titulo}`,
        prioridade: 3,
        payload: {
          workflow_id: wf.workflow_id,
          no_id: no.id,
          config: no.config,
        },
      });
      tarefasGeradas.push(t.tarefa_id);
      wsHub.broadcast("task:queued", {
        tarefa_id: t.tarefa_id,
        tipo: t.tipo,
        titulo: t.titulo,
        prioridade: t.prioridade,
        canal_origem: t.canal_origem,
      });
    }

    const agora = new Date().toISOString();
    db.connection
      .prepare(`UPDATE projecao_workflows SET ultima_execucao_em = ?, atualizado_em = ? WHERE workflow_id = ?;`)
      .run(agora, agora, wfId);

    wsHub.broadcast("workflow:status", {
      workflow_id: wf.workflow_id,
      status: "concluido",
      resumo: `${tarefasGeradas.length} etapa(s) enviada(s) para a Fila`,
    });

    sendJson(res, 200, {
      ok: true,
      workflow_id: wf.workflow_id,
      tarefas_criadas: tarefasGeradas,
      executado_em: agora,
    });
    return true;
  }

  const wfMatch = path.match(/^\/api\/workflows\/([^/]+)$/);
  if (wfMatch && (method === "PUT" || method === "DELETE")) {
    const wfId = decodeURIComponent(wfMatch[1]);
    const existing = db.connection
      .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(wfId) as Parameters<typeof mapWorkflowRow>[0] | undefined;

    if (!existing) {
      sendJson(res, 404, { erro: `Workflow '${wfId}' não encontrado.` });
      return true;
    }

    if (method === "DELETE") {
      db.connection.prepare(`DELETE FROM projecao_workflows WHERE workflow_id = ?;`).run(wfId);
      sendJson(res, 200, { ok: true, workflow_id: wfId });
      return true;
    }

    const body = await readJsonBody(req);
    const nome = typeof body.nome === "string" ? body.nome : existing.nome;
    const descricao = typeof body.descricao === "string" ? body.descricao : (existing.descricao ?? "");
    const nosJson = Array.isArray(body.nos) ? JSON.stringify(body.nos) : existing.nos_json;
    const arestasJson = Array.isArray(body.arestas)
      ? JSON.stringify(body.arestas)
      : existing.arestas_json;
    const ativo = typeof body.ativo === "boolean" ? (body.ativo ? 1 : 0) : existing.ativo;
    const agora = new Date().toISOString();

    db.connection
      .prepare(
        `UPDATE projecao_workflows SET nome = ?, descricao = ?, nos_json = ?, arestas_json = ?, ativo = ?, atualizado_em = ? WHERE workflow_id = ?;`
      )
      .run(nome, descricao, nosJson, arestasJson, ativo, agora, wfId);

    const updated = db.connection
      .prepare(`SELECT * FROM projecao_workflows WHERE workflow_id = ?;`)
      .get(wfId) as Parameters<typeof mapWorkflowRow>[0];

    sendJson(res, 200, { workflow: mapWorkflowRow(updated) });
    return true;
  }

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
    const body = await readJsonBody(req);
    if (typeof body.nome !== "string" || typeof body.conteudo_base64 !== "string") {
      sendJson(res, 400, { erro: "Campos obrigatórios: 'nome' e 'conteudo_base64'." });
      return true;
    }

    const base64Clean = body.conteudo_base64.replace(/^data:[^;]+;base64,/, "").trim();
    const buffer = Buffer.from(base64Clean, "base64");
    if (buffer.length === 0) {
      sendJson(res, 400, { erro: "Conteúdo base64 vazio ou inválido." });
      return true;
    }
    if (buffer.length > 15 * 1024 * 1024) {
      sendJson(res, 413, { erro: "Arquivo excede o limite de 15 MB por upload." });
      return true;
    }

    const cleanName = sanitizeFileName(body.nome);
    const arquivoId = `arq-${randomUUID().slice(0, 8)}`;
    const storedName = `${arquivoId}-${cleanName}`;
    const mimeType =
      typeof body.mime_type === "string" && body.mime_type.length > 0
        ? body.mime_type
        : RAW_MIME_MAP[extname(cleanName).toLowerCase()] ?? "application/octet-stream";
    const tipoUso = inferTipoUso(mimeType, typeof body.tipo_uso === "string" ? body.tipo_uso : undefined);

    const relFolder =
      tipoUso === "referencia"
        ? "recursos/referencias"
        : tipoUso === "logo"
          ? "recursos/logos"
          : tipoUso === "personagem"
            ? "recursos/personagens"
            : "recursos/uploads";
    const targetDir = resolve(workspaceRoot, relFolder);
    mkdirSync(targetDir, { recursive: true });

    const targetPath = resolve(targetDir, storedName);
    writeFileSync(targetPath, buffer);

    const relPath = `${relFolder}/${storedName}`;
    const agenteId = typeof body.agente_id === "string" ? body.agente_id : null;
    const tarefaId = typeof body.tarefa_id === "string" ? body.tarefa_id : null;
    const agora = new Date().toISOString();

    db.connection
      .prepare(
        `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        arquivoId,
        body.nome.slice(0, 140),
        relPath,
        mimeType,
        buffer.length,
        tipoUso,
        agenteId,
        tarefaId,
        agora
      );

    const arquivo: ArquivoStudio = {
      arquivo_id: arquivoId,
      nome_original: body.nome.slice(0, 140),
      caminho_relativo: relPath,
      url: `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`,
      mime_type: mimeType,
      tamanho_bytes: buffer.length,
      tipo_uso: tipoUso,
      agente_id: agenteId,
      tarefa_id: tarefaId,
      criado_em: agora,
    };

    sendJson(res, 201, { arquivo });
    return true;
  }

  if (method === "GET" && path === "/api/arquivos/raw") {
    const requestedRel = url.searchParams.get("path") ?? "";
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
