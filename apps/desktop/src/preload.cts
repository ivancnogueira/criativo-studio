import { contextBridge, ipcRenderer } from "electron";

export interface CriativoMainNavigatePayload {
  agenteId?: string;
  action?: "new-agent" | "open-dock-settings";
}

export interface CriativoDeepLinkPayload {
  kind: "agent" | "workflow" | "oauth_callback" | "server_connect" | "template_install";
  agenteId?: string;
  workflowId?: string;
  provider?: string;
  code?: string | null;
  state?: string | null;
  url?: string;
  claim?: string | null;
  name?: string | null;
  sourceUrl?: string | null;
  templateJson?: string | null;
  rawUrl: string;
}

export interface CriativoDockStatePayload {
  visible: boolean;
  expanded: boolean;
  side: "left" | "right";
  pinned: boolean;
  peeked: boolean;
  scalePercent?: number;
  alwaysOnTop?: boolean;
  displayId?: string;
}

export interface CriativoDockConfigurePayload {
  visible?: boolean;
  side?: "left" | "right";
  pinned?: boolean;
  scalePercent?: number;
  alwaysOnTop?: boolean;
  displayId?: string;
  pillHeight?: number;
}

export interface CriativoDesktopBridge {
  isPackagedDesktop: boolean;
  platform: NodeJS.Platform;
  getDesktopInfo: () => Promise<{ version: string; daemonUrl: string; userDataDir: string }>;
  checkForUpdates: () => Promise<unknown>;
  triggerUpdateInstall: (targetServerId?: string) => Promise<unknown>;
  restartForUpdate: () => Promise<unknown>;
  openExternalSafe: (url: string) => Promise<boolean>;
  openUserDataFolder: () => Promise<void>;
  dockGetState: () => Promise<CriativoDockStatePayload>;
  dockGetDisplays: () => Promise<Array<{ id: string; label: string; primary: boolean }>>;
  dockSetExpanded: (expanded: boolean, pillHeight?: number) => Promise<CriativoDockStatePayload>;
  dockSetVisible: (visible: boolean) => Promise<boolean>;
  dockSetPinned: (pinned: boolean, pillHeight?: number) => Promise<CriativoDockStatePayload>;
  dockSetPeeked: (peeked: boolean, pillHeight?: number) => Promise<CriativoDockStatePayload>;
  dockConfigure: (config: CriativoDockConfigurePayload) => Promise<CriativoDockStatePayload>;
  dockStartDrag: () => Promise<void>;
  dockMoveDrag: () => Promise<void>;
  dockEndDrag: () => Promise<CriativoDockStatePayload>;
  onDockStateChanged: (listener: (state: CriativoDockStatePayload) => void) => () => void;
  dockSyncActiveServer: (serverId: string) => Promise<boolean>;
  onDockActiveServerChanged: (listener: (serverId: string) => void) => () => void;
  openMainWindow: (opts?: CriativoMainNavigatePayload) => Promise<void>;
  onMainNavigate: (listener: (payload: CriativoMainNavigatePayload) => void) => () => void;
  pickFolder: () => Promise<{ canceled: boolean; path: string | null }>;
  openAgentWindow: (agenteId: string) => Promise<boolean>;
  notifyNative: (payload: {
    id?: string;
    kind?: "approval" | "error" | "completion" | "update" | "info";
    title: string;
    body: string;
    agentId?: string | null;
  }) => Promise<{ shown: boolean; reason?: string }>;
  onNotificationClicked: (
    listener: (payload: { id?: string | null; kind?: string; agentId?: string | null }) => void
  ) => () => void;
  cuaAbort: (reason?: string) => Promise<boolean>;
  cuaResetAbort: () => Promise<boolean>;
  cuaPermissionStatus: () => Promise<{ granted: boolean; aborted: boolean }>;
  setWindowVibrancy: (enabled: boolean) => Promise<boolean>;
  onDeepLink: (listener: (payload: CriativoDeepLinkPayload) => void) => () => void;
  onOpenCommandPalette: (listener: () => void) => () => void;
  setGlobalShortcut: (accelerator: string) => Promise<boolean>;
  openBrowserPip: (payload?: { tabId?: string | null; agenteId?: string | null }) => Promise<boolean>;
  closeBrowserPip: () => Promise<boolean>;
  openDetachedBrowser: (payload?: {
    tabId?: string | null;
    agenteId?: string | null;
    displayId?: string | null;
  }) => Promise<boolean>;
  closeDetachedBrowser: () => Promise<boolean>;
  listDetachedBrowserDisplays: () => Promise<Array<{ id: string; label: string; primary: boolean }>>;
  onDetachedBrowserClosed: (listener: (info: { tabId: string | null }) => void) => () => void;
}

const bridge: CriativoDesktopBridge = {
  isPackagedDesktop: true,
  platform: process.platform,
  getDesktopInfo: () => ipcRenderer.invoke("criativo:get-info"),
  checkForUpdates: () => ipcRenderer.invoke("criativo:check-updates"),
  triggerUpdateInstall: (targetServerId?: string) =>
    ipcRenderer.invoke("criativo:trigger-update", targetServerId),
  restartForUpdate: () => ipcRenderer.invoke("criativo:restart-for-update"),
  openExternalSafe: (url: string) => ipcRenderer.invoke("criativo:open-external", url),
  openUserDataFolder: () => ipcRenderer.invoke("criativo:open-data-dir"),
  dockGetState: () => ipcRenderer.invoke("criativo:dock-get-state"),
  dockGetDisplays: () => ipcRenderer.invoke("criativo:dock-get-displays"),
  dockSetExpanded: (expanded: boolean, pillHeight?: number) =>
    ipcRenderer.invoke("criativo:dock-set-expanded", { expanded, pillHeight }),
  dockSetVisible: (visible: boolean) => ipcRenderer.invoke("criativo:dock-set-visible", visible),
  dockSetPinned: (pinned: boolean, pillHeight?: number) =>
    ipcRenderer.invoke("criativo:dock-set-pinned", { pinned, pillHeight }),
  dockSetPeeked: (peeked: boolean, pillHeight?: number) =>
    ipcRenderer.invoke("criativo:dock-set-peeked", { peeked, pillHeight }),
  dockConfigure: (config: CriativoDockConfigurePayload) =>
    ipcRenderer.invoke("criativo:dock-configure", config ?? {}),
  dockStartDrag: () => ipcRenderer.invoke("criativo:dock-start-drag"),
  dockMoveDrag: () => ipcRenderer.invoke("criativo:dock-move-drag"),
  dockEndDrag: () => ipcRenderer.invoke("criativo:dock-end-drag"),
  onDockStateChanged: (listener: (state: CriativoDockStatePayload) => void) => {
    const wrapped = (_event: unknown, payload: CriativoDockStatePayload) => {
      listener(payload);
    };
    ipcRenderer.on("criativo:dock-state-changed", wrapped);
    return () => {
      ipcRenderer.removeListener("criativo:dock-state-changed", wrapped);
    };
  },
  dockSyncActiveServer: (serverId: string) =>
    ipcRenderer.invoke("criativo:dock-sync-active-server", serverId),
  onDockActiveServerChanged: (listener: (serverId: string) => void) => {
    const wrapped = (_event: unknown, payload: { serverId?: string } | undefined) => {
      listener(typeof payload?.serverId === "string" && payload.serverId ? payload.serverId : "primary");
    };
    ipcRenderer.on("criativo:dock-active-server-changed", wrapped);
    return () => {
      ipcRenderer.removeListener("criativo:dock-active-server-changed", wrapped);
    };
  },
  openMainWindow: (opts?: CriativoMainNavigatePayload) =>
    ipcRenderer.invoke("criativo:open-main-window", opts ?? {}),
  onMainNavigate: (listener: (payload: CriativoMainNavigatePayload) => void) => {
    const wrapped = (_event: unknown, payload: CriativoMainNavigatePayload) => {
      listener(payload ?? {});
    };
    ipcRenderer.on("criativo:main-navigate", wrapped);
    return () => {
      ipcRenderer.removeListener("criativo:main-navigate", wrapped);
    };
  },
  pickFolder: () => ipcRenderer.invoke("criativo:pick-folder"),
  openAgentWindow: (agenteId: string) =>
    ipcRenderer.invoke("criativo:open-agent-window", { agenteId }),
  notifyNative: (payload) => ipcRenderer.invoke("criativo:notify-native", payload),
  onNotificationClicked: (listener) => {
    const wrapped = (
      _event: unknown,
      payload: { id?: string | null; kind?: string; agentId?: string | null }
    ) => {
      listener(payload ?? {});
    };
    ipcRenderer.on("criativo:notification-clicked", wrapped);
    return () => {
      ipcRenderer.removeListener("criativo:notification-clicked", wrapped);
    };
  },
  cuaAbort: (reason?: string) => ipcRenderer.invoke("criativo:cua-abort", reason),
  cuaResetAbort: () => ipcRenderer.invoke("criativo:cua-reset-abort"),
  cuaPermissionStatus: () => ipcRenderer.invoke("criativo:cua-permission-status"),
  setWindowVibrancy: (enabled: boolean) => ipcRenderer.invoke("criativo:set-window-vibrancy", enabled),
  onDeepLink: (listener: (payload: CriativoDeepLinkPayload) => void) => {
    const wrapped = (_event: unknown, payload: CriativoDeepLinkPayload) => {
      if (payload) listener(payload);
    };
    ipcRenderer.on("criativo:deep-link", wrapped);
    return () => {
      ipcRenderer.removeListener("criativo:deep-link", wrapped);
    };
  },
  onOpenCommandPalette: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("criativo:open-command-palette", wrapped);
    return () => {
      ipcRenderer.removeListener("criativo:open-command-palette", wrapped);
    };
  },
  setGlobalShortcut: (accelerator: string) =>
    ipcRenderer.invoke("criativo:set-global-shortcut", accelerator),
  openBrowserPip: (payload?: { tabId?: string | null; agenteId?: string | null }) =>
    ipcRenderer.invoke("criativo:browser-pip-open", payload ?? {}),
  closeBrowserPip: () => ipcRenderer.invoke("criativo:browser-pip-close"),
  openDetachedBrowser: (payload) => ipcRenderer.invoke("criativo:browser-detached-open", payload ?? {}),
  closeDetachedBrowser: () => ipcRenderer.invoke("criativo:browser-detached-close"),
  listDetachedBrowserDisplays: () => ipcRenderer.invoke("criativo:browser-detached-displays"),
  onDetachedBrowserClosed: (listener) => {
    const wrapped = (_event: unknown, info: { tabId: string | null }) => {
      listener(info ?? { tabId: null });
    };
    ipcRenderer.on("criativo:browser-detached-closed", wrapped);
    return () => {
      ipcRenderer.removeListener("criativo:browser-detached-closed", wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("criativoDesktop", bridge);
