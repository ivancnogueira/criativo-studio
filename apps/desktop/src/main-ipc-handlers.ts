import { join } from "node:path";
import { app, BrowserWindow, dialog, screen, shell } from "electron";
import {
  resolveDesktopProductRoot,
  type EmbeddedDaemonHandle,
} from "./daemon-launcher.ts";
import { registerTrustedIpcHandle } from "./desktop-security.ts";
import { showDesktopNotification, type NativeDesktopNotificationPayload } from "./desktop-notifications.ts";
import type { FloatingDockController } from "./floating-dock.ts";
import type { BrowserPipWindowController } from "./browser-pip-window.ts";

export interface DesktopIpcDeps {
  userDataDir: string;
  preloadPath: string;
  getDaemonHandle: () => EmbeddedDaemonHandle | null;
  getMainWindow: () => BrowserWindow | null;
  getFloatingDock: () => FloatingDockController | null;
  browserPipController?: BrowserPipWindowController;
  registerCommandPaletteShortcut?: (accelerator: string) => boolean;
  resolveIconPath: (productRoot: string) => string | undefined;
  isLocalDaemonOrigin: (rawUrl: string, daemonPort: number) => boolean;
  openExternalValidated: (rawUrl: string) => boolean;
  focusOrShowMainWindow: () => void;
  onLog?: (message: string) => void;
}

/**
 * Registra todos os handlers IPC do processo principal com validação estrita de `senderFrame`.
 */
export function registerDesktopIpcHandlers(deps: DesktopIpcDeps): void {
  const getDaemonPort = () => deps.getDaemonHandle()?.port ?? null;
  const onRejected = (channel: string, frameUrl: string | undefined) => {
    deps.onLog?.(`[Security] IPC '${channel}' bloqueado para frame não confiável: ${frameUrl ?? "n/d"}`);
  };

  const handleTrusted = <TArgs extends unknown[], TResult>(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
  ) => registerTrustedIpcHandle(channel, getDaemonPort, fn, onRejected);

  handleTrusted("criativo:get-info", () => ({
    version: app.getVersion(),
    daemonUrl: deps.getDaemonHandle()?.baseUrl ?? "",
    userDataDir: deps.userDataDir,
  }));

  handleTrusted("criativo:open-external", (_evt, url: unknown) => {
    if (typeof url !== "string") return false;
    return deps.openExternalValidated(url);
  });

  handleTrusted("criativo:open-data-dir", async () => {
    await shell.openPath(deps.userDataDir);
  });

  handleTrusted("criativo:check-updates", async () => {
    const handle = deps.getDaemonHandle();
    if (!handle) return null;
    const res = await fetch(`${handle.baseUrl}/api/studio/updates/check`, { method: "POST" });
    return await res.json();
  });

  handleTrusted("criativo:trigger-update", async (_evt, targetServerId: unknown) => {
    const handle = deps.getDaemonHandle();
    if (!handle) return null;
    const res = await fetch(`${handle.baseUrl}/api/studio/updates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_server_id: typeof targetServerId === "string" ? targetServerId : undefined,
      }),
    });
    return await res.json();
  });

  handleTrusted("criativo:restart-for-update", async () => {
    const handle = deps.getDaemonHandle();
    if (!handle) return null;
    const res = await fetch(`${handle.baseUrl}/api/studio/updates/restart`, {
      method: "POST",
    });
    return await res.json();
  });

  handleTrusted("criativo:dock-get-state", () => {
    return (
      deps.getFloatingDock()?.getState() ?? {
        visible: false,
        expanded: false,
        side: "right",
        pinned: true,
        peeked: false,
        scalePercent: 100,
        alwaysOnTop: true,
        displayId: "principal",
      }
    );
  });

  handleTrusted("criativo:dock-get-displays", () => {
    try {
      const primary = screen.getPrimaryDisplay();
      return screen.getAllDisplays().map((d, idx) => ({
        id: d.id === primary.id ? "principal" : String(d.id),
        label:
          d.id === primary.id
            ? "Tela principal"
            : d.label?.trim() || `Tela ${idx + 1}`,
        primary: d.id === primary.id,
      }));
    } catch {
      return [{ id: "principal", label: "Tela principal", primary: true }];
    }
  });

  handleTrusted("criativo:dock-set-expanded", (_evt, rawPayload: unknown) => {
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as { expanded?: unknown; pillHeight?: unknown })
        : {};
    const expanded = Boolean(payload.expanded);
    const pillHeight = typeof payload.pillHeight === "number" ? payload.pillHeight : undefined;
    return (
      deps.getFloatingDock()?.setExpanded(expanded, pillHeight) ?? {
        visible: false,
        expanded,
        side: "right",
        pinned: true,
        peeked: false,
      }
    );
  });

  handleTrusted("criativo:dock-set-visible", async (_evt, visible: unknown) => {
    const dock = deps.getFloatingDock();
    if (!dock) return false;
    return await dock.setVisible(Boolean(visible));
  });

  handleTrusted("criativo:dock-set-pinned", (_evt, rawPayload: unknown) => {
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as { pinned?: unknown; pillHeight?: unknown })
        : {};
    const pinned = Boolean(payload.pinned);
    const pillHeight = typeof payload.pillHeight === "number" ? payload.pillHeight : undefined;
    return (
      deps.getFloatingDock()?.setPinned(pinned, pillHeight) ?? {
        visible: true,
        expanded: false,
        side: "right",
        pinned,
        peeked: false,
      }
    );
  });

  handleTrusted("criativo:dock-set-peeked", (_evt, rawPayload: unknown) => {
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as { peeked?: unknown; pillHeight?: unknown })
        : {};
    const peeked = Boolean(payload.peeked);
    const pillHeight = typeof payload.pillHeight === "number" ? payload.pillHeight : undefined;
    return (
      deps.getFloatingDock()?.setPeeked(peeked, pillHeight) ?? {
        visible: true,
        expanded: false,
        side: "right",
        pinned: false,
        peeked,
      }
    );
  });

  handleTrusted("criativo:dock-configure", async (_evt, rawPayload: unknown) => {
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as {
            visible?: unknown;
            side?: unknown;
            pinned?: unknown;
            scalePercent?: unknown;
            alwaysOnTop?: unknown;
            displayId?: unknown;
            pillHeight?: unknown;
          })
        : {};
    const dock = deps.getFloatingDock();
    if (!dock) {
      return {
        visible: typeof payload.visible === "boolean" ? payload.visible : true,
        expanded: false,
        side: payload.side === "left" ? "left" : "right",
        pinned: typeof payload.pinned === "boolean" ? payload.pinned : true,
        peeked: false,
        scalePercent: typeof payload.scalePercent === "number" ? payload.scalePercent : 100,
        alwaysOnTop: typeof payload.alwaysOnTop === "boolean" ? payload.alwaysOnTop : true,
        displayId: typeof payload.displayId === "string" ? payload.displayId : "principal",
      };
    }
    return await dock.configure({
      visible: typeof payload.visible === "boolean" ? payload.visible : undefined,
      side: payload.side === "left" || payload.side === "right" ? payload.side : undefined,
      pinned: typeof payload.pinned === "boolean" ? payload.pinned : undefined,
      scalePercent: typeof payload.scalePercent === "number" ? payload.scalePercent : undefined,
      alwaysOnTop: typeof payload.alwaysOnTop === "boolean" ? payload.alwaysOnTop : undefined,
      displayId: typeof payload.displayId === "string" ? payload.displayId : undefined,
      pillHeight: typeof payload.pillHeight === "number" ? payload.pillHeight : undefined,
    });
  });

  handleTrusted("criativo:dock-start-drag", () => {
    deps.getFloatingDock()?.startDrag();
  });

  handleTrusted("criativo:dock-move-drag", () => {
    deps.getFloatingDock()?.moveDrag();
  });

  handleTrusted("criativo:dock-end-drag", () => {
    return (
      deps.getFloatingDock()?.endDrag() ?? {
        visible: true,
        expanded: false,
        side: "right",
        pinned: true,
        peeked: false,
      }
    );
  });

  handleTrusted("criativo:dock-sync-active-server", (_evt, rawServerId: unknown) => {
    const serverId = typeof rawServerId === "string" && rawServerId.trim() ? rawServerId.trim() : "primary";
    deps.getFloatingDock()?.notifyActiveServerChanged(serverId);
    return true;
  });

  handleTrusted("criativo:open-main-window", (_evt, rawOpts: unknown) => {
    deps.focusOrShowMainWindow();
    const mainWin = deps.getMainWindow();
    if (mainWin && !mainWin.isDestroyed()) {
      const payload =
        rawOpts && typeof rawOpts === "object"
          ? (rawOpts as { agenteId?: string; action?: "new-agent" | "open-dock-settings" })
          : {};
      if (payload.agenteId || payload.action) {
        mainWin.webContents.send("criativo:main-navigate", payload);
      }
    }
  });

  handleTrusted("criativo:pick-folder", async () => {
    const mainWin = deps.getMainWindow();
    const parentWin = mainWin && !mainWin.isDestroyed() ? mainWin : undefined;
    const opts: Electron.OpenDialogOptions = {
      title: "Selecionar Pasta Autorizada",
      properties: ["openDirectory"],
    };
    const result = parentWin
      ? await dialog.showOpenDialog(parentWin, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }
    return { canceled: false, path: result.filePaths[0]! };
  });

  handleTrusted("criativo:open-agent-window", async (_evt, rawPayload: unknown) => {
    const handle = deps.getDaemonHandle();
    if (!handle) return false;
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as { agenteId?: unknown })
        : {};
    const agenteId = typeof payload.agenteId === "string" ? payload.agenteId.trim() : "";
    if (!agenteId) return false;

    const productRoot = resolveDesktopProductRoot({
      isPackaged: app.isPackaged,
      resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    });
    const iconPath = deps.resolveIconPath(productRoot);
    const childWin = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 780,
      minHeight: 560,
      title: "Criativo AI Studio Online",
      backgroundColor: "#0D0D0D",
      ...(iconPath ? { icon: iconPath } : {}),
      autoHideMenuBar: true,
      webPreferences: {
        preload: deps.preloadPath || join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const port = handle.port;
    childWin.webContents.setWindowOpenHandler(({ url }) => {
      if (!deps.isLocalDaemonOrigin(url, port)) {
        deps.openExternalValidated(url);
        return { action: "deny" };
      }
      return { action: "allow" };
    });
    childWin.webContents.on("will-navigate", (event: { preventDefault: () => void }, url: string) => {
      if (url.startsWith("data:text/html")) return;
      if (!deps.isLocalDaemonOrigin(url, port)) {
        event.preventDefault();
        deps.openExternalValidated(url);
      }
    });
    await childWin.loadURL(`${handle.baseUrl}/?agent=${encodeURIComponent(agenteId)}`);
    return true;
  });

  handleTrusted("criativo:notify-native", async (_evt, rawPayload: unknown) => {
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as NativeDesktopNotificationPayload)
        : { title: "Criativo AI Studio", body: "" };
    return showDesktopNotification(deps.getMainWindow, payload);
  });

  handleTrusted("criativo:set-window-vibrancy", (_evt, enabled: unknown) => {
    const mainWin = deps.getMainWindow();
    if (!mainWin || mainWin.isDestroyed()) return false;
    const on = Boolean(enabled);
    try {
      if (process.platform === "darwin") {
        mainWin.setVibrancy(on ? "under-window" : null);
      } else if (process.platform === "win32" && typeof mainWin.setBackgroundMaterial === "function") {
        mainWin.setBackgroundMaterial(on ? "acrylic" : "none");
      }
      return true;
    } catch {
      return false;
    }
  });

  handleTrusted("criativo:set-global-shortcut", (_evt, accelerator: unknown) => {
    if (typeof accelerator !== "string" || !deps.registerCommandPaletteShortcut) {
      return false;
    }
    return deps.registerCommandPaletteShortcut(accelerator);
  });

  handleTrusted("criativo:browser-pip-open", async (_evt, rawPayload: unknown) => {
    const handle = deps.getDaemonHandle();
    if (!handle || !deps.browserPipController) return false;
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as { tabId?: unknown; agenteId?: unknown })
        : {};
    return await deps.browserPipController.open({
      daemonBaseUrl: handle.baseUrl,
      tabId: typeof payload.tabId === "string" ? payload.tabId : null,
      agenteId: typeof payload.agenteId === "string" ? payload.agenteId : null,
      preloadPath: deps.preloadPath,
      isLocalOrigin: (rawUrl) => deps.isLocalDaemonOrigin(rawUrl, handle.port),
      openExternalValidated: deps.openExternalValidated,
    });
  });

  handleTrusted("criativo:browser-pip-close", () => {
    return deps.browserPipController?.close() ?? false;
  });
}
