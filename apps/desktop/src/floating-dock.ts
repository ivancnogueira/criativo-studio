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
}

export interface FloatingDockControllerOptions {
  daemonBaseUrl: string;
  userDataDir: string;
  isAllowedOrigin: (rawUrl: string) => boolean;
  onOpenExternal: (rawUrl: string) => boolean;
  onLog?: (msg: string) => void;
}

const COLLAPSED_WIDTH = 92;
const DEFAULT_PILL_HEIGHT = 360;
const MIN_PILL_HEIGHT = 200;
const MAX_PILL_HEIGHT = 640;
const EXPANDED_WIDTH = 480;
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
        return {
          x: typeof raw.x === "number" && Number.isFinite(raw.x) ? Math.round(raw.x) : undefined,
          y: typeof raw.y === "number" && Number.isFinite(raw.y) ? Math.round(raw.y) : undefined,
          visible: typeof raw.visible === "boolean" ? raw.visible : true,
          side: raw.side === "left" ? "left" : "right",
        };
      }
    } catch {
      // Usa estado padrão se arquivo estiver corrompido
    }
    return { visible: true, side: "right" };
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

  private resolveInitialPillBounds(): { x: number; y: number; width: number; height: number } {
    const primary = screen.getPrimaryDisplay();
    const wa = primary.workArea;
    const width = COLLAPSED_WIDTH;
    const height = this.pillHeight;

    let x =
      typeof this.state.x === "number"
        ? this.state.x
        : wa.x + wa.width - width - 8;
    let y =
      typeof this.state.y === "number"
        ? this.state.y
        : Math.round(wa.y + (wa.height - height) / 2);

    const targetDisplay = screen.getDisplayMatching({ x, y, width, height });
    const dwa = targetDisplay.workArea;
    x = clamp(x, dwa.x, Math.max(dwa.x, dwa.x + dwa.width - width));
    y = clamp(y, dwa.y, Math.max(dwa.y, dwa.y + dwa.height - height));
    return { x, y, width, height };
  }

  private applyAlwaysOnTop(win: BrowserWindow): void {
    try {
      win.setAlwaysOnTop(true, process.platform === "darwin" ? "floating" : "screen-saver");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      win.setAlwaysOnTop(true);
    }
  }

  public async init(): Promise<void> {
    if (this.win && !this.win.isDestroyed()) return;

    const initial = this.resolveInitialPillBounds();
    this.pillX = initial.x;
    this.pillY = initial.y;

    const win = new BrowserWindow({
      width: initial.width,
      height: initial.height,
      x: initial.x,
      y: initial.y,
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      backgroundColor: "#00000000",
      show: false,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
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
      }
    } catch (err) {
      this.options.onLog?.(
        `[FloatingDock] Aviso ao carregar dock flutuante: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  public getState(): { visible: boolean; expanded: boolean; side: FloatingDockSide } {
    return {
      visible: this.state.visible,
      expanded: this.expanded,
      side: this.state.side,
    };
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
      }
    } else if (this.win && !this.win.isDestroyed()) {
      this.expanded = false;
      this.win.hide();
    }
    return this.state.visible;
  }

  public async toggleVisible(): Promise<boolean> {
    return await this.setVisible(!this.state.visible);
  }

  public setExpanded(expanded: boolean, nextPillHeight?: number): { side: FloatingDockSide } {
    if (typeof nextPillHeight === "number" && Number.isFinite(nextPillHeight)) {
      this.pillHeight = clamp(nextPillHeight, MIN_PILL_HEIGHT, MAX_PILL_HEIGHT);
    }
    const win = this.win;
    if (!win || win.isDestroyed()) {
      this.expanded = Boolean(expanded);
      return { side: this.state.side };
    }

    const currentBounds = win.getBounds();
    const display = screen.getDisplayMatching(currentBounds);
    const wa = display.workArea;

    if (expanded) {
      // Atualiza referência da pílula caso ainda estivesse recolhida
      if (!this.expanded) {
        this.pillX = currentBounds.x;
        this.pillY = currentBounds.y;
      }
      const centerRatio = (this.pillX + COLLAPSED_WIDTH / 2 - wa.x) / Math.max(1, wa.width);
      this.state.side = centerRatio < 0.5 ? "left" : "right";

      const targetW = EXPANDED_WIDTH;
      const targetH = Math.min(EXPANDED_HEIGHT, Math.max(360, wa.height - 24));
      let targetX =
        this.state.side === "right"
          ? this.pillX + COLLAPSED_WIDTH - targetW
          : this.pillX;
      let targetY = Math.round(this.pillY + this.pillHeight / 2 - targetH / 2);

      targetX = clamp(targetX, wa.x + 4, Math.max(wa.x + 4, wa.x + wa.width - targetW - 4));
      targetY = clamp(targetY, wa.y + 4, Math.max(wa.y + 4, wa.y + wa.height - targetH - 4));

      this.expanded = true;
      win.setBounds({ x: targetX, y: targetY, width: targetW, height: targetH });
      win.focus();
      this.applyAlwaysOnTop(win);
      return { side: this.state.side };
    }

    // Recolhendo de volta exatamente para a âncora da pílula
    this.expanded = false;
    const collapsedW = COLLAPSED_WIDTH;
    const collapsedH = this.pillHeight;
    const targetX = clamp(this.pillX, wa.x, Math.max(wa.x, wa.x + wa.width - collapsedW));
    const targetY = clamp(this.pillY, wa.y, Math.max(wa.y, wa.y + wa.height - collapsedH));
    this.pillX = targetX;
    this.pillY = targetY;
    win.setBounds({ x: targetX, y: targetY, width: collapsedW, height: collapsedH });
    this.applyAlwaysOnTop(win);
    this.saveState();
    return { side: this.state.side };
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

  public endDrag(): { side: FloatingDockSide } {
    this.dragOrigin = null;
    const win = this.win;
    if (!win || win.isDestroyed()) {
      return { side: this.state.side };
    }

    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const wa = display.workArea;

    if (this.expanded) {
      if (this.state.side === "right") {
        this.pillX = bounds.x + bounds.width - COLLAPSED_WIDTH;
      } else {
        this.pillX = bounds.x;
      }
      this.pillY = clamp(
        Math.round(bounds.y + bounds.height / 2 - this.pillHeight / 2),
        wa.y,
        Math.max(wa.y, wa.y + wa.height - this.pillHeight),
      );
    } else {
      this.pillX = bounds.x;
      this.pillY = bounds.y;
    }

    const centerRatio = (this.pillX + COLLAPSED_WIDTH / 2 - wa.x) / Math.max(1, wa.width);
    this.state.side = centerRatio < 0.5 ? "left" : "right";
    this.saveState();
    return { side: this.state.side };
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
