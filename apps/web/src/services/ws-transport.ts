import type { WebSocketEnvelope, WebSocketEventMap } from "@criativo/contracts";
import { getActiveServerId, setActiveServerId } from "./http-client";

type EventName = keyof WebSocketEventMap;
type EventListener<K extends EventName> = (
  payload: WebSocketEventMap[K],
  envelope: WebSocketEnvelope<K>
) => void;

/**
 * Cliente WebSocket reativo com reconexão exponencial (1s -> 2s -> 4s -> máx 15s)
 * para consumir os eventos do DaemonServer em tempo real.
 */
export class WebSocketClient {
  private readonly url: string;
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private closedManually = false;
  private hasConnectedOnce = false;
  private readonly listeners = new Map<EventName, Set<EventListener<any>>>();
  private readonly connectionListeners = new Set<
    (connected: boolean, reconnected: boolean) => void
  >();

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else if (typeof window !== "undefined") {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      this.url = `${protocol}//${window.location.host}/ws`;
    } else {
      this.url = "ws://127.0.0.1:3000/ws";
    }
  }

  public onConnectionChange(
    listener: (connected: boolean, reconnected: boolean) => void
  ): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  public on<K extends EventName>(event: K, listener: EventListener<K>): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener);
    return () => {
      bucket?.delete(listener);
    };
  }

  private buildTargetUrl(): string {
    const activeServerId = getActiveServerId();
    if (!activeServerId || activeServerId === "primary") {
      return this.url;
    }
    const sep = this.url.includes("?") ? "&" : "?";
    return `${this.url}${sep}serverId=${encodeURIComponent(activeServerId)}`;
  }

  public connect(): void {
    this.closedManually = false;
    if (typeof WebSocket === "undefined") return;
    if (this.reconnectTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const ws = new WebSocket(this.buildTargetUrl());
    this.socket = ws;

    ws.addEventListener("open", () => {
      if (this.socket !== ws) return;
      this.reconnectAttempt = 0;
      const reconnected = this.hasConnectedOnce;
      this.hasConnectedOnce = true;
      for (const cb of this.connectionListeners) cb(true, reconnected);
    });

    ws.addEventListener("message", (evt) => {
      if (this.socket !== ws) return;
      try {
        const envelope = JSON.parse(String(evt.data)) as WebSocketEnvelope;
        const bucket = this.listeners.get(envelope.event);
        if (bucket) {
          for (const listener of bucket) {
            listener(envelope.data, envelope);
          }
        }
      } catch {
        // ignora payload inválido
      }
    });

    ws.addEventListener("close", () => {
      if (this.socket !== ws) return;
      this.socket = null;
      for (const cb of this.connectionListeners) cb(false, false);
      if (!this.closedManually) {
        this.scheduleReconnect();
      }
    });

    ws.addEventListener("error", () => {
      if (this.socket !== ws) return;
      ws.close();
    });
  }

  public reconnectForServer(serverId: string): void {
    setActiveServerId(serverId);
    this.disconnect();
    this.reconnectAttempt = 0;
    this.connect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || typeof window === "undefined") return;
    const delayMs = Math.min(15_000, 1000 * Math.pow(2, this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  public disconnect(): void {
    this.closedManually = true;
    if (this.reconnectTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const prev = this.socket;
    this.socket = null;
    prev?.close();
  }
}
