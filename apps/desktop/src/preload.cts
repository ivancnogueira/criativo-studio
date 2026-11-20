import { contextBridge, ipcRenderer } from "electron";

export interface CriativoMainNavigatePayload {
  agenteId?: string;
  action?: "new-agent";
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
  dockGetState: () => Promise<{ visible: boolean; expanded: boolean; side: "left" | "right" }>;
  dockSetExpanded: (expanded: boolean, pillHeight?: number) => Promise<{ side: "left" | "right" }>;
  dockSetVisible: (visible: boolean) => Promise<boolean>;
  dockStartDrag: () => Promise<void>;
  dockMoveDrag: () => Promise<void>;
  dockEndDrag: () => Promise<{ side: "left" | "right" }>;
  openMainWindow: (opts?: CriativoMainNavigatePayload) => Promise<void>;
  onMainNavigate: (listener: (payload: CriativoMainNavigatePayload) => void) => () => void;
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
  dockSetExpanded: (expanded: boolean, pillHeight?: number) =>
    ipcRenderer.invoke("criativo:dock-set-expanded", { expanded, pillHeight }),
  dockSetVisible: (visible: boolean) => ipcRenderer.invoke("criativo:dock-set-visible", visible),
  dockStartDrag: () => ipcRenderer.invoke("criativo:dock-start-drag"),
  dockMoveDrag: () => ipcRenderer.invoke("criativo:dock-move-drag"),
  dockEndDrag: () => ipcRenderer.invoke("criativo:dock-end-drag"),
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
};

contextBridge.exposeInMainWorld("criativoDesktop", bridge);
