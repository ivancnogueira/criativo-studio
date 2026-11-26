import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  ModeloProvedorInfo,
  NivelEsforco,
  PoolContasConfig,
  ProviderName,
} from "@criativo/contracts";
import {
  buildDualWindowQuotaGroup,
  refreshCachedQuotaGroupCountdowns,
} from "../provider-quota-utils.ts";
import {
  ensureProviderRuntimeInstalled,
  forceUpgradeProviderRuntime,
  resolveManagedProviderRuntime,
  spawnProviderProcess,
} from "../provider-runtime-resolver.ts";
import {
  fetchCodexAccountModelsHttp,
  isCodexSchemaMismatchError,
  isImageGenerationCodexModel,
  isInternalHiddenCodexModel,
} from "./codex-models-http.ts";
import { EXEC_TIMEOUT_MS, MODEL_CATALOG_TTL_MS, QUOTA_CACHE_TTL_MS, mapEffortList, resolveCliBinaryForProvider, type CliServiceRuntimeContext } from "./cli-types-and-helpers.ts";

export async function listCliAccountsWithQuotas(
  ctx: CliServiceRuntimeContext,

    provedor: "claude" | "openai",
    forceRefresh = false
  ): Promise<ContaProvedorInfo[]> {
    const accounts = ctx.listAccounts(provedor);
    if (accounts.length === 0) return [];

    const records = ctx.getStoredRecords().filter((r) => r.provedor === provedor);
    const openaiCli =
      provedor === "openai" ? resolveCliBinaryForProvider("openai", ctx.appDataDir).executable : null;
    const now = Date.now();

    return Promise.all(
      accounts.map(async (acc) => {
        const cacheKey = `${provedor}:${acc.id}`;
        const cached = ctx.accountsQuotaCache.get(cacheKey);
        if (!forceRefresh && cached && cached.expiresAt > now) {
          return {
            ...acc,
            grupos_cota: refreshCachedQuotaGroupCountdowns(cached.grupos),
          };
        }

        const rec = records.find((r) => r.id === acc.id);
        let grupos: GrupoCotaConta[] = [];

        if (rec) {
          try {
            if (provedor === "claude") {
              grupos = await fetchCliClaudeQuota(ctx, resolve(rec.configDir));
            } else if (openaiCli) {
              grupos = await probeCliCodexQuota(ctx, openaiCli, resolve(rec.configDir));
            }
          } catch {
            // fallback gracioso abaixo para cache prévio caso indisponível momentaneamente
          }
        }

        if (grupos.length > 0) {
          ctx.accountsQuotaCache.set(cacheKey, {
            expiresAt: now + QUOTA_CACHE_TTL_MS,
            grupos,
          });
        } else if (cached?.grupos?.length) {
          grupos = refreshCachedQuotaGroupCountdowns(cached.grupos);
        }

        return {
          ...acc,
          grupos_cota: grupos,
        };
      })
    );
  }

export async function fetchCliClaudeQuota(
  ctx: CliServiceRuntimeContext,
configDir: string): Promise<GrupoCotaConta[]> {
    const credPath = join(configDir, ".credentials.json");
    if (!existsSync(credPath)) return [];

    let accessToken: string | null = null;
    try {
      const parsed = JSON.parse(readFileSync(credPath, "utf8")) as {
        claudeAiOauth?: { accessToken?: string };
      };
      accessToken = parsed.claudeAiOauth?.accessToken?.trim() || null;
    } catch {
      return [];
    }
    if (!accessToken) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    timer.unref?.();

    try {
      const res = await ctx.fetchImpl("https://api.anthropic.com/api/oauth/usage", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          Accept: "application/json",
          "User-Agent": "claude-code/2.1.0",
        },
        signal: controller.signal,
      });
      if (!res.ok) return [];

      const body = (await res.json()) as {
        five_hour?: { utilization?: number; resets_at?: string | null } | null;
        seven_day?: { utilization?: number; resets_at?: string | null } | null;
      };

      const fiveHourRem =
        typeof body.five_hour?.utilization === "number"
          ? 100 - body.five_hour.utilization
          : null;
      const weeklyRem =
        typeof body.seven_day?.utilization === "number"
          ? 100 - body.seven_day.utilization
          : null;

      const group = buildDualWindowQuotaGroup({
        nome: "Claude",
        fiveHourRemaining: fiveHourRem,
        fiveHourResetIso: body.five_hour?.resets_at ?? null,
        weeklyRemaining: weeklyRem,
        weeklyResetIso: body.seven_day?.resets_at ?? null,
      });
      return group ? [group] : [];
    } finally {
      clearTimeout(timer);
    }
  }

export async function probeCliCodexQuota(
  ctx: CliServiceRuntimeContext,

    executable: string,
    codexHome: string
  ): Promise<GrupoCotaConta[]> {
    const result = await runCliCodexAppServerRpc<{
      rateLimits?: {
        primary?: { usedPercent?: number; windowDurationMins?: number; resetsAt?: number | null } | null;
        secondary?: { usedPercent?: number; windowDurationMins?: number; resetsAt?: number | null } | null;
      };
    }>(ctx, executable, codexHome, "account/rateLimits/read", {});

    const primary = result?.rateLimits?.primary;
    const secondary = result?.rateLimits?.secondary;
    const toIsoFromEpochSec = (sec: number | null | undefined): string | null =>
      typeof sec === "number" && Number.isFinite(sec) && sec > 0
        ? new Date(sec * 1000).toISOString()
        : null;

    const group = buildDualWindowQuotaGroup({
      nome: "ChatGPT",
      fiveHourRemaining: typeof primary?.usedPercent === "number" ? 100 - primary.usedPercent : null,
      fiveHourResetIso: toIsoFromEpochSec(primary?.resetsAt),
      fiveHourDurationMins: primary?.windowDurationMins ?? 300,
      weeklyRemaining: typeof secondary?.usedPercent === "number" ? 100 - secondary.usedPercent : null,
      weeklyResetIso: toIsoFromEpochSec(secondary?.resetsAt),
      weeklyDurationMins: secondary?.windowDurationMins ?? 10_080,
    });
    return group ? [group] : [];
  }

export async function runCliCodexAppServerRpc<TResult>(
  ctx: CliServiceRuntimeContext,

    executable: string,
    codexHome: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<TResult | null> {
    return new Promise((resolvePromise) => {
      const child = spawnProviderProcess(executable, ["app-server"], {
        cwd: ctx.workspaceCwd,
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdin.on("error", () => {});

      let settled = false;
      const done = (res: TResult | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rl.close();
        try {
          child.stdin.end();
          child.kill();
        } catch {
          // ignora
        }
        resolvePromise(res);
      };

      const timer = setTimeout(() => done(null), 6_500);
      timer.unref?.();

      const rl = createInterface({ input: child.stdout });
      let stderrTail = "";
      child.stderr.on("data", (chunk) => {
        stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-2048);
        if (isCodexSchemaMismatchError(stderrTail) && process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1") {
          void forceUpgradeProviderRuntime("codex", {
            appDataDir: ctx.appDataDir,
            codexHomeToResetCache: codexHome,
          }).catch(() => {});
        }
      });
      child.on("error", () => done(null));
      child.on("exit", () => done(null));

      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) return;
        try {
          const msg = JSON.parse(trimmed) as { id?: number; result?: TResult };
          if (msg.id === 1) {
            child.stdin.write(
              `${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`
            );
            child.stdin.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: 2, method, params })}\n`
            );
          } else if (msg.id === 2) {
            done(msg.result ?? null);
          }
        } catch {
          // ignora JSON parcial
        }
      });

      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            clientInfo: { name: "criativo-ai-studio", version: "1.0.0" },
            capabilities: { experimentalApi: true },
          },
        })}\n`
      );
    });
  }

  /**
   * Consulta ao vivo os modelos reais disponíveis na conta/CLI conectada do provedor:
   * - `openai`: JSON-RPC `model/list` em `codex app-server` usando `CODEX_HOME` da conta;
   * - `claude`: `control_request: initialize` em `claude --input-format stream-json --output-format stream-json`.
   */
export async function listCliDynamicModels(
  ctx: CliServiceRuntimeContext,

    provedor: "claude" | "openai",
    forceRefresh = false
  ): Promise<ModeloProvedorInfo[]> {
    const now = Date.now();
    const cached = ctx.dynamicModelsCache.get(provedor);
    if (!forceRefresh && cached && cached.expiresAt > now && cached.modelos.length > 0) {
      return cached.modelos;
    }

    const { executable } = resolveCliBinaryForProvider(provedor, ctx.appDataDir);
    if (!executable) {
      return [];
    }

    const accounts = ctx.listAccounts(provedor);
    if (provedor === "openai" && accounts.length === 0) {
      return [];
    }

    const pool = ctx.getPoolConfig(provedor);
    const chosenId = pool?.conta_em_uso ?? accounts[0]?.id ?? null;
    const rec = chosenId
      ? ctx.getStoredRecords().find((r) => r.provedor === provedor && r.id === chosenId)
      : undefined;

    let modelos: ModeloProvedorInfo[] = [];
    if (provedor === "openai" && rec) {
      modelos = await probeCliCodexModels(ctx, executable, resolve(rec.configDir));
    } else if (provedor === "claude") {
      modelos = await probeCliClaudeModels(ctx, executable, rec ? resolve(rec.configDir) : null);
    }

    if (modelos.length > 0) {
      ctx.dynamicModelsCache.set(provedor, {
        expiresAt: now + MODEL_CATALOG_TTL_MS,
        modelos,
      });
    }
    return modelos;
  }

export async function probeCliCodexModels(
  ctx: CliServiceRuntimeContext,

    executable: string,
    codexHome: string
  ): Promise<ModeloProvedorInfo[]> {
    // Camada 1: consulta direta na conta ChatGPT (resiliente a novos campos/efforts da API)
    if (process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1") {
      const httpModels = await fetchCodexAccountModelsHttp({
        codexHome,
        fetchImpl: ctx.fetchImpl,
        appDataDir: ctx.appDataDir,
        onUnauthorizedRefresh: async () => {
          await runCliCodexAppServerRpc(ctx, executable, codexHome, "account/rateLimits/read", {});
        },
      });
      if (httpModels.length > 0) {
        return httpModels;
      }
    }

    // Camada 2: fallback via `codex app-server` `model/list` com filtro rigoroso de ocultos
    const result = await runCliCodexAppServerRpc<{
      data?: Array<{
        model?: string;
        displayName?: string;
        isDefault?: boolean;
        hidden?: boolean;
        visibility?: string;
        inputModalities?: string[];
        supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
      }>;
    }>(ctx, executable, codexHome, "model/list", { limit: 100, includeHidden: false });

    const rawList = Array.isArray(result?.data) ? result.data : [];
    const mapped: ModeloProvedorInfo[] = [];
    const seen = new Set<string>();
    for (const item of rawList) {
      const id = typeof item.model === "string" ? item.model.trim() : "";
      if (!id || seen.has(id) || isInternalHiddenCodexModel(id)) continue;
      if (item.hidden === true) continue;
      if (typeof item.visibility === "string" && item.visibility.trim().toLowerCase() !== "list") {
        continue;
      }
      seen.add(id);
      const efforts = mapEffortList(
        (item.supportedReasoningEfforts ?? []).map((e: { reasoningEffort?: string }) =>
          String(e.reasoningEffort ?? "")
        )
      );
      mapped.push({
        id,
        rotulo: item.displayName?.trim() || id,
        padrao: Boolean(item.isDefault),
        suporta_imagem: isImageGenerationCodexModel(id),
        esforcos_suportados: efforts,
        descoberto_em_conta: true,
      });
    }
    if (mapped.length > 0 && !mapped.some((m) => m.padrao)) {
      mapped[0].padrao = true;
    }
    return mapped;
  }

export async function probeCliClaudeModels(
  ctx: CliServiceRuntimeContext,

    executable: string,
    configDir: string | null
  ): Promise<ModeloProvedorInfo[]> {
    const args = ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
    return new Promise((resolvePromise) => {
      const child = spawnProviderProcess(executable, args, {
        cwd: ctx.workspaceCwd,
        env: {
          ...process.env,
          DISABLE_AUTOUPDATER: "1",
          ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdin.on("error", () => {});

      let settled = false;
      const done = (res: ModeloProvedorInfo[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rl.close();
        try {
          child.stdin.end();
          child.kill();
        } catch {
          // ignora
        }
        resolvePromise(res);
      };

      const timer = setTimeout(() => done([]), 6_000);
      timer.unref?.();

      const rl = createInterface({ input: child.stdout });
      child.on("error", () => done([]));
      child.on("exit", () => done([]));

      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) return;
        try {
          const msg = JSON.parse(trimmed) as {
            type?: string;
            response?: {
              response?: {
                models?: Array<{
                  value?: string;
                  resolvedModel?: string;
                  displayName?: string;
                  supportedEffortLevels?: string[];
                }>;
              };
            };
          };
          if (msg.type !== "control_response") return;
          const rawList = msg.response?.response?.models;
          if (!Array.isArray(rawList)) {
            done([]);
            return;
          }
          const mapped: ModeloProvedorInfo[] = [];
          const seen = new Set<string>();
          for (const item of rawList) {
            const id = (item.resolvedModel?.trim() || item.value?.trim() || "").replace(/\[1m\]$/i, "");
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const rawName = item.displayName?.trim() || id;
            const rotulo =
              rawName.toLowerCase() === "default (recommended)"
                ? id
                : rawName.toLowerCase().startsWith("claude")
                  ? rawName
                  : `Claude ${rawName}`;
            mapped.push({
              id,
              rotulo,
              padrao: item.value === "default" || mapped.length === 0,
              esforcos_suportados: mapEffortList(item.supportedEffortLevels),
              descoberto_em_conta: Boolean(configDir),
            });
          }
          done(mapped);
        } catch {
          // ignora JSON parcial
        }
      });

      child.stdin.write(
        `${JSON.stringify({
          type: "control_request",
          request_id: "init-models",
          request: { subtype: "initialize" },
        })}\n`
      );
    });
  }
