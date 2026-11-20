import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ManagedRuntimeFolder = "claude" | "codex" | "opencode" | "antigravity";

export interface ResolvedProviderRuntime {
  executable: string | null;
  version: string | null;
}

const RUNTIME_NPM_PACKAGES: Partial<Record<ManagedRuntimeFolder, string>> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  opencode: "opencode-ai",
};

function getDefaultBinNames(folder: ManagedRuntimeFolder): string[] {
  const isWin = process.platform === "win32";
  if (folder === "claude") return isWin ? ["claude.exe", "claude.cmd"] : ["claude"];
  if (folder === "codex") return isWin ? ["codex.exe", "codex.cmd"] : ["codex"];
  if (folder === "opencode") return isWin ? ["opencode.exe", "opencode.cmd"] : ["opencode"];
  return isWin ? ["agy.exe", "agy.cmd"] : ["agy"];
}

function getDefaultAppDataDir(explicitAppDataDir?: string): string {
  if (explicitAppDataDir && explicitAppDataDir.trim().length > 0) {
    return explicitAppDataDir;
  }
  if (process.env.APPDATA && process.env.APPDATA.trim().length > 0) {
    return process.env.APPDATA;
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }
  return join(homedir(), ".config");
}

function getPreferredArchFolders(): string[] {
  if (process.platform === "win32") return ["win32-x64", "win32-arm64"];
  if (process.platform === "darwin") return ["darwin-arm64", "darwin-x64"];
  return ["linux-x64", "linux-arm64"];
}

function scanProviderRuntimesBase(
  baseRuntimeDir: string,
  binNames: string[]
): ResolvedProviderRuntime | null {
  try {
    if (!existsSync(baseRuntimeDir)) return null;

    // 1. Estrutura versionada <base>/<arch>/<version>/bin/<binName>
    const entries = readdirSync(baseRuntimeDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "npm")
      .map((d) => d.name);

    const preferred = getPreferredArchFolders();
    const orderedArchs = [
      ...preferred.filter((p) => entries.includes(p)),
      ...entries.filter((e) => !preferred.includes(e)),
    ];

    for (const arch of orderedArchs) {
      const archDir = join(baseRuntimeDir, arch);
      let versions: string[] = [];
      try {
        versions = readdirSync(archDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
      } catch {
        continue;
      }

      for (const ver of versions) {
        for (const binName of binNames) {
          const directBin = join(archDir, ver, "bin", binName);
          if (existsSync(directBin)) {
            return { executable: directBin, version: ver };
          }
          const directRoot = join(archDir, ver, binName);
          if (existsSync(directRoot)) {
            return { executable: directRoot, version: ver };
          }
        }
      }
    }

    // 2. Estrutura gerenciada via npm <base>/npm/node_modules/.bin/<binName>
    const isWin = process.platform === "win32";
    const npmCandidates = isWin
      ? Array.from(new Set(binNames.flatMap((b) => [b, b.replace(/\.exe$/i, ".cmd")])))
      : binNames;
    for (const binName of npmCandidates) {
      const npmBin = join(baseRuntimeDir, "npm", "node_modules", ".bin", binName);
      if (existsSync(npmBin)) {
        return { executable: npmBin, version: "managed-npm" };
      }
    }
  } catch {
    // ignora erros de permissão/leitura
  }
  return null;
}

function getExtraSystemCandidatePaths(folder: ManagedRuntimeFolder): string[] {
  const home = homedir();
  const isWin = process.platform === "win32";
  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    if (folder === "claude") {
      return [
        join(home, ".local", "bin", "claude.exe"),
        join(home, ".claude", "local", "claude.exe"),
        join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"),
        join(appData, "npm", "claude.cmd"),
      ];
    }
    if (folder === "codex") {
      return [
        join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
        join(appData, "npm", "codex.cmd"),
        join(home, ".local", "bin", "codex.exe"),
      ];
    }
    if (folder === "opencode") {
      return [
        join(home, ".opencode", "bin", "opencode.exe"),
        join(appData, "npm", "opencode.cmd"),
        join(home, ".local", "bin", "opencode.exe"),
      ];
    }
    return [
      join(localAppData, "agy", "bin", "agy.exe"),
      join(home, ".local", "bin", "agy.exe"),
    ];
  }

  if (folder === "claude") {
    return [
      join(home, ".local", "bin", "claude"),
      join(home, ".claude", "local", "claude"),
      "/usr/local/bin/claude",
    ];
  }
  if (folder === "codex") {
    return [
      join(home, ".local", "bin", "codex"),
      "/usr/local/bin/codex",
    ];
  }
  if (folder === "opencode") {
    return [
      join(home, ".opencode", "bin", "opencode"),
      join(home, ".local", "bin", "opencode"),
      "/usr/local/bin/opencode",
    ];
  }
  return [
    join(home, ".local", "bin", "agy"),
    "/usr/local/bin/agy",
  ];
}

function findInSystemPath(binNames: string[]): string | null {
  const sep = process.platform === "win32" ? ";" : ":";
  const pathEntries = (process.env.PATH ?? "").split(sep);
  for (const dir of pathEntries) {
    if (!dir) continue;
    for (const candidate of binNames) {
      const full = join(dir, candidate);
      if (existsSync(full)) {
        return full;
      }
    }
  }
  return null;
}

/**
 * Resolve o executável local de um runtime de provedor em 3 camadas:
 * 1. `<appData>/CriativoStudio/provider-runtimes/<folder>` (runtime próprio gerenciado)
 * 2. `<appData>/<vendor>/provider-runtimes/<folder>` (descoberta agnóstica de runtimes compatíveis já existentes)
 * 3. `PATH` e diretórios oficiais do SO
 */
export function resolveManagedProviderRuntime(
  folder: ManagedRuntimeFolder,
  options?: {
    appDataDir?: string;
    binNames?: string[];
    includeSystemPaths?: boolean;
  }
): ResolvedProviderRuntime {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return { executable: null, version: null };
  }

  const binNames = options?.binNames ?? getDefaultBinNames(folder);
  const resolvedAppData = getDefaultAppDataDir(options?.appDataDir);

  // Camada 1: CriativoStudio/provider-runtimes/<folder>
  if (resolvedAppData) {
    const primaryBase = join(resolvedAppData, "CriativoStudio", "provider-runtimes", folder);
    const primaryHit = scanProviderRuntimesBase(primaryBase, binNames);
    if (primaryHit) return primaryHit;

    // Camada 2: descoberta agnóstica de runtimes compatíveis já presentes em <appData>/*/provider-runtimes/<folder>
    try {
      if (existsSync(resolvedAppData)) {
        const subdirs = readdirSync(resolvedAppData, { withFileTypes: true });
        for (const entry of subdirs) {
          if (!entry.isDirectory() || entry.name === "CriativoStudio") continue;
          const compatBase = join(resolvedAppData, entry.name, "provider-runtimes", folder);
          const compatHit = scanProviderRuntimesBase(compatBase, binNames);
          if (compatHit) return compatHit;
        }
      }
    } catch {
      // ignora erro ao listar appData
    }
  }

  if (options?.includeSystemPaths === false) {
    return { executable: null, version: null };
  }

  // Camada 3: PATH antes dos caminhos extras oficiais do SO
  const pathBin = findInSystemPath(binNames);
  if (pathBin) {
    return { executable: pathBin, version: "PATH" };
  }

  for (const extraPath of getExtraSystemCandidatePaths(folder)) {
    if (existsSync(extraPath)) {
      return { executable: extraPath, version: "PATH" };
    }
  }

  return { executable: null, version: null };
}

/**
 * Executa binário ou wrapper `.cmd`/`.bat` com segurança sem depender de shell global.
 */
export function spawnProviderProcess(
  executable: string,
  args: string[],
  options?: SpawnOptionsWithoutStdio
): ChildProcessWithoutNullStreams;
export function spawnProviderProcess(
  executable: string,
  args: string[],
  options: SpawnOptions
): ChildProcess;
export function spawnProviderProcess(
  executable: string,
  args: string[],
  options: SpawnOptions = {}
): ChildProcess {
  const isCmdWrapper = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
  return spawn(
    isCmdWrapper ? process.env.ComSpec || "cmd.exe" : executable,
    isCmdWrapper ? ["/c", executable, ...args] : args,
    {
      ...options,
      shell: false,
    }
  );
}

/**
 * Garante que a CLI esteja disponível no ambiente; se não existir, tenta instalar
 * sob demanda via `npm install --prefix <CriativoStudio>/provider-runtimes/<folder>/npm <pkg>`.
 */
export async function ensureProviderRuntimeInstalled(
  folder: "claude" | "codex" | "opencode",
  options?: {
    appDataDir?: string;
    timeoutMs?: number;
  }
): Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }> {
  const existing = resolveManagedProviderRuntime(folder, { appDataDir: options?.appDataDir });
  if (existing.executable) {
    return { ...existing, installedNow: false };
  }

  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return { executable: null, version: null, installedNow: false };
  }

  const pkg = RUNTIME_NPM_PACKAGES[folder];
  if (!pkg) {
    return {
      executable: null,
      version: null,
      installedNow: false,
      error: `Pacote automático não configurado para ${folder}.`,
    };
  }

  const npmExe = findInSystemPath(process.platform === "win32" ? ["npm.cmd", "npm.exe"] : ["npm"]);
  if (!npmExe) {
    return {
      executable: null,
      version: null,
      installedNow: false,
      error: `Runtime ${folder} ausente e npm não encontrado no PATH para instalação automática.`,
    };
  }

  const resolvedAppData = getDefaultAppDataDir(options?.appDataDir);
  const prefixDir = join(resolvedAppData, "CriativoStudio", "provider-runtimes", folder, "npm");
  mkdirSync(prefixDir, { recursive: true });

  const timeoutMs = options?.timeoutMs ?? 120_000;
  const installRes = await new Promise<{ ok: boolean; errMsg?: string }>((resolveInstall) => {
    const child = spawnProviderProcess(
      npmExe,
      ["install", "--no-audit", "--no-fund", "--prefix", prefixDir, pkg],
      {
        cwd: prefixDir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );

    let errTail = "";
    const collect = (chunk: Buffer) => {
      errTail = `${errTail}${chunk.toString("utf8")}`.slice(-400);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // ignora
      }
      resolveInstall({
        ok: false,
        errMsg: `Tempo esgotado (${Math.round(timeoutMs / 1000)}s) ao instalar ${pkg}.`,
      });
    }, timeoutMs);
    timer.unref?.();

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveInstall({ ok: false, errMsg: err.message });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolveInstall({ ok: true });
      } else {
        resolveInstall({
          ok: false,
          errMsg: `npm install ${pkg} falhou (código ${code}): ${errTail.trim()}`.slice(0, 220),
        });
      }
    });
  });

  if (!installRes.ok) {
    return {
      executable: null,
      version: null,
      installedNow: false,
      error: installRes.errMsg,
    };
  }

  const resolvedAfter = resolveManagedProviderRuntime(folder, { appDataDir: options?.appDataDir });
  return {
    executable: resolvedAfter.executable,
    version: resolvedAfter.version,
    installedNow: Boolean(resolvedAfter.executable),
    ...(resolvedAfter.executable ? {} : { error: `Pacote ${pkg} instalado, mas binário não localizado.` }),
  };
}
