import {
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  basename,
  join,
} from "node:path";
import {
  Readable,
} from "node:stream";
import {
  downloadMediaMessage,
  type WAMessage,
} from "@whiskeysockets/baileys";
import type {
  WhatsAppContaResumo,
  WhatsAppContatoAutorizado,
  WhatsAppMensagemRegistro,
} from "@criativo/contracts";
import type {
  BaileysSocketLike,
  SqliteConnectionLike,
  WhatsAppMediaKind,
} from "./types.ts";

export const WHATSAPP_DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const WHATSAPP_MAX_MEDIA_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
export const WHATSAPP_RETENTION_DAYS = 90;
export const WHATSAPP_RETENTION_MS = WHATSAPP_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

export const silentMediaLogger = {
  level: "silent",
  child: () => silentMediaLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const EXT_TO_MIME: Record<string, string> = {
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

export const MIME_TO_EXT: Record<string, string> = {
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

export function sanitizeSlugSegment(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "conta";
}

export function sanitizeFileName(rawName: string): string {
  const base = basename(rawName.trim())
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[._]+/u, "")
    .slice(-90);
  return base || "anexo";
}

export function inferExtensionFromMime(mimeType: string | undefined, mediaKind: WhatsAppMediaKind): string {
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

export function mapMediaKindToTipoUso(kind: WhatsAppMediaKind): "referencia" | "video" | "documento" {
  if (kind === "imagem") return "referencia";
  if (kind === "video") return "video";
  return "documento";
}

export async function defaultBaileysMediaDownloader(
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

export interface HistoryDbRow {
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

export function mapHistoryRow(row: HistoryDbRow): WhatsAppMensagemRegistro {
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

export function collectFilesRecursively(dir: string): Array<{ path: string; size: number; mtimeMs: number }> {
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
