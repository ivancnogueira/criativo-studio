import type { ExternalThemePalette, StudioBackdropId } from "@criativo/contracts";

const ALLOWED_TOKEN_KEYS = new Set([
  "--studio-bg-frame",
  "--studio-bg-native-canvas",
  "--studio-bg-canvas",
  "--studio-bg-surface",
  "--studio-bg-surface-raised",
  "--studio-bg-control-active",
  "--studio-bg-sheet-inset",
  "--studio-bg-notch",
  "--studio-border",
  "--studio-border-strong",
  "--studio-border-grouped",
  "--studio-text-primary",
  "--studio-text-secondary",
  "--studio-text-muted",
  "--studio-text-dim",
  "--studio-surface-light",
  "--studio-text-on-light",
  "--studio-accent",
  "--studio-accent-text",
  "--studio-unread-surface",
  "--studio-success",
  "--studio-warning",
  "--studio-danger",
  "--studio-danger-text",
]);

const appliedCustomKeys = new Set<string>();

export function clearExternalThemeTokens(): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  const root = document.documentElement;
  for (const key of appliedCustomKeys) {
    root.style.removeProperty(key);
  }
  appliedCustomKeys.clear();
  root.removeAttribute("data-studio-external-theme");
}

export function applyExternalThemePalette(palette: ExternalThemePalette | null): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  clearExternalThemeTokens();
  if (!palette) return;

  const root = document.documentElement;
  root.setAttribute("data-studio-external-theme", palette.id);
  root.setAttribute("data-studio-theme", palette.base === "light" ? "light" : "carbon_dark");

  for (const [key, val] of Object.entries(palette.tokens)) {
    if (!ALLOWED_TOKEN_KEYS.has(key) || typeof val !== "string") continue;
    root.style.setProperty(key, val);
    appliedCustomKeys.add(key);
  }
}

export function applyStudioBackdrop(backdropId?: string | null): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  const val: StudioBackdropId =
    backdropId === "nebula" || backdropId === "grid_soft" || backdropId === "warm_amber"
      ? backdropId
      : "none";
  document.documentElement.setAttribute("data-studio-backdrop", val);
}
