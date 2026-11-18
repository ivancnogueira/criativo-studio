import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketEnvelope, WebSocketEventMap } from "@criativo/contracts";

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Hub WebSocket nativo RFC 6455 sem dependências externas.
 * Transmite eventos do Cockpit (task:queued, agent:step, agent:thought, whatsapp:status, etc.)
 * em tempo real para todos os clientes Web/Mobile conectados.
 */
export class WebSocketHub {
  private readonly clients = new Set<Duplex>();

  public handleUpgrade(req: IncomingMessage, socket: Duplex, expectedPath = "/ws"): boolean {
    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    if (reqUrl.pathname !== expectedPath) {
      return false;
    }

    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !key) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return true;
    }

    const acceptKey = createHash("sha1")
      .update(key + WS_MAGIC_GUID)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`,
        "\r\n",
      ].join("\r\n")
    );

    this.clients.add(socket);

    const cleanup = () => {
      this.clients.delete(socket);
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
    socket.on("end", cleanup);

    // Trata frames básicos de ping/close enviados pelo cliente
    socket.on("data", (buffer: Buffer) => {
      if (buffer.length < 2) return;
      const opcode = buffer[0] & 0x0f;
      if (opcode === 0x08) {
        // Close frame
        socket.end(Buffer.from([0x88, 0x00]));
        cleanup();
      } else if (opcode === 0x09) {
        // Ping -> responde Pong
        const pong = Buffer.from([0x8a, 0x00]);
        socket.write(pong);
      }
    });

    return true;
  }

  private encodeTextFrame(payload: string): Buffer {
    const body = Buffer.from(payload, "utf8");
    const len = body.length;

    if (len < 126) {
      const header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + Text
      header[1] = len;
      return Buffer.concat([header, body]);
    }

    if (len < 65536) {
      const header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
      return Buffer.concat([header, body]);
    }

    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    return Buffer.concat([header, body]);
  }

  private readonly eventListeners = new Set<{
    onEvent: (envelope: WebSocketEnvelope<keyof WebSocketEventMap>) => void;
    onClose?: () => void;
  }>();

  private readonly sseListeners = new Set<{
    res: ServerResponse;
    agenteId?: string | null;
    threadId?: string | null;
    canalId?: string | null;
    keepalive: NodeJS.Timeout;
  }>();

  public registerSseClient(
    res: ServerResponse,
    filter?:
      | string
      | null
      | { agenteId?: string | null; threadId?: string | null; canalId?: string | null },
  ): () => void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`: conectado\n\n`);

    const keepalive = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(`: keepalive ${Date.now()}\n\n`);
      } catch {
        // cleanup abaixo remove cliente
      }
    }, 15_000);
    keepalive.unref?.();

    const parsedFilter =
      typeof filter === "string"
        ? { canalId: filter }
        : filter ?? {};

    const entry = {
      res,
      agenteId: parsedFilter.agenteId ?? null,
      threadId: parsedFilter.threadId ?? null,
      canalId: parsedFilter.canalId ?? null,
      keepalive,
    };
    this.sseListeners.add(entry);

    const cleanup = (): void => {
      clearInterval(entry.keepalive);
      this.sseListeners.delete(entry);
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
    return cleanup;
  }

  public subscribe(
    onEvent: (envelope: WebSocketEnvelope<keyof WebSocketEventMap>) => void,
    onClose?: () => void
  ): () => void {
    const entry = { onEvent, onClose };
    this.eventListeners.add(entry);
    return () => {
      this.eventListeners.delete(entry);
    };
  }

  public broadcast<K extends keyof WebSocketEventMap>(
    event: K,
    data: WebSocketEventMap[K]
  ): void {
    const envelope: WebSocketEnvelope<K> = {
      event,
      data,
      timestamp: new Date().toISOString(),
    };

    for (const entry of this.eventListeners) {
      try {
        entry.onEvent(envelope as WebSocketEnvelope<keyof WebSocketEventMap>);
      } catch {
        // Ignora falhas de subscribers individuais (ex: stream SSE já encerrado)
      }
    }

    if (this.sseListeners.size > 0) {
      const payloadRec = (data && typeof data === "object" ? data : {}) as {
        agente_id?: string | null;
        thread_id?: string | null;
        canal_id?: string | null;
      };
      const sseFrame = `event: ${event}\ndata: ${JSON.stringify(envelope)}\n\n`;
      for (const sse of this.sseListeners) {
        if (sse.res.writableEnded || sse.res.destroyed) {
          clearInterval(sse.keepalive);
          this.sseListeners.delete(sse);
          continue;
        }
        if (sse.canalId && payloadRec.canal_id && payloadRec.canal_id !== sse.canalId) {
          continue;
        }
        if (sse.agenteId && payloadRec.agente_id && payloadRec.agente_id !== sse.agenteId) {
          continue;
        }
        if (sse.threadId && payloadRec.thread_id && payloadRec.thread_id !== sse.threadId) {
          continue;
        }
        try {
          sse.res.write(sseFrame);
        } catch {
          clearInterval(sse.keepalive);
          this.sseListeners.delete(sse);
        }
      }
    }

    if (this.clients.size === 0) return;
    const frame = this.encodeTextFrame(JSON.stringify(envelope));

    for (const socket of this.clients) {
      if (socket.destroyed || !socket.writable) {
        this.clients.delete(socket);
        continue;
      }
      socket.write(frame);
    }
  }

  public get connectedCount(): number {
    return this.clients.size;
  }

  public closeAll(): void {
    for (const sse of this.sseListeners) {
      clearInterval(sse.keepalive);
      try {
        if (!sse.res.writableEnded) {
          sse.res.end();
        }
      } catch {
        // ignora erro no encerramento SSE
      }
    }
    this.sseListeners.clear();

    for (const socket of this.clients) {
      try {
        socket.destroy();
      } catch {
        // ignora erro ao encerrar socket já fechado
      }
    }
    this.clients.clear();
  }
}
