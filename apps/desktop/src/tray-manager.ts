import { existsSync } from "node:fs";
import { join } from "node:path";
import { Menu, nativeImage, shell, Tray } from "electron";

export interface TrayManagerOptions {
  port: number;
  productRoot: string;
  userDataDir: string;
  onShowWindow: () => void;
  onToggleFloatingDock?: () => void;
  onToggleFloatingDockAutoHide?: () => boolean;
  onCheckUpdates: () => void;
  onQuit: () => void;
}

function createFallbackTrayIcon() {
  // Ícone SVG Carbon Dark + Esmeralda gerado em memória para nunca depender de ativo externo ausente
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="8" fill="#141414"/>
    <circle cx="11" cy="16" r="4" fill="#31CF76"/>
    <circle cx="21" cy="16" r="4" fill="#FFFFFF"/>
  </svg>`;
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  const img = nativeImage.createFromDataURL(dataUrl);
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
}

export function createStudioTray(options: TrayManagerOptions): Tray {
  const iconCandidates = [
    join(options.productRoot, "apps", "desktop", "build", "tray-icon.png"),
    join(options.productRoot, "build", "tray-icon.png"),
  ];
  const existingIcon = iconCandidates.find((p) => existsSync(p));
  const icon = existingIcon ? nativeImage.createFromPath(existingIcon) : createFallbackTrayIcon();

  const tray = new Tray(icon.isEmpty() ? createFallbackTrayIcon() : icon);
  tray.setToolTip("Criativo AI Studio — Agentes e WhatsApp ativos");

  const menu = Menu.buildFromTemplate([
    {
      label: "Abrir Criativo AI Studio",
      click: () => options.onShowWindow(),
    },
    ...(options.onToggleFloatingDock
      ? [
          {
            label: "Mostrar / Ocultar Ilha Flutuante",
            click: () => options.onToggleFloatingDock?.(),
          },
        ]
      : []),
    ...(options.onToggleFloatingDockAutoHide
      ? [
          {
            label: "Ilha Flutuante: Recolher na Borda",
            click: () => {
              options.onToggleFloatingDockAutoHide?.();
            },
          },
        ]
      : []),
    {
      label: `Motor ativo em loopback :${options.port}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Verificar atualizações",
      click: () => {
        options.onShowWindow();
        options.onCheckUpdates();
      },
    },
    {
      label: "Abrir pasta de dados da marca",
      click: () => {
        void shell.openPath(options.userDataDir);
      },
    },
    { type: "separator" },
    {
      label: "Encerrar Criativo AI Studio",
      click: () => options.onQuit(),
    },
  ]);

  tray.setContextMenu(menu);
  tray.on("click", () => options.onShowWindow());
  tray.on("double-click", () => options.onShowWindow());
  return tray;
}
