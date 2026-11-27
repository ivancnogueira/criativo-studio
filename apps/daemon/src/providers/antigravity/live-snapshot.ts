import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  JanelaCotaConta,
  ModeloProvedorInfo,
  NivelEsforco,
  PoolContasConfig,
  PoolEstrategiaContas,
} from "@criativo/contracts";
import { accountTurnCoordinator, selectPoolAccount } from "../provider-account-pool.ts";
import {
  formatResetCountdownPtBr,
  refreshCachedQuotaGroupCountdowns,
} from "../provider-quota-utils.ts";
import { ensureProviderRuntimeInstalled } from "../provider-runtime-resolver.ts";
import { ACP_MODELS_CACHE_TTL_MS, CACHE_TTL_MS, CODE_ASSIST_URL, DAILY_CODE_ASSIST_URL, type AntigravityLiveSnapshot, type AntigravitySnapshotRuntimeContext, type CodeAssistRetrieveQuotaResponse, type DiscoveredTokenEntry, type FetchAvailableModelsResponse } from "./live-types.ts";
import { buildGroupedAcpModels, extractQuotaBucketsFromResponse, extractQuotaGroupsFromResponse, mergeAndSortQuotaGroups, normalizeWindowBucket, parseGroupModelsDescription, synthesizeQuotaGroupsFromModels } from "./quota-helpers.ts";
import { callCodeAssistEndpoint, filterHttpAvailableModels, normalizeModelFamilyAndEffort } from "./model-filter-helpers.ts";

export async function computeAntigravityLiveSnapshot(
  ctx: AntigravitySnapshotRuntimeContext,
  forceRefresh = false
): Promise<AntigravityLiveSnapshot> {
  let acpModelsCache = ctx.getAcpModelsCache();
    const now = Date.now();
    const SHORT_MISSING_QUOTA_TTL_MS = 5_000;

    const { entries, poolOverride } = ctx.discoverStudioTokenEntries();
    if (entries.length === 0) {
      if (
        ctx.allowAutoAcpDiscovery &&
        process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1" &&
        !ctx.acpService.getCliExecutable()
      ) {
        void ensureProviderRuntimeInstalled("antigravity", {
          appDataDir: ctx.appDataDir,
        }).catch(() => {});
      }
      const emptySnap: AntigravityLiveSnapshot = {
        contas: [],
        pool: null,
        modelos: [],
        defaultModelId: null,
        imageGenerationModelIds: [],
        atualizado_em: new Date().toISOString(),
      };
      ctx.setSnapshotCache({ expiresAt: now + CACHE_TTL_MS, data: emptySnap });
      return emptySnap;
    }

    let cliExe = ctx.acpService.getCliExecutable();
    if (
      !cliExe &&
      ctx.allowAutoAcpDiscovery &&
      process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1"
    ) {
      if (forceRefresh) {
        const installed = await ensureProviderRuntimeInstalled("antigravity", {
          appDataDir: ctx.appDataDir,
        }).catch(() => null);
        if (installed?.executable) {
          cliExe = installed.executable;
        }
      } else {
        void ensureProviderRuntimeInstalled("antigravity", {
          appDataDir: ctx.appDataDir,
        }).catch(() => {});
      }
    }
    const cachedPrev = ctx.loadLastSnapshotCache();

    const contas: ContaProvedorInfo[] = [];
    const modelMap = new Map<string, ModeloProvedorInfo>();
    let defaultModelId: string | null = cachedPrev?.defaultModelId ?? null;
    const imageGenerationModelIds = new Set<string>(cachedPrev?.imageGenerationModelIds ?? []);
    let anyFreshLiveSuccess = false;

    await Promise.all(
      entries.map(async (entry) => {
        const cachedAccount = cachedPrev?.contas?.find(
          (c) => c.id === entry.id || (entry.email && c.email === entry.email)
        );
        const grupos: GrupoCotaConta[] = [];
        let modelosConta: string[] = [];
        let activeAccessToken = entry.accessToken;
        let tokenValidNow = entry.tokenValid;
        let expiryIsoNow = entry.expiryIso;

        // Se o token JWT em disco venceu e o motor ACP está disponível, renova silenciosamente em qualquer leitura
        if (!tokenValidNow && entry.hasRefreshToken && cliExe) {
          try {
            const refreshed = await ctx.acpService.refreshAccountToken(entry.id, entry.geminiDir);
            if (refreshed?.accessToken) {
              activeAccessToken = refreshed.accessToken;
              expiryIsoNow = refreshed.expiryIso;
              tokenValidNow = true;
            }
          } catch {
            // fallback para cache ou estado autenticado via ACP
          }
        }

        let estado: ContaProvedorInfo["estado"] =
          tokenValidNow || (entry.hasRefreshToken && Boolean(cliExe)) ? "conectado" : "desconectado";
        let plano: string | null = cachedAccount?.plano ?? null;

        const fetchLiveQuotaAndModels = async (tokenToUse: string) => {
          const loadBody = {
            metadata: {
              ideType: "ANTIGRAVITY",
              platform:
                process.platform === "win32"
                  ? "WINDOWS"
                  : process.platform === "darwin"
                    ? "MACOS"
                    : "LINUX",
              pluginType: "GEMINI",
            },
          };

          let codeAssistInfo = await callCodeAssistEndpoint<{
            cloudaicompanionProject?: string;
            currentTier?: { name?: string };
          }>(ctx.fetchImpl, CODE_ASSIST_URL, "loadCodeAssist", tokenToUse, loadBody).catch(() => null);

          if (!codeAssistInfo?.cloudaicompanionProject) {
            const dailyLoad = await callCodeAssistEndpoint<{
              cloudaicompanionProject?: string;
              currentTier?: { name?: string };
            }>(ctx.fetchImpl, DAILY_CODE_ASSIST_URL, "loadCodeAssist", tokenToUse, loadBody).catch(() => null);
            if (dailyLoad?.cloudaicompanionProject || !codeAssistInfo) {
              codeAssistInfo = dailyLoad;
            }
          }

          if (!codeAssistInfo) {
            codeAssistInfo = await callCodeAssistEndpoint<{
              cloudaicompanionProject?: string;
              currentTier?: { name?: string };
            }>(ctx.fetchImpl, CODE_ASSIST_URL, "loadCodeAssist", tokenToUse, {});
          }

          if (codeAssistInfo.currentTier?.name) {
            plano = codeAssistInfo.currentTier.name;
          }

          const project = codeAssistInfo.cloudaicompanionProject;
          const queryPayload = project ? { project } : {};

          const [dailyQuotaRes, dailyModelsRes] = await Promise.all([
            callCodeAssistEndpoint<CodeAssistRetrieveQuotaResponse>(ctx.fetchImpl, 
              DAILY_CODE_ASSIST_URL,
              "retrieveUserQuotaSummary",
              tokenToUse,
              queryPayload
            ).catch(() => null),
            callCodeAssistEndpoint<FetchAvailableModelsResponse>(ctx.fetchImpl, 
              DAILY_CODE_ASSIST_URL,
              "fetchAvailableModels",
              tokenToUse,
              queryPayload
            ).catch(() => null),
          ]);

          let quotaRes = dailyQuotaRes;
          if (extractQuotaGroupsFromResponse(quotaRes).length === 0) {
            const prodQuotaRes = await callCodeAssistEndpoint<CodeAssistRetrieveQuotaResponse>(ctx.fetchImpl, 
              CODE_ASSIST_URL,
              "retrieveUserQuotaSummary",
              tokenToUse,
              queryPayload
            ).catch(() => null);
            if (
              extractQuotaGroupsFromResponse(prodQuotaRes).length > 0 ||
              extractQuotaBucketsFromResponse(prodQuotaRes).length > 0
            ) {
              quotaRes = prodQuotaRes;
            }
          }

          let modelsRes = dailyModelsRes;
          if (!modelsRes?.models || Object.keys(modelsRes.models).length === 0) {
            const prodModelsRes = await callCodeAssistEndpoint<FetchAvailableModelsResponse>(ctx.fetchImpl, 
              CODE_ASSIST_URL,
              "fetchAvailableModels",
              tokenToUse,
              queryPayload
            ).catch(() => null);
            if (prodModelsRes?.models && Object.keys(prodModelsRes.models).length > 0) {
              modelsRes = prodModelsRes;
            }
          }

          if (project || quotaRes || modelsRes) {
            anyFreshLiveSuccess = true;
          }

          for (const rawGroup of extractQuotaGroupsFromResponse(quotaRes)) {
            const nome = rawGroup.displayName?.trim();
            if (!nome) continue;
            let janela5h: JanelaCotaConta | null = null;
            let janelaSemanal: JanelaCotaConta | null = null;
            for (const b of rawGroup.quotaBuckets ?? rawGroup.buckets ?? []) {
              const win = normalizeWindowBucket(b);
              if (!win) continue;
              if (win.janela === "5h") {
                if (!janela5h || win.restante_percentual < janela5h.restante_percentual) janela5h = win;
              } else if (win.janela === "semanal") {
                if (!janelaSemanal || win.restante_percentual < janelaSemanal.restante_percentual) janelaSemanal = win;
              } else if (!janela5h) {
                janela5h = win;
              } else if (!janelaSemanal) {
                janelaSemanal = win;
              }
            }
            if (janela5h || janelaSemanal) {
              grupos.push({
                nome,
                modelos: parseGroupModelsDescription(rawGroup.description),
                janela_5h: janela5h,
                janela_semanal: janelaSemanal,
              });
            }
          }

          const rawBuckets = extractQuotaBucketsFromResponse(quotaRes);
          const needsFlatBuckets =
            grupos.length === 0 ||
            rawBuckets.length === 0 ||
            grupos.some((g) => !g.janela_semanal) ||
            !grupos.some((g) => g.nome.toLowerCase().includes("argon"));
          if (needsFlatBuckets && project) {
            const flatQuota =
              (await callCodeAssistEndpoint<CodeAssistRetrieveQuotaResponse>(ctx.fetchImpl, 
                CODE_ASSIST_URL,
                "retrieveUserQuota",
                tokenToUse,
                queryPayload
              ).catch(() => null)) ??
              (await callCodeAssistEndpoint<CodeAssistRetrieveQuotaResponse>(ctx.fetchImpl, 
                DAILY_CODE_ASSIST_URL,
                "retrieveUserQuota",
                tokenToUse,
                queryPayload
              ).catch(() => null));
            const flatBuckets = extractQuotaBucketsFromResponse(flatQuota);
            if (flatBuckets.length > 0) {
              rawBuckets.push(...flatBuckets);
              anyFreshLiveSuccess = true;
            }
          }

          const synthesized = synthesizeQuotaGroupsFromModels(modelsRes?.models, rawBuckets);
          const mergedGroups = mergeAndSortQuotaGroups(grupos, synthesized);
          grupos.length = 0;
          grupos.push(...mergedGroups);

          if (modelsRes?.models) {
            if (modelsRes.defaultAgentModelId) {
              defaultModelId = modelsRes.defaultAgentModelId;
            }
            for (const imgId of modelsRes.imageGenerationModelIds ?? []) {
              imageGenerationModelIds.add(imgId);
            }
            for (const [mId, mMeta] of filterHttpAvailableModels(modelsRes)) {
              const normalized = normalizeModelFamilyAndEffort(
                mId,
                mMeta,
                imageGenerationModelIds,
                defaultModelId
              );
              if (!normalized) continue;
              modelosConta.push(normalized.id);
              const existing = modelMap.get(normalized.id);
              if (
                !existing ||
                (normalized.restante_percentual ?? 0) > (existing.restante_percentual ?? -1)
              ) {
                modelMap.set(normalized.id, normalized);
              }
            }
          }
        };

        if (activeAccessToken && (tokenValidNow || entry.hasRefreshToken || !cliExe)) {
          try {
            await fetchLiveQuotaAndModels(activeAccessToken);
            if (anyFreshLiveSuccess) {
              tokenValidNow = true;
              estado = "conectado";
            }
          } catch (liveErr) {
            const msg = liveErr instanceof Error ? liveErr.message : String(liveErr);
            if (/\b401\b|\b403\b/i.test(msg) && entry.hasRefreshToken && cliExe) {
              try {
                const refreshed = await ctx.acpService.refreshAccountToken(entry.id, entry.geminiDir);
                if (refreshed?.accessToken) {
                  activeAccessToken = refreshed.accessToken;
                  expiryIsoNow = refreshed.expiryIso;
                  tokenValidNow = true;
                  estado = "conectado";
                  await fetchLiveQuotaAndModels(activeAccessToken);
                }
              } catch {
                // preserva último snapshot da conta caso renovação ou consulta falhe
              }
            }
          }
        }

        if (grupos.length === 0 && cachedAccount?.grupos_cota?.length) {
          grupos.push(...refreshCachedQuotaGroupCountdowns(cachedAccount.grupos_cota));
        }
        if (modelosConta.length === 0 && cachedAccount?.modelos_disponiveis?.length) {
          modelosConta = cachedAccount.modelos_disponiveis;
        }

        contas.push({
          id: entry.id,
          provedor: "gemini",
          rotulo: entry.label,
          email: entry.email,
          plano: plano ?? "Google AI",
          estado,
          padrao: contas.length === 0,
          token_valido: tokenValidNow,
          token_expira_em: expiryIsoNow,
          grupos_cota: grupos,
          modelos_disponiveis: modelosConta,
          origem: "criativo",
          removendo: accountTurnCoordinator.isDraining("gemini", entry.id),
          turnos_ativos: accountTurnCoordinator.getActiveTurns("gemini", entry.id),
        });
      })
    );

    // Garante que somente a primeira conta conectada tenha flag padrao: true
    contas.forEach((c, idx) => {
      c.padrao = idx === 0;
    });

    const excluidas = poolOverride?.contas_excluidas ?? [];
    const habilitado =
      poolOverride?.habilitado !== undefined ? poolOverride.habilitado : contas.length > 1;
    const rawPoolStrategy = (poolOverride as { estrategia?: PoolEstrategiaContas } | null | undefined)?.estrategia;
    const estrategia: PoolEstrategiaContas = rawPoolStrategy === "spread" ? "spread" : "fill_first";

    const draftPool: PoolContasConfig = {
      habilitado,
      contas_excluidas: excluidas,
      conta_em_uso: poolOverride?.conta_em_uso ?? null,
      estrategia,
    };
    const contaElegivel =
      selectPoolAccount(contas, draftPool, poolOverride?.conta_em_uso, {
        activeTurnsByAccount: accountTurnCoordinator.getActiveTurnsMap("gemini"),
        drainingAccountIds: accountTurnCoordinator.getDrainingAccountIds("gemini"),
      }) ??
      contas.find((c) => !c.removendo) ??
      contas[0] ??
      null;

    const pool: PoolContasConfig | null =
      contas.length > 0
        ? {
            habilitado,
            contas_excluidas: excluidas,
            conta_em_uso: contaElegivel?.id ?? null,
            estrategia,
          }
        : null;

    const eligibleEntry = entries.find(
      (e) => e.id === (contaElegivel?.id ?? "") && e.hasRefreshToken
    );
    const acpTargetEntry = eligibleEntry ?? entries.find((e) => e.hasRefreshToken) ?? null;

    if (ctx.allowAutoAcpDiscovery && cliExe && acpTargetEntry) {
      const cacheValid =
        !forceRefresh &&
        acpModelsCache &&
        acpModelsCache.accountId === acpTargetEntry.id &&
        acpModelsCache.expiresAt > now &&
        acpModelsCache.models.length > 0;

      if (!cacheValid) {
        const acpResult = await ctx.acpService
          .listAvailableModels(acpTargetEntry.id, acpTargetEntry.geminiDir)
          .catch(() => null);
        if (acpResult && acpResult.models.length > 0) {
          acpModelsCache = { 
            accountId: acpTargetEntry.id,
            expiresAt: now + ACP_MODELS_CACHE_TTL_MS,
            models: acpResult.models,
            defaultModelId: acpResult.defaultModelId,
           }; ctx.setAcpModelsCache(acpModelsCache);
          ctx.persistDiscoveredAcpModels(
            acpTargetEntry.geminiDir,
            acpResult.models,
            acpResult.defaultModelId
          );
          anyFreshLiveSuccess = true;
        }
      }
    }

    if (!acpModelsCache || acpModelsCache.models.length === 0) {
      for (const candidate of [acpTargetEntry, ...entries].filter(
        (e): e is DiscoveredTokenEntry => Boolean(e)
      )) {
        const diskAcp = ctx.loadDiscoveredAcpModels(candidate.geminiDir);
        if (diskAcp && diskAcp.models.length > 0) {
          acpModelsCache = { 
            accountId: candidate.id,
            expiresAt: now + ACP_MODELS_CACHE_TTL_MS,
            models: diskAcp.models,
            defaultModelId: diskAcp.defaultModelId,
           }; ctx.setAcpModelsCache(acpModelsCache);
          break;
        }
      }
    }

    if (modelMap.size === 0 && cachedPrev?.modelos?.length) {
      for (const m of cachedPrev.modelos) {
        modelMap.set(m.id, m);
      }
    }

    let modelos: ModeloProvedorInfo[];
    if (acpModelsCache && acpModelsCache.models.length > 0) {
      const targetGrupos = contaElegivel?.grupos_cota?.length
        ? contaElegivel.grupos_cota
        : contas.find((c) => c.grupos_cota.length > 0)?.grupos_cota ?? [];
      modelos = buildGroupedAcpModels(
        acpModelsCache.models,
        acpModelsCache.defaultModelId,
        targetGrupos,
        [...modelMap.values()]
      );
      if (acpModelsCache.defaultModelId) {
        defaultModelId =
          modelos.find((m) => m.padrao)?.id ??
          acpModelsCache.defaultModelId.replace(/-(low|medium|high|xhigh)$/i, "");
      }
      const acpIds = modelos.map((m) => m.id);
      for (const conta of contas) {
        conta.modelos_disponiveis = acpIds;
      }
    } else {
      modelos = ctx.deduplicateModels([...modelMap.values()]);
    }

    if (anyFreshLiveSuccess) {
      const contasForCache = contas.map((c) => {
        if (c.grupos_cota.length > 0) return c;
        const prevAcc = cachedPrev?.contas?.find(
          (p) => p.id === c.id || (c.email && p.email === c.email)
        );
        return prevAcc?.grupos_cota?.length
          ? { ...c, grupos_cota: refreshCachedQuotaGroupCountdowns(prevAcc.grupos_cota) }
          : c;
      });
      ctx.saveLastSnapshotCache({
        contas: contasForCache,
        modelos,
        defaultModelId,
        imageGenerationModelIds: [...imageGenerationModelIds],
      });
    }

    const snapshot: AntigravityLiveSnapshot = {
      contas,
      pool,
      modelos,
      defaultModelId,
      imageGenerationModelIds: [...imageGenerationModelIds],
      atualizado_em: new Date().toISOString(),
    };
    const hasMissingQuotaForConnected = contas.some(
      (c) => c.estado === "conectado" && c.grupos_cota.length === 0
    );
    const cacheTtl = hasMissingQuotaForConnected ? SHORT_MISSING_QUOTA_TTL_MS : CACHE_TTL_MS;
    ctx.setSnapshotCache({ expiresAt: Date.now() + cacheTtl, data: snapshot });
    return snapshot;
}
