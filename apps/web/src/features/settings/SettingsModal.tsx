import React, { useEffect, useState } from "react";
import type {
  AgenteRegistro,
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  BrowserStatusReport,
  CanalEquipe,
  LicenseActivationStatus,
  LicenseDeviceRecord,
  StorageUsageSnapshot,
  StudioUserSettings,
  UpdateStatusSnapshot,
  WhatsNewReleaseInfo,
} from "@criativo/contracts";
import {
  Bell,
  Globe,
  HardDrive,
  KeyRound,
  Mic,
  Palette,
  RotateCcw,
  Sliders,
  Sparkles,
  Zap,
  X,
} from "lucide-react";
import { ServerBrowserProfilesPanel } from "../browser/ServerBrowserProfilesPanel";
import {
  SettingsAppearanceTab,
  SettingsBehaviorTab,
  SettingsGeneralTab,
} from "./SettingsGeneralTabs";
import { SettingsLicenseTab } from "./SettingsLicenseTab";
import { SettingsUpdatesTab } from "./SettingsUpdatesTab";
import {
  SettingsNotificationsTab,
  SettingsVoiceTab,
} from "./SettingsNotificationsVoiceTabs";
import { SettingsStorageTab } from "./StorageUsageBar";

export type SettingsModalTabId =
  | "geral"
  | "aparencia"
  | "comportamento"
  | "navegador"
  | "notificacoes"
  | "voz"
  | "armazenamento"
  | "licenca"
  | "atualizacoes";

const ALLOWED_THEMES = new Set(["carbon_dark", "midnight_contrast", "light"]);
const ALLOWED_SCALES = new Set([80, 90, 100, 110, 120]);
const ALLOWED_LANGS = new Set(["pt-BR", "en", "es"]);
const UI_FONT_WHITELIST: Record<string, string> = {
  Inter: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "System UI": 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "Plus Jakarta Sans": '"Plus Jakarta Sans", "Inter", system-ui, sans-serif',
};
const MONO_FONT_WHITELIST: Record<string, string> = {
  "JetBrains Mono": '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  "Fira Code": '"Fira Code", "JetBrains Mono", ui-monospace, monospace',
  Monospace: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export const DEFAULT_FRONTEND_USER_SETTINGS: StudioUserSettings = {
  geral: {
    atalho_envio: "enter",
    ordenacao_sidebar: "secoes",
    exibir_passos_agente: true,
    acoes_compactas: false,
  },
  aparencia: {
    tema: "carbon_dark",
    cor_acento: "#007CF7",
    escala: 100,
    fonte_interface: "Inter",
    fonte_codigo: "JetBrains Mono",
    idioma: "pt-BR",
  },
  comportamento: {
    restaurar_ultima_aba: true,
    exibir_dynamic_island: true,
    detalhe_dynamic_island: "detalhado",
    habilitar_drawer_rapido: true,
  },
  notificacoes: {
    web_habilitadas: false,
    mostrar_preview: true,
    som_tarefa: "cristal",
    som_feedback: "suave",
    matriz: {},
  },
  voz: {
    provedor_ditado: "web_speech",
    modelo_tts: "edge_tts",
    velocidade: 1,
    leitura_automatica: false,
    live_voice_habilitada: false,
  },
  atualizado_em: new Date(0).toISOString(),
};

/**
 * Aplica tema, cor de destaque validada, escala, tipografia e idioma no DOM com whitelist estrita (T-15-16).
 */
export function applyUserSettingsToDocument(settings: StudioUserSettings): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  const root = document.documentElement;
  const aparencia = settings?.aparencia ?? DEFAULT_FRONTEND_USER_SETTINGS.aparencia;

  const theme = ALLOWED_THEMES.has(aparencia.tema) ? aparencia.tema : "carbon_dark";
  root.setAttribute("data-studio-theme", theme);

  if (theme === "midnight_contrast") {
    root.style.setProperty("--openbot-bg-canvas", "#0D0D0D");
    root.style.setProperty("--openbot-bg-surface", "#161616");
  } else if (theme === "light") {
    root.style.setProperty("--openbot-bg-canvas", "#F4F5F7");
    root.style.setProperty("--openbot-bg-surface", "#FFFFFF");
  } else {
    root.style.setProperty("--openbot-bg-canvas", "#1a1a1a");
    root.style.setProperty("--openbot-bg-surface", "#212121");
  }

  const accentHex = /^#[0-9a-fA-F]{6}$/.test(aparencia.cor_acento ?? "")
    ? aparencia.cor_acento
    : "#007CF7";
  root.style.setProperty("--openbot-accent", accentHex);

  const scale = ALLOWED_SCALES.has(Number(aparencia.escala))
    ? Number(aparencia.escala)
    : 100;
  root.style.fontSize = `${((scale / 100) * 16).toFixed(2)}px`;

  const sansStack =
    UI_FONT_WHITELIST[aparencia.fonte_interface] ?? UI_FONT_WHITELIST.Inter;
  const monoStack =
    MONO_FONT_WHITELIST[aparencia.fonte_codigo] ?? MONO_FONT_WHITELIST["JetBrains Mono"];
  root.style.setProperty("--openbot-font-sans", sansStack);
  root.style.setProperty("--openbot-font-mono", monoStack);

  const lang = ALLOWED_LANGS.has(aparencia.idioma) ? aparencia.idioma : "pt-BR";
  root.setAttribute("lang", lang);
}

const NAV_GROUPS: Array<{
  grupo: string;
  items: Array<{
    id: SettingsModalTabId;
    label: string;
    Icon: React.FC<{ className?: string }>;
  }>;
}> = [
  {
    grupo: "Estúdio",
    items: [
      { id: "geral", label: "Geral", Icon: Sliders },
      { id: "aparencia", label: "Aparência", Icon: Palette },
      { id: "comportamento", label: "Comportamento", Icon: Zap },
      { id: "navegador", label: "Navegador & Proxies", Icon: Globe },
    ],
  },
  {
    grupo: "Comunicação",
    items: [
      { id: "notificacoes", label: "Notificações & Sons", Icon: Bell },
      { id: "voz", label: "Voz & Live Voice", Icon: Mic },
    ],
  },
  {
    grupo: "Sistema",
    items: [
      { id: "licenca", label: "Licença & Plano", Icon: KeyRound },
      { id: "armazenamento", label: "Armazenamento", Icon: HardDrive },
      { id: "atualizacoes", label: "Atualizações & Novidades", Icon: Sparkles },
    ],
  },
];

export interface SettingsModalProps {
  open: boolean;
  initialTab?: SettingsModalTabId;
  settings: StudioUserSettings;
  storageUsage: StorageUsageSnapshot | null;
  whatsNew: WhatsNewReleaseInfo | null;
  browserProfiles: BrowserProfileInfo[];
  browserProxies: BrowserProxyConfig[];
  browserStatus?: BrowserStatusReport | null;
  agentes: AgenteRegistro[];
  canais: CanalEquipe[];
  onClose: () => void;
  onSaveSettings: (next: StudioUserSettings) => Promise<void>;
  onRefreshStorage?: () => Promise<void>;
  onClearStorage?: (category: "browser_cache" | "temp_previews") => Promise<void>;
  onDeleteStorageFile?: (arquivoId: string) => Promise<void>;
  onCheckUpdates?: () => Promise<void>;
  updateStatus?: UpdateStatusSnapshot | null;
  activeServerName?: string;
  onApplyUpdate?: () => Promise<void>;
  onRestartForUpdate?: () => Promise<void>;
  onResetLayoutWidths?: () => void;
  onReopenSetupAssistant?: () => Promise<void>;
  licenseStatus?: LicenseActivationStatus | null;
  onRefreshLicense?: () => Promise<void>;
  onDeactivateLicenseDevice?: (payload: {
    target_machine_id: string;
    license_key?: string;
    email?: string;
  }) => Promise<{ ok: boolean; devices: LicenseDeviceRecord[]; status?: LicenseActivationStatus }>;
  onCreateBrowserProfile: (input: { nome: string; cor_hex?: string }) => Promise<void>;
  onUpdateBrowserProfile: (
    perfilId: string,
    patch: { nome?: string; cor_hex?: string; proxy_json?: BrowserProfileProxyPayload | null }
  ) => Promise<void>;
  onClearBrowserProfile: (perfilId: string) => Promise<void>;
  onDeleteBrowserProfile: (perfilId: string) => Promise<void>;
  onSaveBrowserProxy: (input: {
    nome: string;
    servidor: string;
    usuario?: string | null;
    senha?: string | null;
  }) => Promise<BrowserProxyConfig>;
  onDeleteBrowserProxy: (proxyId: string) => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  initialTab = "geral",
  settings,
  storageUsage,
  whatsNew,
  browserProfiles,
  browserProxies,
  browserStatus = null,
  agentes,
  canais,
  onClose,
  onSaveSettings,
  onRefreshStorage,
  onClearStorage,
  onDeleteStorageFile,
  onCheckUpdates,
  updateStatus = null,
  activeServerName = "Servidor Principal",
  onApplyUpdate,
  onRestartForUpdate,
  onResetLayoutWidths,
  onReopenSetupAssistant,
  licenseStatus = null,
  onRefreshLicense,
  onDeactivateLicenseDevice,
  onCreateBrowserProfile,
  onUpdateBrowserProfile,
  onClearBrowserProfile,
  onDeleteBrowserProfile,
  onSaveBrowserProxy,
  onDeleteBrowserProxy,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsModalTabId>(initialTab);
  const [draft, setDraft] = useState<StudioUserSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>("Sincronizado com SQLite local");

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [initialTab, open]);

  if (!open) return null;

  const activeMeta = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeTab);

  const handleApply = async () => {
    setSaving(true);
    setSyncMessage("Sincronizando preferências...");
    try {
      applyUserSettingsToDocument(draft);
      await onSaveSettings({
        ...draft,
        atualizado_em: new Date().toISOString(),
      });
      setSyncMessage("Preferências salvas no SQLite local");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const resetCopy: StudioUserSettings = {
      ...DEFAULT_FRONTEND_USER_SETTINGS,
      atualizado_em: new Date().toISOString(),
    };
    setDraft(resetCopy);
    applyUserSettingsToDocument(resetCopy);
    setSaving(true);
    try {
      await onSaveSettings(resetCopy);
      setSyncMessage("Padrões restaurados");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Central de Configurações do Estúdio"
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-[920px] h-[640px] max-h-[90vh] rounded-2xl bg-[#212121] border border-white/10 shadow-2xl flex overflow-hidden">
        {/* Navegação lateral em 3 grupos */}
        <aside className="w-[220px] shrink-0 bg-[#1A1A1A] border-r border-white/[0.06] p-[16px] flex flex-col gap-4 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.grupo} className="space-y-1">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#6A6A6A]">
                {group.grupo}
              </div>
              {group.items.map(({ id, label, Icon }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold border-l-2 transition-colors ${
                      active
                        ? "bg-[#2A2A2A] border-[#007CF7] text-white"
                        : "border-transparent text-[#979797] hover:bg-[#212121] hover:text-white"
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-[#42A0FF]" : ""}`} />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Coluna direita de conteúdo */}
        <div className="flex-1 min-w-0 bg-[#1A1A1A] flex flex-col">
          <header className="h-[48px] shrink-0 px-[24px] border-b border-white/[0.06] flex items-center justify-between gap-3">
            <h2 className="text-[20px] font-semibold text-white truncate">
              {activeMeta?.label ?? "Configurações"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#212121] px-2.5 py-1.5 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              <span>Fechar painel</span>
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-[24px]">
            {activeTab === "geral" && (
              <SettingsGeneralTab
                geral={draft.geral}
                onChange={(geral) => setDraft((prev) => ({ ...prev, geral }))}
                onReopenSetupAssistant={onReopenSetupAssistant}
                onResetLayoutWidths={onResetLayoutWidths}
              />
            )}

            {activeTab === "aparencia" && (
              <SettingsAppearanceTab
                aparencia={draft.aparencia}
                onChange={(aparencia) => setDraft((prev) => ({ ...prev, aparencia }))}
              />
            )}

            {activeTab === "comportamento" && (
              <SettingsBehaviorTab
                comportamento={draft.comportamento}
                onChange={(comportamento) => setDraft((prev) => ({ ...prev, comportamento }))}
              />
            )}

            {activeTab === "navegador" && (
              <div className="space-y-4">
                {browserStatus && (
                  <div className="rounded-xl border border-white/[0.06] bg-[#212121] px-4 py-3 flex items-center justify-between gap-3 text-[12px]">
                    <span className="text-[#DCDCDC]">
                      Chromium CDP:{" "}
                      <strong className={browserStatus.available ? "text-[#31CF76]" : "text-[#FF9412]"}>
                        {browserStatus.available ? "Disponível" : "Aguardando navegador"}
                      </strong>
                    </span>
                    <span className="font-mono text-[11px] text-[#979797]">
                      {browserStatus.activeContexts} contexto(s) · {browserStatus.activeTabs} aba(s)
                    </span>
                  </div>
                )}
                <ServerBrowserProfilesPanel
                  profiles={browserProfiles}
                  proxies={browserProxies}
                  onCreateProfile={onCreateBrowserProfile}
                  onUpdateProfile={onUpdateBrowserProfile}
                  onClearProfile={onClearBrowserProfile}
                  onDeleteProfile={onDeleteBrowserProfile}
                  onSaveProxy={onSaveBrowserProxy}
                  onDeleteProxy={onDeleteBrowserProxy}
                />
              </div>
            )}

            {activeTab === "notificacoes" && (
              <SettingsNotificationsTab
                notificacoes={draft.notificacoes}
                agentes={agentes}
                canais={canais}
                onChange={(notificacoes) => setDraft((prev) => ({ ...prev, notificacoes }))}
              />
            )}

            {activeTab === "voz" && (
              <SettingsVoiceTab
                voz={draft.voz}
                onChange={(voz) => setDraft((prev) => ({ ...prev, voz }))}
              />
            )}

            {activeTab === "armazenamento" && (
              <SettingsStorageTab
                snapshot={storageUsage}
                onRefresh={onRefreshStorage}
                onClearCategory={onClearStorage}
                onDeleteFile={onDeleteStorageFile}
              />
            )}

            {activeTab === "licenca" && (
              <SettingsLicenseTab
                status={licenseStatus}
                onRefreshLicense={onRefreshLicense}
                onDeactivateDevice={onDeactivateLicenseDevice}
              />
            )}

            {activeTab === "atualizacoes" && (
              <SettingsUpdatesTab
                updateStatus={updateStatus}
                whatsNew={whatsNew}
                activeServerName={activeServerName}
                onCheckUpdates={onCheckUpdates}
                onApplyUpdate={onApplyUpdate}
                onRestartForUpdate={onRestartForUpdate}
              />
            )}
          </div>

          <footer className="shrink-0 border-t border-white/[0.06] bg-[#141414] px-[24px] py-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11.5px] text-[#979797]">{syncMessage}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleReset()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#212121] px-3 py-1.5 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Restaurar padrão</span>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleApply()}
                className="rounded-lg bg-[#F0F0F0] px-4 py-1.5 text-[12px] font-semibold text-[#141414] hover:bg-white disabled:opacity-50"
              >
                {saving ? "Aplicando..." : "Aplicar preferências"}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};
