/**
 * Contratos compartilhados da Fase 37 (Ecossistema Avançado P3):
 * G-21: Computer Use Nativo (cua-driver)
 * G-22: Temas Externos via JSON (hot-reload) & Backdrops
 * G-23: Deep Links criativo:// & Templates Versionados de Agentes
 * G-24: Monitoramento de Recursos do Host & Processos em Background
 */

export type CuaActionType =
  | "click"
  | "double_click"
  | "type_text"
  | "hotkey"
  | "scroll"
  | "focus_window"
  | "screenshot_region";

export interface CuaPoint {
  x: number;
  y: number;
}

export interface CuaRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CuaActionRequest {
  action: CuaActionType;
  agente_id: string;
  x?: number;
  y?: number;
  text?: string;
  keys?: string[];
  delta_x?: number;
  delta_y?: number;
  window_title?: string;
  region?: CuaRegion;
  aprovado_por_humano?: boolean;
}

export interface CuaActionResult {
  ok: boolean;
  action: CuaActionType;
  window_title?: string | null;
  cursor?: CuaPoint | null;
  highlight_region?: CuaRegion | null;
  screenshot_base64?: string | null;
  executed_at: string;
  message: string;
}

export interface CuaStatusSnapshot {
  enabled: boolean;
  running: boolean;
  aborted: boolean;
  active_agent_id: string | null;
  active_window: string | null;
  cursor: CuaPoint | null;
  highlight_region: CuaRegion | null;
  permission_granted: boolean;
  last_action: CuaActionType | null;
  last_action_at: string | null;
  message: string | null;
}

export type StudioBackdropId = "none" | "nebula" | "grid_soft" | "warm_amber";

export interface ExternalThemePalette {
  id: string;
  name: string;
  base: "dark" | "light";
  description?: string;
  tokens: Record<string, string>;
  backdrop?: StudioBackdropId;
  source_file?: string;
  updated_at: string;
}

export interface ThemeReloadEventPayload {
  themes: ExternalThemePalette[];
  changed_theme_id: string | null;
  reloaded_at: string;
}

export type DeepLinkRoute =
  | { kind: "agent"; agenteId: string; rawUrl: string }
  | { kind: "workflow"; workflowId: string; rawUrl: string }
  | { kind: "oauth_callback"; provider: string; code: string | null; state: string | null; rawUrl: string }
  | { kind: "server_connect"; url: string; claim: string | null; name: string | null; rawUrl: string }
  | { kind: "template_install"; sourceUrl: string | null; templateJson: string | null; rawUrl: string };

export interface AgentTemplatePackage {
  schema_version: 1;
  template_id: string;
  name: string;
  role: string;
  version: string;
  author_display: string;
  description: string;
  sha256: string;
  created_at: string;
  skills: string[];
  config_sanitized: {
    modelo_padrao?: string;
    temperatura?: number;
    max_tokens?: number;
    nivel_esforco?: "low" | "medium" | "high" | "xhigh";
    cua_enabled?: boolean;
    system_prompt?: string;
  };
}

export type TrackedBackgroundProcessKind = "chromium" | "remotion" | "mcp" | "voice" | "shell";

export interface TrackedBackgroundProcess {
  pid: number;
  kind: TrackedBackgroundProcessKind;
  label: string;
  started_at: string;
  uptime_ms: number;
  memory_mb: number;
  can_kill: boolean;
}

export interface HostResourceSnapshot {
  timestamp: string;
  platform: string;
  hostname: string;
  cpus: number;
  cpu_percent: number;
  memory_total_mb: number;
  memory_used_mb: number;
  memory_free_mb: number;
  memory_percent: number;
  daemon_rss_mb: number;
  disk_total_gb: number;
  disk_free_gb: number;
  disk_percent: number;
  processes: TrackedBackgroundProcess[];
}
