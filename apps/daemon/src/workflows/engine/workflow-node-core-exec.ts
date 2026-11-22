import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import {
  isAnnotationNodeKind,
  normalizeNodeKind,
  normalizeWorkflowGraph,
  workflowGraphProblemAt,
  workflowLoopEdges,
  type TarefaRegistro,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowNo,
  type WorkflowOutputTarget,
  type WorkflowPortType,
  type WorkflowRunDetail,
  type WorkflowRunOrigin,
  type WorkflowRunRecord,
  type WorkflowStepRecord,
} from "@criativo/contracts";
import type { AgentRunner } from "../../engine/runner/agent-runner.ts";
import { generateImageTool } from "../../engine/tools/generate-image.ts";
import { executeRemotionRender } from "../../engine/tools/remotion-bridge.ts";
import {
  buildNodeInputs,
  conditionAnswer,
  conditionPrompt,
  currentAnswers,
  hasUpstreamApprovedStep,
  MAX_LOOP_PASSES,
  nextActions,
  runScope,
  soloInputs,
  type WorkflowBuiltInputs,
} from "../workflow-walk.ts";
import { safeJsonParse, type WorkflowEngineRuntimeContext } from "./workflow-engine-types.ts";

export async function executeWorkflowCoreOrAiNode(
  ctx: WorkflowEngineRuntimeContext,
  params: {
    kind: string;
    step: WorkflowStepRecord;
    node: WorkflowNo;
    cfg: Record<string, unknown>;
    inputs: WorkflowBuiltInputs;
    runPayload: string | null;
    signal?: AbortSignal;
  }
): Promise<boolean> {
  const { kind, step, node, cfg, inputs, runPayload, signal } = params;
      if (kind === "gatilho") {
        const out = runPayload ?? inputs.inputText ?? "Disparado manualmente";
        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "done",
          output: out,
          outputTipo: "text",
          artefatos: [],
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "prompt") {
        const template =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        let resolvedText = template.includes("{{input}}")
          ? template.replaceAll("{{input}}", inputs.inputText)
          : template && inputs.inputText
            ? `${template}\n\n${inputs.inputText}`
            : template || inputs.inputText;
        resolvedText = ctx.interpolateBrandPlaceholders(resolvedText);

        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "done",
          output: resolvedText,
          outputTipo: "text",
          artefatos: [],
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "asset") {
        const fileIdOrPath =
          node.fileId ??
          (typeof cfg.fileId === "string" ? cfg.fileId : undefined) ??
          (typeof cfg.caminho_relativo === "string" ? cfg.caminho_relativo : undefined) ??
          "";
        if (!fileIdOrPath) {
          throw new Error(`Nó asset '${node.titulo || node.id}' sem arquivo selecionado.`);
        }

        const fileRow = ctx.deps.db.connection
          .prepare(
            `SELECT arquivo_id, caminho_relativo, mime_type FROM projecao_arquivos WHERE arquivo_id = ? OR caminho_relativo = ? LIMIT 1;`
          )
          .get(fileIdOrPath, fileIdOrPath) as
          | { arquivo_id: string; caminho_relativo: string; mime_type: string }
          | undefined;

        const relPath = fileRow?.caminho_relativo ?? fileIdOrPath;
        const absFile = ctx.resolveWithinRoot(relPath);
        if (!existsSync(absFile)) {
          throw new Error(`Arquivo de ativo não encontrado no disco: ${relPath}`);
        }

        const isImage =
          fileRow?.mime_type?.startsWith("image/") ||
          /\.(png|jpe?g|webp|gif)$/i.test(relPath);
        const outTipo: WorkflowPortType = isImage ? "image" : "file";
        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "done",
          output: fileRow?.arquivo_id ?? relPath,
          outputTipo: outTipo,
          artefatos: [relPath],
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "llm") {
        const basePrompt =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        const fullPrompt =
          basePrompt && inputs.inputText
            ? `${basePrompt}\n\n${inputs.inputText}`
            : basePrompt || inputs.inputText || "Responda de forma objetiva.";
        const sysPrompt =
          node.systemPrompt ??
          (typeof cfg.systemPrompt === "string" ? cfg.systemPrompt : undefined);
        const safeImagePaths = inputs.mediaInputs
          .filter((m) => m.portType === "image")
          .map((m) => {
            try {
              return ctx.resolveWithinRoot(m.path);
            } catch {
              return null;
            }
          })
          .filter((p): p is string => Boolean(p && existsSync(p)));

        const result = await ctx.generationLock.withLock(
          () =>
            ctx.executeDirectModelText({
              model: node.model ?? (typeof cfg.model === "string" ? cfg.model : undefined),
              provider: node.provider ?? (typeof cfg.provider === "string" ? cfg.provider : undefined),
              effort: node.effort ?? (typeof cfg.effort === "string" ? cfg.effort : undefined),
              systemPrompt: sysPrompt,
              prompt: fullPrompt,
              imagePaths: safeImagePaths,
              signal,
            }),
          signal
        );

        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "done",
          output: result.text,
          outputTipo: "text",
          artefatos: [],
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "agente") {
        const agenteId =
          node.agenteId ??
          (typeof cfg.agenteId === "string" ? cfg.agenteId : undefined) ??
          "estrategista";

        const promptBase =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        const combinedPrompt =
          promptBase && inputs.inputText
            ? `${promptBase}\n\n[Entrada do workflow]\n${inputs.inputText}`
            : promptBase || inputs.inputText || `Executar etapa '${node.titulo}'`;

        const mediaPaths = inputs.mediaInputs
          .map((m) => {
            try {
              return ctx.resolveWithinRoot(m.path);
            } catch {
              return null;
            }
          })
          .filter((p): p is string => Boolean(p));

        let tarefa: TarefaRegistro | null = null;
        if (step.tarefa_id) {
          tarefa = ctx.deps.queue.getTask(step.tarefa_id);
        }
        if (!tarefa) {
          tarefa = ctx.createAgentTaskForStep({
            workflowId: step.workflow_id,
            runId: step.run_id ?? "",
            stepId: step.step_id,
            node,
            promptText: combinedPrompt,
            mediaPaths,
          });
          ctx.deps.store.updateStep(step.step_id, { tarefaId: tarefa.tarefa_id });
        }

        if (!ctx.deps.runner) {
          throw new Error("AgentRunner não conectado ao WorkflowEngine.");
        }

        const runnerRes = await ctx.deps.runner.runTask(tarefa);

        // Verifica se a etapa não foi interrompida externamente enquanto o agente executava
        const latestSelf = ctx.deps.store.getStep(step.step_id);
        if (latestSelf?.status === "stopped") {
          return true;
        }

        if (runnerRes.failureReason) {
          throw new Error(runnerRes.failureReason);
        }

        const relArtifacts = runnerRes.generatedArtifacts.map((p) => {
          try {
            const abs = resolve(ctx.deps.workspaceRoot, p);
            if (abs.startsWith(resolve(ctx.deps.workspaceRoot) + sep)) {
              return relative(resolve(ctx.deps.workspaceRoot), abs).replace(/\\/g, "/");
            }
          } catch {
            // mantém string original
          }
          return p;
        });

        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "done",
          output: runnerRes.finalText,
          outputTipo: relArtifacts.length > 0 ? "file" : "text",
          artefatos: relArtifacts,
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "gerar_imagem") {
        const promptBase =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        const promptFinal =
          promptBase && inputs.inputText
            ? `${promptBase}\n\n${inputs.inputText}`
            : promptBase || inputs.inputText || "Arte visual profissional em estética limpa";
        const aspect =
          cfg.aspectRatio === "9:16" || cfg.aspectRatio === "1:1" || cfg.aspectRatio === "3:4"
            ? cfg.aspectRatio
            : "3:4";

        const safeRefs = inputs.mediaInputs
          .filter((m) => m.portType === "image")
          .map((m) => {
            try {
              return ctx.resolveWithinRoot(m.path);
            } catch {
              return null;
            }
          })
          .filter((p): p is string => Boolean(p && existsSync(p)));

        const result = await ctx.mediaLock.withLock(async () => {
          const arquivoId = `arte-wf-${randomUUID().slice(0, 8)}`;
          const relPath = `saidas/artes/${arquivoId}.png`;
          const outputPath = resolve(ctx.deps.workspaceRoot, relPath);
          mkdirSync(resolve(outputPath, ".."), { recursive: true });

          const hasImgApiKey =
            Boolean(ctx.deps.vault.getSecret("gemini_api_key")) ||
            Boolean(ctx.deps.vault.getSecret("google_api_key")) ||
            Boolean(ctx.deps.vault.getSecret("openai_api_key")) ||
            Boolean(ctx.deps.vault.getSecret("fal_api_key"));

          if (hasImgApiKey) {
            await generateImageTool(
              {
                aspect_ratio: aspect,
                prompt: promptFinal,
                image_paths: safeRefs,
                output_path: outputPath,
              },
              { vault: ctx.deps.vault, fetchImpl: ctx.deps.fetchImpl }
            );
          } else {
            const agRes = await ctx.deps.providerConnection
              .getAntigravityService()
              .executeCodeAssistGenerate({
                model: "gemini-3.1-flash-image",
                messages: [{ role: "user", text: promptFinal }],
                generateImage: true,
                imagePaths: safeRefs,
              });
            if (!agRes.images || agRes.images.length === 0) {
              throw new Error("Nenhuma imagem retornada pelo provedor de geração.");
            }
            writeFileSync(outputPath, Buffer.from(agRes.images[0].dataBase64, "base64"));
          }

          const sizeBytes = existsSync(outputPath) ? readFileSync(outputPath).length : 0;
          ctx.deps.db.connection
            .prepare(
              `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
               VALUES (?, ?, ?, 'image/png', ?, 'gerado', NULL, NULL, ?);`
            )
            .run(arquivoId, `${arquivoId}.png`, relPath, sizeBytes, new Date().toISOString());

          return { arquivoId, relPath };
        }, signal);

        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "done",
          output: result.arquivoId,
          outputTipo: "image",
          artefatos: [result.relPath],
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "render_video") {
        const audioInput = inputs.mediaInputs.find(
          (m) => m.portType === "file" && /\.(mp3|wav|m4a|ogg)$/i.test(m.path)
        );
        const composicao =
          cfg.composicao === "ReelsTalkingHead" ? "ReelsTalkingHead" : "ReelsFaceless";

        const result = await ctx.mediaLock.withLock(async () => {
          const arquivoId = `video-wf-${randomUUID().slice(0, 8)}`;
          const relPath = `saidas/videos/${arquivoId}.mp4`;
          const outputPath = resolve(ctx.deps.workspaceRoot, relPath);
          const audioAbs = audioInput
            ? ctx.resolveWithinRoot(audioInput.path)
            : typeof cfg.audioPath === "string"
              ? ctx.resolveWithinRoot(cfg.audioPath)
              : "";

          await executeRemotionRender({
            composicao,
            audio_path: audioAbs,
            output_path: outputPath,
            remotionProjectDir: ctx.deps.workspaceRoot,
            props: {
              roteiroTexto: inputs.inputText,
              imagens: inputs.mediaInputs
                .filter((m) => m.portType === "image")
                .map((m) => m.path),
            },
          });

          const sizeBytes = existsSync(outputPath) ? readFileSync(outputPath).length : 0;
          ctx.deps.db.connection
            .prepare(
              `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
               VALUES (?, ?, ?, 'video/mp4', ?, 'video', NULL, NULL, ?);`
            )
            .run(arquivoId, `${arquivoId}.mp4`, relPath, sizeBytes, new Date().toISOString());

          return { arquivoId, relPath };
        }, signal);

        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "done",
          output: result.arquivoId,
          outputTipo: "file",
          artefatos: [result.relPath],
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "condition") {
        const rule =
          node.rule ??
          (typeof cfg.rule === "string" ? cfg.rule : undefined) ??
          "A entrada atende à condição?";
        const promptCond = conditionPrompt(rule, inputs.inputText);
        const result = await ctx.generationLock.withLock(
          () =>
            ctx.executeDirectModelText({
              model: node.model ?? (typeof cfg.model === "string" ? cfg.model : undefined),
              provider: node.provider ?? (typeof cfg.provider === "string" ? cfg.provider : undefined),
              prompt: promptCond,
              signal,
            }),
          signal
        );

        const branch = conditionAnswer(result.text);
        if (!branch) {
          throw new Error(
            `Resposta ambígua ao avaliar condição ('${result.text.slice(0, 80)}'). Esperado 'yes' ou 'no'.`
          );
        }

        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "done",
          output: inputs.inputText,
          outputTipo: "text",
          artefatos: [],
          branch,
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "approval") {
        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "approval",
          output: null,
          artefatos: inputs.mediaInputs.map((m) => m.path),
        });
        if (updated) ctx.emitStepUpdated(updated);

        if (step.run_id) {
          const pausedRun = ctx.deps.store.updateRunStatus(step.run_id, "approval");
          if (pausedRun) ctx.emitRunUpdated(pausedRun);
        }

        const wfVisual = ctx.deps.store.getWorkflowVisual(step.workflow_id);
        const question =
          node.question ??
          (typeof cfg.question === "string" ? cfg.question : undefined) ??
          "Confirma a continuação deste workflow?";

        if (ctx.deps.telegramBot) {
          const chatId =
            (typeof cfg.telegramChatId === "string" ? cfg.telegramChatId : undefined) ??
            (typeof cfg.chatId === "string" ? cfg.chatId : undefined);
          try {
            await ctx.deps.telegramBot.sendWorkflowApproval({
              stepId: step.step_id,
              workflowNome: wfVisual?.nome ?? step.workflow_id,
              question,
              previewText: inputs.inputText || "(etapa com anexos pronta para revisão)",
              chatId,
            });
          } catch {
            // Notificação Telegram é opcional; nunca bloqueia pausa de aprovação
          }
        }

        const waJid = typeof cfg.whatsappJid === "string" ? cfg.whatsappJid.trim() : "";
        const waAdapter = ctx.getWhatsAppAdapter();
        if (waJid && waAdapter?.getStatus().status === "conectado") {
          try {
            await waAdapter.sendMessage(waJid, {
              text: `⏸ Aprovação pendente no workflow "${wfVisual?.nome ?? step.workflow_id}": ${question}\nEtapa #${step.step_id}`,
            });
          } catch {
            // opcional
          }
        }
        return true;
  }
  return false;
}
