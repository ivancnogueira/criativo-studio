import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import type { AgentAllowedFolder } from "@criativo/contracts";

function isSubPathOrEqual(basePath: string, targetPath: string): boolean {
  const base = resolve(basePath);
  const target = resolve(targetPath);
  const rel = relative(base, target);
  if (!rel) return true;
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return true;
}

/**
 * Resolve e valida o diretório de trabalho (`cwd`) de um processo filho contra o
 * `workspaceRoot` e eventuais `allowedFolders` explícitas do agente.
 * Rejeita paths UNC e qualquer tentativa de escape para diretórios arbitrários do sistema.
 */
export function resolveConfinedWorkingDirectory(options: {
  requestedCwd?: string | null;
  workspaceRoot: string;
  allowedFolders?: readonly AgentAllowedFolder[];
}): string {
  const workspace = resolve(options.workspaceRoot);
  const raw = options.requestedCwd?.trim();
  if (!raw) {
    return workspace;
  }

  const normalized = normalize(raw);
  if (normalized.startsWith(`${sep}${sep}`) || normalized.startsWith("//")) {
    throw new Error(`Diretório UNC bloqueado pelo sandbox: ${raw}`);
  }

  const candidate = isAbsolute(normalized) ? resolve(normalized) : resolve(workspace, normalized);

  if (isSubPathOrEqual(workspace, candidate)) {
    return candidate;
  }

  const allowedList = options.allowedFolders ?? [];
  const inAllowed = allowedList.some((folder) => {
    const folderPath = typeof folder === "string" ? folder : folder.path;
    return Boolean(folderPath) && isSubPathOrEqual(folderPath, candidate);
  });

  if (!inAllowed) {
    throw new Error(
      `Sandbox bloqueou acesso ao diretório '${candidate}' fora do workspace e das pastas autorizadas.`,
    );
  }

  return candidate;
}
