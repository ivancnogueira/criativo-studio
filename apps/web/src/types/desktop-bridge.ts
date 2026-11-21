export interface CriativoMainNavigatePayload {
  agenteId?: string;
  action?: "new-agent" | "open-dock-settings";
}

export interface CriativoDockStatePayload {
  visible: boolean;
  expanded: boolean;
  side: "left" | "right";
  pinned?: boolean;
  peeked?: boolean;
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

export interface CriativoDesktopWindowBridge {
  isPackagedDesktop: boolean;
  platform?: string;
  getDesktopInfo: () => Promise<{ version: string; daemonUrl: string; userDataDir: string }>;
  checkForUpdates: () => Promise<unknown>;
  triggerUpdateInstall: (targetServerId?: string) => Promise<unknown>;
  restartForUpdate: () => Promise<unknown>;
  openExternalSafe: (url: string) => Promise<boolean>;
  openUserDataFolder: () => Promise<void>;
  dockGetState?: () => Promise<CriativoDockStatePayload>;
  dockGetDisplays?: () => Promise<Array<{ id: string; label: string; primary: boolean }>>;
  dockSetExpanded?: (expanded: boolean, pillHeight?: number) => Promise<CriativoDockStatePayload>;
  dockSetVisible?: (visible: boolean) => Promise<boolean>;
  dockSetPinned?: (pinned: boolean, pillHeight?: number) => Promise<CriativoDockStatePayload>;
  dockSetPeeked?: (peeked: boolean, pillHeight?: number) => Promise<CriativoDockStatePayload>;
  dockConfigure?: (config: CriativoDockConfigurePayload) => Promise<CriativoDockStatePayload>;
  dockStartDrag?: () => Promise<void>;
  dockMoveDrag?: () => Promise<void>;
  dockEndDrag?: () => Promise<CriativoDockStatePayload>;
  onDockStateChanged?: (listener: (state: CriativoDockStatePayload) => void) => () => void;
  dockSyncActiveServer?: (serverId: string) => Promise<boolean>;
  onDockActiveServerChanged?: (listener: (serverId: string) => void) => () => void;
  openMainWindow?: (opts?: CriativoMainNavigatePayload) => Promise<void>;
  onMainNavigate?: (listener: (payload: CriativoMainNavigatePayload) => void) => () => void;
  pickFolder?: () => Promise<{ canceled: boolean; path: string | null }>;
  openAgentWindow?: (agenteId: string) => Promise<boolean>;
}

export function getCriativoDesktopBridge(): CriativoDesktopWindowBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { criativoDesktop?: CriativoDesktopWindowBridge };
  return w.criativoDesktop ?? null;
}
