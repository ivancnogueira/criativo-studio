import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ExternalThemePalette, StudioBackdropId } from "@criativo/contracts";
import type { WebSocketHub } from "../server/websocket-hub.ts";

const ALLOWED_CSS_TOKEN_KEYS = new Set([
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

const ALLOWED_BACKDROPS = new Set<StudioBackdropId>(["none", "nebula", "grid_soft", "warm_amber"]);

const SAFE_COLOR_REGEX =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/;

export class ThemeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeValidationError";
  }
}

export function sanitizeThemeId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!cleaned) {
    throw new ThemeValidationError("ID de tema inválido.");
  }
  return cleaned;
}

export function validateCssTokenValue(key: string, value: unknown): string {
  if (!ALLOWED_CSS_TOKEN_KEYS.has(key)) {
    throw new ThemeValidationError(`Token CSS não permitido no tema externo: '${key}'.`);
  }
  if (typeof value !== "string") {
    throw new ThemeValidationError(`Valor inválido para token '${key}'.`);
  }
  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();
  if (
    !trimmed ||
    trimmed.length > 64 ||
    lowered.includes("url(") ||
    lowered.includes("expression(") ||
    lowered.includes("javascript:") ||
    lowered.includes("@import") ||
    /[;<>{}]/.test(trimmed)
  ) {
    throw new ThemeValidationError(`Valor CSS inseguro rejeitado em '${key}'.`);
  }
  if (!SAFE_COLOR_REGEX.test(trimmed)) {
    throw new ThemeValidationError(
      `Formato de cor inválido em '${key}'. Use hex (#RRGGBB), rgb/rgba ou hsl/hsla.`,
    );
  }
  return trimmed;
}

export function parseAndValidateExternalTheme(
  rawInput: unknown,
  sourceFile?: string,
): ExternalThemePalette {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new ThemeValidationError("O tema JSON deve ser um objeto válido.");
  }
  const obj = rawInput as Record<string, unknown>;
  const id = sanitizeThemeId(String(obj.id ?? (sourceFile ? sourceFile.replace(/\.json$/i, "") : "")));
  const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim().slice(0, 60) : id;
  const base = obj.base === "light" ? "light" : "dark";
  const description = typeof obj.description === "string" ? obj.description.trim().slice(0, 140) : undefined;

  if (!obj.tokens || typeof obj.tokens !== "object" || Array.isArray(obj.tokens)) {
    throw new ThemeValidationError("Campo obrigatório 'tokens' ausente ou inválido.");
  }

  const sanitizedTokens: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj.tokens as Record<string, unknown>)) {
    sanitizedTokens[k] = validateCssTokenValue(k, v);
  }
  if (Object.keys(sanitizedTokens).length === 0) {
    throw new ThemeValidationError("O tema deve definir ao menos um token CSS permitido.");
  }

  const backdropRaw = typeof obj.backdrop === "string" ? (obj.backdrop as StudioBackdropId) : undefined;
  const backdrop = backdropRaw && ALLOWED_BACKDROPS.has(backdropRaw) ? backdropRaw : "none";

  return {
    id,
    name,
    base,
    ...(description ? { description } : {}),
    tokens: sanitizedTokens,
    backdrop,
    ...(sourceFile ? { source_file: basename(sourceFile) } : {}),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Gerencia temas externos JSON em `dados/themes/` com validação estrita e hot-reload via WebSocket (G-22).
 */
export class ThemePaletteFilesService {
  private readonly themesDir: string;
  private readonly wsHub?: WebSocketHub;
  private themes = new Map<string, ExternalThemePalette>();
  private watcher: FSWatcher | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: { themesDir?: string; wsHub?: WebSocketHub; autoWatch?: boolean } = {}) {
    this.themesDir = resolve(options.themesDir ?? join(process.cwd(), "dados", "themes"));
    this.wsHub = options.wsHub;
    this.reloadFromDisk(null, false);
    if (options.autoWatch) {
      this.startWatching();
    }
  }

  public getThemesDir(): string {
    return this.themesDir;
  }

  public listThemes(): ExternalThemePalette[] {
    return Array.from(this.themes.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  public getTheme(id: string): ExternalThemePalette | null {
    return this.themes.get(id) ?? null;
  }

  public reloadFromDisk(changedThemeId: string | null = null, broadcast = true): ExternalThemePalette[] {
    if (!existsSync(this.themesDir)) {
      this.themes.clear();
      return [];
    }

    const nextMap = new Map<string, ExternalThemePalette>();
    for (const file of readdirSync(this.themesDir)) {
      if (!file.toLowerCase().endsWith(".json")) continue;
      const fullPath = join(this.themesDir, file);
      try {
        const raw = JSON.parse(readFileSync(fullPath, "utf8")) as unknown;
        const validated = parseAndValidateExternalTheme(raw, file);
        nextMap.set(validated.id, validated);
      } catch {
        // Ignora tema malformado no disco sem derrubar os demais
      }
    }

    this.themes = nextMap;
    const list = this.listThemes();
    if (broadcast) {
      this.wsHub?.broadcast("theme:reloaded", {
        themes: list,
        changed_theme_id: changedThemeId,
        reloaded_at: new Date().toISOString(),
      });
    }
    return list;
  }

  public importThemeJson(rawJson: string | Record<string, unknown>): ExternalThemePalette {
    const parsed = typeof rawJson === "string" ? (JSON.parse(rawJson) as unknown) : rawJson;
    const validated = parseAndValidateExternalTheme(parsed);
    mkdirSync(this.themesDir, { recursive: true });
    const fileName = `${validated.id}.json`;
    const filePath = join(this.themesDir, fileName);
    const saved: ExternalThemePalette = {
      ...validated,
      source_file: fileName,
      updated_at: new Date().toISOString(),
    };
    writeFileSync(filePath, JSON.stringify(saved, null, 2), "utf8");
    this.themes.set(saved.id, saved);
    this.wsHub?.broadcast("theme:reloaded", {
      themes: this.listThemes(),
      changed_theme_id: saved.id,
      reloaded_at: saved.updated_at,
    });
    return saved;
  }

  public startWatching(): void {
    if (this.watcher) return;
    mkdirSync(this.themesDir, { recursive: true });
    try {
      this.watcher = watch(this.themesDir, (_eventType, filename) => {
        const name = typeof filename === "string" ? filename : "";
        if (name && !name.toLowerCase().endsWith(".json")) return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          const changedId = name ? name.replace(/\.json$/i, "") : null;
          this.reloadFromDisk(changedId, true);
        }, 120);
      });
      this.watcher.unref?.();
    } catch {
      this.watcher = null;
    }
  }

  public dispose(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignora
      }
      this.watcher = null;
    }
  }
}
