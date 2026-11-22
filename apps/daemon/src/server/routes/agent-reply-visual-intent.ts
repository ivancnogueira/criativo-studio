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
  buildConnectorsList,
  computeHostAnalytics,
  importExternalTelemetryIfAvailable,
  listInstalledSkills,
  loadSkillPromptBySlug,
  recordChatTurnUsage,
  recordSkillLoadUsage,
} from "../analytics-skills-service.ts";
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
import {
  generateImageTool,
  resolveVaultSecretCaseInsensitive,
} from "../../engine/tools/generate-image.ts";
import type { StudioRoutesDeps } from "./route-helpers.ts";
import type { ChatProgressReport } from "./agent-enrichment-helpers.ts";
import { EXPLICIT_CREATION_ACTION_RE, EXPLICIT_VISUAL_ASSET_NOUN_RE, hasExplicitVisualGenerationIntent } from "./chat-routing-helpers.ts";
import type { AgentReplyOptions, AgentReplyTarget, AgentVisualPreparationResult, PreparedAgentReplySetup } from "./agent-reply-types.ts";

export async function prepareAndGenerateVisualAssets(params: {
  deps: StudioRoutesDeps;
  agente: AgentReplyTarget;
  userPrompt: string;
  anexos: AnexoChat[];
  history: MensagemChat[];
  onProgress?: (evt: ChatProgressReport) => void;
  options?: AgentReplyOptions;
  setup: PreparedAgentReplySetup;
}): Promise<AgentVisualPreparationResult> {
  const { deps, agente, userPrompt, anexos, history, onProgress, options, setup } = params;
  const {
    workspaceRoot,
    config,
    onboarding,
    skillSlug,
    intentSourcePrompt,
    greetingOrCapability,
    promptBase,
    agService,
    agSnapshot,
    statusList,
    hasAntigravityAccount,
    steps,
    turnId,
    sessionId,
    assertNotAborted,
  } = setup;
  // Verifica intenção explícita de produção / geração visual sem disparar em saudações ou dúvidas
  const lower = intentSourcePrompt.toLowerCase();
  let tarefaCriadaId: string | null = null;

  const asksProduction =
    !greetingOrCapability &&
    EXPLICIT_CREATION_ACTION_RE.test(intentSourcePrompt) &&
    EXPLICIT_VISUAL_ASSET_NOUN_RE.test(intentSourcePrompt);
  const asksVisualAsset = hasExplicitVisualGenerationIntent(
    intentSourcePrompt,
    agente.agente_id,
    Boolean(options?.isHandoff),
    history
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
  let labeledVisualAssets: LabeledVisualAsset[] = [];

  if (asksVisualAsset || anexos.length > 0) {
    labeledVisualAssets = selectBalancedVisualAssets(deps.db, workspaceRoot, {
      explicitAttachments: anexos,
      maxFotos: 6,
      maxReferencias: 4,
      maxLogos: 1,
      maxTotal: 14,
    });
  }

  let resolvedImageDiskPaths =
    labeledVisualAssets.length > 0
      ? labeledVisualAssets.map((a) => a.path)
      : anexos.map((a) => resolve(workspaceRoot, a.caminho_relativo)).filter((p) => existsSync(p));

  const formatoVisualPedido: "3:4" | "9:16" | "1:1" | "16:9" = lower.includes("storie")
    ? "9:16"
    : lower.includes("quadrad") || lower.includes("1:1")
      ? "1:1"
      : lower.includes("16:9")
        ? "16:9"
        : "3:4";

  const hasGeminiImgKey = Boolean(
    deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "gemini_api_key", "google_api_key")
  );
  const hasOpenAiImgKey = Boolean(
    deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "openai_api_key")
  );
  const hasFalImgKey = Boolean(
    deps.vault && resolveVaultSecretCaseInsensitive(deps.vault, "fal_api_key", "flux_api_key")
  );
  const hasImgApiKey = hasGeminiImgKey || hasOpenAiImgKey || hasFalImgKey;

  // Se houver API Key (Nano Banana 2.1 / GPT Image 2.6 / Flux) ou conta Google/Antigravity, gera arte real
  if ((hasAntigravityAccount || hasImgApiKey) && asksVisualAsset) {
    const tImgStart = Date.now();
    const imgStepId = `step-img-${randomUUID().slice(0, 8)}`;
    onProgress?.({
      fase: "etapa",
      mensagem_status: `Gerando arte ${formatoVisualPedido} com ${resolvedImageDiskPaths.length} referência(s)...`,
      step: {
        id: imgStepId,
        ferramenta: "generate_image",
        titulo: `Gerando arte visual (${formatoVisualPedido})...`,
        formato: formatoVisualPedido,
        status: "executando",
      },
    });
    try {
      const visualPromptText = `Crie uma arte profissional de Instagram (${formatoVisualPedido}) para ${onboarding.marca_nome} (${onboarding.perfil_handle}). Preserve fielmente o rosto e características da pessoa nas fotos rotuladas como [FOTO REAL DO USUÁRIO], utilizando [REFERÊNCIA DE ESTILO] somente como inspiração estética. Solicitação do usuário: ${userPrompt}. Estética editorial contemporânea, alta legibilidade e contraste, sem marcas d'água.`;

      let generatedArtifact:
        | {
            arquivoId: string;
            fileName: string;
            relPath: string;
            mimeType: string;
            bufLength: number;
            modelUsed: string;
            providerUsed: string;
            usage: { uncachedInput: number; cachedInput: number; output: number };
          }
        | null = null;

      if (hasImgApiKey && deps.vault) {
        try {
          const dirArtes = resolve(workspaceRoot, "saidas", "artes");
          mkdirSync(dirArtes, { recursive: true });
          const arquivoId = `arte-${randomUUID().slice(0, 8)}`;
          const fileName = `${arquivoId}.png`;
          const diskPath = resolve(dirArtes, fileName);
          const apiImgRes = await generateImageTool(
            {
              aspect_ratio: formatoVisualPedido,
              prompt: visualPromptText,
              image_paths: resolvedImageDiskPaths,
              facial_consistency: labeledVisualAssets.some((a) => a.role === "foto_real"),
              output_path: diskPath,
            },
            { vault: deps.vault }
          );
          const buf = readFileSync(diskPath);
          generatedArtifact = {
            arquivoId,
            fileName,
            relPath: `saidas/artes/${fileName}`,
            mimeType: apiImgRes.mime_type,
            bufLength: buf.length,
            modelUsed: apiImgRes.model_used,
            providerUsed: apiImgRes.engine_used,
            usage: { uncachedInput: 0, cachedInput: 0, output: 1290 },
          };
        } catch (apiImgErr) {
          if (!hasAntigravityAccount) {
            throw apiImgErr;
          }
        }
      }

      if (!generatedArtifact && hasAntigravityAccount) {
        const imgGen = await agService.executeCodeAssistGenerate({
          model: agSnapshot.imageGenerationModelIds[0] ?? "gemini-3.1-flash-image",
          messages: [{ role: "user", text: visualPromptText }],
          imagePaths: resolvedImageDiskPaths,
          labeledImages: labeledVisualAssets,
          generateImage: true,
          agentId: agente.agente_id,
          preferredAccountId: typeof config.provider_account_id === "string" ? config.provider_account_id : null,
        });

        if (imgGen.images.length > 0) {
          const firstImg = imgGen.images[0]!;
          const ext = firstImg.mimeType.includes("png") ? ".png" : firstImg.mimeType.includes("webp") ? ".webp" : ".jpg";
          const arquivoId = `arte-${randomUUID().slice(0, 8)}`;
          const dirArtes = resolve(workspaceRoot, "saidas", "artes");
          mkdirSync(dirArtes, { recursive: true });
          const fileName = `${arquivoId}${ext}`;
          const diskPath = resolve(dirArtes, fileName);
          const buf = Buffer.from(firstImg.dataBase64, "base64");
          writeFileSync(diskPath, buf);
          generatedArtifact = {
            arquivoId,
            fileName,
            relPath: `saidas/artes/${fileName}`,
            mimeType: firstImg.mimeType,
            bufLength: buf.length,
            modelUsed: imgGen.modelUsed,
            providerUsed: "antigravity",
            usage: imgGen.usage,
          };
        }
      }

      if (generatedArtifact) {
        const urlRaw = `/api/arquivos/raw?path=${encodeURIComponent(generatedArtifact.relPath)}`;
        const agora = new Date().toISOString();

        deps.db.connection
          .prepare(
            `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
             VALUES (?, ?, ?, ?, ?, 'gerado', ?, ?, ?);`
          )
          .run(
            generatedArtifact.arquivoId,
            generatedArtifact.fileName,
            generatedArtifact.relPath,
            generatedArtifact.mimeType,
            generatedArtifact.bufLength,
            agente.agente_id,
            tarefaCriadaId,
            agora
          );

        anexosGerados.push({
          arquivo_id: generatedArtifact.arquivoId,
          nome: generatedArtifact.fileName,
          caminho_relativo: generatedArtifact.relPath,
          url: urlRaw,
          mime_type: generatedArtifact.mimeType,
          tamanho_bytes: generatedArtifact.bufLength,
          tipo_uso: "gerado",
        });

        recordChatTurnUsage(deps.db, {
          agentId: agente.agente_id,
          sessionId,
          turnId: `${turnId}:img`,
          provider: generatedArtifact.providerUsed,
          model: generatedArtifact.modelUsed,
          uncachedInput: generatedArtifact.usage.uncachedInput,
          cachedInput: generatedArtifact.usage.cachedInput,
          output: generatedArtifact.usage.output,
        });

        if (tarefaCriadaId) {
          deps.queue.updateTaskStatus(tarefaCriadaId, "aguardando_aprovacao", {
            preview_url: urlRaw,
            imagem_caminho: generatedArtifact.relPath,
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

        const imgDoneStep: PassoChat = {
          id: imgStepId,
          ferramenta: `generate_image:${generatedArtifact.modelUsed}`,
          titulo: `Arte real gerada (${(generatedArtifact.bufLength / 1024).toFixed(0)} KB · ${generatedArtifact.modelUsed})`,
          detalhes: generatedArtifact.relPath,
          formato: formatoVisualPedido,
          status: "concluido",
          duracao_ms: Date.now() - tImgStart,
        };
        steps.push(imgDoneStep);
        onProgress?.({
          fase: "etapa",
          mensagem_status: imgDoneStep.titulo,
          step: imgDoneStep,
        });
      } else {
        const imgEmptyStep: PassoChat = {
          id: imgStepId,
          ferramenta: "generate_image",
          titulo: "Gerador não retornou imagem neste turno",
          formato: formatoVisualPedido,
          status: "erro",
          duracao_ms: Date.now() - tImgStart,
        };
        steps.push(imgEmptyStep);
        onProgress?.({
          fase: "etapa",
          mensagem_status: imgEmptyStep.titulo,
          step: imgEmptyStep,
        });
      }
    } catch (imgErr) {
      const imgErrStep: PassoChat = {
        id: imgStepId,
        ferramenta: "generate_image",
        titulo: `Aviso na geração de imagem: ${imgErr instanceof Error ? imgErr.message.slice(0, 90) : "falha na chamada"}`,
        formato: formatoVisualPedido,
        status: "erro",
        duracao_ms: Date.now() - tImgStart,
      };
      steps.push(imgErrStep);
      onProgress?.({
        fase: "etapa",
        mensagem_status: imgErrStep.titulo,
        step: imgErrStep,
      });
    }
  }
  return {
    tarefaCriadaId,
    anexosGerados,
    labeledVisualAssets,
    resolvedImageDiskPaths,
  };
}
