import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, screen } from "electron";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type FloatingDockSide = "left" | "right";

export interface FloatingDockSavedState {
  x?: number;
  y?: number;
  visible: boolean;
  side: FloatingDockSide;
  pinned: boolean;
  scalePercent?: number;
  alwaysOnTop?: boolean;
  displayId?: string;
}

export interface FloatingDockStateSnapshot {
  visible: boolean;
  expanded: boolean;
  side: FloatingDockSide;
  pinned: boolean;
  peeked: boolean;
  scalePercent: number;
  alwaysOnTop: boolean;
  displayId: string;
}

export interface FloatingDockConfigurePayload {
  visible?: boolean;
  side?: FloatingDockSide;
  pinned?: boolean;
  scalePercent?: number;
  alwaysOnTop?: boolean;
  displayId?: string;
  pillHeight?: number;
}

export interface FloatingDockControllerOptions {
  daemonBaseUrl: string;
  userDataDir: string;
  isAllowedOrigin: (rawUrl: string) => boolean;
  onOpenExternal: (rawUrl: string) => boolean;
  onLog?: (msg: string) => void;
}

const EDGE_PEEK_WIDTH = 20;
const COLLAPSED_WIDTH = 66;
const DEFAULT_PILL_HEIGHT = 332;
const MIN_PILL_HEIGHT = 180;
const MAX_PILL_HEIGHT = 620;
const EXPANDED_WIDTH = 446;
const EXPANDED_HEIGHT = 576;

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val)));
}

export class FloatingDockController {
  private readonly options: FloatingDockControllerOptions;
  private readonly statePath: string;
  private win: BrowserWindow | null = null;
  private state: FloatingDockSavedState;
  private expanded = false;
  private peeked = false;
  private pillHeight = DEFAULT_PILL_HEIGHT;
  private pillX = 0;
  private pillY = 0;
  private dragOrigin: {
    cursorX: number;
    cursorY: number;
    winX: number;
    winY: number;
    winW: number;
    winH: number;
  } | null = null;

  constructor(options: FloatingDockControllerOptions) {
    this.options = options;
    this.statePath = join(options.userDataDir, "floating-dock-state.json");
    this.state = this.loadState();
  }

  private loadState(): FloatingDockSavedState {
    try {
      if (existsSync(this.statePath)) {
        const raw = JSON.parse(readFileSync(this.statePath, "utf8")) as Partial<FloatingDockSavedState>;
        const scalePercent =
          typeof raw.scalePercent === "number" && Number.isFinite(raw.scalePercent)
            ? clamp(raw.scalePercent, 80, 150)
            : 100;
        return {
          x: typeof raw.x === "number" && Number.isFinite(raw.x) ? Math.round(raw.x) : undefined,
          y: typeof raw.y === "number" && Number.isFinite(raw.y) ? Math.round(raw.y) : undefined,
          visible: typeof raw.visible === "boolean" ? raw.visible : true,
          side: raw.side === "left" ? "left" : "right",
          pinned: typeof raw.pinned === "boolean" ? raw.pinned : true,
          scalePercent,
          alwaysOnTop: typeof raw.alwaysOnTop === "boolean" ? raw.alwaysOnTop : true,
          displayId: typeof raw.displayId === "string" && raw.displayId.trim() ? raw.displayId.trim() : "principal",
        };
      }
    } catch {
      // Usa estado padrão se arquivo estiver corrompido
    }
    return {
      visible: true,
      side: "right",
      pinned: true,
      scalePercent: 100,
      alwaysOnTop: true,
      displayId: "principal",
    };
  }

  private saveState(): void {
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeFileSync(
        this.statePath,
        JSON.stringify(
          {
            x: this.pillX,
            y: this.pillY,
            visible: this.state.visible,
            side: this.state.side,
            pinned: this.state.pinned,
            scalePercent: this.state.scalePercent ?? 100,
            alwaysOnTop: this.state.alwaysOnTop !== false,
            displayId: this.state.displayId ?? "principal",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
    } catch {
      // Ignora falha de gravação em disco
    }
  }

  private getCurrentCollapsedWidth(): number {
    if (!this.state.pinned && !this.peeked) return EDGE_PEEK_WIDTH;
    const scale = clamp(this.state.scalePercent ?? 100, 80, 150) / 100;
    return Math.max(54, Math.round(COLLAPSED_WIDTH * scale));
  }

  private resolveTargetDisplay(fallbackBounds?: Electron.Rectangle): Electron.Display {
    const displays = screen.getAllDisplays();
    const pref = this.state.displayId ?? "principal";
    if (pref !== "principal") {
      const matched = displays.find((d) => String(d.id) === pref);
      if (matched) return matched;
    }
    if (fallbackBounds) {
      return screen.getDisplayMatching(fallbackBounds);
    }
    return screen.getPrimaryDisplay();
  }

  private resolveEdgeX(wa: Electron.Rectangle, width: number, side: FloatingDockSide): number {
    return side === "left" ? wa.x : Math.max(wa.x, wa.x + wa.width - width);
  }

  private resolveInitialPillBounds(): { x: number; y: number; width: number; height: number } {
    const targetDisplay = this.resolveTargetDisplay();
    const wa = targetDisplay.workArea;
    const width = this.getCurrentCollapsedWidth();
    const scale = clamp(this.state.scalePercent ?? 100, 80, 150) / 100;
    const height = clamp(Math.round(this.pillHeight * scale), MIN_PILL_HEIGHT, MAX_PILL_HEIGHT);

    let x = this.resolveEdgeX(wa, width, this.state.side);
    let y =
      typeof this.state.y === "number"
        ? this.state.y
        : Math.round(wa.y + (wa.height - height) / 2);

    x = this.resolveEdgeX(wa, width, this.state.side);
    y = clamp(y, wa.y, Math.max(wa.y, wa.y + wa.height - height));
    return { x, y, width, height };
  }

  private applyAlwaysOnTop(win: BrowserWindow): void {
    const onTop = this.state.alwaysOnTop !== false;
    try {
      if (onTop) {
        win.setAlwaysOnTop(true, process.platform === "darwin" ? "floating" : "screen-saver");
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } else {
        win.setAlwaysOnTop(false);
        win.setVisibleOnAllWorkspaces(false);
      }
    } catch {
      win.setAlwaysOnTop(onTop);
    }
  }

  /**
   * Atualiza bounds no Windows com frame transparente sem provocar redraw da barra nativa do DWM.
   */
  private safeSetBounds(
    win: BrowserWindow,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    try {
      win.setResizable(true);
      win.setMinimumSize(1, 1);
      win.setBounds(bounds, false);
    } finally {
      try {
        win.setResizable(false);
      } catch {
        // ignora caso janela esteja fechando
      }
    }
  }

  private notifyRendererState(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send("criativo:dock-state-changed", this.getState());
    }
  }

  public notifyActiveServerChanged(serverId: string): void {
    const clean = typeof serverId === "string" && serverId.trim() ? serverId.trim() : "primary";
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send("criativo:dock-active-server-changed", { serverId: clean });
    }
  }

  private applyCollapsedBounds(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || this.expanded) return;

    const currentBounds = win.getBounds();
    const display = this.resolveTargetDisplay(currentBounds);
    const wa = display.workArea;
    const width = this.getCurrentCollapsedWidth();
    const scale = clamp(this.state.scalePercent ?? 100, 80, 150) / 100;
    const height = clamp(Math.round(this.pillHeight * scale), MIN_PILL_HEIGHT, MAX_PILL_HEIGHT);
    const targetX = this.resolveEdgeX(wa, width, this.state.side);
    const targetY = clamp(this.pillY, wa.y, Math.max(wa.y, wa.y + wa.height - height));

    this.pillX = targetX;
    this.pillY = targetY;
    this.safeSetBounds(win, { x: targetX, y: targetY, width, height });
    this.applyAlwaysOnTop(win);
  }

  public async init(): Promise<void> {
    if (this.win && !this.win.isDestroyed()) return;

    const initial = this.resolveInitialPillBounds();
    this.pillX = initial.x;
    this.pillY = initial.y;

    const win = new BrowserWindow({
      title: "",
      width: initial.width,
      height: initial.height,
      x: initial.x,
      y: initial.y,
      transparent: true,
      frame: false,
      thickFrame: false,
      hasShadow: false,
      roundedCorners: false,
      autoHideMenuBar: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      focusable: true,
      backgroundColor: "#00000000",
      show: false,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    try {
      win.setMenu(null);
      win.removeMenu?.();
    } catch {
      // ignora em plataformas sem menu por janela
    }

    win.on("page-title-updated", (event: { preventDefault: () => void }) => {
      event.preventDefault();
    });

    this.applyAlwaysOnTop(win);

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!this.options.isAllowedOrigin(url)) {
        this.options.onOpenExternal(url);
        return { action: "deny" };
      }
      return { action: "allow" };
    });

    win.webContents.on("will-navigate", (event: { preventDefault: () => void }, url: string) => {
      if (!this.options.isAllowedOrigin(url)) {
        event.preventDefault();
        this.options.onOpenExternal(url);
      }
    });

    win.on("closed", () => {
      this.win = null;
    });

    this.win = win;

    try {
      await win.loadURL(`${this.options.daemonBaseUrl}/?mode=floating-dock`);
      if (this.state.visible && !win.isDestroyed()) {
        win.showInactive();
        this.applyAlwaysOnTop(win);
        this.notifyRendererState();
      }
    } catch (err) {
      this.options.onLog?.(
        `[FloatingDock] Aviso ao carregar dock flutuante: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  public getState(): FloatingDockStateSnapshot {
    return {
      visible: this.state.visible,
      expanded: this.expanded,
      side: this.state.side,
      pinned: this.state.pinned,
      peeked: this.peeked,
      scalePercent: this.state.scalePercent ?? 100,
      alwaysOnTop: this.state.alwaysOnTop !== false,
      displayId: this.state.displayId ?? "principal",
    };
  }

  public async configure(opts: FloatingDockConfigurePayload): Promise<FloatingDockStateSnapshot> {
    if (typeof opts.pillHeight === "number" && Number.isFinite(opts.pillHeight)) {
      this.pillHeight = clamp(opts.pillHeight, MIN_PILL_HEIGHT, MAX_PILL_HEIGHT);
    }
    if (opts.side === "left" || opts.side === "right") {
      this.state.side = opts.side;
    }
    if (typeof opts.pinned === "boolean") {
      this.state.pinned = opts.pinned;
      if (!this.state.pinned) this.peeked = false;
    }
    if (typeof opts.scalePercent === "number" && Number.isFinite(opts.scalePercent)) {
      this.state.scalePercent = clamp(opts.scalePercent, 80, 150);
    }
    if (typeof opts.alwaysOnTop === "boolean") {
      this.state.alwaysOnTop = opts.alwaysOnTop;
    }
    if (typeof opts.displayId === "string" && opts.displayId.trim()) {
      this.state.displayId = opts.displayId.trim();
    }
    if (typeof opts.visible === "boolean") {
      await this.setVisible(opts.visible);
    } else {
      this.saveState();
    }
    if (this.win && !this.win.isDestroyed()) {
      if (this.expanded) {
        const bounds = this.win.getBounds();
        const display = this.resolveTargetDisplay(bounds);
        const wa = display.workArea;
        const targetX = this.resolveEdgeX(wa, bounds.width, this.state.side);
        const targetY = clamp(bounds.y, wa.y, Math.max(wa.y, wa.y + wa.height - bounds.height));
        this.safeSetBounds(this.win, { x: targetX, y: targetY, width: bounds.width, height: bounds.height });
        this.applyAlwaysOnTop(this.win);
      } else {
        this.applyCollapsedBounds();
      }
      this.notifyRendererState();
    }
    return this.getState();
  }

  public async setVisible(visible: boolean): Promise<boolean> {
    this.state.visible = Boolean(visible);
    this.saveState();
    if (this.state.visible) {
      if (!this.win || this.win.isDestroyed()) {
        await this.init();
      }
      if (this.win && !this.win.isDestroyed()) {
        this.win.showInactive();
        this.applyAlwaysOnTop(this.win);
        this.notifyRendererState();
      }
    } else if (this.win && !this.win.isDestroyed()) {
      this.expanded = false;
      this.peeked = false;
      this.win.hide();
    }
    return this.state.visible;
  }

  public async toggleVisible(): Promise<boolean> {
    return await this.setVisible(!this.state.visible);
  }

  public setPinned(pinned: boolean, nextPillHeight?: number): FloatingDockStateSnapshot {
    if (typeof nextPillHeight === "number" && Number.isFinite(nextPillHeight)) {
      this.pillHeight = clamp(nextPillHeight, MIN_PILL_HEIGHT, MAX_PILL_HEIGHT);
    }
    this.state.pinned = Boolean(pinned);
    if (!this.state.pinned) {
      this.peeked = false;
    }
    this.saveState();
    if (!this.expanded) {
      this.applyCollapsedBounds();
    }
    this.notifyRendererState();
    return this.getState();
  }

  public setPeeked(peeked: boolean, nextPillHeight?: number): FloatingDockStateSnapshot {
    if (typeof nextPillHeight === "number" && Number.isFinite(nextPillHeight)) {
      this.pillHeight = clamp(nextPillHeight, MIN_PILL_HEIGHT, MAX_PILL_HEIGHT);
    }
    this.peeked = Boolean(peeked);
    if (!this.expanded && !this.state.pinned) {
      this.applyCollapsedBounds();
    }
    this.notifyRendererState();
    return this.getState();
  }

  public setExpanded(expanded: boolean, nextPillHeight?: number): FloatingDockStateSnapshot {
    if (typeof nextPillHeight === "number" && Number.isFinite(nextPillHeight)) {
      this.pillHeight = clamp(nextPillHeight, MIN_PILL_HEIGHT, MAX_PILL_HEIGHT);
    }
    const win = this.win;
    if (!win || win.isDestroyed()) {
      this.expanded = Boolean(expanded);
      return this.getState();
    }

    const currentBounds = win.getBounds();
    const display = screen.getDisplayMatching(currentBounds);
    const wa = display.workArea;

    if (expanded) {
      if (!this.expanded) {
        this.pillY = currentBounds.y;
      }
      this.peeked = true;
      const targetW = EXPANDED_WIDTH;
      const targetH = Math.min(EXPANDED_HEIGHT, Math.max(360, wa.height - 24));
      const targetX = this.resolveEdgeX(wa, targetW, this.state.side);
      const targetY = clamp(
        Math.round(this.pillY + this.pillHeight / 2 - targetH / 2),
        wa.y + 4,
        Math.max(wa.y + 4, wa.y + wa.height - targetH - 4),
      );

      this.expanded = true;
      this.safeSetBounds(win, { x: targetX, y: targetY, width: targetW, height: targetH });
      win.focus();
      this.applyAlwaysOnTop(win);
      this.notifyRendererState();
      return this.getState();
    }

    this.expanded = false;
    if (!this.state.pinned) {
      this.peeked = false;
    }
    this.applyCollapsedBounds();
    this.saveState();
    this.notifyRendererState();
    return this.getState();
  }

  public startDrag(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    this.dragOrigin = {
      cursorX: cursor.x,
      cursorY: cursor.y,
      winX: bounds.x,
      winY: bounds.y,
      winW: bounds.width,
      winH: bounds.height,
    };
  }

  public moveDrag(): void {
    const win = this.win;
    const origin = this.dragOrigin;
    if (!win || win.isDestroyed() || !origin) return;

    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - origin.cursorX;
    const dy = cursor.y - origin.cursorY;

    const display = screen.getDisplayNearestPoint(cursor);
    const wa = display.workArea;

    const nextX = clamp(
      origin.winX + dx,
      wa.x,
      Math.max(wa.x, wa.x + wa.width - origin.winW),
    );
    const nextY = clamp(
      origin.winY + dy,
      wa.y,
      Math.max(wa.y, wa.y + wa.height - origin.winH),
    );

    win.setPosition(nextX, nextY, false);
  }

  public endDrag(): FloatingDockStateSnapshot {
    this.dragOrigin = null;
    const win = this.win;
    if (!win || win.isDestroyed()) {
      return this.getState();
    }

    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const wa = display.workArea;

    const centerRatio = (bounds.x + bounds.width / 2 - wa.x) / Math.max(1, wa.width);
    this.state.side = centerRatio < 0.5 ? "left" : "right";

    const snapX = this.resolveEdgeX(wa, bounds.width, this.state.side);
    const snapY = clamp(bounds.y, wa.y, Math.max(wa.y, wa.y + wa.height - bounds.height));

    if (this.expanded) {
      this.safeSetBounds(win, { x: snapX, y: snapY, width: bounds.width, height: bounds.height });
      this.pillY = clamp(
        Math.round(snapY + bounds.height / 2 - this.pillHeight / 2),
        wa.y,
        Math.max(wa.y, wa.y + wa.height - this.pillHeight),
      );
      this.pillX = this.resolveEdgeX(wa, this.getCurrentCollapsedWidth(), this.state.side);
    } else {
      this.pillX = snapX;
      this.pillY = snapY;
      this.safeSetBounds(win, { x: snapX, y: snapY, width: bounds.width, height: bounds.height });
    }

    this.applyAlwaysOnTop(win);
    this.saveState();
    this.notifyRendererState();
    return this.getState();
  }

  public destroy(): void {
    this.dragOrigin = null;
    if (this.win && !this.win.isDestroyed()) {
      try {
        this.win.destroy();
      } catch {
        // Ignora erro ao destruir na finalização do app
      }
    }
    this.win = null;
  }
}
