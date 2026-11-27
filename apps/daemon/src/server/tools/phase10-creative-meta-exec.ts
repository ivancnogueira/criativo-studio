import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnexoChat } from "@criativo/contracts";
import {
  generateImageTool,
  MAX_REFERENCES_BY_ENGINE,
  resolveVaultSecretCaseInsensitive,
  type ImageProviderEngine,
} from "../../engine/tools/generate-image.ts";
import {
  generateVideoTool,
  MAX_VIDEO_REFERENCE_IMAGES,
} from "../../engine/tools/generate-video.ts";
import {
  fetchMetaAccountAndMediaInsights,
  validateMetaIntegration,
} from "../../engine/tools/meta-insights.ts";
import { metaPublishTool, type MetaPublishParams } from "../../engine/tools/meta-publish.ts";
import type { NativeAppConnectionsStore } from "../../marketplace/native-app-connections-store.ts";
import {
  saveBrandIdentity,
  setSetupAssistantState,
  setVpsAssistantState,
} from "../brand-onboarding-service.ts";
import type { StudioExtensionToolDeps } from "./phase10-tools-schema.ts";
import { selectBalancedVisualAssets } from "./studio-media-scanner.ts";
import { readStringArg, readStringArrayArg } from "./studio-tool-helpers.ts";
import { executeMeta2026Tool, isMeta2026ToolName } from "./meta-2026-tools-exec.ts";
import { executeVideoStudioTool, isVideoStudioToolName } from "./video-tools-exec.ts";
export async function executePhase10CreativeMetaTool(
  toolName: string,
  args: Record<string, unknown>,
  deps: StudioExtensionToolDeps,
  ctx: { workspaceRoot: string; nativeStore: NativeAppConnectionsStore | null }
): Promise<unknown> {
  const { workspaceRoot, nativeStore } = ctx;
  if (isMeta2026ToolName(toolName)) {
    return await executeMeta2026Tool(toolName, args, deps, ctx);
  }
  if (isVideoStudioToolName(toolName)) {
    return await executeVideoStudioTool(toolName, args, deps, workspaceRoot);
  }
  switch (toolName) {
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
      const rawStrategy = readStringArg(args, "trial_graduation_strategy", "trialGraduationStrategy");
      const trialGraduationStrategy =
        rawStrategy === "MANUAL" || rawStrategy === "SS_PERFORMANCE" ? rawStrategy : undefined;
      return await metaPublishTool(
        {
          media_type: (readStringArg(args, "media_type") ?? "IMAGE") as MetaPublishParams["media_type"],
          media_urls: readStringArrayArg(args, "media_urls"),
          caption: readStringArg(args, "caption") ?? "",
          approved_by_human: args.approved_by_human === true,
          conta_id: readStringArg(args, "conta_id", "contaId"),
          editorial_post_id: readStringArg(args, "editorial_post_id", "editorialPostId"),
          trial_reel: args.trial_reel === true,
          trial_graduation_strategy: trialGraduationStrategy,
          first_comment: readStringArg(args, "first_comment", "firstComment"),
          first_comment_approved: args.first_comment_approved === true,
          first_comment_delay_seconds:
            typeof args.first_comment_delay_seconds === "number" &&
            Number.isFinite(args.first_comment_delay_seconds)
              ? args.first_comment_delay_seconds
              : undefined,
        },
        {
          vault: deps.vault,
          db: deps.db,
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
