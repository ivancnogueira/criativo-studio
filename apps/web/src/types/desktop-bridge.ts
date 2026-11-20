export interface CriativoMainNavigatePayload {
  agenteId?: string;
  action?: "new-agent";
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
  dockGetState?: () => Promise<{ visible: boolean; expanded: boolean; side: "left" | "right" }>;
  dockSetExpanded?: (expanded: boolean, pillHeight?: number) => Promise<{ side: "left" | "right" }>;
  dockSetVisible?: (visible: boolean) => Promise<boolean>;
  dockStartDrag?: () => Promise<void>;
  dockMoveDrag?: () => Promise<void>;
  dockEndDrag?: () => Promise<{ side: "left" | "right" }>;
  openMainWindow?: (opts?: CriativoMainNavigatePayload) => Promise<void>;
  onMainNavigate?: (listener: (payload: CriativoMainNavigatePayload) => void) => () => void;
}

export function getCriativoDesktopBridge(): CriativoDesktopWindowBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { criativoDesktop?: CriativoDesktopWindowBridge };
  return w.criativoDesktop ?? null;
}
