import type { ProvedorStatusInfo } from "@criativo/contracts";
import type { AgenteEnriquecido } from "../utils/studio-storage";

const AGENTS_SESSION_CACHE_KEY = "criativo_last_known_agents_v1";
const PROVIDERS_SESSION_CACHE_KEY = "criativo_last_known_providers_v1";
const HYDRATION_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

/**
 * Só aplica o setter React quando o retorno do daemon for não-nulo,
 * evitando que timeouts ou quedas momentâneas apaguem listas carregadas na UI.
 */
export function applyNonNullHydration<T>(
  incoming: T | null | undefined,
  setter: (value: T) => void
): boolean {
  if (incoming === null || incoming === undefined) {
    return false;
  }
  setter(incoming);
  return true;
}

/**
 * Calcula atraso exponencial controlado (2s, 5s, 10s) para retentativa automática
 * de hidratação após falhas transitórias; retorna `null` ao esgotar as tentativas.
 */
export function computeHydrationRetryDelayMs(attemptIndex: number): number | null {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) {
    return null;
  }
  return HYDRATION_RETRY_DELAYS_MS[attemptIndex] ?? null;
}

function getSafeSessionStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // ambiente sem window/storage
  }
  return null;
}

export function saveLastKnownAgentsCache(agentes: AgenteEnriquecido[]): void {
  if (!Array.isArray(agentes) || agentes.length === 0) return;
  const storage = getSafeSessionStorage();
  if (!storage) return;
  try {
    const compact: AgenteEnriquecido[] = agentes.map((a) => ({
      agente_id: a.agente_id,
      nome: a.nome,
      papel: a.papel,
      frente: a.frente,
      modelo_padrao: a.modelo_padrao,
      status: a.status,
      skills_paths: [],
      memoria_resumo: null,
      ordem_exibicao: a.ordem_exibicao ?? 0,
      config: {},
      pinned: a.pinned,
      hidden: a.hidden,
      section_id: a.section_id,
      atualizado_em: a.atualizado_em,
      nao_lidas: a.nao_lidas,
      ultima_mensagem: a.ultima_mensagem,
      ultima_mensagem_em: a.ultima_mensagem_em,
    }));
    storage.setItem(AGENTS_SESSION_CACHE_KEY, JSON.stringify(compact));
  } catch {
    // ignora erro de quota
  }
}

export function readLastKnownAgentsCache(): AgenteEnriquecido[] | null {
  const storage = getSafeSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(AGENTS_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AgenteEnriquecido[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLastKnownProvidersCache(provedores: ProvedorStatusInfo[]): void {
  if (!Array.isArray(provedores) || provedores.length === 0) return;
  const storage = getSafeSessionStorage();
  if (!storage) return;
  try {
    const safeList = provedores.map((p) => ({
      ...p,
      contas: undefined,
      modelos: Array.isArray(p.modelos) ? p.modelos.slice(0, 40) : [],
    }));
    storage.setItem(PROVIDERS_SESSION_CACHE_KEY, JSON.stringify(safeList));
  } catch {
    // ignora erro de quota
  }
}

export function readLastKnownProvidersCache(): ProvedorStatusInfo[] | null {
  const storage = getSafeSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(PROVIDERS_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProvedorStatusInfo[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}
