import {
  spawn,
} from "node:child_process";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  extname,
  join,
  resolve,
} from "node:path";
import {
  resolveManagedProviderRuntime,
} from "./provider-runtime-resolver.ts";
import type { AcpToolStepEvent } from "./turn-stall-watchdog.ts";

/**
 * No Windows o Antigravity CLI abre a página de login Google diretamente (Chrome/rundll32)
 * sem escrever o link em stdout/stderr. Este processo único em loop rápido (150ms) lê o
 * `CommandLine` do navegador disparado para capturar a URL OAuth em <200ms e enviá-la ao Cockpit,
 * abrindo a guia na janela visível do usuário (mesmo comportamento de Claude/ChatGPT).
 */
export function watchGoogleSignInUrlOnWindows(onUrl: (url: string) => void, timeoutMs = 90_000): () => void {
  if (process.platform !== "win32") return () => {};
  const psScript = [
    `$deadline = [DateTime]::UtcNow.AddMilliseconds(${timeoutMs})`,
    "while ([DateTime]::UtcNow -lt $deadline) {",
    "  try {",
    "    $p = Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%accounts.google.com/o/oauth2%'\" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^powershell' } | Select-Object -First 1 -ExpandProperty CommandLine",
    "    if ($p) { Write-Output $p; break }",
    "  } catch {}",
    "  Start-Sleep -Milliseconds 150",
    "}",
  ].join("\n");

  const watcher = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript],
    { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
  );

  let found = false;
  watcher.stdout.on("data", (chunk) => {
    if (found) return;
    const match = chunk.toString("utf8").match(/https:\/\/accounts\.google\.com\/o\/oauth2\/[^\s"']+/i);
    if (match?.[0]) {
      found = true;
      onUrl(match[0]);
      try {
        watcher.kill();
      } catch {
        // ignora
      }
    }
  });

  return () => {
    found = true;
    try {
      watcher.kill();
    } catch {
      // ignora
    }
  };
}

export interface AcpDiscoveredModel {
  modelId: string;
  name: string;
  description?: string | null;
  isDefault?: boolean;
}

export interface AcpAuthTokenSnapshot {
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiryIso: string | null;
}

export type McpServersResolver = (
  agentId?: string | null
) => Promise<unknown[]> | unknown[];

export type VisualImageRole = "foto_real" | "referencia_estilo" | "logo" | "anexo_usuario";

export interface LabeledImageInput {
  path: string;
  role: VisualImageRole;
  label?: string;
}

export function formatLabeledImageInstruction(img: LabeledImageInput): string {
  const safeLabel = (img.label || img.path || "midia").replace(/[\r\n]+/g, " ").trim().slice(0, 140);
  if (img.role === "foto_real") {
    return `[FOTO REAL DO USUÁRIO - preservar fielmente rosto, traços, expressão e aparência: ${safeLabel}]`;
  }
  if (img.role === "referencia_estilo") {
    return `[REFERÊNCIA DE ESTILO - usar apenas paleta, iluminação e composição visual; NÃO copiar nem substituir o rosto da pessoa real: ${safeLabel}]`;
  }
  if (img.role === "logo") {
    return `[LOGO OFICIAL DA MARCA - preservar tipografia e símbolo se incluído: ${safeLabel}]`;
  }
  return `[ANEXO VISUAL ENVIADO PELO USUÁRIO NESTE TURNO: ${safeLabel}]`;
}

export interface AcpPromptExecutionInput {
  geminiDir: string;
  cwd: string;
  promptText: string;
  modelId?: string;
  effort?: string;
  imagePaths?: string[];
  labeledImages?: LabeledImageInput[];
  timeoutMs?: number;
  signal?: AbortSignal;
  agentId?: string | null;
  mcpServers?: unknown[];
  onDelta?: (chunk: string) => void;
  onToolStep?: (step: AcpToolStepEvent) => void;
}

export interface AcpPromptExecutionOutput {
  text: string;
  modelUsed: string;
  usage: {
    uncachedInput: number;
    cachedInput: number;
    output: number;
  };
}

export interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface AcpConfigOption {
  id?: string;
  category?: string;
  currentValue?: string;
  options?: Array<{ value?: string; name?: string }>;
}

export interface AcpSessionNewResult {
  sessionId: string;
  configOptions?: AcpConfigOption[];
  models?: {
    currentModelId?: string;
    availableModels?: Array<{
      modelId?: string;
      name?: string;
      description?: string;
    }>;
  };
}

export function getEffortSuffixOrder(effort?: string): string[] {
  const clean = (effort ?? "").trim().toLowerCase();
  if (clean === "baixo" || clean === "low") {
    return ["-low", "-medium", "-high", "-xhigh"];
  }
  if (clean === "alto" || clean === "high") {
    return ["-high", "-xhigh", "-medium", "-low"];
  }
  if (clean === "maximo" || clean === "máximo" || clean === "xhigh") {
    return ["-xhigh", "-high", "-medium", "-low"];
  }
  return ["-medium", "-high", "-low", "-xhigh"];
}

export function resolveAcpModelSelection(
  requestedId: string,
  candidateIds: string[],
  effort?: string
): string | null {
  const baseId = requestedId.replace(/-(low|medium|high|xhigh)$/i, "");
  const suffixOrder = getEffortSuffixOrder(effort);

  if (effort) {
    for (const suffix of suffixOrder) {
      const candidate = `${baseId}${suffix}`;
      if (candidateIds.includes(candidate)) return candidate;
    }
  }

  if (candidateIds.includes(requestedId)) return requestedId;
  for (const suffix of suffixOrder) {
    const candidate = `${baseId}${suffix}`;
    if (candidateIds.includes(candidate)) return candidate;
  }
  return candidateIds.find((c) => c.startsWith(`${baseId}-`)) ?? null;
}

export const DEFAULT_SIGN_IN_TIMEOUT_MS = 180_000;
export const DEFAULT_PROMPT_TIMEOUT_MS = 10 * 60_000;
export const WORKER_IDLE_TTL_MS = 5 * 60_000;

export function inferMimeFromImagePath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

export function resolveAntigravityCliExecutable(appDataDir?: string): string | null {
  const binNames =
    process.platform === "win32" ? ["antigravity.exe", "agy.exe", "agy.cmd"] : ["antigravity", "agy"];
  return resolveManagedProviderRuntime("antigravity", { appDataDir, binNames }).executable;
}

export function readAccountTokenFile(geminiDir: string): AcpAuthTokenSnapshot | null {
  const tokenPath = join(geminiDir, "antigravity-acp", "antigravity-oauth-token");
  if (!existsSync(tokenPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(tokenPath, "utf8")) as {
      token?: { access_token?: string; refresh_token?: string; expiry?: string };
      id_token_email?: string;
    };
    return {
      email: raw.id_token_email?.trim() || null,
      accessToken: raw.token?.access_token?.trim() || null,
      refreshToken: raw.token?.refresh_token?.trim() || null,
      expiryIso: raw.token?.expiry ?? null,
    };
  } catch {
    return null;
  }
}

export function normalizeJsonRpcError(errObj: unknown): string {
  if (!errObj || typeof errObj !== "object") return "Erro desconhecido do servidor ACP.";
  const rec = errObj as { message?: unknown; data?: { details?: unknown } };
  if (typeof rec.data?.details === "string" && rec.data.details.trim()) {
    return rec.data.details.trim();
  }
  if (typeof rec.message === "string" && rec.message.trim()) {
    return rec.message.trim();
  }
  return "Falha no servidor Antigravity ACP.";
}

