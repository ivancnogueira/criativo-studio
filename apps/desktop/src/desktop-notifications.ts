import { Notification, type BrowserWindow } from "electron";

export interface NativeDesktopNotificationPayload {
  id?: string;
  kind?: "approval" | "error" | "completion" | "update" | "info";
  title: string;
  body: string;
  agentId?: string | null;
}

const MIN_INTERVAL_BETWEEN_SIMILAR_MS = 1200;
const recentShownAt = new Map<string, number>();

/**
 * Dispara notificação nativa do SO via Electron respeitando suporte da plataforma,
 * rate-limit simples anti-spam e foco automático na janela principal ao clicar.
 */
export function showDesktopNotification(
  getMainWindow: () => BrowserWindow | null,
  payload: NativeDesktopNotificationPayload
): { shown: boolean; reason?: string } {
  if (!Notification.isSupported()) {
    return { shown: false, reason: "unsupported" };
  }

  const title = String(payload.title ?? "CriativoOS").trim().slice(0, 120);
  const body = String(payload.body ?? "").trim().slice(0, 280);
  if (!title && !body) {
    return { shown: false, reason: "empty" };
  }

  const dedupeKey = `${title}::${payload.agentId ?? ""}`;
  const now = Date.now();
  const prev = recentShownAt.get(dedupeKey) ?? 0;
  if (now - prev < MIN_INTERVAL_BETWEEN_SIMILAR_MS) {
    return { shown: false, reason: "rate_limited" };
  }
  recentShownAt.set(dedupeKey, now);

  const notif = new Notification({
    title: title || "CriativoOS",
    body,
    silent: false,
  });

  notif.on("click", () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
    win.webContents.send("criativo:notification-clicked", {
      id: payload.id ?? null,
      kind: payload.kind ?? "info",
      agentId: payload.agentId ?? null,
    });
  });

  notif.show();
  return { shown: true };
}
