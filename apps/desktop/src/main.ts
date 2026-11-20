import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, type Tray } from "electron";
import {
  resolveDesktopProductRoot,
  resolveSafeUpdateArtifactPath,
  startEmbeddedDaemon,
  type EmbeddedDaemonHandle,
  type UpdateRestartPayload,
} from "./daemon-launcher.ts";
import { FloatingDockController } from "./floating-dock.ts";
import { createStudioTray } from "./tray-manager.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let floatingDock: FloatingDockController | null = null;
let daemonHandle: EmbeddedDaemonHandle | null = null;
let trayHandle: Tray | null = null;
let isQuitting = false;
let updateRestartInProgress = false;

function resolveWindowIconPath(productRoot: string): string | undefined {
  const candidates = [
    join(productRoot, "apps", "desktop", "build", "icon.png"),
    join(productRoot, "build", "icon.png"),
    join(__dirname, "..", "build", "icon.png"),
  ];
  return candidates.find((p) => existsSync(p));
}

function buildSplashDataUrl(iconPath?: string): string {
  let logoMarkup = '<div class="dot"></div>';
  if (iconPath && existsSync(iconPath)) {
    try {
      const b64 = readFileSync(iconPath).toString("base64");
      logoMarkup = `<img src="data:image/png;base64,${b64}" alt="Criativo AI Studio" class="logo-img" />`;
    } catch {
      // mantém fallback SVG/CSS
    }
  }
  const html = `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <title>Criativo AI Studio</title>
      <style>
        html,body{margin:0;height:100%;background:#0D0D0D;color:#F0F0F0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;display:flex;align-items:center;justify-content:center}
        .card{display:flex;flex-direction:column;align-items:center;gap:14px;padding:34px 44px;border-radius:20px;background:#161616;border:1px solid rgba(255,255,255,.08);box-shadow:0 24px 64px rgba(0,0,0,.6)}
        .logo-img{width:54px;height:54px;object-fit:contain;animation:pulse 1.4s ease-in-out infinite}
        .dot{width:34px;height:34px;border-radius:10px;background:#FF6B00;animation:pulse 1.2s ease-in-out infinite}
        .title{font-size:16px;font-weight:600;letter-spacing:-.01em}
        .sub{font-size:13px;color:#979797}
        @keyframes pulse{0%,100%{opacity:.78;transform:scale(.96)}50%{opacity:1;transform:scale(1.02)}}
      </style>
    </head>
    <body>
      <div class="card">
        ${logoMarkup}
        <div class="title">Criativo AI Studio Online</div>
        <div class="sub">Iniciando sua equipe de Agentes Especialistas...</div>
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

function createWindow(daemonPort: number, iconPath?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: "Criativo AI Studio Online",
    backgroundColor: "#0D0D0D",
    ...(iconPath ? { icon: iconPath } : {}),
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

  ipcMain.handle("criativo:restart-for-update", async () => {
    if (!daemonHandle) return null;
    const res = await fetch(`${daemonHandle.baseUrl}/api/studio/updates/restart`, {
      method: "POST",
    });
    return await res.json();
  });

  ipcMain.handle("criativo:dock-get-state", () => {
    return floatingDock?.getState() ?? { visible: false, expanded: false, side: "right" };
  });

  ipcMain.handle("criativo:dock-set-expanded", (_evt, rawPayload: unknown) => {
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as { expanded?: unknown; pillHeight?: unknown })
        : {};
    const expanded = Boolean(payload.expanded);
    const pillHeight = typeof payload.pillHeight === "number" ? payload.pillHeight : undefined;
    return floatingDock?.setExpanded(expanded, pillHeight) ?? { side: "right" };
  });

  ipcMain.handle("criativo:dock-set-visible", async (_evt, visible: unknown) => {
    if (!floatingDock) return false;
    return await floatingDock.setVisible(Boolean(visible));
  });

  ipcMain.handle("criativo:dock-start-drag", () => {
    floatingDock?.startDrag();
  });

  ipcMain.handle("criativo:dock-move-drag", () => {
    floatingDock?.moveDrag();
  });

  ipcMain.handle("criativo:dock-end-drag", () => {
    return floatingDock?.endDrag() ?? { side: "right" };
  });

  ipcMain.handle("criativo:open-main-window", (_evt, rawOpts: unknown) => {
    focusOrShowMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const payload =
        rawOpts && typeof rawOpts === "object"
          ? (rawOpts as { agenteId?: string; action?: "new-agent" })
          : {};
      if (payload.agenteId || payload.action) {
        mainWindow.webContents.send("criativo:main-navigate", payload);
      }
    }
  });
}

async function handleUpdateRestart(userDataDir: string, payload: UpdateRestartPayload): Promise<void> {
  if (updateRestartInProgress) return;
  let safeArtifactPath: string | null = null;

  if (payload.mode === "native_installer") {
    safeArtifactPath = resolveSafeUpdateArtifactPath(userDataDir, payload.stagedArtifactPath);
    if (!safeArtifactPath || !existsSync(safeArtifactPath)) {
      writeDesktopLog(
        `[AutoUpdate] Reinício com instalador abortado por caminho inválido/ausente: '${String(payload.stagedArtifactPath)}'`,
      );
      return;
    }
  }

  updateRestartInProgress = true;
  writeDesktopLog(
    `[AutoUpdate] Iniciando reinício de atualização (mode=${payload.mode}, version=${payload.version ?? "n/d"}, artifact=${safeArtifactPath ?? "hot_bundle"})`,
  );

  const handle = daemonHandle;
  daemonHandle = null;
  try {
    if (handle) {
      await handle.stop();
    }
  } catch {
    // prossegue mesmo que o daemon já tenha fechado
  }

  trayHandle?.destroy();
  trayHandle = null;
  floatingDock?.destroy();
  floatingDock = null;
  isQuitting = true;

  if (payload.mode === "native_installer" && safeArtifactPath) {
    if (process.platform === "win32" && safeArtifactPath.toLowerCase().endsWith(".exe")) {
      const installer = spawn(safeArtifactPath, ["/S"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      installer.unref();
    } else {
      void shell.openPath(safeArtifactPath);
    }
    app.quit();
    return;
  }

  app.relaunch();
  app.exit(0);
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

function isAllowedLoopbackOrigin(originUrl: string): boolean {
  if (!originUrl) return false;
  try {
    const parsed = new URL(originUrl);
    return parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

async function bootstrapDesktop(): Promise<void> {
  const userDataDir =
    process.env.CRIATIVO_USER_DATA_DIR || join(app.getPath("appData"), "CriativoAIStudio");
  try {
    app.setName("Criativo AI Studio");
    app.setPath("userData", userDataDir);
  } catch {
    // ignora caso já esteja bloqueado
  }

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    focusOrShowMainWindow();
  });

  await app.whenReady();

  const allowedPermissions = new Set(["media", "audioCapture", "microphone", "notifications", "clipboard-read"]);
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return isAllowedLoopbackOrigin(requestingOrigin) && allowedPermissions.has(permission);
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const origin = wc?.getURL?.() || "";
    callback(isAllowedLoopbackOrigin(origin) && allowedPermissions.has(permission));
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      if (sources.length > 0) {
        callback({ video: sources[0] });
        return;
      }
    } catch {
      // fallback seguro caso desktopCapturer falhe
    }
    callback({});
  });

  activeBootLogPath = join(userDataDir, "logs", "desktop-boot.log");
  writeDesktopLog(`Iniciando Criativo AI Studio v${app.getVersion()} (packaged=${app.isPackaged})`);

  const productRoot = resolveDesktopProductRoot({
    isPackaged: app.isPackaged,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
  });
  writeDesktopLog(`productRoot=${productRoot} | userDataDir=${userDataDir}`);

  const iconPath = resolveWindowIconPath(productRoot);
  registerIpcHandlers(userDataDir);

  // Inicia janela imediata com Splash enquanto Daemon sobe silenciosamente em background
  mainWindow = createWindow(3000, iconPath);
  await mainWindow.loadURL(buildSplashDataUrl(iconPath));

  daemonHandle = await startEmbeddedDaemon({
    productRoot,
    userDataDir,
    preferredPort: 3000,
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
    onUpdateRestartRequested: (payload) => {
      void handleUpdateRestart(userDataDir, payload);
    },
    onDaemonCrashed: (code, signal) => {
      writeDesktopLog(`[Watchdog] Daemon caiu inesperadamente (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    },
    onDaemonRestarted: (port, attempt) => {
      writeDesktopLog(`[Watchdog] Daemon reiniciado na porta ${port} (tentativa #${attempt})`);
    },
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
    onToggleFloatingDock: () => {
      void floatingDock?.toggleVisible();
    },
    onCheckUpdates: () => {
      void fetch(`${daemonHandle?.baseUrl}/api/studio/updates/check`, { method: "POST" }).catch(() => {});
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  await mainWindow.loadURL(daemonHandle.baseUrl);

  floatingDock = new FloatingDockController({
    daemonBaseUrl: daemonHandle.baseUrl,
    userDataDir,
    isAllowedOrigin: (rawUrl) => isLocalDaemonOrigin(rawUrl, daemonHandle?.port ?? 3000),
    onOpenExternal: (rawUrl) => openExternalValidated(rawUrl),
    onLog: writeDesktopLog,
  });
  await floatingDock.init();
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", (event: { preventDefault: () => void }) => {
  floatingDock?.destroy();
  floatingDock = null;
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
