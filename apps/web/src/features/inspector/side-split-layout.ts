/**
 * Layout multi-split vertical do painel lateral direito (até 3 grupos) — Fase 43 (UX43-01).
 * Módulo puro, sem dependências de DOM (exceto leitura/escrita opcional em localStorage).
 */

export const MAX_SIDE_SPLIT_GROUPS = 3;
export const MIN_SPLIT_RATIO = 0.18;
export const SIDE_SPLIT_STORAGE_KEY = "criativo.side_split_layout.v1";

export type SideSplitGroupKind = "inspector" | "browser" | "preview" | "side_thread";

export interface SideSplitGroup {
  id: string;
  kind: SideSplitGroupKind;
  ratio: number;
  collapsed?: boolean;
}

export interface SideSplitLayoutState {
  groups: SideSplitGroup[];
}

/** Garante soma `1.0` e mínimo de `MIN_SPLIT_RATIO` (ou `1/n` quando houver muitos grupos). */
export function normalizeSplitRatios(groups: SideSplitGroup[]): SideSplitGroup[] {
  const n = groups.length;
  if (n === 0) return [];
  const min = Math.min(MIN_SPLIT_RATIO, 1 / n);
  const raw = groups.map((g) => (Number.isFinite(g.ratio) && g.ratio > 0 ? g.ratio : 1 / n));
  const sum = raw.reduce((a, b) => a + b, 0);
  const scaled = raw.map((r) => r / sum);
  const excess = scaled.map((r) => Math.max(0, r - min));
  const totalExcess = excess.reduce((a, b) => a + b, 0);
  const remaining = 1 - n * min;
  return groups.map((g, i) => ({
    ...g,
    ratio: min + (totalExcess > 0 ? (remaining * (excess[i] ?? 0)) / totalExcess : remaining / n),
  }));
}

export function addSplitGroup(
  state: SideSplitLayoutState,
  kind: SideSplitGroupKind
): SideSplitLayoutState {
  const existing = state.groups.findIndex((g) => g.kind === kind);
  if (existing >= 0) {
    const promoted = [state.groups[existing]!, ...state.groups.filter((_, i) => i !== existing)];
    return { groups: normalizeSplitRatios(promoted) };
  }
  if (state.groups.length >= MAX_SIDE_SPLIT_GROUPS) return state;
  const next = [...state.groups, { id: kind, kind, ratio: 1 / (state.groups.length + 1) }];
  return { groups: normalizeSplitRatios(next) };
}

export function removeSplitGroup(
  state: SideSplitLayoutState,
  groupId: string
): SideSplitLayoutState {
  return { groups: normalizeSplitRatios(state.groups.filter((g) => g.id !== groupId)) };
}

/** Ajusta a divisória entre `upperIndex` e `upperIndex + 1` respeitando o mínimo por grupo. */
export function resizeSplitPair(
  state: SideSplitLayoutState,
  upperIndex: number,
  deltaRatio: number
): SideSplitLayoutState {
  const a = state.groups[upperIndex];
  const b = state.groups[upperIndex + 1];
  if (!a || !b) return state;
  const total = a.ratio + b.ratio;
  const nextA = Math.min(total - MIN_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, a.ratio + deltaRatio));
  const groups = state.groups.map((g, i) =>
    i === upperIndex ? { ...g, ratio: nextA } : i === upperIndex + 1 ? { ...g, ratio: total - nextA } : g
  );
  return { groups };
}

export function reorderSplitGroup(
  state: SideSplitLayoutState,
  groupId: string,
  direction: "up" | "down"
): SideSplitLayoutState {
  const idx = state.groups.findIndex((g) => g.id === groupId);
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || target < 0 || target >= state.groups.length) return state;
  const groups = [...state.groups];
  const [moved] = groups.splice(idx, 1);
  groups.splice(target, 0, moved!);
  return { groups };
}

/**
 * Reconcilia o layout salvo com os painéis atualmente abertos (mantém ordem/proporção dos ainda ativos).
 */
export function reconcileSideSplitLayout(
  state: SideSplitLayoutState,
  activeKinds: SideSplitGroupKind[]
): SideSplitLayoutState {
  const kept = state.groups.filter((g) => activeKinds.includes(g.kind));
  const added = activeKinds
    .filter((k) => !kept.some((g) => g.kind === k))
    .map((k) => ({ id: k, kind: k, ratio: 1 / Math.max(1, activeKinds.length) }));
  return { groups: normalizeSplitRatios([...kept, ...added].slice(0, MAX_SIDE_SPLIT_GROUPS)) };
}

export function readStoredSideSplitLayout(): SideSplitLayoutState {
  if (typeof window === "undefined") return { groups: [] };
  try {
    const raw = window.localStorage.getItem(SIDE_SPLIT_STORAGE_KEY);
    if (!raw) return { groups: [] };
    const parsed = JSON.parse(raw) as SideSplitLayoutState;
    if (!Array.isArray(parsed.groups)) return { groups: [] };
    const valid = parsed.groups.filter(
      (g) => g && typeof g.kind === "string" && typeof g.id === "string" && typeof g.ratio === "number"
    );
    return { groups: normalizeSplitRatios(valid.slice(0, MAX_SIDE_SPLIT_GROUPS)) };
  } catch {
    return { groups: [] };
  }
}

export function writeStoredSideSplitLayout(state: SideSplitLayoutState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDE_SPLIT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignora erro de quota
  }
}
