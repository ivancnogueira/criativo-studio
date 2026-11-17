import { randomUUID } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadMediaMessage, type WAMessage } from "@whiskeysockets/baileys";
import type {
  WhatsAppContaResumo,
  WhatsAppContatoAutorizado,
  WhatsAppMensagemRegistro,
} from "@criativo/contracts";
import { ensureWhatsAppAccountRow } from "./auth-store.ts";
import type {
  BaileysSocketLike,
  IncomingWhatsAppMessage,
  OutgoingWhatsAppPayload,
  SqliteConnectionLike,
  WhatsAppMediaKind,
} from "./types.ts";

export const WHATSAPP_DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const WHATSAPP_MAX_MEDIA_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
export const WHATSAPP_RETENTION_DAYS = 90;
export const WHATSAPP_RETENTION_MS = WHATSAPP_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

const silentMediaLogger = {
  level: "silent",
  child: () => silentMediaLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogg": "audio/ogg; codecs=opus",
  ".opus": "audio/ogg; codecs=opus",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/opus": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/json": ".json",
};

export type BaileysMediaDownloader = (
  message: unknown,
  socket: BaileysSocketLike | null,
  signal?: AbortSignal
) => Promise<Readable>;

export interface WhatsAppMediaServiceOptions {
  db: SqliteConnectionLike;
  workspaceRoot: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  mediaDownloader?: BaileysMediaDownloader;
  now?: () => number;
}

export interface DownloadedWhatsAppMedia {
  arquivoId: string;
  diskPath: string;
  caminhoRelativo: string;
  mimeType: string;
  tamanhoBytes: number;
  tipoConteudo: WhatsAppMediaKind;
  nomeOriginal: string;
}

function sanitizeSlugSegment(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "conta";
}

function sanitizeFileName(rawName: string): string {
  const base = basename(rawName.trim())
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[._]+/u, "")
    .slice(-90);
  return base || "anexo";
}

function inferExtensionFromMime(mimeType: string | undefined, mediaKind: WhatsAppMediaKind): string {
  const baseMime = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (baseMime && MIME_TO_EXT[baseMime]) {
    return MIME_TO_EXT[baseMime];
  }
  switch (mediaKind) {
    case "imagem":
      return ".jpg";
    case "video":
      return ".mp4";
    case "audio":
      return ".ogg";
    case "documento":
      return ".pdf";
  }
}

function mapMediaKindToTipoUso(kind: WhatsAppMediaKind): "referencia" | "video" | "documento" {
  if (kind === "imagem") return "referencia";
  if (kind === "video") return "video";
  return "documento";
}

async function defaultBaileysMediaDownloader(
  message: unknown,
  socket: BaileysSocketLike | null,
  signal?: AbortSignal
): Promise<Readable> {
  const stream = await downloadMediaMessage(
    message as WAMessage,
    "stream",
    signal ? { options: { signal } } : {},
    {
      logger: silentMediaLogger,
      reuploadRequest: (stale) =>
        socket?.updateMediaMessage
          ? (socket.updateMediaMessage(stale) as Promise<WAMessage>)
          : Promise.reject(new Error("Socket WhatsApp indisponível para reupload de mídia.")),
    }
  );
  return stream as unknown as Readable;
}

/**
 * Serviço de mídia WhatsApp:
 * - Download em streaming via `downloadMediaMessage(..., "stream", ..., { reuploadRequest })`
 * - Abortamento imediato se exceder `maxFileBytes` (padrão 25 MiB)
 * - Gravação segura com permissão `0o600` em `recursos/uploads/whatsapp/<contaId>/`
 * - Indexação automática em `projecao_arquivos`
 * - Montagem tipada de payloads de saída (imagem, vídeo, áudio PTT e documentos PDF)
 */
export class WhatsAppMediaService {
  private readonly db: SqliteConnectionLike;
  private readonly workspaceRoot: string;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly mediaDownloader: BaileysMediaDownloader;
  private readonly now: () => number;

  constructor(options: WhatsAppMediaServiceOptions) {
    this.db = options.db;
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.maxFileBytes = options.maxFileBytes ?? WHATSAPP_DEFAULT_MAX_FILE_BYTES;
    this.maxTotalBytes = options.maxTotalBytes ?? WHATSAPP_MAX_MEDIA_TOTAL_BYTES;
    this.mediaDownloader = options.mediaDownloader ?? defaultBaileysMediaDownloader;
    this.now = options.now ?? Date.now;
  }

  public getMaxTotalBytes(): number {
    return this.maxTotalBytes;
  }

  public async downloadIncomingMedia(
    socket: BaileysSocketLike | null,
    msg: IncomingWhatsAppMessage,
    contaId: string,
    signal?: AbortSignal
  ): Promise<DownloadedWhatsAppMedia | null> {
    const mediaKind: WhatsAppMediaKind | null =
      msg.mediaType ?? (msg.audioBuffer ? "audio" : null);

    if (!mediaKind) {
      return null;
    }

    if (!msg.rawMessage && !msg.audioBuffer) {
      return null;
    }

    const mimeType =
      msg.mediaMimeType ??
      msg.audioMimeType ??
      (mediaKind === "imagem"
        ? "image/jpeg"
        : mediaKind === "video"
          ? "video/mp4"
          : mediaKind === "audio"
            ? "audio/ogg; codecs=opus"
            : "application/pdf");

    const safeContaId = sanitizeSlugSegment(contaId);
    const uploadsBaseRoot = resolve(this.workspaceRoot, "recursos", "uploads", "whatsapp");
    const contaDir = resolve(uploadsBaseRoot, safeContaId);
    if (!contaDir.startsWith(`${uploadsBaseRoot}${sep}`)) {
      throw new Error("Caminho de conta WhatsApp inválido para armazenamento de mídia.");
    }
    mkdirSync(contaDir, { recursive: true, mode: 0o700 });

    const arquivoId = `wpp-${randomUUID().slice(0, 12)}`;
    const preferredExt = inferExtensionFromMime(mimeType, mediaKind);
    const rawOriginal = msg.mediaFileName?.trim() || `${mediaKind}-${msg.messageId}${preferredExt}`;
    let cleanName = sanitizeFileName(rawOriginal);
    if (!extname(cleanName)) {
      cleanName = `${cleanName}${preferredExt}`;
    }

    const storedName = `${arquivoId}-${cleanName}`;
    const diskPath = resolve(contaDir, storedName);
    if (!diskPath.startsWith(`${contaDir}${sep}`)) {
      throw new Error("Nome de arquivo inválido após sanitização.");
    }
    const partPath = `${diskPath}.part`;
    const caminhoRelativo = `recursos/uploads/whatsapp/${safeContaId}/${storedName}`;

    try {
      let tamanhoBytes = 0;

      if (msg.audioBuffer && !msg.rawMessage) {
        if (msg.audioBuffer.byteLength > this.maxFileBytes) {
          throw new Error("file_too_large");
        }
        const stream = Readable.from(msg.audioBuffer);
        await this.writeStreamWithLimit(stream, partPath, signal);
      } else {
        const stream = await this.mediaDownloader(msg.rawMessage, socket, signal);
        await this.writeStreamWithLimit(stream, partPath, signal);
      }

      renameSync(partPath, diskPath);
      chmodSync(diskPath, 0o600);
      tamanhoBytes = statSync(diskPath).size;

      const agora = new Date(this.now()).toISOString();
      const tipoUso = mapMediaKindToTipoUso(mediaKind);

      this.db
        .prepare(
          `
          INSERT INTO projecao_arquivos (
            arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?);
        `
        )
        .run(
          arquivoId,
          rawOriginal.slice(0, 140),
          caminhoRelativo,
          mimeType,
          tamanhoBytes,
          tipoUso,
          agora
        );

      return {
        arquivoId,
        diskPath,
        caminhoRelativo,
        mimeType,
        tamanhoBytes,
        tipoConteudo: mediaKind,
        nomeOriginal: rawOriginal.slice(0, 140),
      };
    } catch (error) {
      rmSync(partPath, { force: true });
      throw error;
    }
  }

  private async writeStreamWithLimit(
    stream: Readable,
    destinationPath: string,
    signal?: AbortSignal
  ): Promise<void> {
    let totalBytes = 0;
    const maxBytes = this.maxFileBytes;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          callback(new Error("file_too_large"));
          return;
        }
        callback(null, chunk);
      },
    });

    const writer = createWriteStream(destinationPath, { mode: 0o600 });
    await (signal
      ? pipeline(stream, sizeGuard, writer, { signal })
      : pipeline(stream, sizeGuard, writer));
  }

  public buildOutgoingMediaPayload(
    filePath: string,
    caption?: string,
    options: { asAudioPtt?: boolean; mimeType?: string; fileName?: string } = {}
  ): OutgoingWhatsAppPayload {
    const candidatePath = existsSync(filePath) ? resolve(filePath) : resolve(this.workspaceRoot, filePath);
    if (!existsSync(candidatePath)) {
      throw new Error(`Arquivo de mídia não encontrado para envio no WhatsApp: ${filePath}`);
    }

    const stats = statSync(candidatePath);
    if (!stats.isFile()) {
      throw new Error(`O caminho informado não é um arquivo válido: ${filePath}`);
    }
    if (stats.size > this.maxFileBytes) {
      throw new Error(
        `Arquivo excede o limite de envio de ${Math.round(this.maxFileBytes / (1024 * 1024))} MiB.`
      );
    }

    const buffer = readFileSync(candidatePath);
    const ext = extname(candidatePath).toLowerCase();
    const mimeType = options.mimeType ?? EXT_TO_MIME[ext] ?? "application/octet-stream";
    const fileName = options.fileName ?? basename(candidatePath);

    if (mimeType.startsWith("image/")) {
      return {
        image: buffer,
        mimetype: mimeType,
        ...(caption ? { caption } : {}),
      };
    }

    if (mimeType.startsWith("video/")) {
      return {
        video: buffer,
        mimetype: mimeType,
        ...(caption ? { caption } : {}),
      };
    }

    if (mimeType.startsWith("audio/")) {
      return {
        audio: buffer,
        mimetype: mimeType,
        ptt: options.asAudioPtt ?? true,
      };
    }

    return {
      document: buffer,
      mimetype: mimeType,
      fileName,
      ...(caption ? { caption } : {}),
    };
  }
}

export interface WhatsAppArchiveServiceOptions {
  db: SqliteConnectionLike;
  workspaceRoot: string;
  maxTotalBytes?: number;
  retentionMs?: number;
  now?: () => number;
}

export interface RecordWhatsAppMessageInput {
  mensagemId?: string;
  contaId: string;
  chatJid: string;
  remetenteJid: string;
  remetenteNome?: string | null;
  direcao: "entrada" | "saida";
  tipoConteudo?: "texto" | "imagem" | "documento" | "audio" | "video" | "sistema";
  texto?: string | null;
  midiaCaminho?: string | null;
  midiaMime?: string | null;
  midiaTamanhoBytes?: number;
  ehGrupo?: boolean;
  ackStatus?: string | null;
  metadados?: Record<string, unknown>;
  ocorridoEm?: string;
  expiraEm?: string;
}

export interface ListWhatsAppHistoryQuery {
  contaId?: string;
  chatJid?: string;
  limit?: number;
}

export interface WhatsAppPlacesSnapshot {
  contas: Array<Pick<WhatsAppContaResumo, "conta_id" | "rotulo" | "status" | "numero_telefone" | "modo_operacao">>;
  autorizados: WhatsAppContatoAutorizado[];
  chatsRecentes: Array<{
    conta_id: string;
    chat_jid: string;
    ultima_mensagem_em: string;
    total_mensagens: number;
    ultimo_texto: string | null;
    eh_grupo: boolean;
  }>;
}

export interface PruneArchiveReport {
  removidosHistorico: number;
  removidosArquivosExpirados: number;
  removidosArquivosPorTeto: number;
  bytesLiberados: number;
}

interface HistoryDbRow {
  mensagem_id: string;
  conta_id: string;
  chat_jid: string;
  remetente_jid: string;
  remetente_nome: string | null;
  direcao: "entrada" | "saida";
  tipo_conteudo: "texto" | "imagem" | "documento" | "audio" | "video" | "sistema";
  texto: string | null;
  midia_caminho: string | null;
  midia_mime: string | null;
  midia_tamanho_bytes: number;
  eh_grupo: number;
  ack_status: string | null;
  metadados_json: string;
  ocorrido_em: string;
  expira_em: string;
}

function mapHistoryRow(row: HistoryDbRow): WhatsAppMensagemRegistro {
  let metadados: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.metadados_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadados = parsed as Record<string, unknown>;
    }
  } catch {
    metadados = {};
  }

  return {
    mensagem_id: row.mensagem_id,
    conta_id: row.conta_id,
    chat_jid: row.chat_jid,
    remetente_jid: row.remetente_jid,
    remetente_nome: row.remetente_nome,
    direcao: row.direcao,
    tipo_conteudo: row.tipo_conteudo,
    texto: row.texto,
    midia_caminho: row.midia_caminho,
    midia_mime: row.midia_mime,
    midia_tamanho_bytes: Number(row.midia_tamanho_bytes ?? 0),
    eh_grupo: row.eh_grupo === 1,
    ack_status: row.ack_status,
    metadados,
    ocorrido_em: row.ocorrido_em,
    expira_em: row.expira_em,
  };
}

function collectFilesRecursively(dir: string): Array<{ path: string; size: number; mtimeMs: number }> {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const results: Array<{ path: string; size: number; mtimeMs: number }> = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(fullPath));
    } else if (entry.isFile()) {
      try {
        const st = statSync(fullPath);
        results.push({ path: fullPath, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        // Ignora arquivo removido concorrentemente
      }
    }
  }

  return results;
}

/**
 * Arquivo histórico de mensagens WhatsApp com retenção de 90 dias (`whatsapp_historico_mensagens`),
 * listagem de lugares/contatos/chats e poda automática respeitando teto de 2 GiB em disco.
 */
export class WhatsAppArchiveService {
  private readonly db: SqliteConnectionLike;
  private readonly workspaceRoot: string;
  private readonly maxTotalBytes: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: WhatsAppArchiveServiceOptions) {
    this.db = options.db;
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.maxTotalBytes = options.maxTotalBytes ?? WHATSAPP_MAX_MEDIA_TOTAL_BYTES;
    this.retentionMs = options.retentionMs ?? WHATSAPP_RETENTION_MS;
    this.now = options.now ?? Date.now;
  }

  public recordMessage(input: RecordWhatsAppMessageInput): WhatsAppMensagemRegistro {
    ensureWhatsAppAccountRow(this.db, input.contaId);

    const mensagemId = input.mensagemId?.trim() || `wppmsg-${randomUUID()}`;
    const currentNow = this.now();
    const ocorridoEm = input.ocorridoEm ?? new Date(currentNow).toISOString();
    const parsedOcorrido = Date.parse(ocorridoEm);
    const baseMs = Number.isFinite(parsedOcorrido) ? parsedOcorrido : currentNow;
    const expiraEm = input.expiraEm ?? new Date(baseMs + this.retentionMs).toISOString();

    const tipoConteudo = input.tipoConteudo ?? "texto";
    const texto = input.texto ?? null;
    const midiaCaminho = input.midiaCaminho ?? null;
    const midiaMime = input.midiaMime ?? null;
    const midiaTamanhoBytes = Number(input.midiaTamanhoBytes ?? 0);
    const ehGrupo = input.ehGrupo ? 1 : 0;
    const ackStatus = input.ackStatus ?? "enviado";
    const metadadosJson = JSON.stringify(input.metadados ?? {});

    this.db
      .prepare(
        `
        INSERT INTO whatsapp_historico_mensagens (
          mensagem_id,
          conta_id,
          chat_jid,
          remetente_jid,
          remetente_nome,
          direcao,
          tipo_conteudo,
          texto,
          midia_caminho,
          midia_mime,
          midia_tamanho_bytes,
          eh_grupo,
          ack_status,
          metadados_json,
          ocorrido_em,
          expira_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mensagem_id) DO UPDATE SET
          texto = COALESCE(excluded.texto, whatsapp_historico_mensagens.texto),
          midia_caminho = COALESCE(excluded.midia_caminho, whatsapp_historico_mensagens.midia_caminho),
          midia_mime = COALESCE(excluded.midia_mime, whatsapp_historico_mensagens.midia_mime),
          midia_tamanho_bytes = CASE
            WHEN excluded.midia_tamanho_bytes > 0 THEN excluded.midia_tamanho_bytes
            ELSE whatsapp_historico_mensagens.midia_tamanho_bytes
          END,
          ack_status = COALESCE(excluded.ack_status, whatsapp_historico_mensagens.ack_status),
          metadados_json = excluded.metadados_json;
      `
      )
      .run(
        mensagemId,
        input.contaId,
        input.chatJid,
        input.remetenteJid,
        input.remetenteNome ?? null,
        input.direcao,
        tipoConteudo,
        texto,
        midiaCaminho,
        midiaMime,
        midiaTamanhoBytes,
        ehGrupo,
        ackStatus,
        metadadosJson,
        ocorridoEm,
        expiraEm
      );

    return {
      mensagem_id: mensagemId,
      conta_id: input.contaId,
      chat_jid: input.chatJid,
      remetente_jid: input.remetenteJid,
      remetente_nome: input.remetenteNome ?? null,
      direcao: input.direcao,
      tipo_conteudo: tipoConteudo,
      texto,
      midia_caminho: midiaCaminho,
      midia_mime: midiaMime,
      midia_tamanho_bytes: midiaTamanhoBytes,
      eh_grupo: ehGrupo === 1,
      ack_status: ackStatus,
      metadados: input.metadados ?? {},
      ocorrido_em: ocorridoEm,
      expira_em: expiraEm,
    };
  }

  public listHistory(query: ListWhatsAppHistoryQuery = {}): WhatsAppMensagemRegistro[] {
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 30)));
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.contaId) {
      conditions.push("conta_id = ?");
      params.push(query.contaId);
    }
    if (query.chatJid) {
      conditions.push("chat_jid = ?");
      params.push(query.chatJid);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(safeLimit);

    const rows = this.db
      .prepare(
        `
        SELECT * FROM whatsapp_historico_mensagens
        ${whereClause}
        ORDER BY ocorrido_em DESC
        LIMIT ?;
      `
      )
      .all(...params) as unknown as HistoryDbRow[];

    return rows.map(mapHistoryRow);
  }

  public listPlaces(contaId?: string): WhatsAppPlacesSnapshot {
    const contas = (contaId
      ? this.db
          .prepare(
            `SELECT conta_id, rotulo, status, numero_telefone, modo_operacao FROM whatsapp_contas WHERE conta_id = ?;`
          )
          .all(contaId)
      : this.db
          .prepare(
            `SELECT conta_id, rotulo, status, numero_telefone, modo_operacao FROM whatsapp_contas ORDER BY atualizado_em DESC;`
          )
          .all()) as Array<
      Pick<WhatsAppContaResumo, "conta_id" | "rotulo" | "status" | "numero_telefone" | "modo_operacao">
    >;

    const autorizadosRows = (contaId
      ? this.db
          .prepare(
            `SELECT * FROM whatsapp_contatos_autorizados WHERE conta_id = ? AND permitido = 1 ORDER BY atualizado_em DESC;`
          )
          .all(contaId)
      : this.db
          .prepare(
            `SELECT * FROM whatsapp_contatos_autorizados WHERE permitido = 1 ORDER BY atualizado_em DESC;`
          )
          .all()) as Array<{
      autorizacao_id: string;
      conta_id: string;
      tipo: "contato" | "grupo";
      identificador_jid: string;
      telefone_normalizado: string | null;
      variantes_json: string;
      nome_exibicao: string | null;
      permitido: number;
      somente_mencao: number;
      origem: "manual" | "pareamento" | "auto_chat";
      criado_em: string;
      atualizado_em: string;
    }>;

    const autorizados: WhatsAppContatoAutorizado[] = autorizadosRows.map((row) => {
      let variantes: string[] = [];
      try {
        const parsed = JSON.parse(row.variantes_json);
        if (Array.isArray(parsed)) {
          variantes = parsed.filter((v): v is string => typeof v === "string");
        }
      } catch {
        variantes = [];
      }
      return {
        autorizacao_id: row.autorizacao_id,
        conta_id: row.conta_id,
        tipo: row.tipo,
        identificador_jid: row.identificador_jid,
        telefone_normalizado: row.telefone_normalizado,
        variantes,
        nome_exibicao: row.nome_exibicao,
        permitido: row.permitido === 1,
        somente_mencao: row.somente_mencao === 1,
        origem: row.origem,
        criado_em: row.criado_em,
        atualizado_em: row.atualizado_em,
      };
    });

    const recentRows = (contaId
      ? this.db
          .prepare(
            `
            SELECT
              conta_id,
              chat_jid,
              MAX(ocorrido_em) AS ultima_mensagem_em,
              COUNT(*) AS total_mensagens,
              MAX(eh_grupo) AS eh_grupo
            FROM whatsapp_historico_mensagens
            WHERE conta_id = ?
            GROUP BY conta_id, chat_jid
            ORDER BY ultima_mensagem_em DESC
            LIMIT 50;
          `
          )
          .all(contaId)
      : this.db
          .prepare(
            `
            SELECT
              conta_id,
              chat_jid,
              MAX(ocorrido_em) AS ultima_mensagem_em,
              COUNT(*) AS total_mensagens,
              MAX(eh_grupo) AS eh_grupo
            FROM whatsapp_historico_mensagens
            GROUP BY conta_id, chat_jid
            ORDER BY ultima_mensagem_em DESC
            LIMIT 50;
          `
          )
          .all()) as Array<{
      conta_id: string;
      chat_jid: string;
      ultima_mensagem_em: string;
      total_mensagens: number;
      eh_grupo: number;
    }>;

    const chatsRecentes = recentRows.map((item) => {
      const last = this.db
        .prepare(
          `
          SELECT texto FROM whatsapp_historico_mensagens
          WHERE conta_id = ? AND chat_jid = ?
          ORDER BY ocorrido_em DESC
          LIMIT 1;
        `
        )
        .get(item.conta_id, item.chat_jid) as { texto: string | null } | undefined;

      return {
        conta_id: item.conta_id,
        chat_jid: item.chat_jid,
        ultima_mensagem_em: item.ultima_mensagem_em,
        total_mensagens: Number(item.total_mensagens),
        ultimo_texto: last?.texto ?? null,
        eh_grupo: item.eh_grupo === 1,
      };
    });

    return {
      contas,
      autorizados,
      chatsRecentes,
    };
  }

  public pruneExpiredAndEnforceCap(): PruneArchiveReport {
    const nowIso = new Date(this.now()).toISOString();
    const whatsappUploadsRoot = resolve(this.workspaceRoot, "recursos", "uploads", "whatsapp");

    const expiredRows = this.db
      .prepare(
        `
        SELECT mensagem_id, midia_caminho
        FROM whatsapp_historico_mensagens
        WHERE expira_em < ?;
      `
      )
      .all(nowIso) as Array<{ mensagem_id: string; midia_caminho: string | null }>;

    let removidosArquivosExpirados = 0;
    let bytesLiberados = 0;

    for (const row of expiredRows) {
      if (!row.midia_caminho) continue;
      const diskCandidate = resolve(this.workspaceRoot, row.midia_caminho);
      if (diskCandidate.startsWith(`${whatsappUploadsRoot}${sep}`) && existsSync(diskCandidate)) {
        try {
          bytesLiberados += statSync(diskCandidate).size;
          rmSync(diskCandidate, { force: true });
          removidosArquivosExpirados += 1;
        } catch {
          // Ignora arquivo bloqueado
        }
      }
      this.db
        .prepare(`DELETE FROM projecao_arquivos WHERE caminho_relativo = ?;`)
        .run(row.midia_caminho);
    }

    const deletedRes = this.db
      .prepare(`DELETE FROM whatsapp_historico_mensagens WHERE expira_em < ?;`)
      .run(nowIso);
    const removidosHistorico = Number(deletedRes.changes ?? 0);

    // Garante teto de 2 GiB em recursos/uploads/whatsapp/ removendo anexos mais antigos primeiro
    const allFiles = collectFilesRecursively(whatsappUploadsRoot).sort(
      (a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path)
    );
    let totalBytes = allFiles.reduce((acc, item) => acc + item.size, 0);
    let removidosArquivosPorTeto = 0;

    for (const file of allFiles) {
      if (totalBytes <= this.maxTotalBytes) {
        break;
      }
      if (!resolve(file.path).startsWith(`${whatsappUploadsRoot}${sep}`)) {
        continue;
      }
      try {
        rmSync(file.path, { force: true });
        totalBytes -= file.size;
        bytesLiberados += file.size;
        removidosArquivosPorTeto += 1;

        const relativePosix = file.path
          .slice(this.workspaceRoot.length + 1)
          .split(sep)
          .join("/");

        this.db
          .prepare(`DELETE FROM projecao_arquivos WHERE caminho_relativo = ?;`)
          .run(relativePosix);
        this.db
          .prepare(
            `UPDATE whatsapp_historico_mensagens SET midia_caminho = NULL, midia_tamanho_bytes = 0 WHERE midia_caminho = ?;`
          )
          .run(relativePosix);
      } catch {
        // Ignora arquivo bloqueado e continua com próximo
      }
    }

    return {
      removidosHistorico,
      removidosArquivosExpirados,
      removidosArquivosPorTeto,
      bytesLiberados,
    };
  }

  public startPeriodicCleanup(intervalMs: number = 60 * 60_000): void {
    if (this.cleanupTimer) {
      return;
    }
    this.cleanupTimer = setInterval(() => {
      try {
        this.pruneExpiredAndEnforceCap();
      } catch {
        // Limpeza periódica não pode derrubar o daemon
      }
    }, intervalMs);
    this.cleanupTimer.unref?.();
  }

  public stopPeriodicCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
