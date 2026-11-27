import {
  mkdirSync,
} from "node:fs";
import {
  basename,
  join,
} from "node:path";
import { type ResolvedProviderRuntime, RUNTIME_NPM_PACKAGES, getDefaultAppDataDir, findInSystemPath, resolveManagedProviderRuntime, spawnProviderProcess } from "./provider-runtime-locate.ts";
import { OPENCODE_LATEST_RELEASE_BASE_URL, resolveOpenCodeReleaseAssetName, inFlightOpenCodeInstalls, inFlightAntigravityInstalls, ANTIGRAVITY_LATEST_RELEASE_API, ANTIGRAVITY_LATEST_DOWNLOAD_BASE, ANTIGRAVITY_OFFICIAL_MANIFEST_BASE, resolveAntigravityManifestPlatform, resolveAntigravityReleaseAssetName, downloadAndStageStandaloneArchive } from "./provider-runtime-archive.ts";
import { installCodexStandaloneBinary } from "./codex-standalone-installer.ts";

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
  forceInstall?: boolean;
}): Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }> {
  if (!options?.forceInstall) {
    const existing = resolveManagedProviderRuntime("opencode", {
      appDataDir: options?.appDataDir,
      includeSystemPaths: options?.includeSystemPaths,
    });
    if (existing.executable) {
      return { ...existing, installedNow: false };
    }
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

  const runInstall = async () => {
    const asset = resolveOpenCodeReleaseAssetName(options?.platform, options?.arch);
    if (!asset) {
      return {
        executable: null,
        version: null,
        installedNow: false,
        error: `Plataforma sem binário standalone suportado para OpenCode (${options?.platform ?? process.platform}/${options?.arch ?? process.arch}).`,
      };
    }

    const baseUrl = (options?.releaseBaseUrl ?? OPENCODE_LATEST_RELEASE_BASE_URL).replace(/\/+$/, "");
    return downloadAndStageStandaloneArchive({
      label: "OpenCode",
      folder: "opencode",
      appDataDir: resolvedAppData,
      platform: options?.platform,
      timeoutMs: options?.timeoutMs,
      downloadUrl: `${baseUrl}/${asset.assetName}`,
      assetName: asset.assetName,
      archFolder: asset.archFolder,
      binName: asset.binName,
      candidateBinNames: [asset.binName],
      archiveKind: asset.archiveKind,
      fetchImpl: options?.fetchImpl,
      extractImpl: options?.extractImpl,
    });
  };

  const promise = runInstall().finally(() => {
    inFlightOpenCodeInstalls.delete(flightKey);
  });
  inFlightOpenCodeInstalls.set(flightKey, promise);
  return promise;
}

/**
 * Baixa e extrai o binário nativo standalone oficial do Antigravity CLI (`google-antigravity/antigravity-cli`)
 * para `<AppData>/CriativoStudio/provider-runtimes/antigravity/<arch>/<versao>/bin/`.
 */
export async function installAntigravityStandaloneBinary(options?: {
  appDataDir?: string;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  arch?: string;
  releaseBaseUrl?: string;
  releasesApiUrl?: string;
  manifestBaseUrl?: string;
  fetchImpl?: typeof fetch;
  extractImpl?: (
    archivePath: string,
    destDir: string,
    archiveKind: "zip" | "tar.gz"
  ) => Promise<void>;
  includeSystemPaths?: boolean;
  forceInstall?: boolean;
}): Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }> {
  if (!options?.forceInstall) {
    const existing = resolveManagedProviderRuntime("antigravity", {
      appDataDir: options?.appDataDir,
      includeSystemPaths: options?.includeSystemPaths,
    });
    if (existing.executable) {
      return { ...existing, installedNow: false };
    }
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
  const currentFlight = inFlightAntigravityInstalls.get(flightKey);
  if (currentFlight) {
    return currentFlight;
  }

  const runInstall = async () => {
    const asset = resolveAntigravityReleaseAssetName(options?.platform, options?.arch);
    if (!asset) {
      return {
        executable: null,
        version: null,
        installedNow: false,
        error: `Plataforma sem binário standalone suportado para Antigravity (${options?.platform ?? process.platform}/${options?.arch ?? process.arch}).`,
      };
    }

    const fetcher = options?.fetchImpl ?? fetch;
    const baseUrl = (options?.releaseBaseUrl ?? ANTIGRAVITY_LATEST_DOWNLOAD_BASE).replace(/\/+$/, "");
    let downloadUrl = `${baseUrl}/${asset.assetName}`;
    let explicitVersion: string | null = null;

    if (!options?.releaseBaseUrl) {
      try {
        const metaRes = await fetcher(options?.releasesApiUrl ?? ANTIGRAVITY_LATEST_RELEASE_API, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "CriativoStudio-RuntimeInstaller",
          },
          signal: AbortSignal.timeout(Math.min(options?.timeoutMs ?? 25_000, 25_000)),
        });
        if (metaRes.ok) {
          const releaseJson = (await metaRes.json().catch(() => null)) as {
            tag_name?: string;
            assets?: Array<{ name?: string; browser_download_url?: string }>;
          } | null;
          if (typeof releaseJson?.tag_name === "string" && releaseJson.tag_name.trim()) {
            explicitVersion = releaseJson.tag_name.trim().replace(/^v/i, "");
          }
          const matchedAsset = releaseJson?.assets?.find((a) => a.name === asset.assetName);
          if (matchedAsset?.browser_download_url) {
            downloadUrl = matchedAsset.browser_download_url;
          }
        }
      } catch {
        // Fallback direto para /releases/latest/download/<assetName> caso GitHub API oscile
      }
    }

    const githubResult = await downloadAndStageStandaloneArchive({
      label: "Antigravity CLI",
      folder: "antigravity",
      appDataDir: resolvedAppData,
      platform: options?.platform,
      timeoutMs: options?.timeoutMs,
      downloadUrl,
      explicitVersion,
      assetName: asset.assetName,
      archFolder: asset.archFolder,
      binName: asset.binName,
      candidateBinNames: asset.candidateBinNames,
      archiveKind: asset.archiveKind,
      fetchImpl: options?.fetchImpl,
      extractImpl: options?.extractImpl,
    });
    if (githubResult.executable) {
      return githubResult;
    }

    // Fallback automático para o CDN oficial da Google (usado por antigravity.google/cli/install.*)
    const manifestPlatform = resolveAntigravityManifestPlatform(options?.platform, options?.arch);
    if (manifestPlatform && (!options?.releaseBaseUrl || options?.manifestBaseUrl)) {
      const manifestBase = (options?.manifestBaseUrl ?? ANTIGRAVITY_OFFICIAL_MANIFEST_BASE).replace(/\/+$/, "");
      try {
        const manifestRes = await fetcher(`${manifestBase}/${manifestPlatform}.json`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(Math.min(options?.timeoutMs ?? 25_000, 25_000)),
        });
        if (manifestRes.ok) {
          const manifestJson = (await manifestRes.json().catch(() => null)) as {
            version?: string;
            url?: string;
            sha512?: string;
          } | null;
          const cdnUrl = typeof manifestJson?.url === "string" ? manifestJson.url.trim() : "";
          const cdnSha = typeof manifestJson?.sha512 === "string" ? manifestJson.sha512.trim() : "";
          const cdnVersion =
            typeof manifestJson?.version === "string" ? manifestJson.version.trim().replace(/^v/i, "") : null;

          if (/^https?:\/\//i.test(cdnUrl)) {
            const urlPath = cdnUrl.split("?")[0] ?? cdnUrl;
            const archiveKind: "zip" | "tar.gz" | "raw" = urlPath.endsWith(".tar.gz")
              ? "tar.gz"
              : urlPath.endsWith(".zip")
                ? "zip"
                : "raw";
            const cdnAssetName = basename(urlPath) || asset.binName;
            const cdnResult = await downloadAndStageStandaloneArchive({
              label: "Antigravity CLI (Google CDN)",
              folder: "antigravity",
              appDataDir: resolvedAppData,
              platform: options?.platform,
              timeoutMs: options?.timeoutMs,
              downloadUrl: cdnUrl,
              explicitVersion: cdnVersion,
              expectedSha512: cdnSha || null,
              assetName: cdnAssetName,
              archFolder: asset.archFolder,
              binName: asset.binName,
              candidateBinNames: asset.candidateBinNames,
              archiveKind,
              fetchImpl: options?.fetchImpl,
              extractImpl: options?.extractImpl,
            });
            if (cdnResult.executable) {
              return cdnResult;
            }
            return {
              ...cdnResult,
              error: [githubResult.error, cdnResult.error].filter(Boolean).join(" | "),
            };
          }
        }
      } catch (cdnErr) {
        const cdnMsg = cdnErr instanceof Error ? cdnErr.message : String(cdnErr);
        return {
          ...githubResult,
          error: [githubResult.error, `Fallback Google CDN falhou: ${cdnMsg}`].filter(Boolean).join(" | "),
        };
      }
    }

    return githubResult;
  };

  const promise = runInstall().finally(() => {
    inFlightAntigravityInstalls.delete(flightKey);
  });
  inFlightAntigravityInstalls.set(flightKey, promise);
  return promise;
}

/**
 * Garante que a CLI esteja disponível no ambiente; para OpenCode e Antigravity baixa o binário nativo
 * standalone oficial (sem depender de Node/npm) e para Claude/Codex usa npm quando necessário.
 */
export async function ensureProviderRuntimeInstalled(
  folder: "claude" | "codex" | "opencode" | "antigravity",
  options?: {
    appDataDir?: string;
    timeoutMs?: number;
    forceInstall?: boolean;
  }
): Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }> {
  if (!options?.forceInstall) {
    const existing = resolveManagedProviderRuntime(folder, { appDataDir: options?.appDataDir });
    if (existing.executable) {
      return { ...existing, installedNow: false };
    }
  }

  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return { executable: null, version: null, installedNow: false };
  }

  if (folder === "antigravity") {
    return await installAntigravityStandaloneBinary({
      appDataDir: options?.appDataDir,
      timeoutMs: options?.timeoutMs,
      forceInstall: options?.forceInstall,
    });
  }

  let standaloneError: string | undefined;
  if (folder === "opencode") {
    const standalone = await installOpenCodeStandaloneBinary({
      appDataDir: options?.appDataDir,
      timeoutMs: options?.timeoutMs,
      forceInstall: options?.forceInstall,
    });
    if (standalone.executable) {
      return standalone;
    }
    standaloneError = standalone.error;
  }

  if (folder === "codex") {
    const standalone = await installCodexStandaloneBinary({
      appDataDir: options?.appDataDir,
      timeoutMs: options?.timeoutMs,
      forceInstall: options?.forceInstall,
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
  const npmSpec = options?.forceInstall ? `${pkg}@latest` : pkg;
  const installRes = await new Promise<{ ok: boolean; errMsg?: string }>((resolveInstall) => {
    const child = spawnProviderProcess(
      npmExe,
      ["install", "--no-audit", "--no-fund", "--prefix", prefixDir, npmSpec],
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

