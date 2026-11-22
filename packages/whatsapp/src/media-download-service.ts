import {
  randomUUID,
} from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import {
  basename,
  extname,
  resolve,
  sep,
} from "node:path";
import {
  Readable,
  Transform,
} from "node:stream";
import {
  pipeline,
} from "node:stream/promises";
import type {
  BaileysSocketLike,
  IncomingWhatsAppMessage,
  OutgoingWhatsAppPayload,
  SqliteConnectionLike,
  WhatsAppMediaKind,
} from "./types.ts";
import { WHATSAPP_DEFAULT_MAX_FILE_BYTES, WHATSAPP_MAX_MEDIA_TOTAL_BYTES, EXT_TO_MIME, sanitizeSlugSegment, sanitizeFileName, inferExtensionFromMime, mapMediaKindToTipoUso, defaultBaileysMediaDownloader, type BaileysMediaDownloader, type WhatsAppMediaServiceOptions, type DownloadedWhatsAppMedia } from "./media-archive-helpers.ts";

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

