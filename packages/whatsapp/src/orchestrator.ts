import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  StatusTarefa,
  TarefaRegistro,
  WhatsAppMensagemRegistro,
  WhatsAppModoOperacao,
  WhatsAppPairingRequest,
} from "@criativo/contracts";
import { WhatsAppApprovalNotifier, type ApprovalPreviewPayload } from "./approval-notifier.ts";
import type { WhatsAppStudioClient } from "./client.ts";
import {
  type DownloadedWhatsAppMedia,
  type WhatsAppArchiveService,
  type WhatsAppMediaService,
} from "./media-archive.ts";
import { detectCreativeIntent, type EnqueueWhatsAppTaskInput } from "./message-handler.ts";
import type { WhatsAppSenderRules } from "./sender-rules.ts";
import type { WhatsAppSessionManager } from "./session-manager.ts";
import type {
  IncomingWhatsAppMessage,
  OutgoingWhatsAppPayload,
  SqliteConnectionLike,
} from "./types.ts";

export const WHATSAPP_MAX_POST_CHARS = 8_000;

export interface AuthorizedWhatsAppMessageEvent {
  contaId: string;
  msg: IncomingWhatsAppMessage;
  text: string;
  resolvedPhone: string | null;
  media: DownloadedWhatsAppMedia | null;
  recorded: WhatsAppMensagemRegistro;
  client: WhatsAppStudioClient;
}

export interface WhatsAppOrchestratorDependencies {
  db: SqliteConnectionLike;
  sessionManager: WhatsAppSessionManager;
  senderRules: WhatsAppSenderRules;
  mediaService: WhatsAppMediaService;
  archiveService: WhatsAppArchiveService;
  enqueueTask?: (input: EnqueueWhatsAppTaskInput) => TarefaRegistro;
  updateTaskStatus?: (
    tarefaId: string,
    status: StatusTarefa,
    result?: Record<string, unknown> | null,
    errorDetails?: string | null
  ) => TarefaRegistro;
  onApproveAndPublish?: (tarefaId: string) => Promise<{ permalink?: string }>;
  onRequestAdjustment?: (tarefaId: string, feedback: string) => Promise<void>;
  transcribeAudio?: (audioBuffer: Buffer, mimeType: string) => Promise<string>;
  onAuthorizedMessage?: (
    event: AuthorizedWhatsAppMessageEvent
  ) => Promise<boolean | void> | boolean | void;
  onPairingRequested?: (contaId: string, request: WhatsAppPairingRequest) => void;
  onMessageRecorded?: (contaId: string, registro: WhatsAppMensagemRegistro) => void;
  autoStartListening?: boolean;
}

export interface OrchestratorProcessResult {
  decision: "allow" | "ignore" | "pairing_pending" | "pairing_challenge";
  handledAsApproval?: boolean;
  handledByHook?: boolean;
  tarefa?: TarefaRegistro | null;
  request?: WhatsAppPairingRequest;
  recorded?: WhatsAppMensagemRegistro;
  media?: DownloadedWhatsAppMedia | null;
}

export interface ChannelMemoryEntry {
  memoria_id: string;
  conta_id: string;
  chat_jid: string | null;
  agente_id: string;
  texto: string;
  origem: "automatica" | "manual";
  criado_em: string;
}

interface AccountRoutingRow {
  modo_operacao: string;
  codigo_autorizacao_obrigatorio: number;
  grupo_auto_responder: number;
  jid_proprio: string | null;
  numero_telefone: string | null;
  agente_orquestrador_id: string | null;
}

function buildMemoryScopePrefix(contaId: string, chatJid?: string | null): string {
  return chatJid ? `[whatsapp:${contaId}|${chatJid}] ` : `[whatsapp:${contaId}] `;
}

function parseMemoryScopePrefix(rawText: string): {
  contaId: string | null;
  chatJid: string | null;
  cleanText: string;
} {
  const match = /^\[whatsapp:([^|\]]+)(?:\|([^\]]+))?\]\s*/u.exec(rawText);
  if (!match) {
    return { contaId: null, chatJid: null, cleanText: rawText };
  }
  return {
    contaId: match[1] ?? null,
    chatJid: match[2] ?? null,
    cleanText: rawText.slice(match[0].length),
  };
}

/**
 * Orquestrador conversacional multi-número do WhatsApp:
 * une sessão (`WhatsAppSessionManager`), segurança (`WhatsAppSenderRules`),
 * download/envio real de mídia (`WhatsAppMediaService`), arquivo 90 dias (`WhatsAppArchiveService`),
 * respostas numéricas de aprovação (1/2) e memórias operacionais do canal.
 */
export class WhatsAppOrchestrator {
  private readonly deps: WhatsAppOrchestratorDependencies;
  private readonly notifiersByAccount = new Map<string, WhatsAppApprovalNotifier>();
  private unsubscribeSessionMessages: (() => void) | null = null;

  constructor(deps: WhatsAppOrchestratorDependencies) {
    this.deps = deps;
    if (deps.autoStartListening !== false) {
      this.start();
    }
  }

  public start(): void {
    if (this.unsubscribeSessionMessages) {
      return;
    }
    this.unsubscribeSessionMessages = this.deps.sessionManager.onMessage(
      async (contaId, msg, client) => {
        await this.handleIncomingMessage(contaId, msg, client);
      }
    );
  }

  public stop(): void {
    this.unsubscribeSessionMessages?.();
    this.unsubscribeSessionMessages = null;
  }

  public getApprovalNotifier(contaId: string): WhatsAppApprovalNotifier {
    const existing = this.notifiersByAccount.get(contaId);
    if (existing) {
      return existing;
    }

    const client = this.deps.sessionManager.getOrCreateClient(contaId);
    const notifier = new WhatsAppApprovalNotifier({
      client,
      updateTaskStatus:
        this.deps.updateTaskStatus ??
        ((id, status, result, err) => ({
          tarefa_id: id,
          agente_id: "estrategista",
          canal_origem: "whatsapp",
          tipo: "post_individual",
          titulo: "Tarefa WhatsApp",
          prioridade: 3,
          status,
          payload: {},
          resultado: result ?? null,
          erro_detalhes: err ?? null,
          tentativas: 0,
          criado_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
          concluido_em: null,
        })),
      onApproveAndPublish: this.deps.onApproveAndPublish ?? (async () => ({})),
      onRequestAdjustment: this.deps.onRequestAdjustment,
    });

    this.notifiersByAccount.set(contaId, notifier);
    return notifier;
  }

  public async notifyReadyForApproval(
    contaId: string,
    payload: ApprovalPreviewPayload
  ): Promise<void> {
    const notifier = this.getApprovalNotifier(contaId);
    await notifier.notifyReadyForApproval(payload);
  }

  private readAccountConfig(contaId: string): {
    modoOperacao: WhatsAppModoOperacao;
    codigoAutorizacaoObrigatorio: boolean;
    grupoAutoResponder: boolean;
    jidProprio: string | null;
    numeroTelefone: string | null;
    agenteOrquestradorId: string | null;
  } {
    const row = this.deps.db
      .prepare(
        `
        SELECT
          modo_operacao,
          codigo_autorizacao_obrigatorio,
          grupo_auto_responder,
          jid_proprio,
          numero_telefone,
          agente_orquestrador_id
        FROM whatsapp_contas
        WHERE conta_id = ?
        LIMIT 1;
      `
      )
      .get(contaId) as AccountRoutingRow | undefined;

    return {
      modoOperacao: row?.modo_operacao === "ownNumber" ? "ownNumber" : "dedicated",
      codigoAutorizacaoObrigatorio: row ? row.codigo_autorizacao_obrigatorio !== 0 : true,
      grupoAutoResponder: row ? row.grupo_auto_responder === 1 : false,
      jidProprio: row?.jid_proprio ?? null,
      numeroTelefone: row?.numero_telefone ?? null,
      agenteOrquestradorId: row?.agente_orquestrador_id ?? "estrategista",
    };
  }

  public async handleIncomingMessage(
    contaId: string,
    msg: IncomingWhatsAppMessage,
    clientArg?: WhatsAppStudioClient
  ): Promise<OrchestratorProcessResult> {
    const client = clientArg ?? this.deps.sessionManager.getOrCreateClient(contaId);
    const socket = client.getSocket();
    const accountCfg = this.readAccountConfig(contaId);

    const ownJid =
      socket?.user?.id ??
      accountCfg.jidProprio ??
      (accountCfg.numeroTelefone ? `${accountCfg.numeroTelefone}@s.whatsapp.net` : null);
    const ownLid = client.getOwnLid?.() ?? socket?.user?.lid ?? null;

    const evaluation = await this.deps.senderRules.evaluateIncoming({
      contaId,
      modoOperacao: accountCfg.modoOperacao,
      codigoAutorizacaoObrigatorio: accountCfg.codigoAutorizacaoObrigatorio,
      grupoAutoResponder: accountCfg.grupoAutoResponder,
      ownJid,
      ownLid,
      msg,
      socket,
      resolveLid: (lid) => client.resolveLidToPn(lid),
    });

    if (evaluation.decision === "ignore") {
      return { decision: "ignore" };
    }

    if (evaluation.decision === "pairing_pending") {
      return { decision: "pairing_pending", request: evaluation.request };
    }

    if (evaluation.decision === "pairing_challenge") {
      try {
        await client.sendMessage(msg.remoteJid, { text: evaluation.challengeMessage });
      } catch {
        // Mesmo se envio falhar temporariamente, mantém solicitação pendente e notifica UI
      }
      this.deps.onPairingRequested?.(contaId, evaluation.request);
      return {
        decision: "pairing_challenge",
        request: evaluation.request,
      };
    }

    // Remetente autorizado: baixa mídia (se houver), transcreve áudio e arquiva histórico
    let media: DownloadedWhatsAppMedia | null = null;
    let mediaError: string | null = null;

    if (msg.mediaType || msg.audioBuffer) {
      try {
        media = await this.deps.mediaService.downloadIncomingMedia(socket, msg, contaId);
      } catch (err) {
        mediaError = err instanceof Error ? err.message : String(err);
      }
    }

    let commandText = msg.text?.trim() ?? "";

    if (!commandText && (msg.mediaType === "audio" || msg.audioBuffer)) {
      let audioBuffer = msg.audioBuffer ?? null;
      if (!audioBuffer && media?.diskPath) {
        try {
          audioBuffer = readFileSync(media.diskPath);
        } catch {
          audioBuffer = null;
        }
      }

      if (audioBuffer) {
        if (this.deps.transcribeAudio) {
          commandText = (
            await this.deps.transcribeAudio(
              audioBuffer,
              media?.mimeType ?? msg.audioMimeType ?? msg.mediaMimeType ?? "audio/ogg; codecs=opus"
            )
          ).trim();
        } else {
          try {
            await client.sendMessage(msg.remoteJid, {
              text: "Recebi seu áudio, mas o serviço de transcrição não está configurado no Cofre.",
            });
          } catch {
            // Ignora falha de resposta se offline
          }
        }
      }
    }

    const tipoConteudo =
      media?.tipoConteudo ?? msg.mediaType ?? (msg.audioBuffer ? "audio" : "texto");

    const recorded = this.deps.archiveService.recordMessage({
      mensagemId: msg.messageId,
      contaId,
      chatJid: msg.remoteJid,
      remetenteJid: msg.isGroup ? msg.participant ?? msg.remoteJid : msg.remoteJid,
      remetenteNome: msg.pushName ?? evaluation.resolvedPhone ?? null,
      direcao: "entrada",
      tipoConteudo,
      texto: commandText || msg.text || media?.nomeOriginal || null,
      midiaCaminho: media?.caminhoRelativo ?? null,
      midiaMime: media?.mimeType ?? msg.mediaMimeType ?? null,
      midiaTamanhoBytes: media?.tamanhoBytes ?? msg.mediaFileSize ?? 0,
      ehGrupo: Boolean(msg.isGroup),
      ackStatus: "recebido",
      metadados: {
        resolvedPhone: evaluation.resolvedPhone,
        reason: evaluation.reason,
        arquivoId: media?.arquivoId ?? null,
        ...(mediaError ? { mediaError } : {}),
      },
      ocorridoEm: msg.timestampMs ? new Date(msg.timestampMs).toISOString() : undefined,
    });

    this.deps.onMessageRecorded?.(contaId, recorded);

    if (commandText) {
      const handledAsApproval = await this.getApprovalNotifier(contaId).handleReply(
        msg.remoteJid,
        commandText
      );
      if (handledAsApproval) {
        return {
          decision: "allow",
          handledAsApproval: true,
          recorded,
          media,
        };
      }
    }

    if (this.deps.onAuthorizedMessage) {
      const handled = await this.deps.onAuthorizedMessage({
        contaId,
        msg,
        text: commandText,
        resolvedPhone: evaluation.resolvedPhone,
        media,
        recorded,
        client,
      });
      if (handled === true) {
        return {
          decision: "allow",
          handledByHook: true,
          recorded,
          media,
        };
      }
    }

    if (!commandText || !this.deps.enqueueTask) {
      return {
        decision: "allow",
        recorded,
        media,
      };
    }

    const intent = detectCreativeIntent(commandText);
    const tarefa = this.deps.enqueueTask({
      canal_origem: "whatsapp",
      tipo: intent.tipo,
      agente_id: intent.agente_id,
      titulo: intent.titulo,
      prioridade: intent.prioridade,
      payload: {
        prompt: commandText,
        conta_id: contaId,
        remetente_jid: msg.remoteJid,
        remetente_nome: msg.pushName ?? null,
        origem_audio: Boolean(msg.audioBuffer || msg.mediaType === "audio"),
        anexo: media
          ? {
              arquivo_id: media.arquivoId,
              caminho_relativo: media.caminhoRelativo,
              mime_type: media.mimeType,
              tipo_conteudo: media.tipoConteudo,
            }
          : null,
      },
    });

    const confirmationText = `Recebi seu pedido! Os agentes iniciaram a produção (${intent.tipo} • tarefa #${tarefa.tarefa_id.slice(0, 8)}).`;
    await this.sendMessageAndArchive(contaId, msg.remoteJid, {
      text: confirmationText,
      waitAck: false,
    }).catch(() => undefined);

    return {
      decision: "allow",
      tarefa,
      recorded,
      media,
    };
  }

  public async sendMessageAndArchive(
    contaId: string,
    chatJid: string,
    payload: {
      text?: string;
      mediaPath?: string;
      caption?: string;
      asAudioPtt?: boolean;
      waitAck?: boolean;
    }
  ): Promise<WhatsAppMensagemRegistro> {
    const text = payload.text?.trim() ?? "";
    if (text.length > WHATSAPP_MAX_POST_CHARS) {
      throw new Error(
        `Mensagem excede o limite de ${WHATSAPP_MAX_POST_CHARS} caracteres por envio no WhatsApp.`
      );
    }
    if (!text && !payload.mediaPath) {
      throw new Error("Informe um texto ou um caminho de mídia para enviar no WhatsApp.");
    }

    const client = this.deps.sessionManager.getOrCreateClient(contaId);
    const ownJid = client.getStatus().jid_proprio ?? `${contaId}@s.whatsapp.net`;

    let outgoing: OutgoingWhatsAppPayload;
    let tipoConteudo: "texto" | "imagem" | "documento" | "audio" | "video" = "texto";
    let midiaMime: string | null = null;
    let midiaCaminho: string | null = null;

    if (payload.mediaPath) {
      outgoing = this.deps.mediaService.buildOutgoingMediaPayload(
        payload.mediaPath,
        payload.caption ?? (text || undefined),
        { asAudioPtt: payload.asAudioPtt }
      );
      midiaCaminho = payload.mediaPath;
      midiaMime = outgoing.mimetype ?? null;
      if (outgoing.image) tipoConteudo = "imagem";
      else if (outgoing.video) tipoConteudo = "video";
      else if (outgoing.audio) tipoConteudo = "audio";
      else tipoConteudo = "documento";
    } else {
      outgoing = { text };
    }

    const sendRes = await client.sendMessage(chatJid, outgoing, {
      waitAck: payload.waitAck ?? true,
    });

    const recorded = this.deps.archiveService.recordMessage({
      mensagemId: sendRes.messageId,
      contaId,
      chatJid,
      remetenteJid: ownJid,
      remetenteNome: "Estúdio Criativo",
      direcao: "saida",
      tipoConteudo,
      texto: payload.caption ?? (text || null),
      midiaCaminho,
      midiaMime,
      midiaTamanhoBytes: 0,
      ehGrupo: chatJid.endsWith("@g.us"),
      ackStatus: sendRes.ackStatus,
      metadados: {},
    });

    this.deps.onMessageRecorded?.(contaId, recorded);
    return recorded;
  }

  private resolveTargetAgentIdForMemories(contaId: string): string | null {
    const cfg = this.readAccountConfig(contaId);
    const preferredIds = [cfg.agenteOrquestradorId, "estrategista"].filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0
    );

    for (const candidate of preferredIds) {
      const found = this.deps.db
        .prepare(`SELECT agente_id FROM projecao_agentes WHERE agente_id = ? LIMIT 1;`)
        .get(candidate) as { agente_id?: string } | undefined;
      if (found?.agente_id) {
        return found.agente_id;
      }
    }

    const firstAgent = this.deps.db
      .prepare(`SELECT agente_id FROM projecao_agentes ORDER BY ordem_exibicao ASC LIMIT 1;`)
      .get() as { agente_id?: string } | undefined;

    return firstAgent?.agente_id ?? null;
  }

  public rememberChannelMemory(input: {
    contaId: string;
    texto: string;
    chatJid?: string | null;
    origem?: "automatica" | "manual";
  }): ChannelMemoryEntry | null {
    const clean = input.texto.trim();
    if (!clean) return null;

    const scopedText = `${buildMemoryScopePrefix(input.contaId, input.chatJid)}${clean}`;
    const agora = new Date().toISOString();
    const origem = input.origem ?? "manual";
    const agenteId = this.resolveTargetAgentIdForMemories(input.contaId);

    if (agenteId) {
      const memoriaId = randomUUID();
      this.deps.db
        .prepare(
          `
          INSERT INTO projecao_agente_memorias (memoria_id, agente_id, texto, origem, criado_em)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(agente_id, texto) DO NOTHING;
        `
        )
        .run(memoriaId, agenteId, scopedText, origem, agora);

      const saved = this.deps.db
        .prepare(
          `
          SELECT memoria_id, agente_id, texto, origem, criado_em
          FROM projecao_agente_memorias
          WHERE agente_id = ? AND texto = ?
          LIMIT 1;
        `
        )
        .get(agenteId, scopedText) as
        | {
            memoria_id: string;
            agente_id: string;
            texto: string;
            origem: "automatica" | "manual";
            criado_em: string;
          }
        | undefined;

      if (saved) {
        const parsed = parseMemoryScopePrefix(saved.texto);
        return {
          memoria_id: saved.memoria_id,
          conta_id: parsed.contaId ?? input.contaId,
          chat_jid: parsed.chatJid,
          agente_id: saved.agente_id,
          texto: parsed.cleanText,
          origem: saved.origem,
          criado_em: saved.criado_em,
        };
      }
    }

    // Fallback seguro caso o banco ainda não possua nenhum registro em projecao_agentes
    const configKey = `whatsapp_memorias:${input.contaId}`;
    const existingList = this.listFallbackMemories(configKey);
    const duplicate = existingList.find((m) => m.texto === clean && m.chat_jid === (input.chatJid ?? null));
    if (duplicate) return duplicate;

    const entry: ChannelMemoryEntry = {
      memoria_id: randomUUID(),
      conta_id: input.contaId,
      chat_jid: input.chatJid ?? null,
      agente_id: `whatsapp:${input.contaId}`,
      texto: clean,
      origem,
      criado_em: agora,
    };
    const nextList = [entry, ...existingList];
    this.deps.db
      .prepare(
        `
        INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
        VALUES (?, ?, ?)
        ON CONFLICT(chave) DO UPDATE SET
          valor_json = excluded.valor_json,
          atualizado_em = excluded.atualizado_em;
      `
      )
      .run(configKey, JSON.stringify(nextList), agora);
    return entry;
  }

  public listChannelMemories(input: {
    contaId: string;
    chatJid?: string | null;
    limit?: number;
  }): ChannelMemoryEntry[] {
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 30)));
    const prefix = input.chatJid
      ? buildMemoryScopePrefix(input.contaId, input.chatJid)
      : `[whatsapp:${input.contaId}`;

    const rows = this.deps.db
      .prepare(
        `
        SELECT memoria_id, agente_id, texto, origem, criado_em
        FROM projecao_agente_memorias
        WHERE texto LIKE ?
        ORDER BY criado_em DESC
        LIMIT ?;
      `
      )
      .all(`${prefix}%`, safeLimit) as Array<{
      memoria_id: string;
      agente_id: string;
      texto: string;
      origem: "automatica" | "manual";
      criado_em: string;
    }>;

    const fromAgentTable = rows.map((row) => {
      const parsed = parseMemoryScopePrefix(row.texto);
      return {
        memoria_id: row.memoria_id,
        conta_id: parsed.contaId ?? input.contaId,
        chat_jid: parsed.chatJid,
        agente_id: row.agente_id,
        texto: parsed.cleanText,
        origem: row.origem,
        criado_em: row.criado_em,
      };
    });

    const fallbackList = this.listFallbackMemories(`whatsapp_memorias:${input.contaId}`).filter((item) =>
      input.chatJid ? item.chat_jid === input.chatJid : true
    );

    return [...fromAgentTable, ...fallbackList].slice(0, safeLimit);
  }

  public forgetChannelMemory(input: {
    contaId: string;
    memoriaId?: string;
    texto?: string;
    chatJid?: string | null;
  }): boolean {
    let removed = false;
    const scopeLike = `[whatsapp:${input.contaId}%`;

    if (input.memoriaId) {
      const res = this.deps.db
        .prepare(`DELETE FROM projecao_agente_memorias WHERE memoria_id = ? AND texto LIKE ?;`)
        .run(input.memoriaId, scopeLike);
      if (Number(res.changes) > 0) removed = true;
    } else if (input.texto?.trim()) {
      const clean = input.texto.trim();
      const exactScoped = buildMemoryScopePrefix(input.contaId, input.chatJid) + clean;
      const res = this.deps.db
        .prepare(`DELETE FROM projecao_agente_memorias WHERE texto = ? OR (texto LIKE ? AND texto LIKE ?);`)
        .run(exactScoped, scopeLike, `%${clean}`);
      if (Number(res.changes) > 0) removed = true;
    }

    const configKey = `whatsapp_memorias:${input.contaId}`;
    const fallbackList = this.listFallbackMemories(configKey);
    if (fallbackList.length > 0) {
      const filtered = fallbackList.filter((item) => {
        if (input.memoriaId && item.memoria_id === input.memoriaId) return false;
        if (input.texto?.trim() && item.texto === input.texto.trim()) return false;
        return true;
      });
      if (filtered.length !== fallbackList.length) {
        removed = true;
        this.deps.db
          .prepare(
            `
            INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
            VALUES (?, ?, ?)
            ON CONFLICT(chave) DO UPDATE SET
              valor_json = excluded.valor_json,
              atualizado_em = excluded.atualizado_em;
          `
          )
          .run(configKey, JSON.stringify(filtered), new Date().toISOString());
      }
    }

    return removed;
  }

  private listFallbackMemories(configKey: string): ChannelMemoryEntry[] {
    try {
      const row = this.deps.db
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = ? LIMIT 1;`)
        .get(configKey) as { valor_json?: string } | undefined;
      if (!row?.valor_json) return [];
      const parsed = JSON.parse(row.valor_json);
      return Array.isArray(parsed) ? (parsed as ChannelMemoryEntry[]) : [];
    } catch {
      return [];
    }
  }
}
