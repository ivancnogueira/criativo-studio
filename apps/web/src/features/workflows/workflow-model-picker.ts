import type { ProvedorStatusInfo, ProviderName } from "@criativo/contracts";

const PROVIDER_ORDER: readonly ProviderName[] = [
  "gemini",
  "claude",
  "openai",
  "opencode",
  "ollama",
];

function providerOrderIndex(provedor: ProviderName): number {
  const idx = PROVIDER_ORDER.indexOf(provedor);
  return idx >= 0 ? idx : PROVIDER_ORDER.length + 1;
}

export interface ConnectedWorkflowModelChoice {
  model: string;
  provider: ProviderName;
  label: string;
}

/**
 * Seleciona deterministicamente o primeiro modelo conectado viável no estúdio,
 * ignorando modelos ocultos e provedores desconectados.
 */
export function resolveFirstConnectedModel(
  provedores: readonly ProvedorStatusInfo[]
): ConnectedWorkflowModelChoice | null {
  const connected = [...provedores]
    .filter((p) => p.conectado)
    .sort((a, b) => {
      const diff = providerOrderIndex(a.provedor) - providerOrderIndex(b.provedor);
      if (diff !== 0) return diff;
      return a.provedor.localeCompare(b.provedor);
    });

  for (const prov of connected) {
    const visible = (prov.modelos ?? []).filter((m) => !m.oculto);
    if (visible.length === 0) continue;

    const sorted = [...visible].sort((a, b) => {
      const defA = a.padrao ? 1 : 0;
      const defB = b.padrao ? 1 : 0;
      if (defA !== defB) return defB - defA;
      const remA = typeof a.restante_percentual === "number" ? a.restante_percentual : 100;
      const remB = typeof b.restante_percentual === "number" ? b.restante_percentual : 100;
      if (remA !== remB) return remB - remA;
      return a.id.localeCompare(b.id);
    });

    const best = sorted[0];
    if (best) {
      return {
        model: best.id,
        provider: prov.provedor,
        label: `${prov.rotulo} (${best.rotulo})`,
      };
    }
  }

  return null;
}

export function describeAutoModelLabel(provedores: readonly ProvedorStatusInfo[]): string {
  const best = resolveFirstConnectedModel(provedores);
  return best
    ? `Automático · ${best.label}`
    : "Automático (conecte um provedor de IA)";
}
