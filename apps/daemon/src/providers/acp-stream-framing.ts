/**
 * Enquadramento NDJSON seguro em streaming para conexões ACP (`antigravity` e `opencode`).
 * Suporta mensagens de até 256 MB sem limite UTF-16 de `node:readline`, descarta linhas
 * excedentes sem encerrar o processo e isola falhas no turno afetado (SCALE41-03).
 */
export const ACP_MAX_MESSAGE_BYTES = 256 * 1024 * 1024; // 256 MB
export const ACP_DEFAULT_TOOL_OUTPUT_PREVIEW_BYTES = 64 * 1024; // 64 KB

export interface NdjsonBufferedLineReaderOptions {
  stream: NodeJS.ReadableStream;
  maxMessageBytes?: number;
  onLine: (line: string) => void;
  onOversizedLine?: (info: { byteLength: number }) => void;
}

export class NdjsonBufferedLineReader {
  private readonly stream: NodeJS.ReadableStream;
  private readonly maxMessageBytes: number;
  private readonly onLine: (line: string) => void;
  private readonly onOversizedLine?: (info: { byteLength: number }) => void;

  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private discardingOversizedLine = false;
  private oversizedByteCount = 0;
  private disposed = false;

  private readonly handleData = (rawChunk: Buffer | string): void => {
    if (this.disposed) return;
    const buf = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk, "utf8");
    let offset = 0;

    while (offset < buf.length && !this.disposed) {
      const nlIdx = buf.indexOf(0x0a, offset);
      if (nlIdx === -1) {
        const tail = buf.subarray(offset);
        if (this.discardingOversizedLine) {
          this.oversizedByteCount += tail.length;
          return;
        }
        if (this.bufferedBytes + tail.length > this.maxMessageBytes) {
          this.discardingOversizedLine = true;
          this.oversizedByteCount = this.bufferedBytes + tail.length;
          this.chunks = [];
          this.bufferedBytes = 0;
          return;
        }
        if (tail.length > 0) {
          this.chunks.push(Buffer.from(tail));
          this.bufferedBytes += tail.length;
        }
        return;
      }

      const segment = buf.subarray(offset, nlIdx);
      offset = nlIdx + 1;

      if (this.discardingOversizedLine) {
        const totalBytes = this.oversizedByteCount + segment.length;
        this.discardingOversizedLine = false;
        this.oversizedByteCount = 0;
        this.chunks = [];
        this.bufferedBytes = 0;
        this.safeNotifyOversized(totalBytes);
        continue;
      }

      const candidateBytes = this.bufferedBytes + segment.length;
      if (candidateBytes > this.maxMessageBytes) {
        this.chunks = [];
        this.bufferedBytes = 0;
        this.safeNotifyOversized(candidateBytes);
        continue;
      }

      if (segment.length > 0) {
        this.chunks.push(Buffer.from(segment));
      }
      const lineBuffer =
        this.chunks.length === 1
          ? this.chunks[0]!
          : Buffer.concat(this.chunks, candidateBytes);
      this.chunks = [];
      this.bufferedBytes = 0;

      const trimmedLen =
        lineBuffer.length > 0 && lineBuffer[lineBuffer.length - 1] === 0x0d
          ? lineBuffer.length - 1
          : lineBuffer.length;
      const lineText = lineBuffer.subarray(0, trimmedLen).toString("utf8");
      if (lineText.length > 0) {
        this.onLine(lineText);
      }
    }
  };

  private readonly handleEnd = (): void => {
    if (this.disposed) return;
    if (this.discardingOversizedLine) {
      const total = this.oversizedByteCount;
      this.discardingOversizedLine = false;
      this.oversizedByteCount = 0;
      this.chunks = [];
      this.bufferedBytes = 0;
      this.safeNotifyOversized(total);
      return;
    }
    if (this.chunks.length > 0) {
      const full = Buffer.concat(this.chunks, this.bufferedBytes);
      this.chunks = [];
      this.bufferedBytes = 0;
      const trimmedLen =
        full.length > 0 && full[full.length - 1] === 0x0d ? full.length - 1 : full.length;
      const text = full.subarray(0, trimmedLen).toString("utf8");
      if (text.length > 0) {
        this.onLine(text);
      }
    }
  };

  constructor(options: NdjsonBufferedLineReaderOptions) {
    this.stream = options.stream;
    this.maxMessageBytes = Math.max(1024, options.maxMessageBytes ?? ACP_MAX_MESSAGE_BYTES);
    this.onLine = options.onLine;
    this.onOversizedLine = options.onOversizedLine;
    this.stream.on("data", this.handleData);
    this.stream.on("end", this.handleEnd);
  }

  private safeNotifyOversized(byteLength: number): void {
    try {
      this.onOversizedLine?.({ byteLength });
    } catch {
      // ignora erro secundário no listener de linha descartada
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stream.removeListener("data", this.handleData);
    this.stream.removeListener("end", this.handleEnd);
    this.chunks = [];
    this.bufferedBytes = 0;
    this.discardingOversizedLine = false;
    this.oversizedByteCount = 0;
  }
}

/**
 * Trunca saídas brutas gigantes de ferramentas ACP antes de armazenar/inspecionar em watchdogs.
 */
export function sanitizeAcpRawOutputPreview(
  rawOutput: unknown,
  maxBytes = ACP_DEFAULT_TOOL_OUTPUT_PREVIEW_BYTES,
): unknown {
  if (rawOutput == null) return rawOutput;
  if (typeof rawOutput === "string") {
    if (Buffer.byteLength(rawOutput, "utf8") <= maxBytes) return rawOutput;
    const sliced = Buffer.from(rawOutput, "utf8").subarray(0, maxBytes).toString("utf8");
    return `${sliced}...[truncado em ${maxBytes}B]`;
  }
  try {
    const serialized = JSON.stringify(rawOutput);
    if (serialized.length <= maxBytes) return rawOutput;
    return `${serialized.slice(0, maxBytes)}...[truncado]`;
  } catch {
    return String(rawOutput).slice(0, maxBytes);
  }
}
