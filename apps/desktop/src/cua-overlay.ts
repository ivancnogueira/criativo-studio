import { BrowserWindow, screen } from "electron";
import type { CuaPoint, CuaRegion } from "@criativo/contracts";

function buildOverlayDataUrl(): string {
  const html = `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <style>
        html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;pointer-events:none;font-family:system-ui,sans-serif}
        #cursor{position:fixed;left:0;top:0;width:24px;height:24px;transform:translate(-999px,-999px);transition:transform .14s cubic-bezier(.22,1,.36,1);pointer-events:none;z-index:20}
        #cursor-ring{width:22px;height:22px;border-radius:999px;border:2px solid #42A0FF;background:rgba(0,124,247,.22);box-shadow:0 0 18px rgba(66,160,255,.75)}
        #cursor-label{position:absolute;left:22px;top:14px;padding:2px 8px;border-radius:999px;background:rgba(13,13,13,.88);border:1px solid rgba(66,160,255,.5);color:#fff;font-size:11px;font-weight:600;white-space:nowrap}
        #highlight{position:fixed;border:2px solid #31CF76;border-radius:10px;background:rgba(49,207,118,.08);box-shadow:0 0 24px rgba(49,207,118,.35);display:none;pointer-events:none;z-index:10}
      </style>
    </head>
    <body>
      <div id="highlight"></div>
      <div id="cursor"><div id="cursor-ring"></div><div id="cursor-label">CUA</div></div>
      <script>
        window.__updateCuaOverlay = function(state) {
          var c = document.getElementById("cursor");
          var l = document.getElementById("cursor-label");
          var h = document.getElementById("highlight");
          if (!state || !state.active) {
            c.style.transform = "translate(-999px,-999px)";
            h.style.display = "none";
            return;
          }
          if (state.cursor) {
            c.style.transform = "translate(" + Math.round(state.cursor.x - 11) + "px," + Math.round(state.cursor.y - 11) + "px)";
          }
          if (l) l.textContent = state.label || "CUA Ativo";
          if (state.region) {
            h.style.display = "block";
            h.style.left = Math.round(state.region.x) + "px";
            h.style.top = Math.round(state.region.y) + "px";
            h.style.width = Math.max(8, Math.round(state.region.width)) + "px";
            h.style.height = Math.max(8, Math.round(state.region.height)) + "px";
          } else {
            h.style.display = "none";
          }
        };
      </script>
    </body>
  </html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Janela overlay transparente click-through para exibir cursor animado e highlight CUA (G-21).
 */
export class CuaOverlayController {
  private win: BrowserWindow | null = null;

  public async ensureWindow(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) {
      return this.win;
    }
    const display = screen.getPrimaryDisplay();
    const bounds = display.bounds;
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      resizable: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setAlwaysOnTop(true, "screen-saver");
    await win.loadURL(buildOverlayDataUrl());
    this.win = win;
    return win;
  }

  public async showState(params: {
    cursor?: CuaPoint | null;
    region?: CuaRegion | null;
    label?: string;
  }): Promise<void> {
    const win = await this.ensureWindow();
    if (!win.isVisible()) {
      win.showInactive();
    }
    const payload = JSON.stringify({
      active: true,
      cursor: params.cursor ?? null,
      region: params.region ?? null,
      label: params.label ?? "CUA Ativo",
    });
    await win.webContents.executeJavaScript(`window.__updateCuaOverlay(${payload});`).catch(() => {});
  }

  public hide(): void {
    if (!this.win || this.win.isDestroyed()) return;
    void this.win.webContents
      .executeJavaScript(`window.__updateCuaOverlay({ active: false });`)
      .catch(() => {});
    this.win.hide();
  }

  public destroy(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = null;
  }
}
