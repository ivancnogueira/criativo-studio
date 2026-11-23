import React from "react";
import type {
  ProvedorStatusInfo,
  ProviderName,
} from "@criativo/contracts";

export interface ProvidersCatalogViewProps {
  provedores: ProvedorStatusInfo[];
  defaultProvider: ProviderName;
  initialDetailProviderId?: ProviderName | null;
  authorizingProvider: string | null;
  authError: string | null;
  pendingAuthUrl?: { provedor: "gemini" | "claude" | "openai"; url: string } | null;
  onSelectDefaultProvider?: (provedor: ProviderName) => Promise<void>;
  onStartBrowserSignIn: (prov: "gemini" | "claude" | "openai", label?: string) => Promise<void>;
  onCancelBrowserSignIn?: (prov: "gemini" | "claude" | "openai") => Promise<void>;
  onConnectApiKey: (provedor: ProviderName, apiKey: string) => Promise<void>;
  onDisconnectProvider: (provedor: ProviderName) => Promise<void>;
  onRefreshProviders?: () => Promise<void>;
  onTogglePool?: (provedor: ProviderName, habilitado: boolean) => Promise<void>;
  onSetAccountActive?: (provedor: ProviderName, contaId: string) => Promise<void>;
  onToggleAccountExcluded?: (
    provedor: ProviderName,
    contaId: string,
    exclude: boolean
  ) => Promise<void>;
  onRemoveAccount?: (provedor: ProviderName, contaId: string) => Promise<void>;
  onAddManualAccount?: (
    provedor: ProviderName,
    payload: { email: string; access_token: string; label?: string }
  ) => Promise<void>;
  onSetModelsVisibility?: (provedor: ProviderName, hiddenIds: string[]) => Promise<void>;
  onActiveProviderChange?: (prov: ProvedorStatusInfo | null) => void;
  activeServerName?: string;
  activeServerKind?: "primary" | "local_child" | "remote_vps" | "joined";
  onSubmitManualOAuthCallback?: (
    provedor: "claude" | "openai",
    callbackUrl: string
  ) => Promise<void>;
  onShowToast: (msg: string) => void;
}

export const SwitchPill: React.FC<{
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  disabled?: boolean;
}> = ({ checked, onChange, ariaLabel, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={onChange}
    className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
      checked ? "bg-[#42A0FF]" : "bg-[#2C2C30]"
    }`}
  >
    <span
      className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${
        checked ? "translate-x-[19px]" : "translate-x-[3px]"
      }`}
    />
  </button>
);

export function formatPlatformLabel(platform?: string | null): string | null {
  if (!platform) return null;
  if (platform === "linux") return "Linux";
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  return platform;
}

export function formatAccountSummary(
  prov: ProvedorStatusInfo,
  authorizing: string | null,
  activeServerName?: string,
  activeServerKind?: "primary" | "local_child" | "remote_vps" | "joined"
): string {
  if (authorizing === prov.provedor) return "Conectando...";
  const contas = prov.contas ?? [];
  if (contas.length > 0) {
    const primary = contas.find((c) => c.padrao) ?? contas[0];
    const base = primary.email ?? primary.rotulo ?? "Conta conectada";
    return contas.length > 1 ? `${base} (+${contas.length - 1})` : base;
  }
  if (prov.provedor === "opencode" && prov.conectado) {
    const osLabel = formatPlatformLabel(prov.runtime_platform);
    if (activeServerKind && activeServerKind !== "primary") {
      const targetName =
        activeServerName || (activeServerKind === "local_child" ? "Servidor Local" : "Servidor VPS");
      return osLabel ? `Rodando em ${targetName} (${osLabel})` : `Rodando em ${targetName}`;
    }
    return osLabel ? `Disponível neste computador (${osLabel})` : "Disponível neste computador";
  }
  if (prov.provedor === "ollama" && prov.conectado) {
    return "Daemon local ativo em 127.0.0.1:11434";
  }
  if (prov.vault_configurado) {
    return "Chave de API no Cofre";
  }
  if (prov.conectado) {
    return "Conectado";
  }
  return prov.cli_detectado && prov.cli_versao
    ? `${prov.cli_versao} · Não conectado`
    : "Não conectado";
}

export function browserConnectLabel(prov: ProviderName): string {
  if (prov === "gemini") return "Conectar com Google (abrir navegador)";
  if (prov === "claude") return "Conectar Claude (abrir navegador)";
  return "Conectar ChatGPT (abrir navegador)";
}

/**
 * Visual Master/Detail de Provedores de IA do CriativoOS.
 */
