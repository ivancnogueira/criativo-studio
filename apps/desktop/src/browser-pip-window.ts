import { join } from "node:path";
import { BrowserWindow } from "electron";

export interface BrowserPipOpenOptions {
  daemonBaseUrl: string;
  tabId?: string | null;
  agenteId?: string | null;
  preloadPath?: string;
  isLocalOrigin: (url: string) => boolean;
  openExternalValidated: (url: string) => boolean;
}

/**
 * Controlador da mini-janela flutuante Picture-in-Picture (PiP) nativa do Electron (G-06),
 * sempre no topo (420x280, redimensionável) para acompanhar/assumir o navegador durante tarefas ou CAPTCHAs.
 */
export class BrowserPipWindowController {
  private pipWin: BrowserWindow | null = null;

  public isOpen(): boolean {
    return Boolean(this.pipWin && !this.pipWin.isDestroyed());
  }

  public async open(opts: BrowserPipOpenOptions): Promise<boolean> {
    if (this.pipWin && !this.pipWin.isDestroyed()) {
      this.pipWin.show();
      this.pipWin.focus();
      return true;
    }

    const win = new BrowserWindow({
      width: 420,
      height: 280,
      minWidth: 320,
      minHeight: 220,
      alwaysOnTop: true,
      resizable: true,
      autoHideMenuBar: true,
      title: "Criativo Browser PiP",
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

    win.on("closed", () => {
      if (this.pipWin === win) {
        this.pipWin = null;
      }
    });

    this.pipWin = win;
    const qs = new URLSearchParams();
    qs.set("browserPip", "1");
    if (opts.tabId) qs.set("tabId", opts.tabId);
    if (opts.agenteId) qs.set("agent", opts.agenteId);
    await win.loadURL(`${opts.daemonBaseUrl}/?${qs.toString()}`);
    return true;
  }

  public close(): boolean {
    if (!this.pipWin || this.pipWin.isDestroyed()) {
      this.pipWin = null;
      return false;
    }
    this.pipWin.close();
    this.pipWin = null;
    return true;
  }
}
