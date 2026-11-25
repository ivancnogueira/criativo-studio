import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import {
  existsSync,
  readdirSync,
} from "node:fs";
import {
  homedir,
} from "node:os";
import {
  dirname,
  join,
} from "node:path";

export type ManagedRuntimeFolder = "claude" | "codex" | "opencode" | "antigravity";

export interface ResolvedProviderRuntime {
  executable: string | null;
  version: string | null;
}

export const RUNTIME_NPM_PACKAGES: Partial<Record<ManagedRuntimeFolder, string>> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  opencode: "opencode-ai",
};

export function getDefaultBinNames(folder: ManagedRuntimeFolder): string[] {
  const isWin = process.platform === "win32";
  if (folder === "claude") return isWin ? ["claude.exe", "claude.cmd"] : ["claude"];
  if (folder === "codex") return isWin ? ["codex.exe", "codex.cmd"] : ["codex"];
  if (folder === "opencode") return isWin ? ["opencode.exe", "opencode.cmd"] : ["opencode"];
  return isWin ? ["antigravity.exe", "agy.exe", "agy.cmd"] : ["antigravity", "agy"];
}

export function getDefaultAppDataDir(explicitAppDataDir?: string): string {
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

export function getPreferredArchFolders(): string[] {
  if (process.platform === "win32") return ["win32-x64", "win32-arm64"];
  if (process.platform === "darwin") return ["darwin-arm64", "darwin-x64"];
  return ["linux-x64", "linux-arm64"];
}

export function scanProviderRuntimesBase(
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

/**
 * Evita confundir o aplicativo desktop/IDE Electron do Antigravity (ex.: Antigravity.exe)
 * com o binário de linha de comando (`agy` / `antigravity`).
 */
export function isLikelyAntigravityGuiBinary(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const baseName = normalized.split("/").pop() ?? "";
  if (!baseName.startsWith("antigravity")) {
    return false;
  }
  if (
    normalized.includes("/programs/antigravity/") ||
    normalized.includes("/programs/antigravity ide/") ||
    normalized.includes(".app/contents/")
  ) {
    return true;
  }
  try {
    const dir = dirname(filePath);
    if (
      existsSync(join(dir, "chrome_100_percent.pak")) ||
      existsSync(join(dir, "resources", "app.asar")) ||
      existsSync(join(dir, "Uninstall Antigravity.exe"))
    ) {
      return true;
    }
  } catch {
    // ignora erro de leitura de diretório
  }
  return false;
}

export function getExtraSystemCandidatePaths(folder: ManagedRuntimeFolder): string[] {
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
      join(home, ".agy", "bin", "agy.exe"),
      join(home, ".antigravity", "bin", "agy.exe"),
      join(localAppData, "Microsoft", "WinGet", "Links", "agy.exe"),
      join(appData, "npm", "agy.cmd"),
      join(localAppData, "agy", "bin", "antigravity.exe"),
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
  if (process.platform === "darwin") {
    return [
      join(home, ".local", "bin", "agy"),
      "/opt/homebrew/bin/agy",
      "/usr/local/bin/agy",
      join(home, ".agy", "bin", "agy"),
      join(home, ".antigravity", "bin", "agy"),
      join(home, ".local", "bin", "antigravity"),
      "/usr/local/bin/antigravity",
    ];
  }
  return [
    join(home, ".local", "bin", "agy"),
    "/usr/local/bin/agy",
    "/usr/bin/agy",
    join(home, ".agy", "bin", "agy"),
    join(home, ".antigravity", "bin", "agy"),
    join(home, ".local", "bin", "antigravity"),
    "/usr/local/bin/antigravity",
  ];
}

export function findInSystemPath(
  binNames: string[],
  filter?: (fullPath: string) => boolean
): string | null {
  const sep = process.platform === "win32" ? ";" : ":";
  const pathEntries = (process.env.PATH ?? "").split(sep);
  for (const dir of pathEntries) {
    if (!dir) continue;
    for (const candidate of binNames) {
      const full = join(dir, candidate);
      if (existsSync(full) && (!filter || filter(full))) {
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
  const systemBinNames =
    folder === "antigravity"
      ? process.platform === "win32"
        ? ["agy.exe", "agy.cmd", "antigravity.exe"]
        : ["agy", "antigravity"]
      : binNames;
  const systemFilter =
    folder === "antigravity" ? (p: string) => !isLikelyAntigravityGuiBinary(p) : undefined;

  const pathBin = findInSystemPath(systemBinNames, systemFilter);
  if (pathBin) {
    return { executable: pathBin, version: "PATH" };
  }

  for (const extraPath of getExtraSystemCandidatePaths(folder)) {
    if (existsSync(extraPath) && (!systemFilter || systemFilter(extraPath))) {
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

