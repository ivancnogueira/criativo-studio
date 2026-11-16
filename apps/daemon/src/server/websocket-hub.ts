import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
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

  public broadcast<K extends keyof WebSocketEventMap>(
    event: K,
    data: WebSocketEventMap[K]
  ): void {
    if (this.clients.size === 0) return;

    const envelope: WebSocketEnvelope<K> = {
      event,
      data,
      timestamp: new Date().toISOString(),
    };
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
