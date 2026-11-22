import { ipcMain, type IpcMainInvokeEvent, type Session } from "electron";

/**
 * Monta política CSP restritiva para o Cockpit servido pelo daemon loopback.
 */
export function buildDesktopCspHeader(): string {
  return [
    "default-src 'self' http://127.0.0.1:*",
    "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*",
    "img-src 'self' data: blob: http://127.0.0.1:* http://localhost:*",
    "media-src 'self' data: blob: http://127.0.0.1:* http://localhost:*",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Verifica se a URL do frame que originou o IPC pertence ao loopback local confiável.
 */
export function isTrustedIpcSenderFrame(
  frameUrl: string | undefined | null,
  expectedPort?: number | null
): boolean {
  if (!frameUrl || typeof frameUrl !== "string") return false;
  try {
    const parsed = new URL(frameUrl);
    if (parsed.protocol !== "http:") return false;
    const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (!isLoopback) return false;
    if (expectedPort && expectedPort > 0) {
      return Number(parsed.port || 80) === expectedPort;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Registra handler `ipcMain.handle` exigindo origem `event.senderFrame?.url` confiável do daemon local.
 */
export function registerTrustedIpcHandle<TArgs extends unknown[], TResult>(
  channel: string,
  getDaemonPort: () => number | null | undefined,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  onRejected?: (channel: string, frameUrl: string | undefined) => void
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const frameUrl = event.senderFrame?.url;
    if (!isTrustedIpcSenderFrame(frameUrl, getDaemonPort())) {
      onRejected?.(channel, frameUrl);
      throw new Error(
        `[CRV-AUTH-002] Invocação IPC bloqueada para '${channel}': origem '${frameUrl ?? "desconhecida"}' não confiável.`
      );
    }
    return await handler(event, ...(args as TArgs));
  });
}

/**
 * Aplica Content-Security-Policy restritiva em todas as respostas HTTP servidas para janelas do estúdio.
 */
export function installDesktopCsp(
  targetSession: Session,
  isAllowedOrigin: (url: string) => boolean
): void {
  const cspHeader = buildDesktopCspHeader();
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url || "";
    if (!isAllowedOrigin(url)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const headers: Record<string, string | string[]> = {
      ...(details.responseHeaders ?? {}),
    };
    delete headers["content-security-policy"];
    delete headers["Content-Security-Policy"];
    headers["Content-Security-Policy"] = [cspHeader];
    callback({ responseHeaders: headers });
  });
}
