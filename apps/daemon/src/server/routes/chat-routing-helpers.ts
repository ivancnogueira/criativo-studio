import { randomUUID, timingSafeEqual } from "node:crypto";
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
import type { CriativoDatabase } from "../../database/client.ts";
import {
  getDeletedNativeAgentsMeta,
  getSetupCompatibleRoster,
  markNativeAgentDeleted,
  ROSTER_15_AGENTES,
  SETUP_ASSISTANT_AGENT_DEF,
  unmarkNativeAgentDeleted,
} from "../../engine/runner/roster-defaults.ts";
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
import { resolveAgentRecord } from "../agent-resolver.ts";
import type { StudioRoutesDeps } from "./route-helpers.ts";
import {
  detectUnparsedTextToolAttempt,
  parseTextToolCalls,
  type ParsedTextToolCall,
} from "./text-tool-call-detector.ts";

export { type ParsedTextToolCall, parseTextToolCalls as parseWorkflowTextToolCalls };

export function compactRecentHistory(
  history: MensagemChat[],
  maxMessages = 6,
  maxCharsPerMessage = 1200
): Array<{ role: "user" | "assistant"; text: string }> {
  return history.slice(-maxMessages).map((item) => {
    const raw = item.conteudo_markdown ?? "";
    const text =
      raw.length > maxCharsPerMessage
        ? `${raw.slice(0, maxCharsPerMessage)}\n...[mensagem compactada]`
        : raw;
    return {
      role: (item.autor === "usuario" ? "user" : "assistant") as "user" | "assistant",
      text,
    };
  });
}

export async function runTextModelWorkflowToolLoop(params: {
  initialText: string;
  invokeFollowUp: (promptFollowUp: string) => Promise<string>;
  deps: StudioRoutesDeps;
  agenteId: string;
  turnId: string;
  threadId?: string | null;
  entregaOrigemId?: string;
  pedidoTexto?: string;
  isRoutine?: boolean;
  isResumingWait?: boolean;
  channelOrigin?: "web" | "whatsapp";
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
  signal?: AbortSignal;
  steps: PassoChat[];
  anexosGerados?: AnexoChat[];
  onProgress?: (event: {
    fase: "iniciado" | "etapa" | "chunk" | "concluido" | "erro";
    mensagem_status?: string;
    step?: PassoChat;
    delta?: string;
  }) => void;
}): Promise<string> {
  let currentText = params.initialText;
  let attemptedUnparsedRecovery = false;
  const hasWorkflow = Boolean(params.deps.workflowStore && params.deps.workflowEngine);
  const workspaceRoot = params.deps.workspaceRoot ?? process.cwd();

  for (let round = 0; round < 4; round += 1) {
    if (params.signal?.aborted) {
      const abortErr = new Error("Turno interrompido.");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    const calls = parseTextToolCalls(currentText);
    if (calls.length === 0) {
      const unparsed = detectUnparsedTextToolAttempt(currentText);
      if (unparsed.detected && !attemptedUnparsedRecovery) {
        attemptedUnparsedRecovery = true;
        currentText = await params.invokeFollowUp(
          `Sua resposta anterior continha uma tentativa literal de ferramenta (${unparsed.matchedTag ?? "<execute>"}) escrita como texto inválido que não pôde ser executada.\nExecute a ferramenta real agora via MCP ou emita uma chamada JSON estritamente válida dentro de <tool_call>{"name":"nome_da_ferramenta","arguments":{...}}</tool_call>, sem envolver em XML/Markdown inválido.`,
        );
        continue;
      }
      if (unparsed.detected) {
        return (
          unparsed.sanitizedText ||
          "Não foi possível concluir a chamada de ferramenta solicitada neste turno. Tente reformular o pedido."
        );
      }
      break;
    }

    const toolResults: Array<{ name: string; output: unknown }> = [];
    for (const call of calls) {
      const t0 = Date.now();
      const toolName = call.name.replace(/^mcp__criativo_studio__/, "").trim();
      let out: unknown;
      let failed = false;
      try {
        const effectiveCanalId =
          params.threadId && !params.threadId.startsWith("main:")
            ? `thread:${params.threadId}`
            : `agente:${params.agenteId}`;

        if (
          !isAgentAuthorizedForStudioTool(toolName, params.agenteId, {
            db: params.deps.db,
            vault: params.deps.vault,
            catalogService: params.deps.catalogService,
            licenseService: params.deps.licenseService,
            workspaceRoot,
            productRoot: params.deps.productRoot,
          })
        ) {
          throw new Error(
            `Acesso negado: o agente '${params.agenteId}' não possui autorização na Loja para usar '${toolName}'.`
          );
        }

        if (isPhase15ToolName(toolName)) {
          out = await executePhase15ChatTool({
            toolName,
            args: call.arguments,
            agenteId: params.agenteId,
            canalId: effectiveCanalId,
            deps: {
              db: params.deps.db,
              wsHub: params.deps.wsHub,
              workspaceRoot,
              browserService: params.deps.browserService,
              screenCapture: params.deps.screenCapture,
              showcaseService: params.deps.showcaseService,
              transcription: params.deps.transcription,
              remoteClaimService: params.deps.remoteClaimService ?? undefined,
            },
          });
        } else if (isPhase10ExtensionTool(toolName)) {
          out = await executeStudioExtensionTool(toolName, call.arguments, {
            db: params.deps.db,
            vault: params.deps.vault,
            wsHub: params.deps.wsHub,
            workspaceRoot,
            productRoot: params.deps.productRoot,
            licenseService: params.deps.licenseService,
            transcription: params.deps.transcription,
            agenteId: params.agenteId,
            canalId: effectiveCanalId,
            threadId: params.threadId ?? `main:${params.agenteId}`,
            channelOrigin: params.channelOrigin,
            whatsappContaId: params.whatsappContaId ?? null,
            whatsappChatJid: params.whatsappChatJid ?? null,
            backgroundJobService: params.deps.phase13?.backgroundJobService,
            mcpGateway: params.deps.mcpGateway,
            catalogService: params.deps.catalogService,
            nativeStore: params.deps.catalogService?.nativeStore,
            providerConnection: params.deps.providerConnection,
            skillsManager: params.deps.skillsManager,
            whatsappManager: params.deps.whatsappManager,
            whatsappOrchestrator: params.deps.whatsappOrchestrator,
            onImageProgress: (evt) => {
              params.onProgress?.({
                fase: "etapa",
                mensagem_status: evt.mensagem,
                step: {
                  id: evt.stepId,
                  ferramenta: toolName,
                  titulo: evt.mensagem,
                  formato: evt.formato,
                  status: evt.status,
                },
              });
            },
          });
          if (
            (toolName === "generate_image" ||
              toolName === "generate_video" ||
              toolName === "exec_remotion_render" ||
              toolName === "exec_ffmpeg_edit") &&
            out &&
            typeof out === "object" &&
            "anexo" in out &&
            (out as { anexo?: AnexoChat }).anexo
          ) {
            params.anexosGerados?.push((out as { anexo: AnexoChat }).anexo);
          }
        } else if (isRoutineToolName(toolName)) {
          out = await executeStudioRoutineTool(toolName, call.arguments, {
            agenteId: params.agenteId,
            turnOrigin: "human",
            routineToolsDeps: params.deps.routineToolsDeps,
          });
        } else if (isWorkflowToolName(toolName) && hasWorkflow) {
          out = await executeChatWorkflowTool(toolName, call.arguments, {
            store: params.deps.workflowStore,
            engine: params.deps.workflowEngine,
            wsHub: params.deps.wsHub,
            agenteId: params.agenteId,
            requestSeed: params.turnId,
          });
        } else if (isPhase14ToolName(toolName) && params.deps.phase14) {
          out = await executePhase14ToolCall(
            toolName,
            call.arguments,
            {
              agenteId: params.agenteId,
              canalId: effectiveCanalId,
              threadId: params.threadId ?? `main:${params.agenteId}`,
              turnId: params.turnId,
              origemTurno: params.isRoutine ? "rotina" : "usuario_local",
              isOneToOneUserChat: !params.isRoutine && effectiveCanalId === `agente:${params.agenteId}`,
              lastUserMessageId: params.entregaOrigemId ?? null,
            },
            params.deps.phase14,
          );
        } else if (isPhase13ToolName(toolName) && params.deps.phase13) {
          const p13 = await executePhase13Tool(
            toolName,
            call.arguments,
            {
              agenteId: params.agenteId,
              turnoId: params.turnId,
              callId: `${params.turnId}:${round}:${toolName}`,
              threadId: params.threadId ?? `main:${params.agenteId}`,
              canalId: effectiveCanalId,
              entregaOrigemId: params.entregaOrigemId ?? params.turnId,
              pedidoTexto: params.pedidoTexto ?? "",
              isRoutine: params.isRoutine,
              isResumingWait: params.isResumingWait,
              channelOrigin: params.channelOrigin,
              whatsappContaId: params.whatsappContaId ?? null,
              whatsappChatJid: params.whatsappChatJid ?? null,
            },
            {
              ...params.deps.phase13,
              db: params.deps.db,
              workspaceRoot,
            },
          );
          out = p13.result;
        } else if (params.deps.mcpGateway && toolName.startsWith("mcp_")) {
          out = await params.deps.mcpGateway.callMcpTool(toolName, call.arguments, {
            agentId: params.agenteId,
          });
        } else {
          failed = true;
          out = { erro: `Serviço indisponível para ferramenta '${toolName}'.` };
        }
      } catch (err) {
        failed = true;
        out = { erro: err instanceof Error ? err.message : String(err) };
      }

      const step: PassoChat = {
        id: `step-${randomUUID().slice(0, 8)}`,
        ferramenta: call.name,
        titulo: failed ? `Falha em ${call.name}` : `Ferramenta ${call.name} executada`,
        detalhes: JSON.stringify(out).slice(0, 800),
        status: failed ? "erro" : "concluido",
        duracao_ms: Date.now() - t0,
      };
      params.steps.push(step);
      params.onProgress?.({ fase: "etapa", mensagem_status: step.titulo, step });
      toolResults.push({ name: call.name, output: out });
    }

    currentText = await params.invokeFollowUp(
      `Resultados das ferramentas executadas:\n${JSON.stringify(toolResults, null, 2)}\n\nContinue respondendo ao usuário em pt-br com base nesses resultados reais (ou chame nova ferramenta via <tool_call> se necessário).`
    );
  }

  return currentText;
}

export function loadResolvableAgentsForRouting(
  db?: CriativoDatabase,
): readonly { agente_id: string; nome?: string | null }[] {
  if (db) {
    try {
      const rows = db.connection
        .prepare("SELECT agente_id, nome FROM projecao_agentes ORDER BY ordem_exibicao ASC;")
        .all() as Array<{ agente_id: string; nome: string }>;
      if (rows.length > 0) return rows;
    } catch {
      // Fallback caso tabela ainda não exista
    }
  }
  return ROSTER_15_AGENTES;
}

export function extractMentionedAgentIds(
  text: string,
  excludeId?: string,
  db?: CriativoDatabase,
): string[] {
  const found = new Set<string>();
  const agentsList = loadResolvableAgentsForRouting(db);

  // Detecta [HANDOFF:agente_id_ou_apelido] ou @agente_id_ou_apelido no texto
  for (const m of text.matchAll(/\[HANDOFF:([a-z0-9_-]+)\]/gi)) {
    const resolved = resolveAgentRecord(agentsList, m[1]);
    if (resolved && resolved.agente_id !== excludeId) found.add(resolved.agente_id);
  }
  for (const m of text.matchAll(/@([a-z0-9_-]+)/gi)) {
    const resolved = resolveAgentRecord(agentsList, m[1]);
    if (resolved && resolved.agente_id !== excludeId) found.add(resolved.agente_id);
  }
  return Array.from(found);
}

export function extractExplicitAgentHandoffTags(
  text: string,
  excludeId?: string,
  db?: CriativoDatabase,
): string[] {
  const found = new Set<string>();
  const agentsList = loadResolvableAgentsForRouting(db);
  for (const m of text.matchAll(/\[HANDOFF:([a-z0-9_-]+)\]/gi)) {
    const resolved = resolveAgentRecord(agentsList, m[1]);
    if (resolved && resolved.agente_id !== excludeId) found.add(resolved.agente_id);
  }
  return Array.from(found);
}

export const EXPLICIT_CREATION_ACTION_RE =
  /(?:^|\b)(crie|criar|gere|gerar|fa[cç]a|fazer|produza|produzir|monte|montar|desenhe|desenhar|refa[cç]a|refazer|ajuste|ajustar|renderize|renderizar|cria|gera|faz|quero um|quero uma|preciso de um|preciso de uma)\b/i;

const IMPERATIVE_OR_WANT_RE =
  /(?:^|\b)(crie|gere|fa[cç]a|produza|monte|desenhe|refa[cç]a|ajuste|renderize|quero um|quero uma|preciso de um|preciso de uma)\b/i;

export const EXPLICIT_VISUAL_ASSET_NOUN_RE =
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

const VISUAL_FOLLOWUP_CORRECTION_RE =
  /(n[aã]o\s+(sou\s+eu|use\s+ess[ae]|eh\s+essa)|esse\s+a[ií]\s+n[aã]o|foto\s+errad[ao]|pasta\s+errad[ao]|minhas?\s+fotos?|recursos\/fotos|refa[cç]a|tenta\s+de\s+novo|tentar\s+novamente|gera\s+outr[ao]|usa\s+a?\s*minha\s+foto|cade\s+a?\s*imagem|^\s*(kd|cad[eê])\??\s*$)/i;

export function hasExplicitVisualGenerationIntent(
  userPrompt: string,
  agentId: string,
  isHandoff = false,
  history: MensagemChat[] = []
): boolean {
  if (isGreetingOrCapabilityQuestion(userPrompt)) return false;

  const isVisualAgent = agentId.startsWith("designer_") || agentId === "consistencia_visual";
  const hasRecentVisualContext =
    isVisualAgent ||
    history.slice(-6).some((m) => {
      const hasGeneratedAnexo = Array.isArray(m.anexos) && m.anexos.some((a) => a?.tipo_uso === "gerado");
      if (hasGeneratedAnexo) return true;
      return /(gerar|processando\s+a\s+arte|arte|imagem|post|storie|carrossel|recursos\/fotos|recursos\/referencias)/i.test(
        m.conteudo_markdown || ""
      );
    });

  if (VISUAL_FOLLOWUP_CORRECTION_RE.test(userPrompt) && hasRecentVisualContext && !isHandoff) {
    return true;
  }

  if (!EXPLICIT_CREATION_ACTION_RE.test(userPrompt)) return false;

  if (isVisualAgent) {
    return EXPLICIT_VISUAL_ASSET_NOUN_RE.test(userPrompt);
  }
  if (isHandoff) {
    return false;
  }
  // Agentes não-visuais (estrategista, copywriter, etc.) só geram imagem se o usuário pedir explicitamente uma imagem/arte
  return DIRECT_IMAGE_NOUN_RE.test(userPrompt);
}
