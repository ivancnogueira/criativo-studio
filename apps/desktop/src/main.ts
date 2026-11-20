import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, session, shell, type Tray } from "electron";
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

function buildSplashDataUrl(_iconPath?: string): string {
  const html = `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <title>Criativo AI Studio</title>
      <style>
        html,body{margin:0;height:100%;overflow:hidden;user-select:none;background:radial-gradient(circle at 50% 54%,#181615 0%,#0D0D0D 76%);display:flex;align-items:center;justify-content:center}
        .stage{position:relative;flex-shrink:0;width:960px;height:380px;transform-origin:center center}
        .glow{position:absolute;left:50%;top:250px;width:900px;height:210px;transform:translate(-50%,-45%);background:radial-gradient(ellipse at center,rgba(249,115,22,.22) 0%,rgba(56,189,248,.09) 48%,transparent 74%);filter:blur(36px);pointer-events:none}
        .clip{position:absolute;inset:0 0 auto 0;height:250px;clip-path:inset(-360px -80px 0px -80px);-webkit-clip-path:inset(-360px -80px 0px -80px)}
        .clip.unlocked{clip-path:none;-webkit-clip-path:none}
        .line{position:absolute;left:50%;top:250px;width:320px;height:2px;transform:translateX(-50%);border-radius:999px;background:linear-gradient(90deg,transparent,rgba(255,107,0,.52),rgba(255,255,255,.34),rgba(255,107,0,.52),transparent);box-shadow:0 0 22px rgba(255,107,0,.36);transition:width 540ms cubic-bezier(.22,1,.36,1),opacity 320ms ease;pointer-events:none}
        .line.wide{width:940px}
        .line.soft{opacity:.45}
        .slot{position:absolute;left:50%;bottom:0;width:104px;height:104px;transform-origin:center bottom;will-change:transform,opacity;transition:transform 500ms cubic-bezier(.34,1.56,.64,1),opacity 280ms ease}
        .slot.peek-rise{transition:transform 620ms cubic-bezier(.22,1,.36,1),opacity 260ms ease}
        .jumper{position:relative;width:104px;height:104px;transform-origin:center bottom;transition:transform 220ms cubic-bezier(.22,1,.36,1);will-change:transform}
        .jumper.hopping{animation:bounce 980ms cubic-bezier(.45,.05,.55,.95) infinite}
        @keyframes bounce{0%,100%{transform:translateY(0) scale(1.03,.96)}14%{transform:translateY(5px) scale(1.1,.88)}46%{transform:translateY(-40px) scale(.95,1.07)}74%{transform:translateY(2px) scale(1.05,.94)}}
        .spark{position:absolute;left:50%;top:-30px;transform:translateX(-50%) scale(.35);opacity:0;pointer-events:none;transition:transform 220ms cubic-bezier(.34,1.56,.64,1),opacity 180ms ease}
        .spark.show{transform:translateX(-50%) translateY(-10px) scale(1);opacity:1}
        @media (prefers-reduced-motion: reduce){.jumper.hopping{animation:none}}
      </style>
    </head>
    <body>
      <div class="stage" id="stage">
        <div class="glow"></div>
        <div class="clip" id="clip"></div>
        <div class="line" id="line"></div>
      </div>
      <script>
        (function(){
          function applyStageScale(){
            var w=window.innerWidth||1380,h=window.innerHeight||880;
            var sc=Math.max(0.35,Math.min(1.85,Math.min((w*0.72)/960,(h*0.62)/380)));
            var st=document.getElementById("stage");
            if(st)st.style.transform="scale("+sc.toFixed(4)+")";
          }
          applyStageScale();
          window.addEventListener("resize",applyStageScale);
          var PATHS={
            blob:"M50 11 C73 11 89 26 89 49 C89 72 74 89 50 89 C26 89 11 72 11 49 C11 26 27 11 50 11 Z",
            pill:"M50 10 C71 10 83 22 83 41 L83 60 C83 78 70 90 50 90 C30 90 17 78 17 60 L17 41 C17 22 29 10 50 10 Z",
            triangle:"M50 10 C56 10 61 14 66 22 L85 59 C90 70 84 85 71 86 L29 86 C16 85 10 70 15 59 L34 22 C39 14 44 10 50 10 Z",
            hex:"M42 12 C47 9 53 9 58 12 L81 26 C86 29 89 35 89 41 L89 60 C89 66 86 72 81 75 L58 89 C53 92 47 92 42 89 L19 75 C14 72 11 66 11 60 L11 41 C11 35 14 29 19 26 Z",
            rounded_square:"M32 13 L68 13 C80 13 87 20 87 32 L87 68 C87 80 80 87 68 87 L32 87 C20 87 13 80 13 68 L13 32 C13 20 20 13 32 13 Z",
            octo:"M50 9 L64 17 L80 19 L84 35 L91 50 L84 65 L80 81 L64 83 L50 91 L36 83 L20 81 L16 65 L9 50 L16 35 L20 19 L36 17 Z",
            diamond:"M50 8 C54 8 58 10 62 14 L86 38 C92 44 92 56 86 62 L62 86 C56 92 44 92 38 86 L14 62 C8 56 8 44 14 38 L38 14 C42 10 46 8 50 8 Z"
          };
          var SQUAD=[
            {slot:-3,x:-396,xStart:-104,yEnd:-4,shape:"octo",color:"#a855f7"},
            {slot:-2,x:-264,xStart:-52,yEnd:-12,shape:"pill",color:"#3b82f6"},
            {slot:-1,x:-132,xStart:0,yEnd:-20,shape:"hex",color:"#22c55e"},
            {slot:0,x:0,xStart:0,yEnd:-28,shape:"blob",color:"#f97316"},
            {slot:1,x:132,xStart:0,yEnd:-20,shape:"diamond",color:"#f27ba5"},
            {slot:2,x:264,xStart:52,yEnd:-12,shape:"rounded_square",color:"#2dd4bf"},
            {slot:3,x:396,xStart:104,yEnd:-4,shape:"triangle",color:"#eab308"}
          ];
          var uid=1;
          function mascotSvg(shape,color,face,gx,gy){
            var id="s"+(uid++),p=PATHS[shape]||PATHS.blob,e="";
            if(face==="excite"){e='<path d="M 35 52 Q 40.5 43.5 46 52" fill="none" stroke="#FFF8E7" stroke-width="4.4" stroke-linecap="round"/><path d="M 54 52 Q 59.5 43.5 65 52" fill="none" stroke="#FFF8E7" stroke-width="4.4" stroke-linecap="round"/>';}
            else if(face==="wink"){e='<ellipse cx="40.5" cy="50" rx="5.2" ry="8.4" fill="#FFF8E7"/><circle cx="38.8" cy="46.2" r="1.45" fill="#FFFFFF" opacity="0.92"/><path d="M 54.5 51 Q 59.5 46 64.5 51" fill="none" stroke="#FFF8E7" stroke-width="4" stroke-linecap="round"/>';}
            else if(face==="blink"){e='<ellipse cx="40.5" cy="50" rx="5.4" ry="1.3" fill="#FFF8E7"/><ellipse cx="59.5" cy="50" rx="5.4" ry="1.3" fill="#FFF8E7"/>';}
            else{var ryR=face==="curieux"?6.2:8.4;e='<ellipse cx="40.5" cy="50" rx="5.2" ry="8.4" fill="#FFF8E7"/><circle cx="38.8" cy="46.2" r="1.45" fill="#FFFFFF" opacity="0.92"/><ellipse cx="59.5" cy="50" rx="5.2" ry="'+ryR+'" fill="#FFF8E7"/><circle cx="57.8" cy="46.2" r="1.45" fill="#FFFFFF" opacity="0.92"/>';}
            return '<svg width="104" height="104" viewBox="0 0 100 100" style="overflow:visible;display:block"><defs><radialGradient id="pl-'+id+'" cx="36%" cy="28%" r="72%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.48"/><stop offset="45%" stop-color="'+color+'" stop-opacity="1"/><stop offset="100%" stop-color="#050505" stop-opacity="0.42"/></radialGradient><filter id="gl-'+id+'" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="'+color+'" flood-opacity="0.34"/></filter></defs><g filter="url(#gl-'+id+')"><path d="'+p+'" fill="'+color+'"/><path d="'+p+'" fill="url(#pl-'+id+')"/><path d="'+p+'" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.6"/></g><g transform="translate('+(gx||0)+','+(gy||0)+')">'+e+'</g></svg>';
          }
          function sparkSvg(color){return '<svg width="26" height="26" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 0 8px '+color+')"><path d="M12 2 L14.4 9.6 L22 12 L14.4 14.4 L12 22 L9.6 14.4 L2 12 L9.6 9.6 Z" fill="'+color+'" stroke="#FFF8E7" stroke-width="1"/></svg>';}
          var clip=document.getElementById("clip"),line=document.getElementById("line");
          var reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          clip.innerHTML=SQUAD.map(function(m,i){
            var sc=m.slot===0;
            var tr=reduced?("translate(calc(-50% + "+m.x+"px),"+m.yEnd+"px) scale(1)"):(sc?"translate(-50%,290px) scale(2.65)":"translate(calc(-50% + "+m.xStart+"px),124px) scale(0.5)");
            var op=(reduced||sc)?1:0;
            var z=sc?8:(7-Math.abs(m.slot));
            return '<div class="slot '+(sc?"peek-rise":"")+'" id="sl-'+i+'" style="transform:'+tr+';opacity:'+op+';z-index:'+z+'"><div class="jumper" id="jp-'+i+'"><div class="spark" id="sp-'+i+'">'+sparkSvg(m.color)+'</div><div id="sv-'+i+'">'+mascotSvg(m.shape,m.color,sc&&!reduced?"curieux":"resting",0,sc&&!reduced?-0.8:0)+'</div></div></div>';
          }).join("");
          if(reduced){clip.classList.add("unlocked");line.classList.add("wide","soft");return;}
          function setFace(i,f,gx,gy){var e=document.getElementById("sv-"+i);if(e)e.innerHTML=mascotSvg(SQUAD[i].shape,SQUAD[i].color,f,gx,gy);}
          var s=3;
          setTimeout(function(){var e=document.getElementById("sl-"+s);if(e)e.style.transform="translate(-50%,100px) scale(2.65)";},100);
          setTimeout(function(){var j=document.getElementById("jp-"+s);if(j)j.style.transform="rotate(-5deg)";setFace(s,"curieux",-4.4,-1.4);},820);
          setTimeout(function(){var j=document.getElementById("jp-"+s);if(j)j.style.transform="rotate(5deg)";setFace(s,"curieux",4.4,-1.4);},1260);
          setTimeout(function(){var j=document.getElementById("jp-"+s);if(j)j.style.transform="rotate(0deg)";setFace(s,"wink",0,-0.4);},1640);
          setTimeout(function(){
            line.classList.add("wide");
            var sc=document.getElementById("sl-"+s);
            if(sc){sc.classList.remove("peek-rise");sc.style.transform="translate(-50%,"+SQUAD[s].yEnd+"px) scale(1)";}
            setFace(s,"excite",0,0);
            setTimeout(function(){setFace(s,"resting",0,0);},440);
            [[2,4,110],[1,5,250],[0,6,390]].forEach(function(p){
              setTimeout(function(){
                [p[0],p[1]].forEach(function(idx){
                  var el=document.getElementById("sl-"+idx);
                  if(el){el.style.opacity="1";el.style.transform="translate(calc(-50% + "+SQUAD[idx].x+"px),"+SQUAD[idx].yEnd+"px) scale(1)";}
                });
              },p[2]);
            });
          },1900);
          setTimeout(function(){
            clip.classList.add("unlocked");line.classList.add("soft");
            SQUAD.forEach(function(_,idx){
              var j=document.getElementById("jp-"+idx);
              if(j){j.style.transform="";j.style.animationDelay=(idx*115)+"ms";j.classList.add("hopping");}
            });
            var beat=0;
            (function loop(){
              var idx=beat%SQUAD.length,sp=document.getElementById("sp-"+idx),mood=beat%3===0?"excite":beat%3===1?"wink":"blink";
              setFace(idx,mood,0,-0.5);
              if(mood==="excite"&&sp)sp.classList.add("show");
              setTimeout(function(){if(sp)sp.classList.remove("show");setFace(idx,"resting",0,0);},mood==="blink"?150:340);
              beat++;setTimeout(loop,440);
            })();
          },2950);
        })();
      </script>
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
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.max(1024, workArea?.width || 1380),
    height: Math.max(680, workArea?.height || 880),
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
    win.maximize();
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
    return (
      floatingDock?.getState() ?? {
        visible: false,
        expanded: false,
        side: "right",
        pinned: true,
        peeked: false,
      }
    );
  });

  ipcMain.handle("criativo:dock-set-expanded", (_evt, rawPayload: unknown) => {
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as { expanded?: unknown; pillHeight?: unknown })
        : {};
    const expanded = Boolean(payload.expanded);
    const pillHeight = typeof payload.pillHeight === "number" ? payload.pillHeight : undefined;
    return (
      floatingDock?.setExpanded(expanded, pillHeight) ?? {
        visible: false,
        expanded,
        side: "right",
        pinned: true,
        peeked: false,
      }
    );
  });

  ipcMain.handle("criativo:dock-set-visible", async (_evt, visible: unknown) => {
    if (!floatingDock) return false;
    return await floatingDock.setVisible(Boolean(visible));
  });

  ipcMain.handle("criativo:dock-set-pinned", (_evt, rawPayload: unknown) => {
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as { pinned?: unknown; pillHeight?: unknown })
        : {};
    const pinned = Boolean(payload.pinned);
    const pillHeight = typeof payload.pillHeight === "number" ? payload.pillHeight : undefined;
    return (
      floatingDock?.setPinned(pinned, pillHeight) ?? {
        visible: true,
        expanded: false,
        side: "right",
        pinned,
        peeked: false,
      }
    );
  });

  ipcMain.handle("criativo:dock-set-peeked", (_evt, rawPayload: unknown) => {
    const payload =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as { peeked?: unknown; pillHeight?: unknown })
        : {};
    const peeked = Boolean(payload.peeked);
    const pillHeight = typeof payload.pillHeight === "number" ? payload.pillHeight : undefined;
    return (
      floatingDock?.setPeeked(peeked, pillHeight) ?? {
        visible: true,
        expanded: false,
        side: "right",
        pinned: false,
        peeked,
      }
    );
  });

  ipcMain.handle("criativo:dock-start-drag", () => {
    floatingDock?.startDrag();
  });

  ipcMain.handle("criativo:dock-move-drag", () => {
    floatingDock?.moveDrag();
  });

  ipcMain.handle("criativo:dock-end-drag", () => {
    return (
      floatingDock?.endDrag() ?? {
        visible: true,
        expanded: false,
        side: "right",
        pinned: true,
        peeked: false,
      }
    );
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
  const splashStartedAt = Date.now();
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
    onToggleFloatingDockAutoHide: () => {
      if (!floatingDock) return false;
      const nextPinned = !floatingDock.getState().pinned;
      floatingDock.setPinned(nextPinned);
      return !nextPinned;
    },
    onCheckUpdates: () => {
      void fetch(`${daemonHandle?.baseUrl}/api/studio/updates/check`, { method: "POST" }).catch(() => {});
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  const splashElapsedMs = Math.max(0, Date.now() - splashStartedAt);
  await mainWindow.loadURL(`${daemonHandle.baseUrl}/?fromSplash=1&splashElapsed=${splashElapsedMs}`);

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
