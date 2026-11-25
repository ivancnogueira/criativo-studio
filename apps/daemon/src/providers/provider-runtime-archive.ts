import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  spawn,
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
import {
  dirname,
  join,
} from "node:path";
import { type ResolvedProviderRuntime, getDefaultAppDataDir } from "./provider-runtime-locate.ts";

export const OPENCODE_LATEST_RELEASE_BASE_URL =
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

export function findFileRecursive(dir: string, targetFileName: string): string | null {
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

export function runProcessQuiet(cmd: string, args: string[], timeoutMs: number): Promise<void> {
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

export async function extractArchiveNative(
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

export const inFlightOpenCodeInstalls = new Map<
  string,
  Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }>
>();
export const inFlightAntigravityInstalls = new Map<
  string,
  Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }>
>();

export const ANTIGRAVITY_LATEST_RELEASE_API =
  "https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest";
export const ANTIGRAVITY_LATEST_DOWNLOAD_BASE =
  "https://github.com/google-antigravity/antigravity-cli/releases/latest/download";
export const ANTIGRAVITY_OFFICIAL_MANIFEST_BASE =
  "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests";

export function isLinuxMuslHost(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "linux" || process.platform !== "linux") return false;
  return (
    existsSync("/lib/libc.musl-x86_64.so.1") ||
    existsSync("/lib/libc.musl-aarch64.so.1")
  );
}

/**
 * Mapeia SO e arquitetura para o identificador de manifesto usado pelo instalador oficial da Google.
 */
export function resolveAntigravityManifestPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string | null {
  if (platform === "win32") {
    return arch === "arm64" ? "windows_arm64" : "windows_amd64";
  }
  if (platform === "darwin") {
    return arch === "arm64" ? "darwin_arm64" : "darwin_amd64";
  }
  if (platform === "linux") {
    const muslSuffix = isLinuxMuslHost(platform) ? "_musl" : "";
    if (arch === "arm64") return `linux_arm64${muslSuffix}`;
    if (arch === "x64") return `linux_amd64${muslSuffix}`;
  }
  return null;
}

export interface AntigravityReleaseAssetSpec {
  assetName: string;
  archFolder: string;
  binName: string;
  candidateBinNames: string[];
  archiveKind: "zip" | "tar.gz";
}

/**
 * Mapeia SO e arquitetura para o asset oficial do Antigravity CLI (`google-antigravity/antigravity-cli`).
 */
export function resolveAntigravityReleaseAssetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): AntigravityReleaseAssetSpec | null {
  if (platform === "win32") {
    return arch === "arm64"
      ? {
          assetName: "agy_cli_windows_arm64.zip",
          archFolder: "win32-arm64",
          binName: "antigravity.exe",
          candidateBinNames: ["antigravity.exe", "agy.exe"],
          archiveKind: "zip",
        }
      : {
          assetName: "agy_cli_windows_x64.zip",
          archFolder: "win32-x64",
          binName: "antigravity.exe",
          candidateBinNames: ["antigravity.exe", "agy.exe"],
          archiveKind: "zip",
        };
  }
  if (platform === "darwin") {
    return arch === "arm64"
      ? {
          assetName: "agy_cli_mac_arm64.tar.gz",
          archFolder: "darwin-arm64",
          binName: "antigravity",
          candidateBinNames: ["antigravity", "agy"],
          archiveKind: "tar.gz",
        }
      : {
          assetName: "agy_cli_mac_x64.tar.gz",
          archFolder: "darwin-x64",
          binName: "antigravity",
          candidateBinNames: ["antigravity", "agy"],
          archiveKind: "tar.gz",
        };
  }
  if (platform === "linux") {
    const muslSuffix = isLinuxMuslHost(platform) ? "_musl" : "";
    if (arch === "arm64") {
      return {
        assetName: `agy_cli_linux_arm64${muslSuffix}.tar.gz`,
        archFolder: "linux-arm64",
        binName: "antigravity",
        candidateBinNames: ["antigravity", "agy"],
        archiveKind: "tar.gz",
      };
    }
    if (arch === "x64") {
      return {
        assetName: `agy_cli_linux_x64${muslSuffix}.tar.gz`,
        archFolder: "linux-x64",
        binName: "antigravity",
        candidateBinNames: ["antigravity", "agy"],
        archiveKind: "tar.gz",
      };
    }
  }
  return null;
}

export async function downloadAndStageStandaloneArchive(params: {
  label: string;
  folder: "opencode" | "antigravity";
  appDataDir?: string;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  downloadUrl: string;
  explicitVersion?: string | null;
  expectedSha512?: string | null;
  assetName: string;
  archFolder: string;
  binName: string;
  candidateBinNames: string[];
  archiveKind: "zip" | "tar.gz" | "raw";
  fetchImpl?: typeof fetch;
  extractImpl?: (
    archivePath: string,
    destDir: string,
    archiveKind: "zip" | "tar.gz"
  ) => Promise<void>;
}): Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }> {
  const resolvedAppData = getDefaultAppDataDir(params.appDataDir);
  const baseDir = join(resolvedAppData, "CriativoStudio", "provider-runtimes", params.folder);
  const tmpDir = join(baseDir, "_tmp", randomUUID().slice(0, 8));
  const archivePath = join(tmpDir, params.assetName);
  const extractDir = join(tmpDir, "extract");
  const timeoutMs = params.timeoutMs ?? 180_000;
  const fetcher = params.fetchImpl ?? fetch;

  try {
    mkdirSync(extractDir, { recursive: true });
    const res = await fetcher(params.downloadUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return {
        executable: null,
        version: null,
        installedNow: false,
        error: `Falha ao baixar ${params.label} (HTTP ${res.status}).`,
      };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      return {
        executable: null,
        version: null,
        installedNow: false,
        error: `Arquivo baixado do ${params.label} está vazio.`,
      };
    }

    if (params.expectedSha512 && params.expectedSha512.trim().length > 0) {
      const actualSha512 = createHash("sha512").update(buf).digest("hex").toLowerCase();
      if (actualSha512 !== params.expectedSha512.trim().toLowerCase()) {
        return {
          executable: null,
          version: null,
          installedNow: false,
          error: `Verificação de integridade SHA-512 falhou para ${params.label}.`,
        };
      }
    }

    writeFileSync(archivePath, buf);

    let extractedBin: string | null = null;
    if (params.archiveKind === "raw") {
      extractedBin = archivePath;
    } else {
      if (params.extractImpl) {
        await params.extractImpl(archivePath, extractDir, params.archiveKind);
      } else {
        await extractArchiveNative(archivePath, extractDir, params.archiveKind, timeoutMs);
      }

      for (const candidateName of params.candidateBinNames) {
        extractedBin = findFileRecursive(extractDir, candidateName);
        if (extractedBin) break;
      }
    }
    if (!extractedBin || !existsSync(extractedBin) || statSync(extractedBin).size <= 0) {
      return {
        executable: null,
        version: null,
        installedNow: false,
        error: `Binário '${params.binName}' não encontrado dentro do pacote ${params.label}.`,
      };
    }

    const verMatch = (res.url || params.downloadUrl).match(/\/download\/v?([0-9]+\.[0-9]+\.[0-9][^/]*)\//i);
    const cleanExplicit = params.explicitVersion?.replace(/^v/i, "").trim();
    const version = cleanExplicit || verMatch?.[1] || "latest";
    const finalBinPath = join(baseDir, params.archFolder, version, "bin", params.binName);
    mkdirSync(dirname(finalBinPath), { recursive: true });
    copyFileSync(extractedBin, finalBinPath);
    const targetPlatform = params.platform ?? process.platform;
    if (targetPlatform !== "win32") {
      chmodSync(finalBinPath, 0o755);
      if (targetPlatform === "darwin" && process.platform === "darwin") {
        await runProcessQuiet("xattr", ["-d", "com.apple.quarantine", finalBinPath], 5_000).catch(() => {});
      }
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
          ? `Não foi possível instalar o ${params.label} automaticamente: ${err.message}`
          : `Não foi possível instalar o ${params.label} automaticamente.`,
    };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignora limpeza de diretório temporário
    }
  }
}

/**
 * Baixa e extrai o binário nativo standalone oficial do OpenCode para
 * `<AppData>/CriativoStudio/provider-runtimes/opencode/<arch>/<versao>/bin/`, sem exigir Node/npm.
 */
