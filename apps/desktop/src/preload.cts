import { contextBridge, ipcRenderer } from "electron";

export interface CriativoDesktopBridge {
  isPackagedDesktop: boolean;
  platform: NodeJS.Platform;
  getDesktopInfo: () => Promise<{ version: string; daemonUrl: string; userDataDir: string }>;
  checkForUpdates: () => Promise<unknown>;
  triggerUpdateInstall: (targetServerId?: string) => Promise<unknown>;
  restartForUpdate: () => Promise<unknown>;
  openExternalSafe: (url: string) => Promise<boolean>;
  openUserDataFolder: () => Promise<void>;
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
};

contextBridge.exposeInMainWorld("criativoDesktop", bridge);
