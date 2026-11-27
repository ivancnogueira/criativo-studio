import { randomUUID } from "node:crypto";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  type WhatsAppArchiveService,
  type WhatsAppSessionManager,
} from "@criativo/whatsapp";
import type { CriativoDatabase } from "../database/client.ts";
import type { QueueControlsService } from "../queue/queue-controls-service.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import { formatMarkdownForWhatsApp } from "../whatsapp/whatsapp-formatter.ts";
import type { BackgroundJobSnapshot } from "./background-job-service.ts";

interface ScheduledAgentRow {
  agente_id: string;
  nome: string;
  papel: string;
  modelo_padrao: string;
  config_json: string;
  backup_models_json?: string | null;
}

function formatDurationHuman(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

export function buildBackgroundJobWakePrompt(job: BackgroundJobSnapshot): string {
  const statusLabel =
    job.status === "concluido"
      ? "CONCLUÍDO"
      : job.status === "timeout"
        ? "TIMEOUT"
        : "FALHOU";
  const lines: string[] = [
    `[BACKGROUND JOB ${statusLabel} — ID: ${job.jobId}]`,
    `Tarefa: ${job.label}`,
    `Tipo: ${job.kind} | Duração: ${formatDurationHuman(job.duracaoMs)}${
      job.exitCode !== null ? ` | Código de saída: ${job.exitCode}` : ""
    }`,
  ];
  if (job.logPath) {
    lines.push(`Log completo: ${job.logPath}`);
  }
  if (job.erro) {
    lines.push(`Erro: ${job.erro.slice(-1000)}`);
  }
  if (job.resultSummary) {
    lines.push(`Resultado estruturado:\n${job.resultSummary.slice(0, 2000)}`);
  } else {
    const outTail = job.stdoutTail.trim().slice(-1500);
    const errTail = job.stderrTail.trim().slice(-1000);
    if (outTail) {
      lines.push(`Últimas linhas de stdout:\n\`\`\`\n${outTail}\n\`\`\``);
    }
    if (errTail) {
      lines.push(`Últimas linhas de stderr:\n\`\`\`\n${errTail}\n\`\`\``);
    }
  }
  lines.push(
    `Próximo passo instruído: ${job.onCompleteInstruction}`,
    "(Execute agora a continuação ou apresente o resultado final ao usuário.)",
  );
  return lines.join("\n\n");
}

/**
 * Executa o despertar reativo de um agente quando um BackgroundJob finaliza.
 * Aguarda brevemente se a lane do agente ainda estiver encerrando o turno que disparou o job.
 */
export async function handleBackgroundJobCompletionWakeup(params: {
  job: BackgroundJobSnapshot;
  db: CriativoDatabase;
  wsHub: WebSocketHub;
  queueControls: QueueControlsService;
  whatsappManager: WhatsAppSessionManager;
  whatsappArchiveService: WhatsAppArchiveService;
  executeTurn: (args: {
    agente: ScheduledAgentRow;
    userPrompt: string;
    threadId: string;
    turnoId: string;
    channelOrigin: "web" | "whatsapp";
    whatsappContaId: string | null;
    whatsappChatJid: string | null;
    extraMetadados: Record<string, unknown>;
  }) => Promise<{ agentMsg: { conteudo_markdown?: string | null } }>;
}): Promise<void> {
  const { job, db, wsHub, queueControls, whatsappManager, whatsappArchiveService, executeTurn } =
    params;
  if (!job.notifyOnComplete || job.status === "cancelado") return;

  const agente = db.connection
    .prepare(
      `SELECT agente_id, nome, papel, modelo_padrao, config_json, backup_models_json
       FROM projecao_agentes
       WHERE agente_id = ?
       LIMIT 1;`,
    )
    .get(job.agenteId) as ScheduledAgentRow | undefined;
  if (!agente) return;

  const normalizedThread =
    job.threadId && !job.threadId.startsWith("main:") ? job.threadId : null;
  const maxWaitMs = 45_000;
  const startedWait = Date.now();
  while (
    queueControls.hasActiveTurn(job.agenteId, normalizedThread) &&
    Date.now() - startedWait < maxWaitMs
  ) {
    await new Promise((r) => setTimeout(r, 1500));
  }

  const bgPrompt = buildBackgroundJobWakePrompt(job);
  const { agentMsg } = await executeTurn({
    agente,
    userPrompt: bgPrompt,
    threadId: job.threadId,
    turnoId: `bg-${randomUUID().slice(0, 8)}`,
    channelOrigin: job.channelOrigin,
    whatsappContaId: job.whatsappContaId,
    whatsappChatJid: job.whatsappChatJid,
    extraMetadados: {
      origem: "background_job",
      job_id: job.jobId,
      status: job.status,
    },
  });

  const replyText = agentMsg.conteudo_markdown?.trim();
  if (job.channelOrigin === "whatsapp" && job.whatsappChatJid && replyText) {
    const targetContaId = job.whatsappContaId || DEFAULT_WHATSAPP_ACCOUNT_ID;
    const client = whatsappManager.getClient(targetContaId);
    if (client) {
      const chunks = formatMarkdownForWhatsApp(replyText, {
        maxChunkLength: 1600,
        maxChunks: 4,
      });
      for (const chunk of chunks) {
        try {
          const sent = await client.sendMessage(job.whatsappChatJid, { text: chunk });
          const recorded = whatsappArchiveService.recordMessage({
            mensagemId: sent.messageId,
            contaId: targetContaId,
            chatJid: job.whatsappChatJid,
            remetenteJid: job.whatsappChatJid,
            remetenteNome: agente.nome,
            direcao: "saida",
            tipoConteudo: "texto",
            texto: chunk,
            ehGrupo: job.whatsappChatJid.endsWith("@g.us"),
            ackStatus: sent.ackStatus === "ack" ? "entregue" : "enviado",
            metadados: { agente_id: agente.agente_id, job_id: job.jobId },
          });
          wsHub.broadcast("whatsapp.mensagem_recebida", {
            conta_id: targetContaId,
            mensagem: recorded,
          });
        } catch {
          // Falha isolada de WhatsApp não derruba callback do background job
        }
      }
    }
  }
}
