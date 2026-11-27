const KNOWN_PROVIDER_COLORS: Record<string, string> = {
  claude: "#D97757",
  anthropic: "#D97757",
  openai: "#74AA9C",
  codex: "#74AA9C",
  gemini: "#5E9BFF",
  antigravity: "#5E9BFF",
  opencode: "#31CF76",
  grok: "#E5E7EB",
  ollama: "#A78BFA",
};

/**
 * Resolve cor determinística para provedores nativos e customizados (OpenAI-compatible / proxy).
 */
export function resolveProviderChartColor(providerId: string): string {
  const normalized = (providerId || "").trim().toLowerCase();
  if (!normalized) return "#7C8CFF";

  for (const [key, color] of Object.entries(KNOWN_PROVIDER_COLORS)) {
    if (normalized === key || normalized.includes(key)) {
      return color;
    }
  }
  if (normalized.includes("gpt")) return KNOWN_PROVIDER_COLORS.openai;

  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 68%, 62%)`;
}

export const RECOMMENDED_PERIOD_OPTIONS: Array<{ dias: number; rotulo: string }> = [
  { dias: 7, rotulo: "Últimos 7 dias" },
  { dias: 30, rotulo: "Últimos 30 dias" },
  { dias: 90, rotulo: "Últimos 90 dias · Semanal" },
  { dias: 365, rotulo: "Último ano (365d) · Mensal" },
  { dias: 3650, rotulo: "Todo o histórico" },
];

export function formatCompactTokensPt(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (safe === 0) return "0";
  if (safe >= 1_000_000) {
    return `${(safe / 1_000_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} mi`;
  }
  if (safe >= 1_000) {
    return `${(safe / 1_000).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} mil`;
  }
  return safe.toLocaleString("pt-BR");
}

export function formatUsdPt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return "Indisponível";
  }
  return `US$ ${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatBucketCompactValue(value: number, mode: "usd" | "tokens"): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (mode === "usd") {
    return `US$ ${safe.toFixed(2).replace(".", ",")}`;
  }
  if (safe >= 1_000_000) {
    return `${(safe / 1_000_000).toFixed(1).replace(".", ",")}M`;
  }
  if (safe >= 1_000) {
    return `${(safe / 1_000).toFixed(1).replace(".", ",")}k`;
  }
  return String(Math.round(safe));
}

export function formatDateTimePt(iso: string | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function inferProviderFromModelOrAgent(
  nameOrProvider: string | null | undefined,
): "gemini" | "claude" | "openai" | "opencode" | "grok" | "ollama" {
  const lower = (nameOrProvider ?? "").toLowerCase();
  if (lower.includes("opencode") || lower.endsWith("-free") || lower.includes("big-pickle")) return "opencode";
  if (lower.includes("claude") || lower.includes("anthropic")) return "claude";
  if (lower.includes("gpt") || lower.includes("codex") || lower.includes("openai")) return "openai";
  if (lower.includes("grok")) return "grok";
  if (lower.includes("ollama") || lower.includes("llama") || lower.includes("qwen")) return "ollama";
  return "gemini";
}
