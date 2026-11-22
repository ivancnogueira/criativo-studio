import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer as createNetServer } from "node:net";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

export const KEY_CODE_MAP: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  Space: { code: "Space", keyCode: 32, text: " " },
  " ": { code: "Space", keyCode: 32, text: " " },
};

/**
 * Valida estritamente endpoints CDP contra SSRF: permite apenas localhost / 127.0.0.1 / ::1
 * e portas válidas entre 1024 e 65535.
 */
export function assertLoopbackCdpEndpoint(rawUrlOrPort: string | number): string {
  if (typeof rawUrlOrPort === "number") {
    if (!Number.isInteger(rawUrlOrPort) || rawUrlOrPort < 1024 || rawUrlOrPort > 65535) {
      throw new Error(
        `Porta CDP inválida (${rawUrlOrPort}). Informe um inteiro entre 1024 e 65535.`,
      );
    }
    return `http://127.0.0.1:${rawUrlOrPort}`;
  }

  const trimmed = String(rawUrlOrPort ?? "").trim();
  if (!trimmed) {
    throw new Error("Endpoint CDP vazio.");
  }

  if (/^\d+$/.test(trimmed)) {
    return assertLoopbackCdpEndpoint(Number.parseInt(trimmed, 10));
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Endpoint CDP inválido: '${trimmed}'.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Protocolo '${parsed.protocol}' não permitido para anexo CDP. Use apenas http://127.0.0.1:<porta>.`,
    );
  }

  const hostLower = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostLower)) {
    throw new Error(
      `Anexo CDP recusado pela proteção anti-SSRF: host '${parsed.hostname}' não é loopback (use 127.0.0.1 ou localhost).`,
    );
  }

  const portNum = parsed.port ? Number.parseInt(parsed.port, 10) : 9222;
  if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
    throw new Error(
      `Porta CDP inválida em '${trimmed}'. Informe uma porta entre 1024 e 65535.`,
    );
  }

  const normalizedHost = hostLower.includes(":") && !hostLower.startsWith("[")
    ? `[${hostLower}]`
    : hostLower;
  return `${parsed.protocol}//${normalizedHost}:${portNum}`;
}

export async function findFreeLoopbackTcpPort(): Promise<number> {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const srv = createNetServer();
    srv.unref();
    srv.once("error", rejectPort);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

export class CdpWebSocketClient {
  private readonly wsUrl: string;
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (val: unknown) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly eventListeners = new Map<string, Set<(payload: any) => void>>();
  private closed = false;

  private constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  public static async connect(wsUrl: string, timeoutMs = 10_000): Promise<CdpWebSocketClient> {
    if (typeof globalThis.WebSocket !== "function") {
      throw new Error(
        "WebSocket nativo indisponível neste runtime Node.js (Node 22+ requerido para driver CDP nativo).",
      );
    }
    const client = new CdpWebSocketClient(wsUrl);
    await client.open(timeoutMs);
    return client;
  }

  private open(timeoutMs: number): Promise<void> {
    return new Promise((resolveOpen, rejectOpen) => {
      const ws = new globalThis.WebSocket(this.wsUrl);
      this.socket = ws;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {
            // ignora
          }
          rejectOpen(new Error(`Timeout conectando ao WebSocket CDP '${this.wsUrl}'.`));
        }
      }, timeoutMs);

      ws.addEventListener("open", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolveOpen();
        }
      });

      ws.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          rejectOpen(new Error(`Falha ao conectar no WebSocket CDP '${this.wsUrl}'.`));
        }
      });

      ws.addEventListener("message", (evt) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(evt.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (typeof msg.id === "number") {
          const wait = this.pending.get(msg.id);
          if (!wait) return;
          this.pending.delete(msg.id);
          clearTimeout(wait.timer);
          if (msg.error && typeof msg.error === "object") {
            const errObj = msg.error as { message?: string; code?: number };
            wait.reject(new Error(errObj.message || `Erro CDP (${errObj.code ?? -1})`));
          } else {
            wait.resolve(msg.result);
          }
          return;
        }

        if (typeof msg.method === "string") {
          const listeners = this.eventListeners.get(msg.method);
          if (listeners) {
            for (const fn of listeners) {
              try {
                fn(msg.params ?? {});
              } catch {
                // listener isolado não derruba despacho CDP
              }
            }
          }
        }
      });

      ws.addEventListener("close", () => {
        this.closed = true;
        for (const [id, wait] of this.pending.entries()) {
          clearTimeout(wait.timer);
          wait.reject(new Error("Conexão WebSocket CDP encerrada."));
          this.pending.delete(id);
        }
        const closeListeners = this.eventListeners.get("__ws_close__");
        if (closeListeners) {
          for (const fn of closeListeners) {
            try {
              fn({});
            } catch {
              // ignore
            }
          }
        }
      });
    });
  }

  public on(method: string, listener: (payload: any) => void): this {
    let set = this.eventListeners.get(method);
    if (!set) {
      set = new Set();
      this.eventListeners.set(method, set);
    }
    set.add(listener);
    return this;
  }

  public off(method: string, listener: (payload: any) => void): this {
    this.eventListeners.get(method)?.delete(listener);
    return this;
  }

  public async send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 20_000,
  ): Promise<T> {
    if (this.closed || !this.socket || this.socket.readyState !== globalThis.WebSocket.OPEN) {
      throw new Error(`Sessão CDP não está aberta para executar '${method}'.`);
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });

    return await new Promise<T>((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error(`Timeout aguardando comando CDP '${method}'.`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, {
        resolve: resolveSend as (val: unknown) => void,
        reject: rejectSend,
        timer,
      });

      try {
        this.socket!.send(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectSend(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public close(): void {
    this.closed = true;
    try {
      this.socket?.close();
    } catch {
      // ignora
    }
    this.socket = null;
  }
}
