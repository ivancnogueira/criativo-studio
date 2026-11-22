import type {
  MarketplaceAppItem,
  MarketplaceAuthFlow,
  MarketplaceAuthKind,
  McpProbeResultado,
} from "@criativo/contracts";
import {
  type MetaValidationReport,
  validateMetaIntegration,
} from "../engine/tools/meta-insights.ts";
import { inspectMcpServer } from "../mcp/mcp-probe.ts";
import {
  CatalogServiceError,
  NATIVE_VAULT_ALIAS_MAP,
  sanitizeMcpIdSegment,
  type CatalogServiceDeps,
  type ConnectCatalogAppInput,
  type ConnectCatalogAppResult,
} from "./catalog-types.ts";

export function catalog_resolveAuthFlow(
  deps: CatalogServiceDeps,
    app: MarketplaceAppItem,
    payload: ConnectCatalogAppInput
  ): MarketplaceAuthFlow | null {
    if (payload.flowId) {
      const byId = app.authFlows.find((f) => f.id === payload.flowId);
      if (byId) return byId;
    }
    if (payload.kind) {
      const byKind = app.authFlows.find((f) => f.kind === payload.kind);
      if (byKind) return byKind;
    }
    return app.authFlows[0] ?? null;
  }

export function catalog_allocateServerIdentity(
  deps: CatalogServiceDeps,
    app: MarketplaceAppItem,
    payload: ConnectCatalogAppInput
  ): { mcpId: string; serverName: string; contaRotulo: string } {
    const existingAll = deps.mcpStore.listServersForClient({ includeDisabled: true });
    const existingForApp = existingAll.filter((s) => s.origemAppSlug === app.slug);

    const contaRotulo =
      payload.contaRotulo?.trim() || `#account-${existingForApp.length + 1}`;

    if (payload.mcpId?.trim()) {
      const existingById = existingAll.find((s) => s.mcp_id === payload.mcpId!.trim());
      return {
        mcpId: payload.mcpId.trim(),
        serverName: existingById?.nome ?? app.name,
        contaRotulo: existingById?.contaRotulo ?? contaRotulo,
      };
    }

    const existingIds = new Set(existingAll.map((s) => s.mcp_id));
    const existingNames = new Set(existingAll.map((s) => s.nome.trim().toLowerCase()));

    const slugPart = sanitizeMcpIdSegment(app.slug) || "app";
    const rotuloPart = sanitizeMcpIdSegment(contaRotulo) || `account-${existingForApp.length + 1}`;
    let mcpId = `${slugPart}-${rotuloPart}`;
    let idx = 2;
    while (existingIds.has(mcpId)) {
      mcpId = `${slugPart}-${rotuloPart}-${idx}`;
      idx += 1;
    }

    let serverName =
      existingForApp.length === 0 && !existingNames.has(app.name.trim().toLowerCase())
        ? app.name
        : `${app.name} (${contaRotulo})`;
    let nameIdx = 2;
    while (existingNames.has(serverName.trim().toLowerCase())) {
      serverName = `${app.name} (${contaRotulo} #${nameIdx})`;
      nameIdx += 1;
    }

    return { mcpId, serverName, contaRotulo };
  }

export async function catalog_probeSavedServer(
  deps: CatalogServiceDeps,mcpId: string): Promise<McpProbeResultado> {
    if (deps.mcpGateway) {
      return await deps.mcpGateway.testServer(mcpId);
    }
    const resolved = deps.mcpStore.getServer(mcpId, true);
    if (!resolved) {
      throw new CatalogServiceError(`Servidor MCP '${mcpId}' não encontrado após salvar.`);
    }
    const result = await inspectMcpServer(resolved);
    deps.mcpStore.recordProbeResult(mcpId, result);
    return result;
  }

  /**
   * Conecta um aplicativo da Loja suportando fluxos adaptativos `key`, `local` e `oauth`,
   * múltiplas contas (`#account-N`) e sondagem via `McpProbe`.
   */
export async function catalog_connectCatalogApp(
  deps: CatalogServiceDeps,
    slug: string,
    payload: ConnectCatalogAppInput = {}
  ): Promise<ConnectCatalogAppResult> {
    const app = deps.findAppBySlug(slug);
    if (!app) {
      throw new CatalogServiceError(`Aplicativo '${slug}' não encontrado no catálogo.`, "APP_NOT_FOUND");
    }

    const authFlow = catalog_resolveAuthFlow(deps, app, payload);
    const kind: MarketplaceAuthKind = payload.kind ?? authFlow?.kind ?? "key";

    // Fluxo 1: Chave de API / Token guardado no Cofre
    if (kind === "key") {
      const providedFields = payload.fields ?? {};
      const requiredFields = (authFlow?.fields ?? []).filter((f) => f.required !== false);

      // Conectores nativos sem serverTemplate persistem em projecao_apps_nativos_contas + VaultService
      if (!app.serverTemplate) {
        const existingNativeAccounts = deps.nativeStore.listAccounts(app.slug);
        const cleanRotulo = payload.contaRotulo?.trim().toLowerCase() ?? "";
        const targetExisting = payload.contaId?.trim()
          ? existingNativeAccounts.find((a) => a.conta_id === payload.contaId!.trim())
          : cleanRotulo
            ? existingNativeAccounts.find((a) => a.conta_rotulo.trim().toLowerCase() === cleanRotulo)
            : existingNativeAccounts.length === 1
              ? existingNativeAccounts[0]
              : undefined;

        for (const field of requiredFields) {
          const val = providedFields[field.key];
          const hasStored = Boolean(
            targetExisting &&
              (targetExisting.campos_mascarados?.[field.key] ||
                targetExisting.campos_visiveis?.[field.key])
          );
          if ((typeof val !== "string" || val.trim().length === 0) && !hasStored) {
            throw new CatalogServiceError(
              `Preencha o campo obrigatório '${field.label || field.key}'.`,
              "MISSING_REQUIRED_FIELD"
            );
          }
        }

        const aliasMap = NATIVE_VAULT_ALIAS_MAP[app.slug] ?? {};
        let savedAcc = deps.nativeStore.upsertAccount({
          appSlug: app.slug,
          contaId: payload.contaId ?? targetExisting?.conta_id,
          contaRotulo: payload.contaRotulo,
          fields: providedFields,
          flowFields: (authFlow?.fields ?? []).map((f) => ({
            key: f.key,
            label: f.label,
            secret: f.secret !== false,
            required: f.required !== false,
            prefix: f.prefix,
          })),
          aliasMap,
          acesso: payload.acesso,
        });

        const savedKeys: string[] = [];
        for (const field of authFlow?.fields ?? []) {
          if (providedFields[field.key]?.trim()) {
            const targets = aliasMap[field.key] ?? [field.key];
            savedKeys.push(...targets);
          }
        }

        let validationReport: MetaValidationReport | undefined;
        if (app.slug === "instagram" && !payload.skipProbe) {
          validationReport = await validateMetaIntegration(deps.vault, deps.fetchImpl, {
            nativeStore: deps.nativeStore,
            contaId: savedAcc.conta_id,
          });
          savedAcc =
            deps.nativeStore.recordTestResult(savedAcc.conta_id, {
              ok: validationReport.ok,
              error: validationReport.detalhes.erro,
              perfilConectado: validationReport.detalhes.username
                ? {
                    username: validationReport.detalhes.username,
                    followers_count: validationReport.detalhes.followersCount,
                    media_count: validationReport.detalhes.mediaCount,
                  }
                : null,
            }) ?? savedAcc;
        } else if (!payload.skipProbe && savedAcc.configurado && app.slug !== "instagram") {
          savedAcc =
            deps.nativeStore.recordTestResult(savedAcc.conta_id, {
              ok: true,
              error: null,
            }) ?? savedAcc;
        }

        return {
          ok: true,
          kind: "key",
          appSlug: app.slug,
          native: true,
          contaRotulo: savedAcc.conta_rotulo,
          nativeAccount: savedAcc,
          validationReport,
          savedKeys: Array.from(new Set(savedKeys)),
        };
      }

      for (const field of requiredFields) {
        const val = providedFields[field.key];
        if (typeof val !== "string" || val.trim().length === 0) {
          throw new CatalogServiceError(
            `Preencha o campo obrigatório '${field.label || field.key}'.`,
            "MISSING_REQUIRED_FIELD"
          );
        }
      }

      const { mcpId, serverName, contaRotulo } = catalog_allocateServerIdentity(deps, app, payload);
      const env: Record<string, string> = { ...(app.serverTemplate.env ?? {}) };
      const headers: Record<string, string> = { ...(app.serverTemplate.headers ?? {}) };
      let targetUrl = payload.url?.trim() || authFlow?.defaultUrl?.trim() || app.serverTemplate.url || "";

      const applyField = (
        key: string,
        rawValue: string,
        target: "header" | "env" | "query",
        prefix = "",
        isSecret = false
      ) => {
        const formatted = `${prefix}${rawValue.trim()}`;
        if (target === "header") {
          headers[key] = formatted;
        } else if (target === "env") {
          env[key] = formatted;
        } else if (target === "query" && targetUrl) {
          const parsedUrl = new URL(targetUrl);
          parsedUrl.searchParams.set(key, formatted);
          targetUrl = parsedUrl.toString();
          if (isSecret) {
            deps.vault.setSecret(`mcp/${mcpId}/query/${encodeURIComponent(key)}`, formatted);
          }
        }
      };

      const flowFieldMap = new Map((authFlow?.fields ?? []).map((f) => [f.key, f]));
      for (const field of authFlow?.fields ?? []) {
        const raw = providedFields[field.key];
        if (typeof raw === "string" && raw.trim()) {
          applyField(field.key, raw, field.target, field.prefix ?? "", field.secret);
        }
      }
      for (const [extraKey, extraVal] of Object.entries(providedFields)) {
        if (flowFieldMap.has(extraKey)) continue;
        if (typeof extraVal === "string" && extraVal.trim()) {
          applyField(extraKey, extraVal, app.serverTemplate.transport === "http" ? "header" : "env");
        }
      }

      const saved = deps.mcpStore.saveServer({
        mcp_id: mcpId,
        nome: serverName,
        transporte: app.serverTemplate.transport,
        comando: payload.comando ?? app.serverTemplate.command ?? "",
        args: payload.args ?? app.serverTemplate.args ?? [],
        env,
        headers,
        url: app.serverTemplate.transport === "http" ? targetUrl || null : null,
        workingDirectory: payload.workingDirectory ?? null,
        acesso: payload.acesso ?? { mode: "everyone", agentIds: [] },
        origemAppSlug: app.slug,
        contaRotulo,
        ativo: true,
      });

      if (payload.skipProbe) {
        deps.mcpGateway?.refreshProxyRoutes();
        return {
          ok: true,
          kind: "key",
          appSlug: app.slug,
          mcpId: saved.mcp_id,
          contaRotulo,
          server: saved,
        };
      }

      const probe = await catalog_probeSavedServer(deps, saved.mcp_id);
      deps.mcpGateway?.refreshProxyRoutes();
      const updatedServer = deps.mcpStore.getServer(saved.mcp_id, false) ?? saved;

      return {
        ok: probe.status === "passed",
        kind: "key",
        appSlug: app.slug,
        mcpId: saved.mcp_id,
        contaRotulo,
        server: updatedServer,
        probe,
      };
    }

    // Fluxo 2: App Local (Desktop / STDIO / Loopback HTTP)
    if (kind === "local") {
      if (!app.serverTemplate) {
        return {
          ok: true,
          kind: "local",
          appSlug: app.slug,
          native: true,
          instructions: authFlow?.localInstructions ?? [],
        };
      }

      const { mcpId, serverName, contaRotulo } = catalog_allocateServerIdentity(deps, app, payload);
      const transport = app.serverTemplate.transport;
      const targetUrl =
        transport === "http"
          ? payload.url?.trim() || authFlow?.defaultUrl?.trim() || app.serverTemplate.url || "http://127.0.0.1:3000/mcp"
          : null;

      if (transport === "http" && targetUrl) {
        const parsed = new URL(targetUrl);
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol === "http:" && host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
          throw new CatalogServiceError(
            "Apps locais HTTP devem apontar para 127.0.0.1/localhost ou utilizar HTTPS.",
            "UNSAFE_LOCAL_URL"
          );
        }
      }

      const saved = deps.mcpStore.saveServer({
        mcp_id: mcpId,
        nome: serverName,
        transporte: transport,
        comando: transport === "stdio" ? payload.comando ?? app.serverTemplate.command ?? "" : "",
        args: transport === "stdio" ? payload.args ?? app.serverTemplate.args ?? [] : [],
        env: { ...(app.serverTemplate.env ?? {}) },
        headers: { ...(app.serverTemplate.headers ?? {}) },
        url: targetUrl,
        workingDirectory: payload.workingDirectory ?? null,
        acesso: payload.acesso ?? { mode: "everyone", agentIds: [] },
        origemAppSlug: app.slug,
        contaRotulo,
        ativo: true,
      });

      if (payload.skipProbe) {
        deps.mcpGateway?.refreshProxyRoutes();
        return {
          ok: true,
          kind: "local",
          appSlug: app.slug,
          mcpId: saved.mcp_id,
          contaRotulo,
          server: saved,
        };
      }

      const probe = await catalog_probeSavedServer(deps, saved.mcp_id);
      deps.mcpGateway?.refreshProxyRoutes();
      const updatedServer = deps.mcpStore.getServer(saved.mcp_id, false) ?? saved;

      return {
        ok: probe.status === "passed",
        kind: "local",
        appSlug: app.slug,
        mcpId: saved.mcp_id,
        contaRotulo,
        server: updatedServer,
        probe,
      };
    }

    // Fluxo 3: OAuth 2.1 PKCE (suporta múltiplas contas #account-N)
    if (!deps.oauthProvider) {
      throw new CatalogServiceError(
        "Provedor OAuth 2.1 MCP não configurado neste servidor.",
        "OAUTH_UNAVAILABLE"
      );
    }

    const oauthUrl =
      payload.url?.trim() || authFlow?.defaultUrl?.trim() || app.serverTemplate?.url?.trim() || "";
    if (!oauthUrl) {
      throw new CatalogServiceError(
        `O aplicativo '${app.name}' não possui endpoint Streamable HTTP definido para OAuth.`,
        "MISSING_OAUTH_URL"
      );
    }

    const { mcpId, serverName, contaRotulo } = catalog_allocateServerIdentity(deps, app, payload);
    const saved = deps.mcpStore.saveServer({
      mcp_id: mcpId,
      nome: serverName,
      transporte: "http",
      comando: "",
      args: [],
      env: {},
      headers: { ...(app.serverTemplate?.headers ?? {}) },
      url: oauthUrl,
      workingDirectory: null,
      acesso: payload.acesso ?? { mode: "everyone", agentIds: [] },
      origemAppSlug: app.slug,
      contaRotulo,
      ativo: true,
    });

    const contaChave = `${saved.mcp_id}#${contaRotulo.replace(/^#/, "")}`;
    const authFlowResult = await deps.oauthProvider.startAuthorizationFlow({
      mcpId: saved.mcp_id,
      appSlug: app.slug,
      serverUrl: oauthUrl,
      contaChave,
      callbackBaseUrl: payload.callbackBaseUrl,
      useLoopbackListener: payload.useLoopbackListener,
      clientIdOverride: payload.clientIdOverride,
      clientSecretOverride: payload.clientSecretOverride,
    });

    deps.mcpGateway?.refreshProxyRoutes();

    return {
      ok: true,
      kind: "oauth",
      appSlug: app.slug,
      mcpId: saved.mcp_id,
      contaRotulo,
      contaChave: authFlowResult.contaChave,
      authorizeUrl: authFlowResult.authorizeUrl,
      state: authFlowResult.state,
      redirectUri: authFlowResult.redirectUri,
      server: saved,
    };
  }
