import type {
  AgenteEspera,
  AgenteRegistro,
  AgenteThreadBranch,
  AgenteThreadRegistro,
  AgenteThreadsSnapshot,
  AnexoChat,
  ArquivoStudio,
  AvatarShape,
  BackupModelChoice,
  BibliotecasPastasSnapshot,
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  BrowserSecretRequest,
  BrowserStatusReport,
  BrowserTabSummary,
  BrowserTakeoverSession,
  CanalEquipe,
  CaptureScreenConsentRequest,
  ConectorIntegracaoInfo,
  DeletedNativeAgentInfo,
  FilaChatEntrega,
  FilaChatSnapshot,
  HabilidadeInstaladaInfo,
  LicenseActivationStatus,
  MensagemChat,
  MensagemFixada,
  NivelEsforco,
  OnboardingEstado,
  PacoteUpgradeInfo,
  PaginaConversaThread,
  PassoChat,
  ProvedorStatusInfo,
  ProviderName,
  RelatorioAnalyticsHost,
  ServerClaimTicket,
  ServerQuotaSummary,
  ShowcaseSiteSummary,
  SidebarLayoutMutation,
  SidebarLayoutSnapshot,
  StatusMensageria,
  StorageUsageSnapshot,
  StudioServerRecord,
  StudioUserSettings,
  TarefaRegistro,
  UiBlockSubmitPayload,
  UpdateStatusSnapshot,
  UsageLimitAskPayload,
  UserBrowsingStep,
  UsoProvedoresSnapshot,
  WhatsAppContaResumo,
  WhatsNewReleaseInfo,
  WorkflowAresta,
  WorkflowNo,
  WorkflowVisual,
} from "@criativo/contracts";
import {
  inferTaskContextFromActivity,
  MascoteAvatar,
  resolveAgentAvatarConfig,
  type AvatarTaskContext,
  type MascotEyeMood,
} from "../components/MascoteAvatar";
import {
  DEFAULT_FRONTEND_DOCK_SETTINGS,
  resolveEffectiveDockAgentIds,
} from "../features/settings/SettingsGeneralTabs";
import {
  DEFAULT_FRONTEND_USER_SETTINGS,
  SettingsModal,
  type SettingsModalTabId,
  applyUserSettingsToDocument,
} from "../features/settings/SettingsModal";

export const USER_SETTINGS_STORAGE_KEY = "criativo_user_settings";
export const LAST_TAB_STORAGE_KEY = "criativo_last_tab_id";
export const SIDEBAR_WIDTH_KEY = "criativo_sidebar_width";
export const INSPECTOR_WIDTH_KEY = "criativo_inspector_width";
export const AGENT_DOCK_PINNED_KEY = "criativo.agent_dock.pinned";
export const DEFAULT_SIDEBAR_WIDTH = 276;
export const DEFAULT_INSPECTOR_WIDTH = 330;

export function clampWidth(val: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.round(val)));
}

export function readStoredWidth(key: string, min: number, max: number, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return clampWidth(Number(raw), min, max, fallback);
  } catch {
    return fallback;
  }
}

export function writeStoredWidth(key: string, width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // ignora quota de localStorage
  }
}

export function readCachedUserSettings(): StudioUserSettings {
  if (typeof window === "undefined") return DEFAULT_FRONTEND_USER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_FRONTEND_USER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StudioUserSettings>;
    return {
      geral: { ...DEFAULT_FRONTEND_USER_SETTINGS.geral, ...(parsed.geral ?? {}) },
      aparencia: { ...DEFAULT_FRONTEND_USER_SETTINGS.aparencia, ...(parsed.aparencia ?? {}) },
      comportamento: {
        ...DEFAULT_FRONTEND_USER_SETTINGS.comportamento,
        ...(parsed.comportamento ?? {}),
      },
      dock: {
        ...DEFAULT_FRONTEND_DOCK_SETTINGS,
        ...(parsed.dock ?? {}),
      },
      notificacoes: {
        ...DEFAULT_FRONTEND_USER_SETTINGS.notificacoes,
        ...(parsed.notificacoes ?? {}),
      },
      voz: { ...DEFAULT_FRONTEND_USER_SETTINGS.voz, ...(parsed.voz ?? {}) },
      atualizado_em:
        typeof parsed.atualizado_em === "string"
          ? parsed.atualizado_em
          : DEFAULT_FRONTEND_USER_SETTINGS.atualizado_em,
    };
  } catch {
    return DEFAULT_FRONTEND_USER_SETTINGS;
  }
}

export type AgenteEnriquecido = AgenteRegistro & {
  nao_lidas?: number;
  ultima_mensagem?: string | null;
  ultima_mensagem_em?: string | null;
};

export type AgentCenterMode =
  | { type: "agent"; agenteId: string }
  | { type: "thread"; agenteId: string; threadId: string }
  | { type: "channel"; canalId: string }
  | { type: "new_agent" };

export function getThreadLaneKey(agenteId: string, threadId?: string | null): string {
  return `${agenteId}:${threadId ?? "main"}`;
}

export function getAgentAvatar(ag?: AgenteRegistro | null) {
  return resolveAgentAvatarConfig(ag);
}

export function mergeUniqueMessages(
  current: MensagemChat[],
  incoming: MensagemChat[]
): MensagemChat[] {
  const map = new Map<string, MensagemChat>();
  for (const m of current) map.set(m.mensagem_id, m);
  for (const m of incoming) map.set(m.mensagem_id, m);
  return Array.from(map.values()).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
}
