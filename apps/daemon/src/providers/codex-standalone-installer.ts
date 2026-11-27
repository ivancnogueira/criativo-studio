import { downloadAndStageStandaloneArchive } from "./provider-runtime-archive.ts";
import {
  type ResolvedProviderRuntime,
  getDefaultAppDataDir,
  getPreferredArchFolders,
  resolveManagedProviderRuntime,
} from "./provider-runtime-locate.ts";

export const CODEX_LATEST_RELEASE_API = "https://api.github.com/repos/openai/codex/releases/latest";

const inFlightCodexInstalls = new Map<
  string,
  Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }>
>();

export interface CodexReleaseAssetItem {
  name?: string;
  browser_download_url?: string;
  digest?: string;
  size?: number;
}

export function selectCodexReleaseAsset(
  assets: CodexReleaseAssetItem[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): {
  asset: CodexReleaseAssetItem;
  archiveKind: "zip" | "tar.gz" | "raw";
  candidateBinNames: string[];
  binName: string;
} | null {
  let targetPatterns: RegExp[];
  let candidateBinNames: string[];
  let binName: string;

  if (platform === "win32") {
    const targetTriple = arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    targetPatterns = [
      new RegExp(`^codex-${targetTriple}\\.exe\\.zip$`, "i"),
      new RegExp(`^codex-${targetTriple}\\.(?:zip|tar\\.gz)$`, "i"),
      new RegExp(`^codex-${targetTriple}\\.exe$`, "i"),
    ];
    binName = "codex.exe";
    candidateBinNames = [
      `codex-${targetTriple}.exe`,
      "codex.exe",
    ];
  } else if (platform === "darwin") {
    const targetTriple = arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
    targetPatterns = [
      new RegExp(`^codex-${targetTriple}\\.tar\\.gz$`, "i"),
      new RegExp(`^codex-${targetTriple}\\.zip$`, "i"),
    ];
    binName = "codex";
    candidateBinNames = [`codex-${targetTriple}`, "codex"];
  } else {
    const isArm = arch === "arm64";
    const muslTriple = isArm ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
    const gnuTriple = isArm ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
    targetPatterns = [
      new RegExp(`^codex-${muslTriple}\\.tar\\.gz$`, "i"),
      new RegExp(`^codex-${gnuTriple}\\.tar\\.gz$`, "i"),
    ];
    binName = "codex";
    candidateBinNames = [`codex-${muslTriple}`, `codex-${gnuTriple}`, "codex"];
  }

  for (const pat of targetPatterns) {
    const found = assets.find(
      (a) => typeof a?.name === "string" && typeof a?.browser_download_url === "string" && pat.test(a.name)
    );
    if (found?.name) {
      const lower = found.name.toLowerCase();
      const archiveKind = lower.endsWith(".zip")
        ? "zip"
        : lower.endsWith(".tar.gz") || lower.endsWith(".tgz")
          ? "tar.gz"
          : "raw";
      return { asset: found, archiveKind, candidateBinNames, binName };
    }
  }
  return null;
}

/**
 * Baixa e extrai o binário nativo standalone oficial da Codex CLI (`openai/codex`)
 * para `<AppData>/CriativoStudio/provider-runtimes/codex/<arch>/<versao>/bin/`, sem exigir Node/npm.
 */
export async function installCodexStandaloneBinary(options?: {
  appDataDir?: string;
  timeoutMs?: number;
  forceInstall?: boolean;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchImpl?: typeof fetch;
  extractImpl?: (archivePath: string, destDir: string, archiveKind: "zip" | "tar.gz") => Promise<void>;
}): Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }> {
  const resolvedAppData = getDefaultAppDataDir(options?.appDataDir);
  if (!options?.forceInstall) {
    const existing = resolveManagedProviderRuntime("codex", {
      appDataDir: resolvedAppData,
      includeSystemPaths: false,
    });
    if (existing.executable) {
      return { ...existing, installedNow: false };
    }
  }

  const targetPlatform = options?.platform ?? process.platform;
  const targetArch = options?.arch ?? process.arch;
  const archFolder = getPreferredArchFolders()[0] ?? `${targetPlatform}-${targetArch}`;
  const flightKey = `${resolvedAppData}:${archFolder}:codex`;
  const pending = inFlightCodexInstalls.get(flightKey);
  if (pending) return pending;

  const fetcher = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 180_000;

  const runInstall = async (): Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }> => {
    let releaseRes: Response;
    try {
      releaseRes = await fetcher(CODEX_LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "CriativoStudio-RuntimeInstaller" },
        signal: AbortSignal.timeout(Math.min(20_000, timeoutMs)),
      });
    } catch (err) {
      return {
        executable: null,
        version: null,
        installedNow: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (!releaseRes.ok) {
      return {
        executable: null,
        version: null,
        installedNow: false,
        error: `GitHub Releases do Codex retornou HTTP ${releaseRes.status}.`,
      };
    }

    const releaseJson = (await releaseRes.json().catch(() => null)) as {
      tag_name?: string;
      assets?: CodexReleaseAssetItem[];
    } | null;

    const assets = Array.isArray(releaseJson?.assets) ? releaseJson.assets : [];
    const selected = selectCodexReleaseAsset(assets, targetPlatform, targetArch);
    if (!selected?.asset.browser_download_url || !selected.asset.name) {
      return {
        executable: null,
        version: null,
        installedNow: false,
        error: `Asset nativo oficial do Codex não encontrado para ${targetPlatform}/${targetArch}.`,
      };
    }

    const rawTag = String(releaseJson?.tag_name ?? "").trim();
    const explicitVersion = rawTag.replace(/^(?:rust-)?v/i, "").trim() || null;
    const sha256Match =
      typeof selected.asset.digest === "string"
        ? /^sha256:([a-f0-9]{64})$/i.exec(selected.asset.digest.trim())
        : null;

    return await downloadAndStageStandaloneArchive({
      label: "Codex CLI",
      folder: "codex",
      appDataDir: resolvedAppData,
      platform: targetPlatform,
      timeoutMs,
      downloadUrl: selected.asset.browser_download_url,
      explicitVersion,
      expectedSha256: sha256Match?.[1] ?? null,
      assetName: selected.asset.name,
      archFolder,
      binName: selected.binName,
      candidateBinNames: selected.candidateBinNames,
      archiveKind: selected.archiveKind,
      fetchImpl: fetcher,
      extractImpl: options?.extractImpl,
    });
  };

  const promise = runInstall().finally(() => {
    inFlightCodexInstalls.delete(flightKey);
  });
  inFlightCodexInstalls.set(flightKey, promise);
  return promise;
}
