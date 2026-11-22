import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  BrowserProxyProtocol,
  BrowserSnapshotResult,
  BrowserStatusReport,
  BrowserTabSummary,
  BrowserTakeoverReason,
  BrowserTakeoverSession,
  BrowserTargetSelector,
  PermissionLevel,
  UserBrowsingStep,
} from "@criativo/contracts";
import {
  assertSafeNavigationUrl,
  assertSafeUploadPaths,
  buildSemanticSnapshot,
  isSensitiveFieldHint,
  resolveBrowserTarget,
} from "../browser-snapshot.ts";
import { SHARED_BROWSER_PROFILE_ID, inferProxyProtocol, normalizeProxyServerUrl, type BrowserAutomationRuntimeContext, type BrowserProfile } from "./browser-types.ts";

export function ensureDefaultSharedBrowserProfile(ctx: BrowserAutomationRuntimeContext): BrowserProfileInfo {
    const existing = ctx.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(SHARED_BROWSER_PROFILE_ID) as BrowserProfile | undefined;

    if (!existing) {
      const userDataDir = resolve(ctx.workspaceRoot, "dados", "browser-profiles", SHARED_BROWSER_PROFILE_ID);
      mkdirSync(userDataDir, { recursive: true });
      const agora = new Date().toISOString();
      ctx.db.connection
        .prepare(
          `INSERT INTO projecao_perfis_navegador (
            perfil_id, nome, user_data_dir, proxy_url, ultimo_uso_em, cor_hex, proxy_json, criado_em
          ) VALUES (?, 'Perfil Compartilhado', ?, NULL, ?, '#979797', '{}', ?);`,
        )
        .run(SHARED_BROWSER_PROFILE_ID, userDataDir, agora, agora);
    }

    return getBrowserProfileInfo(ctx, SHARED_BROWSER_PROFILE_ID)!;
  }

export function ensureBrowserProfile(
  ctx: BrowserAutomationRuntimeContext,
nome: string, proxyUrl?: string): BrowserProfile {
    const existing = ctx.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE nome = ? LIMIT 1;")
      .get(nome) as unknown as BrowserProfile | undefined;
    if (existing) return existing;

    const perfilId = `prf-${randomUUID().slice(0, 8)}`;
    const userDataDir = resolve(ctx.workspaceRoot, "dados", "browser-profiles", perfilId);
    mkdirSync(userDataDir, { recursive: true });
    const agora = new Date().toISOString();

    ctx.db.runInTransaction(() => {
      ctx.db.connection
        .prepare(
          `INSERT INTO projecao_perfis_navegador (
            perfil_id, nome, user_data_dir, proxy_url, ultimo_uso_em, cor_hex, proxy_json, criado_em
          ) VALUES (?, ?, ?, ?, ?, '#42A0FF', ?, ?);`,
        )
        .run(
          perfilId,
          nome,
          userDataDir,
          proxyUrl ?? null,
          agora,
          JSON.stringify(proxyUrl ? { server: proxyUrl } : {}),
          agora,
        );
    });

    return ctx.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(perfilId) as unknown as BrowserProfile;
  }

export function sanitizeBrowserProxyForClient(
  ctx: BrowserAutomationRuntimeContext,
rawJson?: string | null): BrowserProfileProxyPayload {
    if (!rawJson) return {};
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      return {
        proxy_id: typeof parsed.proxy_id === "string" ? parsed.proxy_id : null,
        server: typeof parsed.server === "string" ? parsed.server : null,
        username: typeof parsed.username === "string" ? parsed.username : null,
        password_vault_key:
          typeof parsed.password_vault_key === "string" ? parsed.password_vault_key : null,
      };
    } catch {
      return {};
    }
  }

export function mapBrowserProfileRow(
  ctx: BrowserAutomationRuntimeContext,
row: BrowserProfile): BrowserProfileInfo {
    const agentCountRow = ctx.db.connection
      .prepare(
        row.perfil_id === SHARED_BROWSER_PROFILE_ID
          ? "SELECT COUNT(*) AS c FROM projecao_agentes WHERE browser_profile_id IS NULL OR browser_profile_id = 'shared';"
          : "SELECT COUNT(*) AS c FROM projecao_agentes WHERE browser_profile_id = ?;",
      )
      .get(...(row.perfil_id === SHARED_BROWSER_PROFILE_ID ? [] : [row.perfil_id])) as { c: number };

    const proxy = sanitizeBrowserProxyForClient(ctx, row.proxy_json);
    return {
      perfil_id: row.perfil_id,
      nome: row.nome,
      cor_hex: row.cor_hex || (row.perfil_id === SHARED_BROWSER_PROFILE_ID ? "#979797" : "#42A0FF"),
      user_data_dir: row.user_data_dir,
      cdp_porta: row.cdp_porta ?? null,
      proxy_url: row.proxy_url ?? proxy.server ?? null,
      proxy,
      agentes_count: Number(agentCountRow?.c ?? 0),
      abas_count: ctx.sessionManager.countProfileTabs(row.perfil_id),
      compartilhado: row.perfil_id === SHARED_BROWSER_PROFILE_ID,
      criado_em: row.criado_em ?? null,
      ultimo_uso_em: row.ultimo_uso_em ?? null,
    };
  }

export function getBrowserProfileInfo(
  ctx: BrowserAutomationRuntimeContext,
perfilId: string): BrowserProfileInfo | null {
    const row = ctx.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(perfilId) as BrowserProfile | undefined;
    return row ? mapBrowserProfileRow(ctx, row) : null;
  }

export function listBrowserProfiles(ctx: BrowserAutomationRuntimeContext): BrowserProfileInfo[] {
    ensureDefaultSharedBrowserProfile(ctx);
    const rows = ctx.db.connection
      .prepare(
        `SELECT * FROM projecao_perfis_navegador
         ORDER BY CASE WHEN perfil_id = 'shared' THEN 0 ELSE 1 END ASC, criado_em ASC, nome ASC;`,
      )
      .all() as unknown as BrowserProfile[];
    return rows.map((r) => mapBrowserProfileRow(ctx, r));
  }

export function createBrowserProfile(
  ctx: BrowserAutomationRuntimeContext,
input: {
    nome: string;
    cor_hex?: string;
    proxy_json?: BrowserProfileProxyPayload;
  }): BrowserProfileInfo {
    const nome = input.nome?.trim();
    if (!nome) throw new Error("Informe o nome do perfil de navegador.");
    const corHex =
      input.cor_hex && /^#[0-9a-fA-F]{6}$/.test(input.cor_hex) ? input.cor_hex : "#42A0FF";
    const perfilId = `prf-${randomUUID().slice(0, 8)}`;
    const userDataDir = resolve(ctx.workspaceRoot, "dados", "browser-profiles", perfilId);
    mkdirSync(userDataDir, { recursive: true });
    const agora = new Date().toISOString();

    const safeProxy: BrowserProfileProxyPayload = {
      proxy_id: input.proxy_json?.proxy_id ?? null,
      server: input.proxy_json?.server ?? null,
      username: input.proxy_json?.username ?? null,
      password_vault_key: input.proxy_json?.password_vault_key ?? null,
    };

    ctx.db.connection
      .prepare(
        `INSERT INTO projecao_perfis_navegador (
          perfil_id, nome, user_data_dir, proxy_url, ultimo_uso_em, cor_hex, proxy_json, criado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      )
      .run(
        perfilId,
        nome.slice(0, 80),
        userDataDir,
        safeProxy.server ?? null,
        agora,
        corHex,
        JSON.stringify(safeProxy),
        agora,
      );

    return getBrowserProfileInfo(ctx, perfilId)!;
  }

export async function updateBrowserProfile(
  ctx: BrowserAutomationRuntimeContext,

    perfilId: string,
    patch: {
      nome?: string;
      cor_hex?: string;
      cdp_porta?: number | null;
      proxy_json?: BrowserProfileProxyPayload | null;
    },
  ): Promise<{ perfil: BrowserProfileInfo; closedTabs: number }> {
    const existing = ctx.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(perfilId) as BrowserProfile | undefined;
    if (!existing) {
      throw new Error(`Perfil '${perfilId}' não encontrado.`);
    }

    const nextNome =
      patch.nome !== undefined && patch.nome.trim()
        ? patch.nome.trim().slice(0, 80)
        : existing.nome;
    const nextCor =
      patch.cor_hex && /^#[0-9a-fA-F]{6}$/.test(patch.cor_hex)
        ? patch.cor_hex
        : (existing.cor_hex ?? "#42A0FF");

    let nextCdpPort = existing.cdp_porta ?? null;
    let cdpChanged = false;
    if (patch.cdp_porta !== undefined) {
      if (patch.cdp_porta === null) {
        if (nextCdpPort !== null) cdpChanged = true;
        nextCdpPort = null;
      } else {
        const parsedPort = Number(patch.cdp_porta);
        if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
          throw new Error("Porta CDP inválida: informe null ou inteiro entre 1024 e 65535.");
        }
        if (nextCdpPort !== parsedPort) cdpChanged = true;
        nextCdpPort = parsedPort;
      }
    }

    let nextProxyJsonStr = existing.proxy_json ?? "{}";
    let nextProxyUrl = existing.proxy_url;
    let proxyChanged = false;

    if (patch.proxy_json !== undefined) {
      const cleanProxy: BrowserProfileProxyPayload = patch.proxy_json
        ? {
            proxy_id: patch.proxy_json.proxy_id ?? null,
            server: patch.proxy_json.server ?? null,
            username: patch.proxy_json.username ?? null,
            password_vault_key: patch.proxy_json.password_vault_key ?? null,
          }
        : {};
      const candidateStr = JSON.stringify(cleanProxy);
      if (candidateStr !== (existing.proxy_json ?? "{}")) {
        proxyChanged = true;
      }
      nextProxyJsonStr = candidateStr;
      nextProxyUrl = cleanProxy.server ?? null;
    }

    let closedTabs = 0;
    if (proxyChanged || cdpChanged) {
      closedTabs = await ctx.sessionManager.closeProfileContext(perfilId);
    }

    ctx.db.connection
      .prepare(
        `UPDATE projecao_perfis_navegador
         SET nome = ?, cor_hex = ?, cdp_porta = ?, proxy_json = ?, proxy_url = ?
         WHERE perfil_id = ?;`,
      )
      .run(nextNome, nextCor, nextCdpPort, nextProxyJsonStr, nextProxyUrl, perfilId);

    return {
      perfil: getBrowserProfileInfo(ctx, perfilId)!,
      closedTabs,
    };
  }

export async function openBrowserProfileWindow(
  ctx: BrowserAutomationRuntimeContext,

    perfilId: string,
    initialUrl = "about:blank",
  ): Promise<{ tab: BrowserTabSummary; cdpPort?: number | null }> {
    const resolvedId = perfilId.trim() || SHARED_BROWSER_PROFILE_ID;
    ensureDefaultSharedBrowserProfile(ctx);
    const row = ctx.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(resolvedId) as BrowserProfile | undefined;
    if (!row) {
      throw new Error(`Perfil '${resolvedId}' não encontrado.`);
    }

    const { profile, proxy } = ctx.resolveProfileAndLaunchProxy(resolvedId, null);
    const targetUrl =
      initialUrl && initialUrl.trim() && initialUrl.trim() !== "about:blank"
        ? assertSafeNavigationUrl(initialUrl).toString()
        : "about:blank";
    const cdpUrl = profile.cdp_porta ? `http://127.0.0.1:${profile.cdp_porta}` : null;

    const tab = await ctx.sessionManager.openTab({
      perfilId: profile.perfil_id,
      userDataDir: profile.user_data_dir,
      agenteId: null,
      url: targetUrl,
      cdpUrl,
      headless: false,
      proxy,
    });

    ctx.db.connection
      .prepare("UPDATE projecao_perfis_navegador SET ultimo_uso_em = ? WHERE perfil_id = ?;")
      .run(new Date().toISOString(), profile.perfil_id);

    return {
      tab: {
        tabId: tab.tabId,
        perfilId: tab.perfilId,
        agenteId: tab.agenteId,
        url: tab.page ? tab.page.url() : tab.virtualUrl,
        title: tab.virtualTitle,
        revision: tab.revision,
        userControl: tab.userControl,
        screencastActive: tab.screencastActive,
        lastActivityAt: new Date(tab.lastActivityAt).toISOString(),
      },
      cdpPort: profile.cdp_porta ?? null,
    };
  }

export async function clearBrowserProfileStorage(
  ctx: BrowserAutomationRuntimeContext,
perfilId: string): Promise<{ ok: boolean; closedTabs: number }> {
    const existing = ctx.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(perfilId) as BrowserProfile | undefined;
    if (!existing) {
      throw new Error(`Perfil '${perfilId}' não encontrado.`);
    }

    const closedTabs = await ctx.sessionManager.closeProfileContext(perfilId);
    try {
      rmSync(existing.user_data_dir, { recursive: true, force: true });
      mkdirSync(existing.user_data_dir, { recursive: true });
    } catch {
      // ignora lock residual do sistema operacional
    }
    return { ok: true, closedTabs };
  }

export async function deleteBrowserProfile(
  ctx: BrowserAutomationRuntimeContext,
perfilId: string): Promise<{ ok: boolean; reassignedAgents: number }> {
    if (perfilId === SHARED_BROWSER_PROFILE_ID) {
      throw new Error("O Perfil Compartilhado padrão não pode ser removido.");
    }
    const existing = ctx.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(perfilId) as BrowserProfile | undefined;
    if (!existing) {
      throw new Error(`Perfil '${perfilId}' não encontrado.`);
    }

    await ctx.sessionManager.closeProfileContext(perfilId);

    let reassignedAgents = 0;
    ctx.db.runInTransaction(() => {
      const upd = ctx.db.connection
        .prepare("UPDATE projecao_agentes SET browser_profile_id = NULL WHERE browser_profile_id = ?;")
        .run(perfilId);
      reassignedAgents = Number(upd.changes ?? 0);
      ctx.db.connection
        .prepare("DELETE FROM projecao_perfis_navegador WHERE perfil_id = ?;")
        .run(perfilId);
    });

    try {
      rmSync(existing.user_data_dir, { recursive: true, force: true });
    } catch {
      // ignora falha de limpeza em disco
    }

    return { ok: true, reassignedAgents };
  }
