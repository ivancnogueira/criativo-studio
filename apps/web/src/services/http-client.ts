import type { LicenseActivationStatus, WorkflowDetail } from "@criativo/contracts";

export class WorkflowRevisionConflictError extends Error {
  public readonly conflict: WorkflowDetail;
  public readonly statusCode = 409;

  constructor(message: string, conflict: WorkflowDetail) {
    super(message);
    this.name = "WorkflowRevisionConflictError";
    this.conflict = conflict;
  }
}

export class DaemonHttpError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly payload?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code?: string,
    payload?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DaemonHttpError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

let licenseRequiredListener: ((status: LicenseActivationStatus | null) => void) | null = null;
export const ACTIVE_SERVER_STORAGE_KEY = "criativo_active_server_id";
const activeServerListeners = new Set<(serverId: string) => void>();
let storageListenerInstalled = false;

let activeServerId = (() => {
  if (typeof window === "undefined") return "primary";
  try {
    return window.localStorage.getItem(ACTIVE_SERVER_STORAGE_KEY) || "primary";
  } catch {
    return "primary";
  }
})();

function notifyActiveServerListeners(nextId: string): void {
  for (const listener of activeServerListeners) {
    try {
      listener(nextId);
    } catch {
      // ignora erro em listener individual
    }
  }
}

export function subscribeActiveServerChanges(listener: (serverId: string) => void): () => void {
  if (typeof window !== "undefined" && !storageListenerInstalled) {
    storageListenerInstalled = true;
    window.addEventListener("storage", (evt) => {
      if (evt.key !== ACTIVE_SERVER_STORAGE_KEY) return;
      const nextId = evt.newValue || "primary";
      if (nextId !== activeServerId) {
        activeServerId = nextId;
        notifyActiveServerListeners(nextId);
      }
    });
  }
  activeServerListeners.add(listener);
  return () => {
    activeServerListeners.delete(listener);
  };
}

export function getActiveServerId(): string {
  return activeServerId;
}

export function setActiveServerId(serverId: string): void {
  const nextId = serverId || "primary";
  const changed = nextId !== activeServerId;
  activeServerId = nextId;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, activeServerId);
    } catch {
      // ignora erro de quota
    }
  }
  if (changed) {
    notifyActiveServerListeners(activeServerId);
  }
}

function shouldForwardToActiveServer(rawInput: RequestInfo | URL): boolean {
  if (!activeServerId || activeServerId === "primary") return false;
  const urlStr =
    typeof rawInput === "string"
      ? rawInput
      : rawInput instanceof URL
        ? rawInput.pathname
        : rawInput.url;
  if (!urlStr.startsWith("/api/")) return false;
  if (urlStr.startsWith("/api/studio/servers") || urlStr.startsWith("/api/studio/license")) {
    return false;
  }
  return true;
}

/** Resolve URL de mídia/preview do servidor ativo para tags <img>/<video>/<iframe> sem headers customizados. */
export function resolveActiveServerUrl(rawUrl: string): string {
  if (!activeServerId || activeServerId === "primary") return rawUrl;
  if (!rawUrl.startsWith("/api/")) return rawUrl;
  if (rawUrl.includes("serverId=")) return rawUrl;
  const sep = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${sep}serverId=${encodeURIComponent(activeServerId)}`;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!shouldForwardToActiveServer(input)) {
    return await globalThis.fetch(input, init);
  }
  const headers = new Headers(init?.headers);
  if (!headers.has("X-Criativo-Server-Id")) {
    headers.set("X-Criativo-Server-Id", activeServerId);
  }
  return await globalThis.fetch(input, { ...init, headers });
}

export function setOnLicenseRequiredHandler(
  handler: ((status: LicenseActivationStatus | null) => void) | null
): void {
  licenseRequiredListener = handler;
}

export async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  if (!res.ok) {
    if (res.status === 402 && licenseRequiredListener) {
      const licStatus =
        parsed.status && typeof parsed.status === "object"
          ? (parsed.status as LicenseActivationStatus)
          : null;
      licenseRequiredListener(licStatus);
    }
    const errMsg =
      typeof parsed.erro === "string"
        ? parsed.erro
        : typeof parsed.message === "string"
          ? parsed.message
          : `Erro HTTP ${res.status} ao consultar ${input}.`;
    const errCode =
      typeof parsed.code === "string"
        ? parsed.code
        : typeof parsed.error === "string"
          ? parsed.error
          : undefined;
    throw new DaemonHttpError(errMsg, res.status, errCode, parsed);
  }
  return parsed as T;
}
