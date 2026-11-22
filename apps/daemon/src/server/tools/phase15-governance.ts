import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentAllowedFolder, BackupModelsConfig, PermissionLevel } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import { parseBackupModelsJson } from "../../engine/runner/backup-models-resolver.ts";
export interface AgentGovernanceState {
  agenteId: string;
  permissionLevel: PermissionLevel;
  allowNewChat: boolean;
  allowQuickAck: boolean;
  browserProfileId: string | null;
  backupModels: BackupModelsConfig;
  allowedFolders: AgentAllowedFolder[];
  autoMemoryEnabled: boolean;
}

const MAX_AGENT_ALLOWED_FOLDERS = 20;

const BLOCKED_SYSTEM_PATHS_LOWER = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata",
  "c:\\$recycle.bin",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/system",
  "/library",
  "/private/etc",
  "/var/root",
];

function normalizePathForCompare(p: string): string {
  const clean = resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? clean.toLowerCase() : clean;
}

function isDriveOrRoot(p: string): boolean {
  const clean = p.trim();
  if (clean === "/" || clean === "\\") return true;
  if (/^[a-zA-Z]:[\\/]?$/.test(clean)) return true;
  return false;
}

export function validateAllowedFolderPath(rawPath: string):
  | { ok: true; normalized: string }
  | { ok: false; error: string } {
  const trimmed = String(rawPath ?? "").trim();
  if (!trimmed || trimmed.includes("\0")) {
    return { ok: false, error: "Informe um caminho de pasta válido." };
  }
  if (!isAbsolute(trimmed)) {
    return {
      ok: false,
      error: "A pasta autorizada deve ser um caminho absoluto (ex.: D:\\Projetos\\Marca ou /home/usuario/projetos).",
    };
  }
  const normalized = resolve(trimmed).replace(/([\\/]+)$/, (m) =>
    isDriveOrRoot(resolve(trimmed)) ? m[0]! : "",
  );
  if (isDriveOrRoot(normalized)) {
    return {
      ok: false,
      error: "Por segurança, não é permitido autorizar a unidade/raiz inteira do sistema (ex.: C:\\ ou /).",
    };
  }

  const lower = normalized.toLowerCase();
  const home = homedir();
  const sensitiveUserDirs = [
    join(home, ".ssh"),
    join(home, ".gnupg"),
    join(home, ".aws"),
  ].map((d) => normalizePathForCompare(d));

  for (const sensitive of sensitiveUserDirs) {
    if (lower === sensitive || lower.startsWith(sensitive + sep) || lower.startsWith(sensitive + "/")) {
      return {
        ok: false,
        error: "Por segurança, pastas sensíveis de credenciais (.ssh, .gnupg, .aws) não podem ser autorizadas.",
      };
    }
  }

  if (/[\\/]\.(?:ssh|gnupg|aws)(?:[\\/]|$)/i.test(normalized)) {
    return {
      ok: false,
      error: "Por segurança, pastas sensíveis de credenciais (.ssh, .gnupg, .aws) não podem ser autorizadas.",
    };
  }

  for (const blocked of BLOCKED_SYSTEM_PATHS_LOWER) {
    const bNorm = blocked.replace(/[\\/]+$/, "");
    if (
      lower === bNorm ||
      lower.startsWith(bNorm + "\\") ||
      lower.startsWith(bNorm + "/")
    ) {
      return {
        ok: false,
        error: `Por segurança, diretórios críticos do sistema (${normalized}) não podem ser autorizados.`,
      };
    }
  }

  return { ok: true, normalized };
}

export function normalizeAllowedFolders(raw: unknown): AgentAllowedFolder[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AgentAllowedFolder[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { path?: unknown; mode?: unknown; added_at?: unknown };
    if (typeof rec.path !== "string") continue;
    const validated = validateAllowedFolderPath(rec.path);
    if (!validated.ok) continue;
    const key = normalizePathForCompare(validated.normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      path: validated.normalized,
      mode: rec.mode === "read" ? "read" : "read_write",
      ...(typeof rec.added_at === "string" && rec.added_at ? { added_at: rec.added_at } : {}),
    });
    if (out.length >= MAX_AGENT_ALLOWED_FOLDERS) break;
  }
  return out;
}

export function sanitizeAllowedFoldersList(
  raw: unknown,
): { ok: true; folders: AgentAllowedFolder[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Campo 'allowed_folders' deve ser uma lista." };
  }
  if (raw.length > MAX_AGENT_ALLOWED_FOLDERS) {
    return {
      ok: false,
      error: `Limite máximo de ${MAX_AGENT_ALLOWED_FOLDERS} pastas autorizadas por agente.`,
    };
  }
  const seen = new Set<string>();
  const out: AgentAllowedFolder[] = [];
  for (const item of raw) {
    const rawPath =
      typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string"
          ? (item as { path: string }).path
          : "";
    const validated = validateAllowedFolderPath(rawPath);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }
    const key = normalizePathForCompare(validated.normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    const modeRaw =
      item && typeof item === "object" ? (item as { mode?: unknown }).mode : undefined;
    const addedAtRaw =
      item && typeof item === "object" ? (item as { added_at?: unknown }).added_at : undefined;
    out.push({
      path: validated.normalized,
      mode: modeRaw === "read" ? "read" : "read_write",
      added_at: typeof addedAtRaw === "string" && addedAtRaw ? addedAtRaw : new Date().toISOString(),
    });
  }
  return { ok: true, folders: out };
}

export function isPathInsideAllowedFolders(
  absTarget: string,
  folders: readonly AgentAllowedFolder[],
  operation: "read" | "write" | "publish",
): boolean {
  if (!folders || folders.length === 0) return false;
  const resolvedTarget = resolve(absTarget);
  const normTarget =
    process.platform === "win32" ? resolvedTarget.toLowerCase() : resolvedTarget;
  for (const folder of folders) {
    if (operation !== "read" && folder.mode === "read") {
      continue;
    }
    const baseResolved = resolve(folder.path);
    const normBase =
      process.platform === "win32" ? baseResolved.toLowerCase() : baseResolved;
    const rel = relative(normBase, normTarget);
    if (
      rel === "" ||
      (!rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel))
    ) {
      return true;
    }
  }
  return false;
}

export function readAgentGovernance(
  db: CriativoDatabase,
  agenteId: string,
): AgentGovernanceState {
  const row = db.connection
    .prepare(
      `SELECT permission_level, allow_new_chat, allow_quick_ack, browser_profile_id, backup_models_json, config_json
       FROM projecao_agentes
       WHERE agente_id = ?
       LIMIT 1;`,
    )
    .get(agenteId) as
    | {
        permission_level?: string | null;
        allow_new_chat?: number | null;
        allow_quick_ack?: number | null;
        browser_profile_id?: string | null;
        backup_models_json?: string | null;
        config_json?: string | null;
      }
    | undefined;

  const perm: PermissionLevel =
    row?.permission_level === "ask" || row?.permission_level === "full"
      ? row.permission_level
      : "workspace";

  let parsedCfg: Record<string, unknown> = {};
  if (row?.config_json) {
    try {
      const p = JSON.parse(row.config_json) as Record<string, unknown>;
      if (p && typeof p === "object") parsedCfg = p;
    } catch {
      parsedCfg = {};
    }
  }

  return {
    agenteId,
    permissionLevel: perm,
    allowNewChat: row?.allow_new_chat !== 0,
    allowQuickAck: row?.allow_quick_ack !== 0,
    browserProfileId: row?.browser_profile_id ?? null,
    backupModels: parseBackupModelsJson(row?.backup_models_json),
    allowedFolders: normalizeAllowedFolders(parsedCfg.allowed_folders),
    autoMemoryEnabled: parsedCfg.auto_memory_enabled !== false,
  };
}

export class PermissionEscalationRequiredError extends Error {
  public readonly code = "permission_ask_required";
  constructor(message: string) {
    super(message);
    this.name = "PermissionEscalationRequiredError";
  }
}

export function assertAgentPermissionForPath(params: {
  rawPath: string;
  workspaceRoot: string;
  permissionLevel: PermissionLevel;
  agenteId: string;
  operation: "read" | "write" | "publish";
  allowedFolders?: readonly AgentAllowedFolder[];
}): void {
  const trimmed = String(params.rawPath ?? "").trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error("Caminho de arquivo inválido.");
  }

  const rootAbs = resolve(params.workspaceRoot);
  const absTarget = isAbsolute(trimmed) ? resolve(trimmed) : resolve(rootAbs, trimmed);

  if (
    params.allowedFolders &&
    params.allowedFolders.length > 0 &&
    isPathInsideAllowedFolders(absTarget, params.allowedFolders, params.operation)
  ) {
    return;
  }

  const relToRoot = relative(rootAbs, absTarget);
  const insideWorkspace =
    relToRoot === "" ||
    (!relToRoot.startsWith("..") && !relToRoot.includes(`..${sep}`) && !isAbsolute(relToRoot));

  if (!insideWorkspace) {
    if (params.permissionLevel === "ask" && params.operation !== "read") {
      throw new PermissionEscalationRequiredError(
        `Nível de permissão 'ask': confirme com o usuário antes de ${params.operation === "publish" ? "publicar" : "gravar"} fora do workspace (${trimmed}).`,
      );
    }
    throw new Error(
      `Acesso bloqueado fora do workspace raiz e das Pastas Autorizadas (${trimmed}) no nível de permissão '${params.permissionLevel}'.`,
    );
  }

  if (params.permissionLevel === "workspace") {
    const allowedWorkspaceRoots = [
      resolve(rootAbs, "recursos"),
      resolve(rootAbs, "saidas"),
      resolve(rootAbs, "previas"),
      resolve(rootAbs, "dados", "agentes", params.agenteId),
    ];
    const inStrictDirs = allowedWorkspaceRoots.some((allowed) => {
      const subRel = relative(allowed, absTarget);
      return (
        subRel === "" ||
        (!subRel.startsWith("..") && !subRel.includes(`..${sep}`) && !isAbsolute(subRel))
      );
    });
    if (!inStrictDirs) {
      throw new Error(
        `Nível de permissão 'workspace': '${trimmed}' está fora de recursos/, saidas/, previas/, dados/agentes/${params.agenteId}/ ou Pastas Autorizadas do agente. Adicione a pasta ou altere a permissão em Controle se necessário.`,
      );
    }
  } else if (params.permissionLevel === "ask" && params.operation !== "read") {
    const allowedWriteRoots = [
      resolve(rootAbs, "recursos"),
      resolve(rootAbs, "saidas"),
      resolve(rootAbs, "previas"),
    ];
    const inStandardOut = allowedWriteRoots.some((allowed) => {
      const subRel = relative(allowed, absTarget);
      return (
        subRel === "" ||
        (!subRel.startsWith("..") && !subRel.includes(`..${sep}`) && !isAbsolute(subRel))
      );
    });
    if (!inStandardOut) {
      throw new PermissionEscalationRequiredError(
        `Nível de permissão 'ask': operação '${params.operation}' em '${trimmed}' requer confirmação humana.`,
      );
    }
  }
}
