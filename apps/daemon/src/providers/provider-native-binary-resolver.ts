import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { ManagedRuntimeFolder } from "./provider-runtime-locate.ts";

function isExistingFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function inferFolderFromPath(
  candidatePath: string,
  explicitFolder?: ManagedRuntimeFolder
): ManagedRuntimeFolder | null {
  if (explicitFolder) return explicitFolder;
  const lower = candidatePath.toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("codex")) return "codex";
  if (lower.includes("opencode")) return "opencode";
  if (lower.includes("antigravity") || lower.includes("agy")) return "antigravity";
  return null;
}

function resolveNodeModulesRoot(filePath: string): string | null {
  let cursor = dirname(resolve(filePath));
  for (let depth = 0; depth < 8; depth += 1) {
    if (basename(cursor).toLowerCase() === "node_modules") {
      return cursor;
    }
    const candidateNm = join(cursor, "node_modules");
    if (existsSync(candidateNm)) {
      return candidateNm;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function resolveCodexNativeCandidates(nmRoot: string): string[] {
  const isWin = process.platform === "win32";
  const isArm = process.arch === "arm64";
  const archFolder = isWin
    ? isArm
      ? "aarch64-pc-windows-msvc"
      : "x86_64-pc-windows-msvc"
    : process.platform === "darwin"
      ? isArm
        ? "aarch64-apple-darwin"
        : "x86_64-apple-darwin"
      : isArm
        ? "aarch64-unknown-linux-musl"
        : "x86_64-unknown-linux-musl";

  const platformPkg = isWin
    ? isArm
      ? "@openai/codex-win32-arm64"
      : "@openai/codex-win32-x64"
    : process.platform === "darwin"
      ? isArm
        ? "@openai/codex-darwin-arm64"
        : "@openai/codex-darwin-x64"
      : isArm
        ? "@openai/codex-linux-arm64"
        : "@openai/codex-linux-x64";

  const binName = isWin ? "codex.exe" : "codex";
  const gnuFallback =
    process.platform === "linux"
      ? isArm
        ? "aarch64-unknown-linux-gnu"
        : "x86_64-unknown-linux-gnu"
      : null;

  return [
    join(nmRoot, ...platformPkg.split("/"), "vendor", archFolder, "codex", binName),
    join(nmRoot, "@openai", "codex", "vendor", archFolder, "codex", binName),
    ...(gnuFallback
      ? [
          join(nmRoot, ...platformPkg.split("/"), "vendor", gnuFallback, "codex", binName),
          join(nmRoot, "@openai", "codex", "vendor", gnuFallback, "codex", binName),
        ]
      : []),
  ];
}

function resolveClaudeNativeCandidates(nmRoot: string): string[] {
  const isWin = process.platform === "win32";
  const binName = isWin ? "claude.exe" : "claude";
  const platPkg = isWin
    ? process.arch === "arm64"
      ? "claude-agent-sdk-win32-arm64"
      : "claude-agent-sdk-win32-x64"
    : process.platform === "darwin"
      ? process.arch === "arm64"
        ? "claude-agent-sdk-darwin-arm64"
        : "claude-agent-sdk-darwin-x64"
      : process.arch === "arm64"
        ? "claude-agent-sdk-linux-arm64"
        : "claude-agent-sdk-linux-x64";

  return [
    join(nmRoot, "@anthropic-ai", "claude-code", "bin", binName),
    join(nmRoot, "@anthropic-ai", platPkg, binName),
    join(nmRoot, "@anthropic-ai", platPkg, "bin", binName),
  ];
}

function resolveOpenCodeNativeCandidates(nmRoot: string): string[] {
  const isWin = process.platform === "win32";
  const binName = isWin ? "opencode.exe" : "opencode";
  const platPkg = isWin
    ? process.arch === "arm64"
      ? "opencode-windows-arm64"
      : "opencode-windows-x64"
    : process.platform === "darwin"
      ? process.arch === "arm64"
        ? "opencode-darwin-arm64"
        : "opencode-darwin-x64"
      : process.arch === "arm64"
        ? "opencode-linux-arm64"
        : "opencode-linux-x64";

  return [
    join(nmRoot, platPkg, "bin", binName),
    join(nmRoot, "@opencode", platPkg.replace(/^opencode-/, "cli-"), "bin", binName),
    join(nmRoot, "opencode-ai", "bin", binName),
    join(nmRoot, "opencode-ai", "vendor", binName),
  ];
}

/**
 * Desembrulha wrappers npm (`.cmd`/`.bat`/`.js`/`.cjs`) diretamente para o binário nativo
 * quando presente na árvore `node_modules`, eliminando spawns intermediários sem `windowsHide`.
 */
export function unwrapNpmNativeBinary(
  executablePath: string,
  explicitFolder?: ManagedRuntimeFolder
): string | null {
  const trimmed = String(executablePath ?? "").trim();
  if (!trimmed) return null;

  const ext = extname(trimmed).toLowerCase();
  if (![".cmd", ".bat", ".js", ".cjs", ".mjs"].includes(ext)) {
    return null;
  }

  const folder = inferFolderFromPath(trimmed, explicitFolder);
  if (!folder || folder === "antigravity") {
    return null;
  }

  const nmRoot = resolveNodeModulesRoot(trimmed);
  if (!nmRoot) return null;

  const candidates =
    folder === "codex"
      ? resolveCodexNativeCandidates(nmRoot)
      : folder === "claude"
        ? resolveClaudeNativeCandidates(nmRoot)
        : resolveOpenCodeNativeCandidates(nmRoot);

  for (const candidate of candidates) {
    if (isExistingFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Detecta se um diretório gerenciado de runtime ainda depende de instalação legada `npm`
 * (sem binário nativo standalone versionado em `<arch>/<versao>/bin/`).
 */
export function isLegacyNpmRuntime(
  baseRuntimeDir: string,
  executablePath: string | null
): boolean {
  const npmDir = join(baseRuntimeDir, "npm");
  const normalizedExe = (executablePath ?? "").replace(/\\/g, "/").toLowerCase();
  const exeInsideNpm = normalizedExe.includes("/npm/");
  const hasNpmFolder = existsSync(npmDir);

  if (!hasNpmFolder && !exeInsideNpm) {
    return false;
  }
  if (executablePath && !exeInsideNpm) {
    return false;
  }
  return true;
}
