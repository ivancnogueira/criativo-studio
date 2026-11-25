import {
  execFile,
} from "node:child_process";
import {
  existsSync,
  readdirSync,
} from "node:fs";
import {
  homedir,
} from "node:os";
import {
  join,
} from "node:path";
import type {
  ContaProvedorInfo,
  ModeloProvedorInfo,
  PoolContasConfig,
} from "@criativo/contracts";
import {
  getExtraSystemCandidatePaths,
  isLikelyAntigravityGuiBinary,
  resolveManagedProviderRuntime,
  type ManagedRuntimeFolder,
} from "./provider-runtime-resolver.ts";


export function runShortCommand(command: string, args: string[], timeoutMs = 900): Promise<string | null> {
  return new Promise((resolvePromise) => {
    try {
      execFile(
        command,
        args,
        { timeout: timeoutMs, windowsHide: true },
        (error, stdout) => {
          if (error) {
            resolvePromise(null);
            return;
          }
          resolvePromise(stdout.trim() || "ok");
        }
      );
    } catch {
      resolvePromise(null);
    }
  });
}

export function findManagedRuntimeExecutable(
  appDataDir: string,
  providerFolder: string,
  exeName: string
): { executable: string; version: string } | null {
  try {
    const platArch =
      process.platform === "win32" ? "win32-x64" : process.platform === "darwin" ? "darwin-arm64" : "linux-x64";
    const base = join(appDataDir, "CriativoStudio", "provider-runtimes", providerFolder, platArch);
    if (!existsSync(base)) return null;
    const versions = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));

    for (const ver of versions) {
      const candidate = join(base, ver, "bin", exeName);
      if (existsSync(candidate)) {
        return { executable: candidate, version: ver };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function detectLocalBinary(
  bins: string[],
  managedFolder?: string
): Promise<{ found: boolean; version: string | null; executable: string | null }> {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return { found: false, version: null, executable: null };
  }

  const knownFolders: ReadonlySet<string> = new Set([
    "claude",
    "codex",
    "opencode",
    "antigravity",
  ]);
  if (managedFolder && knownFolders.has(managedFolder)) {
    const binNames =
      process.platform === "win32"
        ? Array.from(new Set(bins.flatMap((b) => [`${b}.exe`, `${b}.cmd`])))
        : bins;
    const resolved = resolveManagedProviderRuntime(managedFolder as ManagedRuntimeFolder, {
      binNames,
    });
    if (resolved.executable) {
      let version = resolved.version;
      if (!version || version === "PATH" || version === "managed-npm") {
        const verOut = await runShortCommand(resolved.executable, ["--version"], 800);
        version = verOut ? verOut.split(/\r?\n/)[0].slice(0, 48) : "CLI ativo";
      }
      return {
        found: true,
        version,
        executable: resolved.executable,
      };
    }
  }

  const appDataDir = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const isWin = process.platform === "win32";

  if (managedFolder) {
    const exeName = isWin ? `${managedFolder}.exe` : managedFolder;
    const managed = findManagedRuntimeExecutable(appDataDir, managedFolder, exeName);
    if (managed) {
      return {
        found: true,
        version: managed.version,
        executable: managed.executable,
      };
    }
  }

  const locator = isWin ? "where.exe" : "which";
  for (const bin of bins) {
    const pathFound = await runShortCommand(locator, [bin], 600);
    if (pathFound) {
      const candidates = pathFound
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      for (const candidate of candidates) {
        if (managedFolder === "antigravity" && isLikelyAntigravityGuiBinary(candidate)) {
          continue;
        }
        const ver = await runShortCommand(candidate, ["--version"], 800);
        return {
          found: true,
          version: ver ? ver.split(/\r?\n/)[0].slice(0, 48) : "CLI ativo",
          executable: candidate,
        };
      }
    }
  }

  if (managedFolder && knownFolders.has(managedFolder)) {
    for (const candidate of getExtraSystemCandidatePaths(managedFolder as ManagedRuntimeFolder)) {
      if (managedFolder === "antigravity" && isLikelyAntigravityGuiBinary(candidate)) {
        continue;
      }
      if (existsSync(candidate)) {
        const ver = await runShortCommand(candidate, ["--version"], 800);
        return {
          found: true,
          version: ver ? ver.split(/\r?\n/)[0].slice(0, 48) : "CLI ativo",
          executable: candidate,
        };
      }
    }
  }

  if (isWin) {
    const extra: string[] = [];
    for (const bin of bins) {
      if (bin === "agy") extra.push(join(localAppData, "agy", "bin", "agy.exe"));
      if (bin === "codex") extra.push(join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
      if (bin === "claude") extra.push(join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"));
      if (bin === "opencode") {
        extra.push(join(homedir(), ".opencode", "bin", "opencode.exe"));
        extra.push(join(appDataDir, "npm", "opencode.cmd"));
      }
    }
    for (const candidate of extra) {
      if (existsSync(candidate)) {
        const ver = await runShortCommand(candidate, ["--version"], 800);
        return {
          found: true,
          version: ver ? ver.split(/\r?\n/)[0].slice(0, 48) : "CLI ativo",
          executable: candidate,
        };
      }
    }
  }

  return { found: false, version: null, executable: null };
}

export async function detectOllamaModels(): Promise<{ up: boolean; models: ModeloProvedorInfo[] }> {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return { up: false, models: [] };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok) return { up: false, models: [] };
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    const list: ModeloProvedorInfo[] = (body.models ?? [])
      .filter((m) => typeof m.name === "string" && m.name.length > 0)
      .map((m, idx) => ({
        id: m.name!.startsWith("ollama/") ? m.name! : `ollama/${m.name!}`,
        rotulo: `${m.name!} (Ollama Local)`,
        padrao: idx === 0,
        gratuito: true,
        descoberto_em_conta: true,
      }));
    return { up: true, models: list };
  } catch {
    return { up: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

export const POOL_AFFINITY_WINDOW_MS = 10 * 60 * 1000;
export const POOL_BUFFER_SHORT_WINDOW_PCT = 15; // <= 24h (janela_5h)
export const POOL_BUFFER_WEEKLY_WINDOW_PCT = 5; // janela_semanal

export function getAccountLongestWindowResetMs(conta: ContaProvedorInfo): number {
  const grupos = conta.grupos_cota ?? [];
  const weeklyResets: number[] = [];
  const shortResets: number[] = [];

  for (const grupo of grupos) {
    if (grupo.janela_semanal?.reseta_em) {
      const ts = Date.parse(grupo.janela_semanal.reseta_em);
      if (Number.isFinite(ts)) weeklyResets.push(ts);
    }
    if (grupo.janela_5h?.reseta_em) {
      const ts = Date.parse(grupo.janela_5h.reseta_em);
      if (Number.isFinite(ts)) shortResets.push(ts);
    }
  }

  if (weeklyResets.length > 0) return Math.min(...weeklyResets);
  if (shortResets.length > 0) return Math.min(...shortResets);
  return Number.MAX_SAFE_INTEGER;
}

export function getAccountAverageRemainingPct(conta: ContaProvedorInfo): number {
  const values: number[] = [];
  for (const grupo of conta.grupos_cota ?? []) {
    if (grupo.janela_5h) values.push(grupo.janela_5h.restante_percentual);
    if (grupo.janela_semanal) values.push(grupo.janela_semanal.restante_percentual);
  }
  if (values.length === 0) return 100;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function accountRespectsQuotaBuffers(conta: ContaProvedorInfo): boolean {
  for (const grupo of conta.grupos_cota ?? []) {
    if (grupo.janela_5h) {
      const dur = Number(grupo.janela_5h.duracao_minutos ?? 300);
      const minRequired = dur <= 24 * 60 ? POOL_BUFFER_SHORT_WINDOW_PCT : POOL_BUFFER_WEEKLY_WINDOW_PCT;
      if (grupo.janela_5h.restante_percentual < minRequired) {
        return false;
      }
    }
    if (grupo.janela_semanal) {
      if (grupo.janela_semanal.restante_percentual < POOL_BUFFER_WEEKLY_WINDOW_PCT) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Seleciona a melhor conta do pool respeitando exclusões, reserva mínima de segurança
 * (15% na janela 5h e 5% na janela semanal), prioridade para a janela mais longa que
 * reinicia primeiro e afinidade com `preferredAccountId`/`conta_em_uso` quando diferença < 10 min.
 */
export function selectPoolAccount(
  contas: ContaProvedorInfo[],
  pool: PoolContasConfig | null | undefined,
  preferredAccountId?: string | null,
): ContaProvedorInfo | null {
  const excluded = new Set(pool?.contas_excluidas ?? []);
  const usable = contas.filter(
    (c) =>
      c.estado === "conectado" &&
      !excluded.has(c.id) &&
      accountRespectsQuotaBuffers(c),
  );

  if (usable.length === 0) {
    return null;
  }

  const sorted = [...usable].sort((a, b) => {
    const resetA = getAccountLongestWindowResetMs(a);
    const resetB = getAccountLongestWindowResetMs(b);
    if (resetA !== resetB) {
      return resetA - resetB;
    }
    return getAccountAverageRemainingPct(b) - getAccountAverageRemainingPct(a);
  });

  const best = sorted[0]!;
  const stickyId = preferredAccountId ?? pool?.conta_em_uso ?? null;
  if (stickyId) {
    const sticky = usable.find((c) => c.id === stickyId);
    if (sticky) {
      const bestReset = getAccountLongestWindowResetMs(best);
      const stickyReset = getAccountLongestWindowResetMs(sticky);
      if (
        bestReset === stickyReset ||
        (bestReset !== Number.MAX_SAFE_INTEGER &&
          stickyReset !== Number.MAX_SAFE_INTEGER &&
          Math.abs(stickyReset - bestReset) < POOL_AFFINITY_WINDOW_MS)
      ) {
        return sticky;
      }
    }
  }

  return best;
}

