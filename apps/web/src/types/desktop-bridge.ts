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
  notifyNative?: (payload: {
    id?: string;
    kind?: "approval" | "error" | "completion" | "update" | "info";
    title: string;
    body: string;
    agentId?: string | null;
  }) => Promise<{ shown: boolean; reason?: string }>;
  onNotificationClicked?: (
    listener: (payload: { id?: string | null; kind?: string; agentId?: string | null }) => void
  ) => () => void;
  cuaAbort?: (reason?: string) => Promise<boolean>;
  cuaResetAbort?: () => Promise<boolean>;
  cuaPermissionStatus?: () => Promise<{ granted: boolean; aborted: boolean }>;
  setWindowVibrancy?: (enabled: boolean) => Promise<boolean>;
  onDeepLink?: (listener: (payload: CriativoDeepLinkPayload) => void) => () => void;
  onOpenCommandPalette?: (listener: () => void) => () => void;
  setGlobalShortcut?: (accelerator: string) => Promise<boolean>;
  openBrowserPip?: (payload?: { tabId?: string | null; agenteId?: string | null }) => Promise<boolean>;
  closeBrowserPip?: () => Promise<boolean>;
  openDetachedBrowser?: (payload?: {
    tabId?: string | null;
    agenteId?: string | null;
    displayId?: string | null;
  }) => Promise<boolean>;
  closeDetachedBrowser?: () => Promise<boolean>;
  listDetachedBrowserDisplays?: () => Promise<Array<{ id: string; label: string; primary: boolean }>>;
  onDetachedBrowserClosed?: (listener: (info: { tabId: string | null }) => void) => () => void;
}

export function getCriativoDesktopBridge(): CriativoDesktopWindowBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { criativoDesktop?: CriativoDesktopWindowBridge };
  return w.criativoDesktop ?? null;
}
