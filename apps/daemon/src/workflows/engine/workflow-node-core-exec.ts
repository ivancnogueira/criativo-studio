import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  type TarefaRegistro,
  type WorkflowAresta,
  type WorkflowBranch,
  type WorkflowDeterministicRule,
  type WorkflowNo,
  type WorkflowPortType,
  type WorkflowStepRecord,
} from "@criativo/contracts";
import { conditionAnswer, conditionPrompt, type WorkflowBuiltInputs } from "../workflow-walk.ts";
import { type WorkflowEngineRuntimeContext } from "./workflow-engine-types.ts";
import { executeBatchMediaNode } from "./workflow-batch-media-exec.ts";
import {
  buildAnswerFieldsInstruction,
  collectUpstreamStructuredVariables,
  extractWebhookAnswerFields,
  interpolateWorkflowVariables,
  parseAndValidateAnswerFields,
  resolveNodeAnswerFields,
} from "../workflow-structured-fields.ts";
import { evaluateDeterministicCondition } from "../workflow-deterministic-condition.ts";

export async function executeWorkflowCoreOrAiNode(
  ctx: WorkflowEngineRuntimeContext,
  params: {
    kind: string;
    step: WorkflowStepRecord;
    node: WorkflowNo;
    cfg: Record<string, unknown>;
    graph?: { nos: WorkflowNo[]; arestas: WorkflowAresta[] };
    inputs: WorkflowBuiltInputs;
    stepsByNode?: Map<string, WorkflowStepRecord>;
    runPayload: string | null;
    signal?: AbortSignal;
  }
): Promise<boolean> {
  const { kind, step, node, cfg, inputs, runPayload, signal } = params;
  const upstreamVars = collectUpstreamStructuredVariables(
    node,
    params.graph?.arestas ?? [],
    params.stepsByNode ?? new Map(),
    inputs.inputText
  );

      if (kind === "gatilho") {
        const answerFields = resolveNodeAnswerFields(node);
        const structuredOutput =
          answerFields.length > 0 ? extractWebhookAnswerFields(runPayload, answerFields) : null;
        const out = runPayload ?? inputs.inputText ?? "Disparado manualmente";
        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "done",
          output: out,
          outputTipo: "text",
          artefatos: [],
          ...(structuredOutput ? { structuredOutput } : {}),
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "prompt") {
        const template =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        let resolvedText = template.includes("{{")
          ? interpolateWorkflowVariables(template, upstreamVars, inputs.inputText)
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
        const rawBasePrompt =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        const basePrompt = interpolateWorkflowVariables(rawBasePrompt, upstreamVars, inputs.inputText);
        const answerFields = resolveNodeAnswerFields(node);
        const structuredInstruction = buildAnswerFieldsInstruction(answerFields);
        const joinedPrompt =
          basePrompt && inputs.inputText && !rawBasePrompt.includes("{{")
            ? `${basePrompt}\n\n${inputs.inputText}`
            : basePrompt || inputs.inputText || "Responda de forma objetiva.";
        const fullPrompt = structuredInstruction
          ? `${joinedPrompt}\n\n${structuredInstruction}`
          : joinedPrompt;
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

        const parsedFields =
          answerFields.length > 0 ? parseAndValidateAnswerFields(result.text, answerFields) : null;
        const updated = ctx.deps.store.updateStep(step.step_id, {
          status: "done",
          output: parsedFields ? parsedFields.formattedJson : result.text,
          outputTipo: "text",
          artefatos: [],
          ...(parsedFields ? { structuredOutput: parsedFields.data } : {}),
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "agente") {
        const agenteId =
          node.agenteId ??
          (typeof cfg.agenteId === "string" ? cfg.agenteId : undefined) ??
          "estrategista";

        const rawPromptBase =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        const promptBase = interpolateWorkflowVariables(rawPromptBase, upstreamVars, inputs.inputText);
        const answerFields = resolveNodeAnswerFields(node);
        const structuredInstruction = buildAnswerFieldsInstruction(answerFields);
        const joinedAgentPrompt =
          promptBase && inputs.inputText && !rawPromptBase.includes("{{")
            ? `${promptBase}\n\n[Entrada do workflow]\n${inputs.inputText}`
            : promptBase || inputs.inputText || `Executar etapa '${node.titulo}'`;
        const combinedPrompt = structuredInstruction
          ? `${joinedAgentPrompt}\n\n${structuredInstruction}`
          : joinedAgentPrompt;

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

        const parsedFields =
          answerFields.length > 0
            ? parseAndValidateAnswerFields(runnerRes.finalText, answerFields)
            : null;
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
          output: parsedFields ? parsedFields.formattedJson : runnerRes.finalText,
          outputTipo: relArtifacts.length > 0 ? "file" : "text",
          artefatos: relArtifacts,
          ...(parsedFields ? { structuredOutput: parsedFields.data } : {}),
        });
        if (updated) ctx.emitStepUpdated(updated);
      } else if (kind === "gerar_imagem" || kind === "render_video") {
        const rawPromptBase =
          node.prompt ??
          (typeof cfg.prompt === "string" ? cfg.prompt : undefined) ??
          "";
        const promptBase = interpolateWorkflowVariables(rawPromptBase, upstreamVars, inputs.inputText);
        const defaultFallback =
          kind === "gerar_imagem"
            ? "Arte visual profissional em estética limpa"
            : "Vídeo Reels profissional";
        const promptFinal =
          promptBase && inputs.inputText && !rawPromptBase.includes("{{")
            ? `${promptBase}\n\n${inputs.inputText}`
            : promptBase || inputs.inputText || defaultFallback;

        await executeBatchMediaNode(ctx, {
          kind,
          step,
          node,
          cfg,
          inputs,
          promptFinal,
          signal,
        });
      } else if (kind === "condition") {
        const conditionMode =
          node.conditionMode ??
          (cfg.conditionMode === "deterministic" ? "deterministic" : "ai");
        const deterministicRule =
          node.deterministicRule ??
          (cfg.deterministicRule as WorkflowDeterministicRule | undefined);

        if (conditionMode === "deterministic" && deterministicRule) {
          const branch = evaluateDeterministicCondition(
            deterministicRule,
            upstreamVars,
            inputs.inputText
          );
          const updated = ctx.deps.store.updateStep(step.step_id, {
            status: "done",
            output: inputs.inputText,
            outputTipo: "text",
            artefatos: [],
            branch,
          });
          if (updated) ctx.emitStepUpdated(updated);
          return false;
        }

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
