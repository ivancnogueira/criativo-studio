/**
 * Ponte assíncrona de consentimento explícito para captura única de tela Web (`capture_screen` — BRWS-03 / D-03).
 * Dispara `screen:capture_requested` via WebSocket e aguarda `getDisplayMedia()` autorizado pelo usuário.
 */
import { randomUUID } from "node:crypto";
import type { CaptureScreenConsentRequest } from "@criativo/contracts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";

export const MAX_SCREEN_CAPTURE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ScreenCaptureResolution {
  ok: boolean;
  captureId: string;
  decision: "granted" | "declined" | "expired";
  dataUrl?: string;
  width?: number;
  height?: number;
  reason?: string;
}

interface PendingCaptureEntry {
  request: CaptureScreenConsentRequest;
  resolve: (res: ScreenCaptureResolution) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ScreenCaptureBridge {
  private wsHub?: WebSocketHub;
  private readonly pending = new Map<string, PendingCaptureEntry>();

  constructor(wsHub?: WebSocketHub) {
    this.wsHub = wsHub;
  }

  public setWebSocketHub(wsHub: WebSocketHub): void {
    this.wsHub = wsHub;
  }

  public listPendingCaptures(agenteId?: string): CaptureScreenConsentRequest[] {
    const out: CaptureScreenConsentRequest[] = [];
    for (const entry of this.pending.values()) {
      if (agenteId && entry.request.agenteId !== agenteId) continue;
      out.push({ ...entry.request });
    }
    return out;
  }

  /**
   * Registra uma solicitação pendente e retorna o objeto de consentimento junto à Promise de resolução.
   */
  public openCaptureSession(params: {
    agenteId: string;
    canalId: string;
    purpose: string;
    targetHint?: string | null;
    timeoutMs?: number;
  }): {
    request: CaptureScreenConsentRequest;
    waitForResolution: Promise<ScreenCaptureResolution>;
  } {
    const captureId = `cap-${randomUUID().slice(0, 8)}`;
    const purpose = params.purpose?.trim() || "Inspecionar layout visual mediante sua autorização.";
    const request: CaptureScreenConsentRequest = {
      captureId,
      agenteId: params.agenteId,
      canalId: params.canalId,
      purpose: purpose.slice(0, 400),
      targetHint: params.targetHint?.trim().slice(0, 140) ?? null,
      status: "pending",
      criadoEm: new Date().toISOString(),
    };

    const timeoutMs = Math.min(Math.max(1_000, params.timeoutMs ?? 120_000), 300_000);

    const waitForResolution = new Promise<ScreenCaptureResolution>((resolvePromise) => {
      const timer = setTimeout(() => {
        const current = this.pending.get(captureId);
        if (!current) return;
        this.pending.delete(captureId);
        current.request.status = "expired";
        resolvePromise({
          ok: false,
          captureId,
          decision: "expired",
          reason: "A solicitação de captura de tela expirou sem resposta do usuário.",
        });
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(captureId, {
        request,
        resolve: resolvePromise,
        timer,
      });
    });

    this.wsHub?.broadcast("screen:capture_requested", request);

    return { request, waitForResolution };
  }

  public async requestCapture(params: {
    agenteId: string;
    canalId: string;
    purpose: string;
    targetHint?: string | null;
    timeoutMs?: number;
  }): Promise<ScreenCaptureResolution> {
    const { waitForResolution } = this.openCaptureSession(params);
    return await waitForResolution;
  }

  public submitCaptureResponse(
    captureId: string,
    payload: {
      decision: "granted" | "declined";
      dataUrl?: string;
      width?: number;
      height?: number;
      reason?: string;
    },
  ): ScreenCaptureResolution {
    const entry = this.pending.get(captureId);
    if (!entry) {
      throw new Error(`Solicitação de captura '${captureId}' não encontrada ou já encerrada.`);
    }

    clearTimeout(entry.timer);
    this.pending.delete(captureId);

    if (payload.decision === "declined") {
      entry.request.status = "declined";
      const res: ScreenCaptureResolution = {
        ok: false,
        captureId,
        decision: "declined",
        reason: payload.reason?.trim() || "O usuário optou por recusar a captura de tela.",
      };
      entry.resolve(res);
      return res;
    }

    const dataUrl = typeof payload.dataUrl === "string" ? payload.dataUrl.trim() : "";
    if (!dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("Formato de captura inválido: esperado 'data:image/png;base64,...'.");
    }
    const base64Body = dataUrl.slice("data:image/png;base64,".length);
    const byteLen = Buffer.byteLength(base64Body, "base64");
    if (byteLen === 0 || byteLen > MAX_SCREEN_CAPTURE_BYTES) {
      throw new Error("A imagem de captura excede o limite de 10 MB ou está vazia.");
    }

    entry.request.status = "granted";
    const res: ScreenCaptureResolution = {
      ok: true,
      captureId,
      decision: "granted",
      dataUrl,
      width: typeof payload.width === "number" ? Math.round(payload.width) : undefined,
      height: typeof payload.height === "number" ? Math.round(payload.height) : undefined,
    };
    entry.resolve(res);
    return res;
  }

  public dispose(): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({
        ok: false,
        captureId: id,
        decision: "expired",
        reason: "Servidor encerrado.",
      });
    }
  }
}
