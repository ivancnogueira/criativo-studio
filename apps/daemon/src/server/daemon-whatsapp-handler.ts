import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import type { AnexoChat, StatusTarefa, TarefaRegistro } from "@criativo/contracts";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  WhatsAppArchiveService,
  WhatsAppMediaService,
  WhatsAppOrchestrator,
  WhatsAppSenderRules,
  WhatsAppSessionManager,
  type AuthorizedWhatsAppMessageEvent,
  type WhatsAppApprovalNotifier,
  type SocketFactory,
} from "@criativo/whatsapp";
import { formatMarkdownForWhatsApp } from "../whatsapp/whatsapp-formatter.ts";
import { executeAgentConversationTurn, tryHandleStudioRoute } from "./studio-routes.ts";
import { resolveAgentRecord } from "./agent-resolver.ts";
import type { DaemonInfraServices } from "./daemon-infra-services.ts";
import type { DaemonRuntimeServices } from "./daemon-runtime-services.ts";

export function createWhatsAppAuthorizedTurnHandler(
  infra: DaemonInfraServices,
  rt: DaemonRuntimeServices
): (event: AuthorizedWhatsAppMessageEvent) => Promise<boolean> {
  const {
    resolvedWorkspaceRoot,
    db,
    wsHub,
    whatsappArchiveService,
    sharedTables,
    memoryManager,
    skillLearning,
    historySearch,
    libraryFolders,
    handoffBus,
    visualPreview,
    uiBlockRegistry,
    apiKeysBridge,
    phase13Bundle,
  } = infra;
  const { memoryReview, phase14Services, baseStudioDepsForLanes } = rt;

  return async (event) => {
    const rawPrompt = event.text?.trim() ?? "";
    const hasMediaAttachment = Boolean(event.media && event.media.diskPath);
    if (!rawPrompt && !hasMediaAttachment) {
      return false;
    }

    const accountRow = db.connection
      .prepare(`SELECT agente_orquestrador_id FROM whatsapp_contas WHERE conta_id = ? LIMIT 1;`)
      .get(event.contaId) as { agente_orquestrador_id?: string | null } | undefined;

    const allAgents = db.connection
      .prepare(`SELECT agente_id, nome, papel, modelo_padrao, config_json FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
      .all() as Array<{
      agente_id: string;
      nome: string;
      papel: string;
      modelo_padrao: string;
      config_json: string;
    }>;

    const mentionMatch = rawPrompt.match(/@([a-z0-9_-]+)/i);
    const mentionedAgent = mentionMatch
      ? resolveAgentRecord(allAgents, mentionMatch[1]) ?? undefined
      : undefined;
    const defaultAgentId = accountRow?.agente_orquestrador_id || "estrategista";
    const agente =
      mentionedAgent ??
      allAgents.find((a) => a.agente_id === defaultAgentId) ??
      allAgents[0];

    if (!agente) {
      return false;
    }

    const incomingAnexos: AnexoChat[] =
      event.media && event.media.caminhoRelativo
        ? [
            {
              arquivo_id: event.media.arquivoId,
              nome: event.media.nomeOriginal,
              caminho_relativo: event.media.caminhoRelativo,
              url: `/api/arquivos/raw?path=${encodeURIComponent(event.media.caminhoRelativo)}`,
              mime_type: event.media.mimeType,
              tamanho_bytes: event.media.tamanhoBytes,
              tipo_uso: "anexo",
            },
          ]
        : [];

    const turnoId = `wpp-${randomUUID().slice(0, 8)}`;
    const mainThreadId = `main:${agente.agente_id}`;
    const canalId = `agente:${agente.agente_id}`;
    const whatsappUserText = rawPrompt || "📎 Mídia enviada pelo WhatsApp";
    const whatsappMeta = {
      origem: "whatsapp",
      chat_jid: event.msg.remoteJid,
      conta_id: event.contaId,
      self_chat: Boolean(event.msg.fromMe),
    };

    const maxOrdRow = db.connection
      .prepare("SELECT COALESCE(MAX(ordinal), 0) AS max_ord FROM projecao_conversas_chat WHERE thread_id = ?;")
      .get(mainThreadId) as { max_ord: number } | undefined;
    const userOrdinal = (maxOrdRow?.max_ord ?? 0) + 1;
    const incomingMsgId = `msg-${randomUUID()}`;
    const incomingCreatedAt = new Date().toISOString();

    db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (
          mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
          anexos_json, steps_json, tarefa_id, lida, criado_em,
          thread_id, turno_id, item_type, status, resposta_para_mensagem_id,
          ordinal, branch_origem_mensagem_id, metadados_json
        ) VALUES (?, ?, ?, 'usuario', ?, ?, ?, '[]', NULL, 1, ?, ?, ?, 'mensagem', 'completed', NULL, ?, NULL, ?);`,
      )
      .run(
        incomingMsgId,
        canalId,
        agente.agente_id,
        event.msg.pushName?.trim() || "Você",
        whatsappUserText,
        JSON.stringify(incomingAnexos),
        incomingCreatedAt,
        mainThreadId,
        turnoId,
        userOrdinal,
        JSON.stringify(whatsappMeta),
      );

    wsHub.broadcast("chat:message", {
      canal_id: canalId,
      agente_id: agente.agente_id,
      mensagem: {
        mensagem_id: incomingMsgId,
        canal_id: canalId,
        agente_id: agente.agente_id,
        autor: "usuario",
        autor_nome: event.msg.pushName?.trim() || "Você",
        conteudo_markdown: whatsappUserText,
        anexos: incomingAnexos,
        steps: [],
        tarefa_id: null,
        thread_id: mainThreadId,
        turno_id: turnoId,
        item_type: "mensagem",
        status: "completed",
        ordinal: userOrdinal,
        metadados: whatsappMeta,
        lida: true,
        criado_em: incomingCreatedAt,
      },
    });

    try {
      const { agentMsg } = await executeAgentConversationTurn({
        deps: {
          ...baseStudioDepsForLanes,
          phase13: phase13Bundle,
          sharedTables,
          memoryManager,
          memoryReview,
          skillLearning,
          historySearch,
          libraryFolders,
          handoffBus,
          visualPreview,
          uiBlockRegistry,
          apiKeysBridge,
          phase14: phase14Services,
        },
        agente,
        userPrompt: rawPrompt || "Analise este arquivo enviado pelo WhatsApp.",
        anexos: incomingAnexos,
        turnoId,
        originalUserPrompt: rawPrompt,
        respostaParaMensagemId: incomingMsgId,
        channelOrigin: "whatsapp",
        whatsappContaId: event.contaId,
        whatsappChatJid: event.msg.remoteJid,
        extraMetadados: whatsappMeta,
      });

      const replyText = agentMsg.conteudo_markdown?.trim();
      if (replyText) {
        const chunks = formatMarkdownForWhatsApp(replyText, { maxChunkLength: 1600, maxChunks: 4 });
        for (const chunk of chunks) {
          const sent = await event.client.sendMessage(event.msg.remoteJid, {
            text: chunk,
          });
          const recordedReply = whatsappArchiveService.recordMessage({
            mensagemId: sent.messageId,
            contaId: event.contaId,
            chatJid: event.msg.remoteJid,
            remetenteJid: event.msg.remoteJid,
            remetenteNome: agente.nome,
            direcao: "saida",
            tipoConteudo: "texto",
            texto: chunk,
            ehGrupo: Boolean(event.msg.isGroup),
            ackStatus: sent.ackStatus === "ack" ? "entregue" : "enviado",
            metadados: { agente_id: agente.agente_id, self_chat: true },
          });
          wsHub.broadcast("whatsapp.mensagem_recebida", {
            conta_id: event.contaId,
            mensagem: recordedReply,
          });
        }
      }

      for (const anexo of agentMsg.anexos ?? []) {
        const absImg = resolve(resolvedWorkspaceRoot, anexo.caminho_relativo);
        if (anexo.mime_type?.startsWith("image/") && existsSync(absImg)) {
          await event.client.sendMessage(event.msg.remoteJid, {
            image: readFileSync(absImg),
            caption: `${agente.nome} · ${anexo.nome}`.slice(0, 500),
          });
        }
      }
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      try {
        await event.client.sendMessage(event.msg.remoteJid, {
          text: `Não consegui processar sua solicitação agora (${errMsg.slice(0, 180)}). Verifique a conexão do provedor de IA no Criativo Studio.`,
        });
      } catch {
        // Ignora falha secundária de envio caso o socket esteja desconectado
      }
      return true;
    }
  };
}
