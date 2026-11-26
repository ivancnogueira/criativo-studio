import {
  hostname,
} from "node:os";
import type {
  ContaProvedorInfo,
  ModeloProvedorInfo,
  PoolContasConfig,
  ProvedorStatusInfo,
  ProviderName,
  UsoProvedoresSnapshot,
} from "@criativo/contracts";
import {
  buildUsageWindowsFromGroups,
} from "./provider-quota-utils.ts";
import {
  checkAndUpdateManagedRuntimes,
  ensureProviderRuntimeInstalled,
  resolveManagedProviderRuntime,
  type ManagedRuntimeFolder,
} from "./provider-runtime-resolver.ts";
import { type ProviderConnectionDeps, PROVIDER_CATALOG, API_MODELS_CACHE_TTL_MS, apiKeyModelsCache, fetchApiModelsForProvider } from "./provider-catalog-helpers.ts";
import { detectOllamaModels, selectPoolAccount } from "./provider-local-detection.ts";

export async function getProvidersStatusOp(deps: ProviderConnectionDeps, forceProbe = false): Promise<ProvedorStatusInfo[]> {
  if (forceProbe) {
    deps.invalidateCliProbeCache();
    if (
      process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1" &&
      !deps.antigravityLive.getCliExecutable()
    ) {
      const installed = await ensureProviderRuntimeInstalled("antigravity").catch(() => null);
      if (installed?.executable) {
        deps.invalidateCliProbeCache();
      }
    }
  }

  const [
    cliData,
    agSnapshot,
    ollamaCheck,
    opencodeCatalog,
    claudeDynamicModels,
    openaiDynamicModels,
    claudeAccounts,
    openaiAccounts,
  ] = await Promise.all([
    deps.getCliProbeCache(),
    deps.antigravityLive.getLiveSnapshot(forceProbe),
    detectOllamaModels(),
    deps.opencodeLive.getLiveCatalog(forceProbe),
    deps.cliOAuth.listDynamicModels("claude", forceProbe).catch(() => []),
    deps.cliOAuth.listDynamicModels("openai", forceProbe).catch(() => []),
    deps.cliOAuth.listAccountsWithQuotas("claude", forceProbe).catch(() => deps.cliOAuth.listAccounts("claude")),
    deps.cliOAuth.listAccountsWithQuotas("openai", forceProbe).catch(() => deps.cliOAuth.listAccounts("openai")),
  ]);

  const secretSet = new Set(deps.vault.listSecretsMetadata().map((item) => item.chave_nome));
  const connectedFlags = deps.getStudioConfig<Record<string, boolean>>("provedores_conectados", {});
  const hiddenModelsMap = deps.getStudioConfig<Record<string, string[]>>("modelos_ocultos_por_provedor", {});
  const agentsByProvider = deps.getAgentsByProvider();

  return await Promise.all(
    PROVIDER_CATALOG.map(async (meta) => {
      const cli = (cliData as Record<string, { found: boolean; version: string | null; executable: string | null }>)[meta.provedor] ?? { found: false, version: null, executable: null };
      const vaultConfigured = meta.vaultKeys.some((k) => secretSet.has(k));

      let contas: ContaProvedorInfo[] = [];
      let pool: PoolContasConfig | null = null;
      let discoveredModels: ModeloProvedorInfo[] = [];

      if (meta.provedor === "gemini") {
        contas = agSnapshot.contas;
        pool = agSnapshot.pool;
        discoveredModels = agSnapshot.modelos;
      } else if (meta.provedor === "claude") {
        contas = claudeAccounts;
        pool = deps.cliOAuth.getPoolConfig("claude");
        discoveredModels = claudeDynamicModels;
      } else if (meta.provedor === "openai") {
        contas = openaiAccounts;
        pool = deps.cliOAuth.getPoolConfig("openai");
        discoveredModels = openaiDynamicModels;
      } else if (meta.provedor === "opencode") {
        discoveredModels = opencodeCatalog.modelos;
      } else if (meta.provedor === "ollama") {
        discoveredModels = ollamaCheck.models;
      }

      const hasValidAccount = contas.some((c) => c.estado === "conectado" || c.token_valido);
      if (pool && contas.length > 0 && pool.habilitado) {
        const picked = selectPoolAccount(contas, pool, pool.conta_em_uso);
        if (picked) {
          pool = { ...pool, conta_em_uso: picked.id };
        }
      }

      let modo: ProvedorStatusInfo["modo_conexao"] = "nenhum";
      if (meta.provedor === "opencode") {
        if (vaultConfigured) modo = "api_key";
        else if (opencodeCatalog.detected && opencodeCatalog.modelos.length > 0) modo = "cli";
      } else if (meta.provedor === "ollama") {
        if (ollamaCheck.up) modo = "local";
      } else {
        if (hasValidAccount) modo = "assinatura";
        else if (vaultConfigured || Boolean(connectedFlags[meta.provedor])) {
          modo = vaultConfigured ? "api_key" : "nenhum";
        }
      }

      let modelos: ModeloProvedorInfo[] = [];
      if (modo !== "nenhum") {
        if (modo === "api_key") {
          const cached = !forceProbe ? apiKeyModelsCache.get(meta.provedor) : undefined;
          if (cached && cached.expiresAt > Date.now()) {
            modelos = cached.models;
          } else {
            const apiKey =
              meta.vaultKeys
                .map((k) => deps.vault.getSecret(k) ?? deps.vault.getSecret(k.toUpperCase()))
                .find((val): val is string => typeof val === "string" && val.trim().length > 0)
                ?.trim() ?? "";
            const liveApiModels = apiKey
              ? await fetchApiModelsForProvider(meta.provedor, apiKey)
              : [];
            if (liveApiModels.length > 0) {
              apiKeyModelsCache.set(meta.provedor, {
                expiresAt: Date.now() + API_MODELS_CACHE_TTL_MS,
                models: liveApiModels,
              });
              modelos = liveApiModels;
            } else if (discoveredModels.length > 0) {
              modelos = discoveredModels;
            } else {
              modelos = meta.fallbackModelos.map((m) => ({
                ...m,
                descoberto_em_conta: false,
              }));
            }
          }
        } else if (discoveredModels.length > 0) {
          modelos = discoveredModels;
        } else if (modo === "assinatura") {
          modelos = meta.fallbackModelos.map((m) => ({
            ...m,
            descoberto_em_conta: false,
          }));
        }
      }

      const hiddenSet = new Set(hiddenModelsMap[meta.provedor] ?? []);
      const decoratedModelos = modelos.map((m) => ({
        ...m,
        oculto: hiddenSet.has(m.id),
      }));

      return {
        provedor: meta.provedor,
        rotulo: meta.rotulo,
        subtitulo: meta.subtitulo,
        conectado: modo !== "nenhum",
        cli_detectado:
          meta.provedor === "opencode" ? opencodeCatalog.detected : cli.found,
        cli_versao:
          meta.provedor === "opencode" ? opencodeCatalog.version : cli.version,
        cli_executavel:
          meta.provedor === "opencode" ? opencodeCatalog.executable : cli.executable,
        runtime_host: hostname(),
        runtime_platform: process.platform,
        vault_configurado: vaultConfigured,
        modo_conexao: modo,
        modelos: decoratedModelos,
        contas,
        pool,
        usado_por_agentes: agentsByProvider[meta.provedor] ?? [],
        reporta_cota: contas.some((c) => (c.grupos_cota?.length ?? 0) > 0),
      };
    })
  );
}

export async function ensureOpenCodeRuntimeInBackgroundOp(deps: ProviderConnectionDeps): Promise<{
    installed: boolean;
    connected: boolean;
  }> {
  const existing = resolveManagedProviderRuntime("opencode");
  if (existing.executable) {
    return { installed: false, connected: true };
  }
  const inst = await deps.opencodeLive.ensureInstalled();
  return { installed: inst.installedNow, connected: inst.ok };
}

export async function ensureAntigravityRuntimeInBackgroundOp(deps: ProviderConnectionDeps): Promise<{
    installed: boolean;
    available: boolean;
  }> {
  const existing = deps.antigravityLive.getCliExecutable();
  if (existing) {
    return { installed: false, available: true };
  }
  const inst = await ensureProviderRuntimeInstalled("antigravity");
  if (inst.executable) {
    deps.invalidateCliProbeCache();
    return { installed: inst.installedNow, available: true };
  }
  return { installed: false, available: false };
}

export async function checkAndUpdateManagedRuntimesInBackgroundOp(
  deps: ProviderConnectionDeps
): Promise<{ updated: ManagedRuntimeFolder[]; checked: ManagedRuntimeFolder[] }> {
  const folders: ManagedRuntimeFolder[] = ["antigravity", "opencode"];
  if (
    deps.cliOAuth.listAccounts("openai").length > 0 ||
    Boolean(resolveManagedProviderRuntime("codex").executable)
  ) {
    folders.push("codex");
  }
  if (
    deps.cliOAuth.listAccounts("claude").length > 0 ||
    Boolean(resolveManagedProviderRuntime("claude").executable)
  ) {
    folders.push("claude");
  }

  const res = await checkAndUpdateManagedRuntimes({ folders });
  if (res.updated.length > 0) {
    deps.invalidateCliProbeCache();
    if (res.updated.includes("codex")) {
      deps.cliOAuth.invalidateModelCache("openai");
      deps.cliOAuth.invalidateQuotaCache("openai");
    }
    if (res.updated.includes("claude")) {
      deps.cliOAuth.invalidateModelCache("claude");
      deps.cliOAuth.invalidateQuotaCache("claude");
    }
  }
  return res;
}

export async function connectProviderOp(deps: ProviderConnectionDeps, provedor: ProviderName,
    options?:
      | string
      | {
          apiKey?: string;
          modo?: "cli" | "api_key" | "local" | "assinatura";
        }): Promise<ProvedorStatusInfo> {
  const meta = PROVIDER_CATALOG.find((item) => item.provedor === provedor);
  if (!meta) {
    throw new Error(`Provedor desconhecido: ${provedor}`);
  }

  const opts = typeof options === "string" ? { apiKey: options } : (options ?? {});
  const cleanKey = typeof opts.apiKey === "string" ? opts.apiKey.trim() : "";

  if (provedor === "opencode" && !resolveManagedProviderRuntime("opencode").executable) {
    const inst = await deps.opencodeLive.ensureInstalled();
    if (!inst.ok && cleanKey.length === 0) {
      throw new Error(
        inst.error || "Não foi possível instalar o runtime gratuito do OpenCode automaticamente."
      );
    }
  }

  if (cleanKey.length > 0 && meta.vaultKeys[0]) {
    deps.vault.setSecret(meta.vaultKeys[0], cleanKey);
  }

  if (cleanKey.length > 0 || opts.modo) {
    const connectedFlags = deps.getStudioConfig<Record<string, boolean>>("provedores_conectados", {});
    connectedFlags[provedor] = true;
    deps.setStudioConfig("provedores_conectados", connectedFlags);
  }
  apiKeyModelsCache.delete(provedor);

  const list = await getProvidersStatusOp(deps, provedor === "opencode");
  return list.find((item) => item.provedor === provedor)!;
}

export async function pickPoolAccountOp(deps: ProviderConnectionDeps, provedor: ProviderName,
    preferredAccountId?: string | null,): Promise<ContaProvedorInfo | null> {
  const statuses = await getProvidersStatusOp(deps, false);
  const info = statuses.find((s) => s.provedor === provedor);
  if (!info || !info.contas || info.contas.length === 0) {
    return null;
  }
  return selectPoolAccount(info.contas, info.pool, preferredAccountId);
}

export function selectPoolAccountOp(deps: ProviderConnectionDeps, contas: ContaProvedorInfo[],
    pool: PoolContasConfig | null | undefined,
    preferredAccountId?: string | null,): ContaProvedorInfo | null {
  return selectPoolAccount(contas, pool, preferredAccountId);
}

export async function connectProviderViaBrowserOp(deps: ProviderConnectionDeps, provedor: "gemini" | "claude" | "openai",
    label?: string,
    onAuthUrl?: (url: string) => void): Promise<{ conta: ContaProvedorInfo; provedores: ProvedorStatusInfo[] }> {
  try {
    const conta =
      provedor === "gemini"
        ? await deps.antigravityLive.connectGoogleViaBrowser(label, onAuthUrl)
        : await deps.cliOAuth.connectViaBrowser(provedor, label, onAuthUrl);

    const provedores = await getProvidersStatusOp(deps, true);
    return { conta, provedores };
  } finally {
    deps.invalidateCliProbeCache();
  }
}

export function cancelBrowserSignInOp(deps: ProviderConnectionDeps, provedor: "gemini" | "claude" | "openai"): boolean {
  if (provedor === "gemini") {
    return deps.antigravityLive.cancelPendingSignIn();
  }
  return deps.cliOAuth.cancelPendingSignIn(provedor);
}

export async function setHiddenModelsOp(deps: ProviderConnectionDeps, provedor: ProviderName,
    hiddenModelIds: string[]): Promise<ProvedorStatusInfo[]> {
  const cleanIds = Array.from(
    new Set(hiddenModelIds.map((id) => id.trim()).filter((id) => id.length > 0))
  );
  const current = deps.getStudioConfig<Record<string, string[]>>("modelos_ocultos_por_provedor", {});
  current[provedor] = cleanIds;
  deps.setStudioConfig("modelos_ocultos_por_provedor", current);
  return getProvidersStatusOp(deps, false);
}

export async function disconnectProviderOp(deps: ProviderConnectionDeps, provedor: ProviderName): Promise<ProvedorStatusInfo> {
  const meta = PROVIDER_CATALOG.find((item) => item.provedor === provedor);
  if (!meta) {
    throw new Error(`Provedor desconhecido: ${provedor}`);
  }
  apiKeyModelsCache.delete(provedor);

  for (const keyName of meta.vaultKeys) {
    deps.db.connection.prepare(`DELETE FROM cofre_segredos WHERE chave_nome = ?;`).run(keyName);
  }

  if (provedor === "gemini") {
    const agSnap = await deps.antigravityLive.getLiveSnapshot(false);
    for (const acc of agSnap.contas) {
      deps.antigravityLive.removeAccount(acc.id);
    }
  } else if (provedor === "claude" || provedor === "openai") {
    for (const acc of deps.cliOAuth.listAccounts(provedor)) {
      deps.cliOAuth.removeAccount(provedor, acc.id);
    }
  }

  const connectedFlags = deps.getStudioConfig<Record<string, boolean>>("provedores_conectados", {});
  connectedFlags[provedor] = false;
  deps.setStudioConfig("provedores_conectados", connectedFlags);

  const list = await getProvidersStatusOp(deps, true);
  return list.find((item) => item.provedor === provedor)!;
}

export async function getUsageSnapshotOp(deps: ProviderConnectionDeps, forceRefresh = false): Promise<UsoProvedoresSnapshot> {
  const statuses = await getProvidersStatusOp(deps, forceRefresh);
  const agSnapshot = await deps.antigravityLive.getLiveSnapshot(false);

  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rowUso = deps.db.connection
    .prepare(
      `SELECT COUNT(*) as turnos,
              COALESCE(SUM(uncached_input + cached_input + output_tokens), 0) as tokens
       FROM projecao_uso_registros
       WHERE occurred_at >= ?;`
    )
    .get(cutoffIso) as { turnos: number; tokens: number };

  const rowEv = deps.db.connection
    .prepare(`SELECT COUNT(*) as total FROM eventos_orquestracao WHERE ocorrido_em >= ?;`)
    .get(cutoffIso) as { total: number };

  const execucoes24h = Number(rowUso?.turnos ?? 0) || Number(rowEv?.total ?? 0);
  const totalTokens = Number(rowUso?.tokens ?? 0);

  const provedoresList: UsoProvedoresSnapshot["provedores"] = [];
  const allContas: ContaProvedorInfo[] = [...agSnapshot.contas];

  // Adiciona contas Google conectadas no Studio com suas cotas reais
  for (const conta of agSnapshot.contas) {
    provedoresList.push({
      provedor: "gemini",
      rotulo: conta.email ? `Gemini - ${conta.email}` : conta.rotulo ?? `Gemini (${conta.id})`,
      conectado: conta.estado === "conectado" || Boolean(conta.token_valido),
      email: conta.email,
      janelas: buildUsageWindowsFromGroups(conta.grupos_cota, false),
      grupos: conta.grupos_cota,
    });
  }

  // Inclui contas OAuth de Claude/ChatGPT (com cotas reais 5h/Semanal) e outros provedores ativos
  for (const st of statuses) {
    if (st.provedor === "gemini" && agSnapshot.contas.length > 0) continue;
    if ((st.provedor === "claude" || st.provedor === "openai") && st.contas && st.contas.length > 0) {
      allContas.push(...st.contas);
      for (const acc of st.contas) {
        provedoresList.push({
          provedor: st.provedor,
          rotulo: acc.email ? `${st.rotulo} - ${acc.email}` : st.rotulo,
          conectado: true,
          email: acc.email,
          janelas: buildUsageWindowsFromGroups(acc.grupos_cota ?? [], true),
          grupos: acc.grupos_cota,
        });
      }
      continue;
    }
    if (!st.conectado && allContas.length > 0) continue;
    provedoresList.push({
      provedor: st.provedor,
      rotulo: st.rotulo,
      conectado: st.conectado,
      email: null,
      janelas: [],
      grupos: [],
    });
  }

  return {
    total_execucoes_24h: execucoes24h,
    total_tokens_estimados: totalTokens,
    contas: allContas,
    provedores: provedoresList,
    atualizado_em: new Date().toISOString(),
  };
}

