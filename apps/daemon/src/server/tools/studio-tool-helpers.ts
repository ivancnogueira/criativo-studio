import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
export function readStringArg(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = args[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

export function readStringArrayArg(args: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const val = args[key];
    if (Array.isArray(val)) {
      return val.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    }
  }
  return [];
}

export function readStringRecordArg(
  args: Record<string, unknown>,
  ...keys: string[]
): Record<string, string> | undefined {
  for (const key of keys) {
    const val = args[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  }
  return undefined;
}

export function resolveSafeStudioMediaPath(workspaceRoot: string, rawMediaPath: string): string {
  const trimmed = rawMediaPath.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error("Caminho de mídia inválido.");
  }

  const allowedRoots = [
    resolve(workspaceRoot, "recursos"),
    resolve(workspaceRoot, "saidas"),
    resolve(workspaceRoot, "previas"),
  ];
  const resolvedTarget = isAbsolute(trimmed)
    ? resolve(trimmed)
    : resolve(workspaceRoot, trimmed);

  const contained = allowedRoots.some((root) => {
    const rel = relative(root, resolvedTarget);
    return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel);
  });

  if (!contained) {
    throw new Error(
      "Acesso negado: o anexo de mídia deve estar contido em recursos/, saidas/ ou previas/."
    );
  }

  if (!existsSync(resolvedTarget) || !statSync(resolvedTarget).isFile()) {
    throw new Error(`Arquivo de mídia não encontrado: ${rawMediaPath}`);
  }

  return resolvedTarget;
}
