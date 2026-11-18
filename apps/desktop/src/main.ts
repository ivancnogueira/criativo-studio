import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell, type Tray } from "electron";
import {
  resolveDesktopProductRoot,
  startEmbeddedDaemon,
  type EmbeddedDaemonHandle,
} from "./daemon-launcher.ts";
import { createStudioTray } from "./tray-manager.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let daemonHandle: EmbeddedDaemonHandle | null = null;
let trayHandle: Tray | null = null;
let isQuitting = false;

function buildSplashDataUrl(): string {
  const html = `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <title>Criativo AI Studio</title>
      <style>
        html,body{margin:0;height:100%;background:#0D0D0D;color:#F0F0F0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;display:flex;align-items:center;justify-content:center}
        .card{display:flex;flex-direction:column;align-items:center;gap:14px;padding:32px 40px;border-radius:18px;background:#161616;border:1px solid rgba(255,255,255,.08)}
        .dot{width:34px;height:34px;border-radius:10px;background:#31CF76;animation:pulse 1.2s ease-in-out infinite}
        .title{font-size:16px;font-weight:600}
        .sub{font-size:13px;color:#979797}
        @keyframes pulse{0%,100%{opacity:.55;transform:scale(.95)}50%{opacity:1;transform:scale(1)}}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="dot"></div>
        <div class="title">Criativo AI Studio Online</div>
        <div class="sub">Iniciando seus 15 Agentes Especialistas...</div>
      </div>
    </body>
  </html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function isLocalDaemonOrigin(rawUrl: string, daemonPort: number): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:") return false;
    const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return isLoopback && Number(parsed.port || 80) === daemonPort;
  } catch {
    return false;
  }
}

function openExternalValidated(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    void shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

function focusOrShowMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(daemonPort: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: "Criativo AI Studio Online",
    backgroundColor: "#0D0D0D",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Fronteira rígida contra navegação arbitrária: URLs externas abrem no navegador padrão
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocalDaemonOrigin(url, daemonPort)) {
      openExternalValidated(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  win.webContents.on("will-navigate", (event: { preventDefault: () => void }, url: string) => {
    if (url.startsWith("data:text/html")) return;
    if (!isLocalDaemonOrigin(url, daemonPort)) {
      event.preventDefault();
      openExternalValidated(url);
    }
  });

  win.on("close", (event: { preventDefault: () => void }) => {
    if (!isQuitting && trayHandle) {
      // Mantém Daemon, WhatsApp e Rotinas 24/7 ativos na bandeja
      event.preventDefault();
      win.hide();
    }
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  return win;
}

function registerIpcHandlers(userDataDir: string): void {
  ipcMain.handle("criativo:get-info", () => ({
    version: app.getVersion(),
    daemonUrl: daemonHandle?.baseUrl ?? "",
    userDataDir,
  }));

  ipcMain.handle("criativo:open-external", (_evt, url: unknown) => {
    if (typeof url !== "string") return false;
    return openExternalValidated(url);
  });

  ipcMain.handle("criativo:open-data-dir", async () => {
    await shell.openPath(userDataDir);
  });

  ipcMain.handle("criativo:check-updates", async () => {
    if (!daemonHandle) return null;
    const res = await fetch(`${daemonHandle.baseUrl}/api/studio/updates/check`, { method: "POST" });
    return await res.json();
  });

  ipcMain.handle("criativo:trigger-update", async (_evt, targetServerId: unknown) => {
    if (!daemonHandle) return null;
    const res = await fetch(`${daemonHandle.baseUrl}/api/studio/updates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_server_id: typeof targetServerId === "string" ? targetServerId : undefined,
      }),
    });
    return await res.json();
  });
}

let activeBootLogPath: string | null = null;

function writeDesktopLog(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (!activeBootLogPath) return;
  try {
    mkdirSync(dirname(activeBootLogPath), { recursive: true });
    appendFileSync(activeBootLogPath, line, "utf8");
  } catch {
    // ignora falha de escrita de log
  }
}

async function bootstrapDesktop(): Promise<void> {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    focusOrShowMainWindow();
  });

  await app.whenReady();

  const userDataDir =
    process.env.CRIATIVO_USER_DATA_DIR || join(app.getPath("appData"), "CriativoAIStudio");
  try {
    app.setName("Criativo AI Studio");
    app.setPath("userData", userDataDir);
  } catch {
    // ignora caso já esteja bloqueado
  }

  activeBootLogPath = join(userDataDir, "logs", "desktop-boot.log");
  writeDesktopLog(`Iniciando Criativo AI Studio v${app.getVersion()} (packaged=${app.isPackaged})`);

  const productRoot = resolveDesktopProductRoot({
    isPackaged: app.isPackaged,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
  });
  writeDesktopLog(`productRoot=${productRoot} | userDataDir=${userDataDir}`);

  registerIpcHandlers(userDataDir);

  // Inicia janela imediata com Splash enquanto Daemon sobe silenciosamente em background
  mainWindow = createWindow(3000);
  await mainWindow.loadURL(buildSplashDataUrl());

  daemonHandle = await startEmbeddedDaemon({
    productRoot,
    userDataDir,
    preferredPort: 3000,
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
  });
  writeDesktopLog(`Daemon embutido pronto em ${daemonHandle.baseUrl}`);

  // Atualiza permissões de origem caso a porta 3000 estivesse ocupada e o fallback usou outra
  if (daemonHandle.port !== 3000) {
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (!isLocalDaemonOrigin(url, daemonHandle!.port)) {
        openExternalValidated(url);
        return { action: "deny" };
      }
      return { action: "allow" };
    });
    mainWindow.webContents.on("will-navigate", (event: { preventDefault: () => void }, url: string) => {
      if (!isLocalDaemonOrigin(url, daemonHandle!.port)) {
        event.preventDefault();
        openExternalValidated(url);
      }
    });
  }

  trayHandle = createStudioTray({
    port: daemonHandle.port,
    productRoot,
    userDataDir,
    onShowWindow: () => focusOrShowMainWindow(),
    onCheckUpdates: () => {
      void fetch(`${daemonHandle?.baseUrl}/api/studio/updates/check`, { method: "POST" }).catch(() => {});
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  await mainWindow.loadURL(daemonHandle.baseUrl);
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", (event: { preventDefault: () => void }) => {
  if (!daemonHandle) return;
  const handle = daemonHandle;
  daemonHandle = null;
  event.preventDefault();
  void handle.stop().finally(() => {
    trayHandle?.destroy();
    trayHandle = null;
    app.quit();
  });
});

app.on("window-all-closed", () => {
  // Mantém executando na bandeja do sistema mesmo sem janela visível até Quit explícito
  if (isQuitting) {
    app.quit();
  }
});

bootstrapDesktop().catch((err) => {
  const errMsg = err instanceof Error ? err.stack || err.message : String(err);
  writeDesktopLog(`ERRO FATAL: ${errMsg}`);
  console.error("[Criativo Desktop] Falha ao iniciar aplicativo:", err);
  try {
    dialog.showErrorBox(
      "Criativo AI Studio — Falha ao iniciar",
      `Não foi possível iniciar o motor local do aplicativo.\n\nDetalhes: ${
        err instanceof Error ? err.message : String(err)
      }${activeBootLogPath ? `\n\nLog salvo em:\n${activeBootLogPath}` : ""}`,
    );
  } catch {
    // ignora se dialog falhar antes de app ready
  }
  isQuitting = true;
  app.quit();
});
