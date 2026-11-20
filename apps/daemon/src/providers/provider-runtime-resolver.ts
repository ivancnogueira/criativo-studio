import { randomUUID } from "node:crypto";
import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

const OPENCODE_LATEST_RELEASE_BASE_URL =
  "https://github.com/anomalyco/opencode/releases/latest/download";

export interface OpenCodeReleaseAssetSpec {
  assetName: string;
  archFolder: string;
  binName: string;
  archiveKind: "zip" | "tar.gz";
}

/**
 * Mapeia SO e arquitetura para o asset nativo standalone oficial do OpenCode.
 */
export function resolveOpenCodeReleaseAssetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): OpenCodeReleaseAssetSpec | null {
  if (platform === "win32") {
    return arch === "arm64"
      ? {
          assetName: "opencode-windows-arm64.zip",
          archFolder: "win32-arm64",
          binName: "opencode.exe",
          archiveKind: "zip",
        }
      : {
          assetName: "opencode-windows-x64.zip",
          archFolder: "win32-x64",
          binName: "opencode.exe",
          archiveKind: "zip",
        };
  }
  if (platform === "darwin") {
    return arch === "arm64"
      ? {
          assetName: "opencode-darwin-arm64.zip",
          archFolder: "darwin-arm64",
          binName: "opencode",
          archiveKind: "zip",
        }
      : {
          assetName: "opencode-darwin-x64.zip",
          archFolder: "darwin-x64",
          binName: "opencode",
          archiveKind: "zip",
        };
  }
  if (platform === "linux") {
    if (arch === "arm64") {
      return {
        assetName: "opencode-linux-arm64.tar.gz",
        archFolder: "linux-arm64",
        binName: "opencode",
        archiveKind: "tar.gz",
      };
    }
    if (arch === "x64") {
      return {
        assetName: "opencode-linux-x64.tar.gz",
        archFolder: "linux-x64",
        binName: "opencode",
        archiveKind: "tar.gz",
      };
    }
  }
  return null;
}

function findFileRecursive(dir: string, targetFileName: string): string | null {
  if (!existsSync(dir)) return null;
  const isWin = process.platform === "win32";
  const wanted = isWin ? targetFileName.toLowerCase() : targetFileName;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileRecursive(full, targetFileName);
      if (nested) return nested;
      continue;
    }
    const current = isWin ? entry.name.toLowerCase() : entry.name;
    if (current === wanted) {
      return full;
    }
  }
  return null;
}

function runProcessQuiet(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let errTail = "";
    const collect = (chunk: Buffer) => {
      errTail = `${errTail}${chunk.toString("utf8")}`.slice(-320);
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
      rejectRun(new Error(`Timeout ao executar ${cmd}.`));
    }, timeoutMs);
    timer.unref?.();

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${cmd} falhou (código ${code}): ${errTail.trim()}`.slice(0, 220)));
    });
  });
}

async function extractArchiveNative(
  archivePath: string,
  destDir: string,
  archiveKind: "zip" | "tar.gz",
  timeoutMs: number
): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32" && archiveKind === "zip") {
    try {
      await runProcessQuiet("tar.exe", ["-xf", archivePath, "-C", destDir], timeoutMs);
      return;
    } catch {
      const safeZip = archivePath.replace(/'/g, "''");
      const safeDest = destDir.replace(/'/g, "''");
      await runProcessQuiet(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Expand-Archive -LiteralPath '${safeZip}' -DestinationPath '${safeDest}' -Force`,
        ],
        timeoutMs
      );
      return;
    }
  }

  if (archiveKind === "zip") {
    try {
      await runProcessQuiet("unzip", ["-o", "-q", archivePath, "-d", destDir], timeoutMs);
      return;
    } catch (err) {
      if (process.platform === "darwin") {
        await runProcessQuiet("ditto", ["-x", "-k", archivePath, destDir], timeoutMs);
        return;
      }
      throw err;
    }
  }

  await runProcessQuiet("tar", ["-xzf", archivePath, "-C", destDir], timeoutMs);
}

const inFlightOpenCodeInstalls = new Map<
  string,
  Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }>
>();

/**
 * Baixa e extrai o binário nativo standalone oficial do OpenCode para
 * `<AppData>/CriativoStudio/provider-runtimes/opencode/<arch>/<versao>/bin/`, sem exigir Node/npm.
 */
export async function installOpenCodeStandaloneBinary(options?: {
  appDataDir?: string;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  arch?: string;
  releaseBaseUrl?: string;
  fetchImpl?: typeof fetch;
  extractImpl?: (
    archivePath: string,
    destDir: string,
    archiveKind: "zip" | "tar.gz"
  ) => Promise<void>;
  includeSystemPaths?: boolean;
}): Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }> {
  const existing = resolveManagedProviderRuntime("opencode", {
    appDataDir: options?.appDataDir,
    includeSystemPaths: options?.includeSystemPaths,
  });
  if (existing.executable) {
    return { ...existing, installedNow: false };
  }

  if (
    !options?.fetchImpl &&
    (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1" ||
      process.env.CRIATIVO_DISABLE_AUTO_INSTALL === "1")
  ) {
    return { executable: null, version: null, installedNow: false };
  }

  const resolvedAppData = getDefaultAppDataDir(options?.appDataDir);
  const flightKey = `${resolvedAppData}:${options?.platform ?? process.platform}:${options?.arch ?? process.arch}`;
  const currentFlight = inFlightOpenCodeInstalls.get(flightKey);
  if (currentFlight) {
    return currentFlight;
  }

  const runInstall = async (): Promise<
    ResolvedProviderRuntime & { installedNow: boolean; error?: string }
  > => {
    const asset = resolveOpenCodeReleaseAssetName(options?.platform, options?.arch);
    if (!asset) {
      return {
        executable: null,
        version: null,
        installedNow: false,
        error: `Plataforma sem binário standalone suportado para OpenCode (${options?.platform ?? process.platform}/${options?.arch ?? process.arch}).`,
      };
    }

    const baseDir = join(resolvedAppData, "CriativoStudio", "provider-runtimes", "opencode");
    const tmpDir = join(baseDir, "_tmp", randomUUID().slice(0, 8));
    const archivePath = join(tmpDir, asset.assetName);
    const extractDir = join(tmpDir, "extract");
    const timeoutMs = options?.timeoutMs ?? 180_000;
    const baseUrl = (options?.releaseBaseUrl ?? OPENCODE_LATEST_RELEASE_BASE_URL).replace(
      /\/+$/,
      ""
    );
    const downloadUrl = `${baseUrl}/${asset.assetName}`;
    const fetcher = options?.fetchImpl ?? fetch;

    try {
      mkdirSync(extractDir, { recursive: true });
      const res = await fetcher(downloadUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return {
          executable: null,
          version: null,
          installedNow: false,
          error: `Falha ao baixar OpenCode (HTTP ${res.status}).`,
        };
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0) {
        return {
          executable: null,
          version: null,
          installedNow: false,
          error: "Arquivo baixado do OpenCode está vazio.",
        };
      }
      writeFileSync(archivePath, buf);

      if (options?.extractImpl) {
        await options.extractImpl(archivePath, extractDir, asset.archiveKind);
      } else {
        await extractArchiveNative(archivePath, extractDir, asset.archiveKind, timeoutMs);
      }

      const extractedBin = findFileRecursive(extractDir, asset.binName);
      if (!extractedBin || !existsSync(extractedBin) || statSync(extractedBin).size <= 0) {
        return {
          executable: null,
          version: null,
          installedNow: false,
          error: `Binário '${asset.binName}' não encontrado dentro do pacote OpenCode.`,
        };
      }

      const verMatch = (res.url || downloadUrl).match(/\/download\/v?([0-9]+\.[0-9]+\.[0-9][^/]*)\//i);
      const version = verMatch?.[1] ?? "latest";
      const finalBinPath = join(baseDir, asset.archFolder, version, "bin", asset.binName);
      mkdirSync(dirname(finalBinPath), { recursive: true });
      copyFileSync(extractedBin, finalBinPath);
      if ((options?.platform ?? process.platform) !== "win32") {
        chmodSync(finalBinPath, 0o755);
      }

      return {
        executable: finalBinPath,
        version,
        installedNow: true,
      };
    } catch (err) {
      return {
        executable: null,
        version: null,
        installedNow: false,
        error:
          err instanceof Error
            ? `Não foi possível instalar o OpenCode automaticamente: ${err.message}`
            : "Não foi possível instalar o OpenCode automaticamente.",
      };
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignora limpeza de diretório temporário
      }
    }
  };

  const promise = runInstall().finally(() => {
    inFlightOpenCodeInstalls.delete(flightKey);
  });
  inFlightOpenCodeInstalls.set(flightKey, promise);
  return promise;
}

/**
 * Garante que a CLI esteja disponível no ambiente; para OpenCode prioriza download direto do
 * binário nativo standalone (sem depender de Node/npm) e usa npm apenas como fallback.
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

  let standaloneError: string | undefined;
  if (folder === "opencode") {
    const standalone = await installOpenCodeStandaloneBinary({
      appDataDir: options?.appDataDir,
      timeoutMs: options?.timeoutMs,
    });
    if (standalone.executable) {
      return standalone;
    }
    standaloneError = standalone.error;
  }

  const pkg = RUNTIME_NPM_PACKAGES[folder];
  if (!pkg) {
    return {
      executable: null,
      version: null,
      installedNow: false,
      error: standaloneError ?? `Pacote automático não configurado para ${folder}.`,
    };
  }

  const npmExe = findInSystemPath(process.platform === "win32" ? ["npm.cmd", "npm.exe"] : ["npm"]);
  if (!npmExe) {
    return {
      executable: null,
      version: null,
      installedNow: false,
      error:
        standaloneError ??
        `Runtime ${folder} ausente e npm não encontrado no PATH para instalação automática.`,
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
