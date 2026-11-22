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
import { sanitizeProviderError, type FetchLike } from "../../engine/providers/provider-interface.ts";
import { metaPublishTool } from "../../engine/tools/meta-publish.ts";
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
import type { WorkflowEngineRuntimeContext } from "./workflow-engine-types.ts";

export async function executeWorkflowOutputNode(
  ctx: WorkflowEngineRuntimeContext,
  params: {
    step: WorkflowStepRecord;
    node: WorkflowNo;
    cfg: Record<string, unknown>;
    graph: { nos: WorkflowNo[]; arestas: WorkflowAresta[] };
    inputs: WorkflowBuiltInputs;
    stepsByNode: Map<string, WorkflowStepRecord>;
    loops: Set<string>;
  }
): Promise<void> {
  const { step, node, cfg, graph, inputs, stepsByNode, loops } = params;
        const target: WorkflowOutputTarget =
          node.target ??
          (typeof cfg.target === "string" ? (cfg.target as WorkflowOutputTarget) : undefined) ??
          "notificacao";
        const targetRef =
          node.targetRef ??
          (typeof cfg.targetRef === "string" ? cfg.targetRef : undefined) ??
          "";

        const mediaPaths = inputs.mediaInputs.map((m) => m.path);
        const delivery = ctx.deps.store.upsertDelivery({
          stepId: step.step_id,
          destino: target,
          destinoRef: targetRef || "default",
          texto: inputs.inputText,
          anexos: mediaPaths,
        });

        // Trava obrigatória antes de claim/envio para Meta API (D-04)
        if (target === "instagram") {
          const approvedUpstream = hasUpstreamApprovedStep(
            node.id,
            graph.arestas,
            stepsByNode,
            loops,
            graph.nos
          );
          if (!approvedUpstream) {
            const blockMsg =
              "BLOQUEIO DE SEGURANÇA: Nó output(instagram) exige uma etapa approval aprovada a montante antes da publicação oficial.";
            ctx.deps.store.markDeliveryResult(delivery.step_id, "failed", blockMsg);
            throw new Error(blockMsg);
          }
        }

        const claimed = ctx.deps.store.claimDeliveryForSending(delivery.step_id);
        if (!claimed) {
          throw new Error("Entrega desta etapa já está em processamento ou foi enviada.");
        }

        try {
          let resultSummary = "";

          if (target === "canal") {
            const canalId = targetRef || "canal-geral";
            const msgId = `msg_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
            const nowIso = new Date().toISOString();
            const textoFinal = inputs.inputText || "(workflow concluído)";
            const wfVisual = ctx.deps.store.getWorkflowVisual(step.workflow_id);
            const authorName = wfVisual?.nome || "Workflow";

            ctx.deps.db.connection
              .prepare(
                `
                INSERT INTO projecao_conversas_chat (
                  mensagem_id, canal_id, agente_id, autor, autor_nome,
                  conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em
                ) VALUES (?, ?, NULL, 'agente', ?, ?, ?, '[]', NULL, 0, ?);
              `
              )
              .run(
                msgId,
                canalId,
                authorName,
                textoFinal,
                JSON.stringify(mediaPaths),
                nowIso
              );

            ctx.deps.wsHub.broadcast("chat:message", {
              canal_id: canalId,
              agente_id: null,
              mensagem: {
                mensagem_id: msgId,
                canal_id: canalId,
                agente_id: null,
                autor: "agente",
                autor_nome: authorName,
                conteudo_markdown: textoFinal,
                anexos: [],
                steps: [],
                tarefa_id: null,
                lida: false,
                criado_em: nowIso,
              },
            });
            resultSummary = `Mensagem entregue no canal '${canalId}'.`;
          } else if (target === "whatsapp") {
            const waAdapter = ctx.getWhatsAppAdapter();
            if (!waAdapter || waAdapter.getStatus().status !== "conectado") {
              throw new Error("WhatsApp desconectado para entrega do workflow.");
            }
            if (!targetRef) {
              throw new Error("Destino WhatsApp (targetRef JID/número) não configurado.");
            }
            const firstImage = inputs.mediaInputs.find((m) => m.portType === "image");
            if (firstImage) {
              const absImg = ctx.resolveWithinRoot(firstImage.path);
              await waAdapter.sendMessage(targetRef, {
                image: readFileSync(absImg),
                caption: inputs.inputText || undefined,
              });
            } else {
              await waAdapter.sendMessage(targetRef, {
                text: inputs.inputText || "(workflow concluído)",
              });
            }
            resultSummary = `Enviado no WhatsApp para '${targetRef}'.`;
          } else if (target === "telegram") {
            if (!ctx.deps.telegramBot) {
              throw new Error("Bot Telegram indisponível para entrega do workflow.");
            }
            const res = await ctx.deps.telegramBot.sendWorkflowMessage({
              text: inputs.inputText || "(workflow concluído)",
              chatId: targetRef || undefined,
            });
            resultSummary = `Enviado no Telegram (message_id=${res.message_id}).`;
          } else if (target === "arquivo") {
            const { absPath, relPath } = ctx.resolveSafeOutputFile(
              targetRef || `workflow-${step.workflow_id}-${step.node_id}.txt`
            );
            const firstMedia = inputs.mediaInputs[0];
            if (firstMedia && !inputs.inputText) {
              const srcAbs = ctx.resolveWithinRoot(firstMedia.path);
              copyFileSync(srcAbs, absPath);
            } else {
              writeFileSync(absPath, inputs.inputText || "", "utf8");
            }
            const sizeBytes = existsSync(absPath) ? readFileSync(absPath).length : 0;
            const arquivoId = `out-wf-${randomUUID().slice(0, 8)}`;
            const ext = extname(absPath).toLowerCase();
            const mimeType =
              ext === ".png"
                ? "image/png"
                : ext === ".jpg" || ext === ".jpeg"
                  ? "image/jpeg"
                  : ext === ".mp4"
                    ? "video/mp4"
                    : "text/plain; charset=utf-8";

            ctx.deps.db.connection
              .prepare(
                `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
                 VALUES (?, ?, ?, ?, ?, 'documento', NULL, NULL, ?);`
              )
              .run(arquivoId, basename(absPath), relPath, mimeType, sizeBytes, new Date().toISOString());

            resultSummary = `Arquivo salvo em ${relPath}`;
          } else if (target === "instagram") {
            const mediaUrls =
              Array.isArray(cfg.mediaUrls) && cfg.mediaUrls.length > 0
                ? cfg.mediaUrls.filter((u): u is string => typeof u === "string")
                : mediaPaths;
            const mediaType =
              cfg.mediaType === "REELS" || cfg.mediaType === "STORIES" || cfg.mediaType === "CAROUSEL"
                ? cfg.mediaType
                : mediaPaths.some((p) => /\.mp4$/i.test(p))
                  ? "REELS"
                  : "IMAGE";

            const pub = await metaPublishTool(
              {
                media_type: mediaType,
                media_urls: mediaUrls,
                caption: inputs.inputText || "",
                approved_by_human: true,
              },
              { vault: ctx.deps.vault, fetchImpl: ctx.deps.fetchImpl }
            );
            resultSummary = `Publicado no Instagram (${pub.media_id}): ${pub.permalink}`;
          } else {
            ctx.deps.wsHub.broadcast("workflow:status", {
              workflow_id: step.workflow_id,
              status: "concluido",
              no_atual: node.id,
              resumo: (inputs.inputText || "Etapa de notificação concluída.").slice(0, 300),
            });
            resultSummary = inputs.inputText || "Notificação emitida no Cockpit.";
          }

          ctx.deps.store.markDeliveryResult(delivery.step_id, "sent", null);
          const updated = ctx.deps.store.updateStep(step.step_id, {
            status: "done",
            output: resultSummary,
            outputTipo: "text",
            artefatos: mediaPaths,
          });
          if (updated) ctx.emitStepUpdated(updated);
        } catch (deliveryErr) {
          const msg = sanitizeProviderError(
            deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr),
            ctx.getSecretsListForRedaction()
          );
          ctx.deps.store.markDeliveryResult(delivery.step_id, "failed", msg);
          throw new Error(msg);
        }
}
