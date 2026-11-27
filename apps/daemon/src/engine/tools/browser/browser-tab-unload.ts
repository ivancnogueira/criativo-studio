/**
 * Avaliador de pressão de RAM e coordenador de seleção de abas ociosas para auto-unload.
 * Módulo clean-room, sem dependência de UI ou estado global — testável de forma determinística.
 * (SCALE41-01)
 */
import type { MemoryPressureLevel, MemoryPressureSnapshot } from "../../../server/resource-monitor.ts";

export type { MemoryPressureLevel, MemoryPressureSnapshot };

/** Tempo mínimo de ociosidade em ms para descarga sob pressão elevada (2 minutos). */
export const DEFAULT_ELEVATED_IDLE_MS = 120_000;

/** Tempo mínimo de ociosidade em ms para descarga sob pressão crítica (30 segundos). */
export const DEFAULT_CRITICAL_IDLE_MS = 30_000;

/**
 * Provedor de leitura de pressão de RAM — permite injeção determinística em testes.
 */
export type BrowserMemoryHostReader = () => MemoryPressureSnapshot;

/**
 * Subconjunto de campos de ManagedTabEntry relevantes para seleção de abas ociosas.
 * Desacopla o módulo do tipo completo do CDP session.
 */
export interface TabUnloadCandidate {
  tabId: string;
  perfilId: string;
  agenteId: string | null;
  lastActivityAt: number;
  userControl: boolean;
  screencastActive: boolean;
  teachRecording: boolean;
  unloaded: boolean;
  virtualUrl: string;
  virtualTitle: string;
}

export interface SelectTabsOptions {
  /**
   * Tempo mínimo de ociosidade (ms) para descarga sob pressão "elevated".
   * Padrão: DEFAULT_ELEVATED_IDLE_MS (120_000)
   */
  elevatedIdleMs?: number;
  /**
   * Tempo mínimo de ociosidade (ms) para descarga sob pressão "critical".
   * Padrão: DEFAULT_CRITICAL_IDLE_MS (30_000)
   */
  criticalIdleMs?: number;
  /**
   * Número máximo de abas a descarregar por varredura (evita descarga em massa).
   * Padrão: sem limite.
   */
  maxUnloadPerSweep?: number;
}

/**
 * Seleciona abas elegíveis para descarga por pressão de memória.
 *
 * Regras de exclusão (nunca descarregar):
 * - Já marcadas como `unloaded`
 * - Sob controle humano (`userControl === true`)
 * - Em gravação de Teach (`teachRecording === true`)
 * - Ativas dentro da janela mínima de ociosidade (depende do nível de pressão)
 *
 * Resultado: lista ordenada das mais ociosas primeiro (candidatas prioritárias).
 */
export function selectTabsForMemoryUnload(
  tabs: ReadonlyArray<TabUnloadCandidate>,
  pressureLevel: MemoryPressureLevel,
  nowMs: number,
  options: SelectTabsOptions = {}
): TabUnloadCandidate[] {
  if (pressureLevel === "normal") return [];

  const elevatedIdleMs = options.elevatedIdleMs ?? DEFAULT_ELEVATED_IDLE_MS;
  const criticalIdleMs = options.criticalIdleMs ?? DEFAULT_CRITICAL_IDLE_MS;
  const minIdleMs = pressureLevel === "critical" ? criticalIdleMs : elevatedIdleMs;

  const candidates = tabs.filter((tab) => {
    if (tab.unloaded) return false;
    if (tab.userControl) return false;
    if (tab.teachRecording) return false;
    // screencastActive com interação recente é protegida pela janela de ociosidade
    const idleMs = nowMs - tab.lastActivityAt;
    if (idleMs < minIdleMs) return false;
    return true;
  });

  // Ordena as mais ociosas primeiro (maior tempo sem atividade)
  candidates.sort((a, b) => a.lastActivityAt - b.lastActivityAt);

  if (options.maxUnloadPerSweep !== undefined && options.maxUnloadPerSweep > 0) {
    return candidates.slice(0, options.maxUnloadPerSweep);
  }

  return candidates;
}

/**
 * Converte um nível de pressão de RAM para string legível em pt-BR para logs/eventos.
 */
export function pressureLevelLabel(level: MemoryPressureLevel): string {
  switch (level) {
    case "critical": return "crítica";
    case "elevated": return "elevada";
    default: return "normal";
  }
}

export interface UnloadableTabState extends TabUnloadCandidate {
  page: { close(): Promise<void> } | null;
  cdpSession: { detach?: () => Promise<void> } | null;
  snapshotRefs: Map<string, unknown>;
  pendingDialogObj: unknown;
  unloadedAt: number | null;
  unloadReason: string | null;
  suppressCloseCleanup?: boolean;
}

/**
 * Executa o ciclo de descarregamento não-destrutivo de uma aba, preservando estado lógico.
 */
export async function executeNonDestructiveTabUnload(
  entry: UnloadableTabState,
  reason: string,
  stopScreencast: (tabId: string) => Promise<void>,
): Promise<void> {
  await stopScreencast(entry.tabId);
  entry.suppressCloseCleanup = true;
  entry.snapshotRefs.clear();
  entry.pendingDialogObj = null;
  if (entry.cdpSession && typeof entry.cdpSession.detach === "function") {
    await entry.cdpSession.detach().catch(() => {});
  }
  if (entry.page) {
    await entry.page.close().catch(() => {});
  }
  entry.page = null;
  entry.cdpSession = null;
  entry.unloaded = true;
  entry.unloadedAt = Date.now();
  entry.unloadReason = reason;
  entry.suppressCloseCleanup = false;
}

export async function closeContextIfNoLoadedPages(
  perfilId: string,
  tabs: ReadonlyArray<{ perfilId: string; page: unknown }>,
  contexts: Map<string, { context: { close(): Promise<void> } }>,
): Promise<void> {
  if (tabs.some((tab) => tab.perfilId === perfilId && tab.page !== null)) return;
  const ctxEntry = contexts.get(perfilId);
  if (ctxEntry) {
    contexts.delete(perfilId);
    await ctxEntry.context.close().catch(() => {});
  }
}

export async function runMemoryPressureUnloadSweep<T extends UnloadableTabState>(params: {
  tabs: Map<string, T>;
  level: MemoryPressureLevel;
  options?: SelectTabsOptions & { nowMs?: number };
  unloadById: (tabId: string, reason: string, level: "elevated" | "critical") => Promise<boolean>;
}): Promise<string[]> {
  if (params.level === "normal") return [];
  const candidates = selectTabsForMemoryUnload(
    Array.from(params.tabs.values()),
    params.level,
    params.options?.nowMs ?? Date.now(),
    {
      elevatedIdleMs: params.options?.elevatedIdleMs,
      criticalIdleMs: params.options?.criticalIdleMs,
      maxUnloadPerSweep: params.options?.maxUnloadPerSweep ?? 3,
    },
  );
  const unloadedIds: string[] = [];
  for (const candidate of candidates) {
    const reason = `Auto-unload por pressão de RAM (${pressureLevelLabel(params.level)})`;
    if (await params.unloadById(candidate.tabId, reason, params.level)) {
      unloadedIds.push(candidate.tabId);
    }
  }
  return unloadedIds;
}

export async function rehydrateUnloadedTabEntry<
  T extends UnloadableTabState & {
    lastActivityAt: number;
    virtualUrl: string;
    virtualTitle: string;
  },
  TPage extends {
    goto(url: string, opts: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
    url(): string;
    title(): Promise<string>;
  },
  TCdp extends { detach?: () => Promise<void> },
>(
  entry: T,
  openFreshPage: () => Promise<{ page: TPage; cdpSession: TCdp }>,
  attachListeners: (entry: T, page: TPage) => void,
): Promise<T> {
  const { page, cdpSession } = await openFreshPage();
  attachListeners(entry, page);
  entry.page = page as unknown as T["page"];
  entry.cdpSession = cdpSession as unknown as T["cdpSession"];
  entry.unloaded = false;
  entry.unloadedAt = null;
  entry.unloadReason = null;
  entry.suppressCloseCleanup = false;
  entry.lastActivityAt = Date.now();
  const targetUrl = entry.virtualUrl || "about:blank";
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
  entry.virtualUrl = page.url() || targetUrl;
  entry.virtualTitle = await page.title().catch(() => entry.virtualTitle);
  return entry;
}
