import { join } from "node:path";
import { BrowserWindow, screen } from "electron";
import { computeDetachedWindowBounds, type DetachedDisplayInfo } from "./browser-window-bounds.ts";

export interface DetachedBrowserOpenOptions {
  daemonBaseUrl: string;
  tabId?: string | null;
  agenteId?: string | null;
  displayId?: string | null;
  preloadPath?: string;
  isLocalOrigin: (url: string) => boolean;
  openExternalValidated: (url: string) => boolean;
  onClosed?: (info: { tabId: string | null }) => void;
}

function listDisplays(): Array<DetachedDisplayInfo & { label: string }> {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, idx) => ({
    id: String(d.id),
    primary: d.id === primaryId,
    workArea: d.workArea,
    label: `Monitor ${idx + 1}${d.id === primaryId ? " (principal)" : ""} — ${d.size.width}×${d.size.height}`,
  }));
}

/**
 * Janela de trabalho separada (multi-monitor) do navegador do agente.
 * Diferente do PiP: sem `alwaysOnTop`, tamanho de trabalho e posicionamento por monitor.
 */
export class DetachedBrowserWindowController {
  private win: BrowserWindow | null = null;
  private currentTabId: string | null = null;

  public isOpen(): boolean {
    return Boolean(this.win && !this.win.isDestroyed());
  }

  public getDisplays(): Array<{ id: string; label: string; primary: boolean }> {
    return listDisplays().map((d) => ({ id: String(d.id), label: d.label, primary: Boolean(d.primary) }));
  }

  public async open(opts: DetachedBrowserOpenOptions): Promise<boolean> {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      return true;
    }

    const bounds = computeDetachedWindowBounds(listDisplays(), opts.displayId ?? null);
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: 640,
      minHeight: 480,
      alwaysOnTop: false,
      autoHideMenuBar: true,
      title: "CriativoOS — Navegador do Criativo",
      backgroundColor: "#0D0D0F",
      webPreferences: {
        preload: opts.preloadPath || join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!opts.isLocalOrigin(url)) {
        opts.openExternalValidated(url);
        return { action: "deny" };
      }
      return { action: "allow" };
    });
    win.webContents.on("will-navigate", (event: { preventDefault: () => void }, url: string) => {
      if (!opts.isLocalOrigin(url)) {
        event.preventDefault();
        opts.openExternalValidated(url);
      }
    });

    this.currentTabId = opts.tabId ?? null;
    win.on("closed", () => {
      if (this.win === win) {
        this.win = null;
        opts.onClosed?.({ tabId: this.currentTabId });
        this.currentTabId = null;
      }
    });

    this.win = win;
    const qs = new URLSearchParams();
    qs.set("detachedBrowser", "1");
    if (opts.tabId) qs.set("tabId", opts.tabId);
    if (opts.agenteId) qs.set("agent", opts.agenteId);
    await win.loadURL(`${opts.daemonBaseUrl}/?${qs.toString()}`);
    return true;
  }

  public close(): boolean {
    if (!this.win || this.win.isDestroyed()) {
      this.win = null;
      return false;
    }
    this.win.close();
    return true;
  }
}
