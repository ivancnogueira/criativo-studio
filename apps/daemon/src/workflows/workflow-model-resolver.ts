import type {
  ModeloProvedorInfo,
  ProvedorStatusInfo,
  WorkflowViableModelInfo,
} from "@criativo/contracts";
import type { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";

const PROVIDER_PREFERENCE_ORDER = [
  "gemini",
  "claude",
  "openai",
  "opencode",
  "ollama",
] as const;

const VAULT_DEFAULT_MODEL_BY_PROVIDER: Array<{ provider: string; model: string; label: string }> = [
  { provider: "gemini", model: "gemini-2.5-pro", label: "Gemini · Gemini 2.5 Pro (Vault)" },
  { provider: "claude", model: "claude-sonnet-4-5", label: "Claude · Sonnet 4.5 (Vault)" },
  { provider: "openai", model: "gpt-4o", label: "OpenAI · GPT-4o (Vault)" },
  { provider: "grok", model: "grok-3", label: "Grok · Grok 3 (Vault)" },
];

function providerRank(provider: string): number {
  const idx = PROVIDER_PREFERENCE_ORDER.indexOf(
    provider as (typeof PROVIDER_PREFERENCE_ORDER)[number]
  );
  return idx >= 0 ? idx : PROVIDER_PREFERENCE_ORDER.length + 1;
}

function pickBestModelFromProvider(status: ProvedorStatusInfo): ModeloProvedorInfo | null {
  const visible = (status.modelos ?? []).filter((m) => !m.oculto);
  if (visible.length === 0) return null;

  const sorted = [...visible].sort((a, b) => {
    const defA = a.padrao ? 1 : 0;
    const defB = b.padrao ? 1 : 0;
    if (defA !== defB) return defB - defA;

    const remA = typeof a.restante_percentual === "number" ? a.restante_percentual : 100;
    const remB = typeof b.restante_percentual === "number" ? b.restante_percentual : 100;
    if (remA !== remB) return remB - remA;

    return a.id.localeCompare(b.id);
  });

  return sorted[0] ?? null;
}

function isProviderUsable(
  provider: string,
  statuses: readonly ProvedorStatusInfo[],
  hasVaultApiKey?: (provider: string) => boolean
): boolean {
  if (provider === "ollama") {
    const ollamaStatus = statuses.find((s) => s.provedor === "ollama");
    return ollamaStatus ? ollamaStatus.conectado : true;
  }
  if (hasVaultApiKey?.(provider)) return true;
  return statuses.some((s) => s.provedor === provider && s.conectado);
}

/**
 * Seleciona deterministicamente o melhor modelo conectado viável para nós de workflow,
 * evitando fallback cego para provedores desconectados.
 */
export async function resolveViableWorkflowModel(
  deps: {
    providers: ProviderRegistry;
    providerConnection: ProviderConnectionService;
    hasVaultApiKey?: (provider: string) => boolean;
  },
  preferredModel?: string,
  preferredProvider?: string
): Promise<WorkflowViableModelInfo> {
  let statuses: ProvedorStatusInfo[] = [];
  try {
    statuses = await deps.providerConnection.getProvidersStatus(false);
  } catch {
    statuses = [];
  }

  const trimmedModel = preferredModel?.trim();
  if (trimmedModel) {
    const resolvedProvider =
      preferredProvider?.trim() || deps.providers.resolveProviderName(trimmedModel);
    if (isProviderUsable(resolvedProvider, statuses, deps.hasVaultApiKey)) {
      return {
        model: trimmedModel,
        provider: resolvedProvider,
        label: trimmedModel,
        source: "explicit",
      };
    }
  }

  const connected = [...statuses]
    .filter((s) => s.conectado)
    .sort((a, b) => {
      const rankDiff = providerRank(a.provedor) - providerRank(b.provedor);
      if (rankDiff !== 0) return rankDiff;
      return a.provedor.localeCompare(b.provedor);
    });

  for (const status of connected) {
    const chosen = pickBestModelFromProvider(status);
    if (chosen) {
      return {
        model: chosen.id,
        provider: status.provedor,
        label: `${status.rotulo} · ${chosen.rotulo}`,
        source: chosen.padrao ? "connected_default" : "connected_fallback",
      };
    }
  }

  if (deps.hasVaultApiKey) {
    for (const entry of VAULT_DEFAULT_MODEL_BY_PROVIDER) {
      if (deps.hasVaultApiKey(entry.provider)) {
        return {
          model: entry.model,
          provider: entry.provider,
          label: entry.label,
          source: "vault_key",
        };
      }
    }
  }

  return {
    model: null,
    provider: null,
    label: null,
    source: "none",
  };
}
