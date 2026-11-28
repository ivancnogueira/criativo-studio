import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANTIGRAVITY_LATEST_RELEASE_API,
  ANTIGRAVITY_OFFICIAL_MANIFEST_BASE,
  resolveAntigravityManifestPlatform,
} from "./provider-runtime-archive.ts";
import { ensureProviderRuntimeInstalled, migrateLegacyNpmRuntimes } from "./provider-runtime-installer.ts";
import {
  type ManagedRuntimeFolder,
  type ResolvedProviderRuntime,
  RUNTIME_NPM_PACKAGES,
  getDefaultAppDataDir,
  resolveManagedProviderRuntime,
} from "./provider-runtime-locate.ts";

export const RUNTIME_UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

interface RuntimeUpdateCheckState {
  checkedAt?: Record<string, string>;
}

const inFlightRuntimeUpgrades = new Map<
  string,
  Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }>
>();

function cleanVersionTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^v/i, "");
  return trimmed.length > 0 ? trimmed : null;
}

export function compareSemverStrings(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

/**
 * Lê a versão instalada no diretório gerenciado `<AppData>/CriativoStudio/provider-runtimes/<folder>/npm`.
 */
export function readManagedNpmPackageVersion(
  folder: "claude" | "codex",
  appDataDir?: string
): string | null {
  const pkg = RUNTIME_NPM_PACKAGES[folder];
  if (!pkg) return null;
  const resolvedAppData = getDefaultAppDataDir(appDataDir);
  const pkgPath = join(
    resolvedAppData,
    "CriativoStudio",
    "provider-runtimes",
    folder,
    "npm",
    "node_modules",
    pkg,
    "package.json"
  );
  if (!existsSync(pkgPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    return cleanVersionTag(parsed.version);
  } catch {
    return null;
  }
}

export async function fetchLatestVersionForRuntime(
  folder: ManagedRuntimeFolder,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  try {
    if (folder === "codex" || folder === "claude") {
      const pkg = RUNTIME_NPM_PACKAGES[folder];
      if (pkg) {
        const res = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        }).catch(() => null);
        if (res?.ok) {
          const json = (await res.json().catch(() => null)) as { version?: unknown } | null;
          const ver = cleanVersionTag(json?.version);
          if (ver) return ver;
        }
      }
      if (folder === "codex") {
        const ghRes = await fetchImpl("https://api.github.com/repos/openai/codex/releases/latest", {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "CriativoStudio-RuntimeUpdater" },
          signal: AbortSignal.timeout(8_000),
        }).catch(() => null);
        if (ghRes?.ok) {
          const ghJson = (await ghRes.json().catch(() => null)) as { tag_name?: unknown } | null;
          return cleanVersionTag(
            typeof ghJson?.tag_name === "string"
              ? ghJson.tag_name.replace(/^rust-/i, "")
              : ghJson?.tag_name
          );
        }
      }
      return null;
    }

    if (folder === "antigravity") {
      const manifestPlat = resolveAntigravityManifestPlatform();
      if (manifestPlat) {
        const res = await fetchImpl(`${ANTIGRAVITY_OFFICIAL_MANIFEST_BASE}/${manifestPlat}.json`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        }).catch(() => null);
        if (res?.ok) {
          const json = (await res.json().catch(() => null)) as { version?: unknown } | null;
          const ver = cleanVersionTag(json?.version);
          if (ver) return ver;
        }
      }
      const ghRes = await fetchImpl(ANTIGRAVITY_LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "CriativoStudio-RuntimeUpdater" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!ghRes.ok) return null;
      const ghJson = (await ghRes.json().catch(() => null)) as { tag_name?: unknown } | null;
      return cleanVersionTag(ghJson?.tag_name);
    }

    const ocRes = await fetchImpl("https://api.github.com/repos/anomalyco/opencode/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "CriativoStudio-RuntimeUpdater" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!ocRes.ok) return null;
    const ocJson = (await ocRes.json().catch(() => null)) as { tag_name?: unknown } | null;
    return cleanVersionTag(ocJson?.tag_name);
  } catch {
    return null;
  }
}

function getUpdateCheckFilePath(appDataDir?: string): string {
  return join(getDefaultAppDataDir(appDataDir), "CriativoStudio", "provider-runtimes", ".update-check.json");
}

function readUpdateCheckState(filePath: string): RuntimeUpdateCheckState {
  if (!existsSync(filePath)) return { checkedAt: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as RuntimeUpdateCheckState;
    return {
      checkedAt: parsed?.checkedAt && typeof parsed.checkedAt === "object" ? parsed.checkedAt : {},
    };
  } catch {
    return { checkedAt: {} };
  }
}

function writeUpdateCheckTimestamp(filePath: string, folder: ManagedRuntimeFolder, nowIso: string): void {
  try {
    const state = readUpdateCheckState(filePath);
    const next: RuntimeUpdateCheckState = {
      checkedAt: {
        ...(state.checkedAt ?? {}),
        [folder]: nowIso,
      },
    };
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  } catch {
    // ignora falha de escrita de cache
  }
}

/**
 * Limpa cache de modelos corrompido (se indicado) e força reinstalação/atualização
 * da CLI gerenciada dentro de `<AppData>/CriativoStudio/provider-runtimes/<folder>`.
 */
export async function forceUpgradeProviderRuntime(
  folder: ManagedRuntimeFolder,
  options?: {
    appDataDir?: string;
    codexHomeToResetCache?: string;
    timeoutMs?: number;
  }
): Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }> {
  if (options?.codexHomeToResetCache) {
    const cacheFile = join(options.codexHomeToResetCache, "models_cache.json");
    if (existsSync(cacheFile)) {
      try {
        rmSync(cacheFile, { force: true });
      } catch {
        // ignora
      }
    }
  }

  const resolvedAppData = getDefaultAppDataDir(options?.appDataDir);
  const key = `${resolvedAppData}:${folder}`;
  const inFlight = inFlightRuntimeUpgrades.get(key);
  if (inFlight) return inFlight;

  const promise = ensureProviderRuntimeInstalled(folder, {
    appDataDir: resolvedAppData,
    timeoutMs: options?.timeoutMs,
    forceInstall: true,
  })
    .then((res) => {
      if (res.executable) {
        writeUpdateCheckTimestamp(getUpdateCheckFilePath(resolvedAppData), folder, new Date().toISOString());
      }
      return res;
    })
    .finally(() => {
      inFlightRuntimeUpgrades.delete(key);
    });

  inFlightRuntimeUpgrades.set(key, promise);
  return promise;
}

function readInstalledManagedVersion(
  folder: ManagedRuntimeFolder,
  appDataDir: string
): { executable: string | null; version: string | null } {
  const ownRuntime = resolveManagedProviderRuntime(folder, {
    appDataDir,
    includeSystemPaths: false,
  });
  let currentVer: string | null =
    ownRuntime.version && /^[0-9]+\.[0-9]+\.[0-9]+/.test(ownRuntime.version)
      ? cleanVersionTag(ownRuntime.version)
      : null;

  if (folder === "codex" || folder === "claude") {
    const npmVer = readManagedNpmPackageVersion(folder, appDataDir);
    if (npmVer && (!currentVer || compareSemverStrings(npmVer, currentVer) > 0)) {
      currentVer = npmVer;
    }
  }

  const active = ownRuntime.executable
    ? ownRuntime
    : resolveManagedProviderRuntime(folder, { appDataDir });
  return { executable: active.executable, version: currentVer };
}

export interface ManagedRuntimeUpdateInfo {
  folder: ManagedRuntimeFolder;
  provider: "openai" | "claude" | "gemini" | "opencode";
  label: string;
  executable: string | null;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
}

const RUNTIME_FOLDER_META: Record<
  ManagedRuntimeFolder,
  { provider: "openai" | "claude" | "gemini" | "opencode"; label: string }
> = {
  codex: { provider: "openai", label: "ChatGPT / Codex CLI" },
  claude: { provider: "claude", label: "Claude CLI" },
  antigravity: { provider: "gemini", label: "Antigravity CLI" },
  opencode: { provider: "opencode", label: "OpenCode CLI" },
};

const RUNTIME_STATUS_CACHE_TTL_MS = 15 * 60 * 1000;
const runtimeStatusCache = new Map<
  string,
  { checkedAt: number; latestVersion: string | null }
>();

/**
 * Consulta rapidamente quais CLIs gerenciadas têm nova versão oficial disponível
 * para exibição de banner estilo OpenBot no topo da interface.
 */
export async function checkManagedRuntimesUpdateStatus(options?: {
  appDataDir?: string;
  folders?: ManagedRuntimeFolder[];
  forceCheck?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ManagedRuntimeUpdateInfo[]> {
  const resolvedAppData = getDefaultAppDataDir(options?.appDataDir);
  const folders = options?.folders ?? ["codex", "claude", "antigravity", "opencode"];
  const fetcher = options?.fetchImpl ?? fetch;
  const now = Date.now();
  const out: ManagedRuntimeUpdateInfo[] = [];

  for (const folder of folders) {
    const installed = readInstalledManagedVersion(folder, resolvedAppData);
    const meta = RUNTIME_FOLDER_META[folder];
    const cacheKey = folder;
    const cached = runtimeStatusCache.get(cacheKey);
    let latestVersion: string | null = null;

    if (
      !options?.forceCheck &&
      cached &&
      now - cached.checkedAt < RUNTIME_STATUS_CACHE_TTL_MS
    ) {
      latestVersion = cached.latestVersion;
    } else if (
      options?.fetchImpl ||
      (process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1" &&
        process.env.CRIATIVO_DISABLE_AUTO_INSTALL !== "1")
    ) {
      latestVersion = await fetchLatestVersionForRuntime(folder, fetcher);
      runtimeStatusCache.set(cacheKey, { checkedAt: now, latestVersion });
    }

    const updateAvailable = Boolean(
      installed.executable &&
        latestVersion &&
        (!installed.version || compareSemverStrings(latestVersion, installed.version) > 0)
    );

    out.push({
      folder,
      provider: meta.provider,
      label: meta.label,
      executable: installed.executable,
      currentVersion: installed.version,
      latestVersion,
      updateAvailable,
    });
  }

  return out;
}

/**
 * Verifica periodicamente (TTL 24h) se há nova versão oficial para as CLIs instaladas
 * e atualiza silenciosamente na pasta própria do CriativoOS.
 */
export async function checkAndUpdateManagedRuntimes(options?: {
  appDataDir?: string;
  folders?: ManagedRuntimeFolder[];
  forceCheck?: boolean;
  fetchImpl?: typeof fetch;
  upgradeImpl?: (
    folder: ManagedRuntimeFolder
  ) => Promise<ResolvedProviderRuntime & { installedNow: boolean; error?: string }>;
}): Promise<{ updated: ManagedRuntimeFolder[]; checked: ManagedRuntimeFolder[] }> {
  const isMocked = Boolean(options?.fetchImpl || options?.upgradeImpl);
  if (
    !isMocked &&
    (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1" ||
      process.env.CRIATIVO_DISABLE_AUTO_INSTALL === "1")
  ) {
    return { updated: [], checked: [] };
  }

  const resolvedAppData = getDefaultAppDataDir(options?.appDataDir);
  const folders = options?.folders ?? ["antigravity", "opencode", "codex", "claude"];
  const checkFile = getUpdateCheckFilePath(resolvedAppData);
  const state = readUpdateCheckState(checkFile);
  const nowMs = Date.now();
  const updated: ManagedRuntimeFolder[] = [];
  const checked: ManagedRuntimeFolder[] = [];

  if (!isMocked) {
    const migration = await migrateLegacyNpmRuntimes({ appDataDir: resolvedAppData }).catch(() => ({
      migrated: [] as Array<"codex" | "opencode">,
      skipped: true,
    }));
    for (const mFolder of migration.migrated) {
      if (!updated.includes(mFolder)) {
        updated.push(mFolder);
      }
    }
  }

  for (const folder of folders) {
    const lastIso = state.checkedAt?.[folder];
    const lastMs = lastIso ? Date.parse(lastIso) : Number.NaN;
    if (!options?.forceCheck && Number.isFinite(lastMs) && nowMs - lastMs < RUNTIME_UPDATE_CHECK_TTL_MS) {
      continue;
    }

    const activeRuntime = resolveManagedProviderRuntime(folder, { appDataDir: resolvedAppData });
    if (!activeRuntime.executable) {
      continue;
    }

    checked.push(folder);
    const latestVersion = await fetchLatestVersionForRuntime(folder, options?.fetchImpl);
    writeUpdateCheckTimestamp(checkFile, folder, new Date().toISOString());
    if (!latestVersion) continue;

    let needsUpgrade = false;
    const installed = readInstalledManagedVersion(folder, resolvedAppData);
    if (folder === "codex" || folder === "claude") {
      if (installed.version) {
        needsUpgrade = compareSemverStrings(latestVersion, installed.version) > 0;
      } else {
        const semverLike = activeRuntime.version && /^[0-9]+\.[0-9]+\.[0-9]+/.test(activeRuntime.version)
          ? activeRuntime.version
          : null;
        needsUpgrade = semverLike ? compareSemverStrings(latestVersion, semverLike) > 0 : true;
      }
    } else {
      if (installed.executable && installed.version && installed.version !== "latest") {
        needsUpgrade = compareSemverStrings(latestVersion, installed.version) > 0;
      }
    }

    if (!needsUpgrade) continue;

    const upgradeRes = options?.upgradeImpl
      ? await options.upgradeImpl(folder).catch(() => null)
      : await forceUpgradeProviderRuntime(folder, { appDataDir: resolvedAppData }).catch(() => null);
    if (upgradeRes?.executable) {
      runtimeStatusCache.set(folder, { checkedAt: Date.now(), latestVersion });
      updated.push(folder);
    }
  }

  return { updated, checked };
}
