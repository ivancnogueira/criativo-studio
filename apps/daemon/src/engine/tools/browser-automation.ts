/**
 * Motor real de automação Chromium via Chrome DevTools Protocol (`BrowserAutomationService` — BRWS-01, BRWS-02).
 * Gerencia perfis persistentes, proxies autenticados no Cofre AES-256-GCM, 22 ações semânticas CDP,
 * sessões interativas `BrowserTakeover`, preenchimento seguro `submit_secret` e gravação `BrowserTeachBar`.
 */
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
import type { CriativoDatabase } from "../../database/client.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import {
  BrowserCdpSessionManager,
  type HumanCdpInputEvent,
  type ManagedTabEntry,
} from "./browser-cdp-session.ts";
import {
  assertSafeNavigationUrl,
  assertSafeUploadPaths,
  buildSemanticSnapshot,
  isSensitiveFieldHint,
  resolveBrowserTarget,
} from "./browser-snapshot.ts";
import { UserBrowsingLogService } from "./user-browsing-log.ts";

export const SHARED_BROWSER_PROFILE_ID = "shared";
export const BROWSER_FILL_FIELDS_MAX_FIELDS = 16;
export const BROWSER_FILL_FIELDS_MAX_TEXT_BYTES = 16_384;

export interface BrowserProfile {
  perfil_id: string;
  nome: string;
  user_data_dir: string;
  proxy_url: string | null;
  ultimo_uso_em: string | null;
  cor_hex?: string;
  cdp_porta?: number | null;
  proxy_json?: string;
  criado_em?: string | null;
}

export interface BrowserNavigationParams {
  url: string;
  perfil_id?: string;
  extract_mode?: "text" | "links" | "screenshot_plan";
}

export interface BrowserNavigationResult {
  url: string;
  status: number;
  title: string;
  textPreview: string;
  perfil_id: string;
}

export type BrowserCdpActionName =
  | "open"
  | "list_tabs"
  | "status"
  | "navigate"
  | "click"
  | "type"
  | "fill_fields"
  | "press"
  | "hover"
  | "scroll"
  | "select_option"
  | "set_checked"
  | "drag"
  | "upload_files"
  | "wait_for"
  | "snapshot"
  | "screenshot"
  | "evaluate"
  | "handle_dialog"
  | "set_environment"
  | "close_tab"
  | "request_takeover"
  | "submit_secret";

export interface BrowserExecuteActionInput {
  action: BrowserCdpActionName;
  agenteId?: string | null;
  canalId?: string | null;
  perfilId?: string | null;
  permissionLevel?: PermissionLevel;
  tabId?: string;
  url?: string;
  target?: BrowserTargetSelector;
  toTarget?: BrowserTargetSelector;
  text?: string;
  clear?: boolean;
  pressEnter?: boolean;
  key?: string;
  fields?: Array<{ target: BrowserTargetSelector; value: string }>;
  deltaX?: number;
  deltaY?: number;
  values?: string[];
  checked?: boolean;
  paths?: string[];
  waitKind?: "text" | "selector" | "url" | "load";
  waitValue?: string;
  timeoutMs?: number;
  image?: boolean;
  expression?: string;
  accept?: boolean;
  promptText?: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  timezoneId?: string;
  colorScheme?: "dark" | "light";
  reason?: BrowserTakeoverReason;
  waitForTakeover?: boolean;
}

interface ProxyRow {
  proxy_id: string;
  nome: string;
  servidor: string;
  usuario: string | null;
  senha_vault_chave: string | null;
  ativo: number;
  criado_em: string;
  atualizado_em: string;
}

interface PendingTakeoverEntry {
  session: BrowserTakeoverSession;
  resolvers: Array<(res: { decision: "complete" | "cancel"; snapshot?: BrowserSnapshotResult }) => void>;
}

function inferProxyProtocol(server: string): BrowserProxyProtocol {
  const lower = server.trim().toLowerCase();
  if (lower.startsWith("socks5://") || lower.startsWith("socks://")) return "socks5";
  if (lower.startsWith("https://")) return "https";
  return "http";
}

function normalizeProxyServerUrl(server: string): string {
  const trimmed = server.trim();
  if (!trimmed) throw new Error("Informe o endereço 'servidor' do proxy (ex.: http://host:8080).");
  if (/^(https?|socks5):\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

export class BrowserAutomationService {
  private readonly db: CriativoDatabase;
  private readonly vault?: VaultService;
  private wsHub?: WebSocketHub;
  private readonly workspaceRoot: string;
  public readonly sessionManager: BrowserCdpSessionManager;
  public readonly browsingLog: UserBrowsingLogService;
  private readonly activeTakeovers = new Map<string, PendingTakeoverEntry>();

  constructor(
    db: CriativoDatabase,
    vault?: VaultService,
    wsHub?: WebSocketHub,
    workspaceRoot?: string,
  ) {
    this.db = db;
    this.vault = vault;
    this.wsHub = wsHub;
    this.workspaceRoot = resolve(workspaceRoot ?? process.cwd());
    this.sessionManager = new BrowserCdpSessionManager(this.workspaceRoot);
    this.browsingLog = new UserBrowsingLogService(db);
  }

  public setWebSocketHub(wsHub: WebSocketHub): void {
    this.wsHub = wsHub;
  }

  // ===========================================================================
  // 1. Perfis Persistentes & Proxies (Cifrados no VaultService)
  // ===========================================================================

  public ensureDefaultSharedProfile(): BrowserProfileInfo {
    const existing = this.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(SHARED_BROWSER_PROFILE_ID) as BrowserProfile | undefined;

    if (!existing) {
      const userDataDir = resolve(this.workspaceRoot, "dados", "browser-profiles", SHARED_BROWSER_PROFILE_ID);
      mkdirSync(userDataDir, { recursive: true });
      const agora = new Date().toISOString();
      this.db.connection
        .prepare(
          `INSERT INTO projecao_perfis_navegador (
            perfil_id, nome, user_data_dir, proxy_url, ultimo_uso_em, cor_hex, proxy_json, criado_em
          ) VALUES (?, 'Perfil Compartilhado', ?, NULL, ?, '#979797', '{}', ?);`,
        )
        .run(SHARED_BROWSER_PROFILE_ID, userDataDir, agora, agora);
    }

    return this.getProfileInfo(SHARED_BROWSER_PROFILE_ID)!;
  }

  public ensureProfile(nome: string, proxyUrl?: string): BrowserProfile {
    const existing = this.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE nome = ? LIMIT 1;")
      .get(nome) as unknown as BrowserProfile | undefined;
    if (existing) return existing;

    const perfilId = `prf-${randomUUID().slice(0, 8)}`;
    const userDataDir = resolve(this.workspaceRoot, "dados", "browser-profiles", perfilId);
    mkdirSync(userDataDir, { recursive: true });
    const agora = new Date().toISOString();

    this.db.runInTransaction(() => {
      this.db.connection
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

    return this.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(perfilId) as unknown as BrowserProfile;
  }

  private sanitizeProxyForClient(rawJson?: string | null): BrowserProfileProxyPayload {
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

  private mapProfileRow(row: BrowserProfile): BrowserProfileInfo {
    const agentCountRow = this.db.connection
      .prepare(
        row.perfil_id === SHARED_BROWSER_PROFILE_ID
          ? "SELECT COUNT(*) AS c FROM projecao_agentes WHERE browser_profile_id IS NULL OR browser_profile_id = 'shared';"
          : "SELECT COUNT(*) AS c FROM projecao_agentes WHERE browser_profile_id = ?;",
      )
      .get(...(row.perfil_id === SHARED_BROWSER_PROFILE_ID ? [] : [row.perfil_id])) as { c: number };

    const proxy = this.sanitizeProxyForClient(row.proxy_json);
    return {
      perfil_id: row.perfil_id,
      nome: row.nome,
      cor_hex: row.cor_hex || (row.perfil_id === SHARED_BROWSER_PROFILE_ID ? "#979797" : "#42A0FF"),
      user_data_dir: row.user_data_dir,
      cdp_porta: row.cdp_porta ?? null,
      proxy_url: row.proxy_url ?? proxy.server ?? null,
      proxy,
      agentes_count: Number(agentCountRow?.c ?? 0),
      abas_count: this.sessionManager.countProfileTabs(row.perfil_id),
      compartilhado: row.perfil_id === SHARED_BROWSER_PROFILE_ID,
      criado_em: row.criado_em ?? null,
      ultimo_uso_em: row.ultimo_uso_em ?? null,
    };
  }

  public getProfileInfo(perfilId: string): BrowserProfileInfo | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(perfilId) as BrowserProfile | undefined;
    return row ? this.mapProfileRow(row) : null;
  }

  public listProfiles(): BrowserProfileInfo[] {
    this.ensureDefaultSharedProfile();
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM projecao_perfis_navegador
         ORDER BY CASE WHEN perfil_id = 'shared' THEN 0 ELSE 1 END ASC, criado_em ASC, nome ASC;`,
      )
      .all() as unknown as BrowserProfile[];
    return rows.map((r) => this.mapProfileRow(r));
  }

  public createProfile(input: {
    nome: string;
    cor_hex?: string;
    proxy_json?: BrowserProfileProxyPayload;
  }): BrowserProfileInfo {
    const nome = input.nome?.trim();
    if (!nome) throw new Error("Informe o nome do perfil de navegador.");
    const corHex =
      input.cor_hex && /^#[0-9a-fA-F]{6}$/.test(input.cor_hex) ? input.cor_hex : "#42A0FF";
    const perfilId = `prf-${randomUUID().slice(0, 8)}`;
    const userDataDir = resolve(this.workspaceRoot, "dados", "browser-profiles", perfilId);
    mkdirSync(userDataDir, { recursive: true });
    const agora = new Date().toISOString();

    const safeProxy: BrowserProfileProxyPayload = {
      proxy_id: input.proxy_json?.proxy_id ?? null,
      server: input.proxy_json?.server ?? null,
      username: input.proxy_json?.username ?? null,
      password_vault_key: input.proxy_json?.password_vault_key ?? null,
    };

    this.db.connection
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

    return this.getProfileInfo(perfilId)!;
  }

  public async updateProfile(
    perfilId: string,
    patch: {
      nome?: string;
      cor_hex?: string;
      cdp_porta?: number | null;
      proxy_json?: BrowserProfileProxyPayload | null;
    },
  ): Promise<{ perfil: BrowserProfileInfo; closedTabs: number }> {
    const existing = this.db.connection
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
      closedTabs = await this.sessionManager.closeProfileContext(perfilId);
    }

    this.db.connection
      .prepare(
        `UPDATE projecao_perfis_navegador
         SET nome = ?, cor_hex = ?, cdp_porta = ?, proxy_json = ?, proxy_url = ?
         WHERE perfil_id = ?;`,
      )
      .run(nextNome, nextCor, nextCdpPort, nextProxyJsonStr, nextProxyUrl, perfilId);

    return {
      perfil: this.getProfileInfo(perfilId)!,
      closedTabs,
    };
  }

  public async openProfileWindow(
    perfilId: string,
    initialUrl = "about:blank",
  ): Promise<{ tab: BrowserTabSummary; cdpPort?: number | null }> {
    const resolvedId = perfilId.trim() || SHARED_BROWSER_PROFILE_ID;
    this.ensureDefaultSharedProfile();
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(resolvedId) as BrowserProfile | undefined;
    if (!row) {
      throw new Error(`Perfil '${resolvedId}' não encontrado.`);
    }

    const { profile, proxy } = this.resolveProfileAndLaunchProxy(resolvedId, null);
    const targetUrl =
      initialUrl && initialUrl.trim() && initialUrl.trim() !== "about:blank"
        ? assertSafeNavigationUrl(initialUrl).toString()
        : "about:blank";
    const cdpUrl = profile.cdp_porta ? `http://127.0.0.1:${profile.cdp_porta}` : null;

    const tab = await this.sessionManager.openTab({
      perfilId: profile.perfil_id,
      userDataDir: profile.user_data_dir,
      agenteId: null,
      url: targetUrl,
      cdpUrl,
      headless: false,
      proxy,
    });

    this.db.connection
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

  public async clearProfileStorage(perfilId: string): Promise<{ ok: boolean; closedTabs: number }> {
    const existing = this.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(perfilId) as BrowserProfile | undefined;
    if (!existing) {
      throw new Error(`Perfil '${perfilId}' não encontrado.`);
    }

    const closedTabs = await this.sessionManager.closeProfileContext(perfilId);
    try {
      rmSync(existing.user_data_dir, { recursive: true, force: true });
      mkdirSync(existing.user_data_dir, { recursive: true });
    } catch {
      // ignora lock residual do sistema operacional
    }
    return { ok: true, closedTabs };
  }

  public async deleteProfile(perfilId: string): Promise<{ ok: boolean; reassignedAgents: number }> {
    if (perfilId === SHARED_BROWSER_PROFILE_ID) {
      throw new Error("O Perfil Compartilhado padrão não pode ser removido.");
    }
    const existing = this.db.connection
      .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
      .get(perfilId) as BrowserProfile | undefined;
    if (!existing) {
      throw new Error(`Perfil '${perfilId}' não encontrado.`);
    }

    await this.sessionManager.closeProfileContext(perfilId);

    let reassignedAgents = 0;
    this.db.runInTransaction(() => {
      const upd = this.db.connection
        .prepare("UPDATE projecao_agentes SET browser_profile_id = NULL WHERE browser_profile_id = ?;")
        .run(perfilId);
      reassignedAgents = Number(upd.changes ?? 0);
      this.db.connection
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

  public listProxies(): BrowserProxyConfig[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM projecao_browser_proxies ORDER BY criado_em DESC;")
      .all() as unknown as ProxyRow[];

    return rows.map((r) => ({
      proxy_id: r.proxy_id,
      nome: r.nome,
      servidor: r.servidor,
      protocolo: inferProxyProtocol(r.servidor),
      usuario: r.usuario,
      senha_configurada: Boolean(r.senha_vault_chave),
      ativo: Boolean(r.ativo),
      criado_em: r.criado_em,
      atualizado_em: r.atualizado_em,
    }));
  }

  public saveProxy(input: {
    proxy_id?: string;
    nome: string;
    servidor: string;
    usuario?: string | null;
    senha?: string | null;
    ativo?: boolean;
  }): BrowserProxyConfig {
    const nome = input.nome?.trim();
    if (!nome) throw new Error("Informe o nome do proxy.");
    const servidor = normalizeProxyServerUrl(input.servidor);
    const proxyId = input.proxy_id?.trim() || `prx-${randomUUID().slice(0, 8)}`;
    const agora = new Date().toISOString();

    const prev = this.db.connection
      .prepare("SELECT * FROM projecao_browser_proxies WHERE proxy_id = ? LIMIT 1;")
      .get(proxyId) as ProxyRow | undefined;

    let vaultKey: string | null = prev?.senha_vault_chave ?? null;
    if (typeof input.senha === "string" && input.senha.trim().length > 0) {
      if (!this.vault) {
        throw new Error("VaultService não inicializado para cifrar senha do proxy.");
      }
      vaultKey = `browser_proxy:${proxyId}`;
      this.vault.setSecret(vaultKey, input.senha.trim());
    }

    const usuario =
      input.usuario !== undefined ? (input.usuario?.trim() || null) : (prev?.usuario ?? null);
    const ativoInt = input.ativo === false ? 0 : 1;

    this.db.connection
      .prepare(
        `INSERT INTO projecao_browser_proxies (
          proxy_id, nome, servidor, usuario, senha_vault_chave, ativo, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(proxy_id) DO UPDATE SET
          nome = excluded.nome,
          servidor = excluded.servidor,
          usuario = excluded.usuario,
          senha_vault_chave = excluded.senha_vault_chave,
          ativo = excluded.ativo,
          atualizado_em = excluded.atualizado_em;`,
      )
      .run(proxyId, nome.slice(0, 80), servidor, usuario, vaultKey, ativoInt, prev?.criado_em ?? agora, agora);

    return this.listProxies().find((p) => p.proxy_id === proxyId)!;
  }

  public deleteProxy(proxyId: string): boolean {
    const prev = this.db.connection
      .prepare("SELECT * FROM projecao_browser_proxies WHERE proxy_id = ? LIMIT 1;")
      .get(proxyId) as ProxyRow | undefined;
    if (!prev) return false;

    if (prev.senha_vault_chave && this.vault) {
      this.vault.deleteSecret(prev.senha_vault_chave);
    }

    this.db.connection
      .prepare("DELETE FROM projecao_browser_proxies WHERE proxy_id = ?;")
      .run(proxyId);
    return true;
  }

  private resolveProfileAndLaunchProxy(
    requestedProfileId?: string | null,
    agenteId?: string | null,
  ): {
    profile: BrowserProfile;
    proxy: { server: string; username?: string; password?: string } | null;
  } {
    this.ensureDefaultSharedProfile();

    let effectiveId = requestedProfileId?.trim() || null;
    if (!effectiveId && agenteId) {
      const agRow = this.db.connection
        .prepare("SELECT browser_profile_id FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
        .get(agenteId) as { browser_profile_id?: string | null } | undefined;
      effectiveId = agRow?.browser_profile_id ?? null;
    }

    let profile: BrowserProfile | undefined;
    if (effectiveId === "agent" && agenteId) {
      const dedicatedId = `agent-${agenteId}`;
      profile = this.db.connection
        .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
        .get(dedicatedId) as BrowserProfile | undefined;
      if (!profile) {
        const userDataDir = resolve(this.workspaceRoot, "dados", "browser-profiles", dedicatedId);
        mkdirSync(userDataDir, { recursive: true });
        const agora = new Date().toISOString();
        this.db.connection
          .prepare(
            `INSERT INTO projecao_perfis_navegador (
              perfil_id, nome, user_data_dir, proxy_url, ultimo_uso_em, cor_hex, proxy_json, criado_em
            ) VALUES (?, ?, ?, NULL, ?, '#31CF76', '{}', ?);`,
          )
          .run(dedicatedId, `Exclusivo (${agenteId})`, userDataDir, agora, agora);
        profile = this.db.connection
          .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
          .get(dedicatedId) as unknown as BrowserProfile;
      }
    } else if (effectiveId) {
      profile = this.db.connection
        .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
        .get(effectiveId) as unknown as BrowserProfile | undefined;
    }

    if (!profile) {
      profile = this.db.connection
        .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
        .get(SHARED_BROWSER_PROFILE_ID) as unknown as BrowserProfile;
    }

    const proxyMeta = this.sanitizeProxyForClient(profile.proxy_json);
    let resolvedProxy: { server: string; username?: string; password?: string } | null = null;

    if (proxyMeta.proxy_id) {
      const proxyRow = this.db.connection
        .prepare("SELECT * FROM projecao_browser_proxies WHERE proxy_id = ? AND ativo = 1 LIMIT 1;")
        .get(proxyMeta.proxy_id) as ProxyRow | undefined;
      if (proxyRow) {
        const decryptedPass =
          proxyRow.senha_vault_chave && this.vault
            ? this.vault.getSecret(proxyRow.senha_vault_chave) ?? undefined
            : undefined;
        resolvedProxy = {
          server: proxyRow.servidor,
          ...(proxyRow.usuario ? { username: proxyRow.usuario } : {}),
          ...(decryptedPass ? { password: decryptedPass } : {}),
        };
      }
    } else if (proxyMeta.server || profile.proxy_url) {
      const decryptedPass =
        proxyMeta.password_vault_key && this.vault
          ? this.vault.getSecret(proxyMeta.password_vault_key) ?? undefined
          : undefined;
      resolvedProxy = {
        server: (proxyMeta.server ?? profile.proxy_url)!,
        ...(proxyMeta.username ? { username: proxyMeta.username } : {}),
        ...(decryptedPass ? { password: decryptedPass } : {}),
      };
    }

    return { profile, proxy: resolvedProxy };
  }

  public getStatus(agenteId?: string): BrowserStatusReport {
    const bin = this.sessionManager.detectBinary();
    const tabs = this.sessionManager.listTabSummaries(agenteId);
    return {
      available: bin.available,
      executablePath: bin.executablePath,
      reason: bin.reason ?? null,
      activeContexts: this.sessionManager.getActiveContextCount(),
      activeTabs: tabs.length,
      tabs,
    };
  }

  // ===========================================================================
  // 2. Retrocompatibilidade inspectPublicPage (CDP real + fallback HTTP seguro)
  // ===========================================================================

  public async inspectPublicPage(
    params: BrowserNavigationParams,
  ): Promise<BrowserNavigationResult> {
    const parsedUrl = assertSafeNavigationUrl(params.url);
    const bin = this.sessionManager.detectBinary();

    if (bin.available && process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1") {
      try {
        const opened = (await this.executeAction({
          action: "open",
          url: parsedUrl.toString(),
          perfilId: params.perfil_id ?? SHARED_BROWSER_PROFILE_ID,
        })) as BrowserSnapshotResult;
        await this.sessionManager.closeTab(opened.tabId);
        return {
          url: opened.url,
          status: 200,
          title: opened.title || parsedUrl.hostname,
          textPreview: opened.textSummary.slice(0, 1500),
          perfil_id: opened.perfilId,
        };
      } catch {
        // Fallback gracioso para leitura HTTP leve caso o host headless restrinja sandbox
      }
    }

    const profile = params.perfil_id
      ? ((this.db.connection
          .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
          .get(params.perfil_id) as unknown as BrowserProfile | undefined) ??
        this.ensureProfile("perfil-pesquisa-padrao"))
      : this.ensureProfile("perfil-pesquisa-padrao");

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "CriativoAIStudio-ResearchBot/2.0",
        Accept: "text/html,application/xhtml+xml,application/json",
      },
    });
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1]!.trim() : parsedUrl.hostname;
    const textPreview = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1500);

    this.db.connection
      .prepare("UPDATE projecao_perfis_navegador SET ultimo_uso_em = ? WHERE perfil_id = ?;")
      .run(new Date().toISOString(), profile.perfil_id);

    return {
      url: parsedUrl.toString(),
      status: response.status,
      title,
      textPreview,
      perfil_id: profile.perfil_id,
    };
  }

  // ===========================================================================
  // 3. Execução das 22 Ações Semânticas CDP (BRWS-01)
  // ===========================================================================

  private requireRealTab(tabId?: string): ManagedTabEntry {
    if (!tabId) {
      throw new Error("Informe 'tabId' da aba ativa para executar esta ação.");
    }
    const entry = this.sessionManager.getTab(tabId);
    if (!entry) {
      throw new Error(`Aba '${tabId}' não encontrada ou já encerrada.`);
    }
    if (entry.userControl) {
      throw new Error(
        `A aba '${tabId}' está atualmente sob controle interativo humano (BrowserTakeover). Aguarde o usuário concluir a sessão.`,
      );
    }
    if (!entry.page) {
      throw new Error(`A aba '${tabId}' não possui página Chromium ativa neste ambiente.`);
    }
    entry.lastActivityAt = Date.now();
    return entry;
  }

  private async captureTabSnapshot(
    entry: ManagedTabEntry,
    includeImage = false,
  ): Promise<BrowserSnapshotResult> {
    if (!entry.page) {
      return {
        tabId: entry.tabId,
        perfilId: entry.perfilId,
        url: entry.virtualUrl,
        title: entry.virtualTitle,
        revision: entry.revision,
        elements: [],
        textSummary: `Página: ${entry.virtualTitle} — ${entry.virtualUrl}`,
        truncated: false,
      };
    }
    const { snapshot, refMap } = await buildSemanticSnapshot(
      entry.page,
      entry.tabId,
      entry.perfilId,
      entry.revision,
      includeImage,
    );
    entry.snapshotRefs = refMap;
    entry.virtualUrl = snapshot.url;
    entry.virtualTitle = snapshot.title;
    return snapshot;
  }

  public async executeAction(input: BrowserExecuteActionInput): Promise<unknown> {
    const action = input.action;

    switch (action) {
      case "status":
        return this.getStatus(input.agenteId ?? undefined);

      case "list_tabs":
        return { tabs: this.sessionManager.listTabSummaries(input.agenteId ?? undefined) };

      case "open": {
        const safeUrl = assertSafeNavigationUrl(input.url ?? "");
        const { profile, proxy } = this.resolveProfileAndLaunchProxy(input.perfilId, input.agenteId);

        const tab = await this.sessionManager.openTab({
          perfilId: profile.perfil_id,
          userDataDir: profile.user_data_dir,
          agenteId: input.agenteId ?? null,
          url: safeUrl.toString(),
          cdpUrl: profile.cdp_porta ? `http://127.0.0.1:${profile.cdp_porta}` : null,
          proxy,
          onPageNavigated: (t, navUrl, navTitle) => {
            if (t.teachRecording && t.agenteId) {
              this.browsingLog.recordStep(t.agenteId, {
                kind: "page",
                url: navUrl,
                title: navTitle,
              });
              this.broadcastTeachStatus(t);
            }
          },
        });

        this.db.connection
          .prepare("UPDATE projecao_perfis_navegador SET ultimo_uso_em = ? WHERE perfil_id = ?;")
          .run(new Date().toISOString(), profile.perfil_id);

        return await this.captureTabSnapshot(tab, Boolean(input.image));
      }

      case "navigate": {
        const entry = this.requireRealTab(input.tabId);
        const safeUrl = assertSafeNavigationUrl(input.url ?? "");
        await entry.page!.goto(safeUrl.toString(), {
          waitUntil: "domcontentloaded",
          timeout: Math.min(Math.max(input.timeoutMs ?? 25_000, 1000), 60_000),
        });
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, Boolean(input.image));
      }

      case "snapshot": {
        const tab = input.tabId ? this.sessionManager.getTab(input.tabId) : null;
        if (!tab) {
          throw new Error(`Aba '${input.tabId ?? ""}' não encontrada.`);
        }
        return await this.captureTabSnapshot(tab, Boolean(input.image));
      }

      case "click": {
        const entry = this.requireRealTab(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em click.");
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        if (resolved.point) {
          await entry.page!.mouse.click(resolved.point.x, resolved.point.y);
        } else if (resolved.locator) {
          await resolved.locator.click({ timeout: 10_000 });
        }
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "type": {
        const entry = this.requireRealTab(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em type.");
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        if (resolved.meta?.isSensitive) {
          throw new Error(
            "Campo classificado como sensível (senha/OTP/cartão). Utilize 'submit_secret' ou 'request_takeover' para proteger a credencial.",
          );
        }
        const text = String(input.text ?? "");
        if (resolved.locator) {
          if (input.clear !== false) {
            await resolved.locator.fill(text, { timeout: 10_000 });
          } else {
            await resolved.locator.pressSequentially(text, { timeout: 10_000 });
          }
          if (input.pressEnter) {
            await resolved.locator.press("Enter");
          }
        }
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "fill_fields": {
        const entry = this.requireRealTab(input.tabId);
        const fields = Array.isArray(input.fields) ? input.fields : [];
        if (fields.length < 1 || fields.length > BROWSER_FILL_FIELDS_MAX_FIELDS) {
          throw new Error(
            `fill_fields aceita entre 1 e ${BROWSER_FILL_FIELDS_MAX_FIELDS} campos por chamada.`,
          );
        }

        let totalBytes = 0;
        for (const f of fields) {
          totalBytes += Buffer.byteLength(String(f.value ?? ""), "utf8");
        }
        if (totalBytes > BROWSER_FILL_FIELDS_MAX_TEXT_BYTES) {
          throw new Error(
            `O volume combinado de texto em fill_fields (${totalBytes} bytes) excede o limite de ${BROWSER_FILL_FIELDS_MAX_TEXT_BYTES} bytes.`,
          );
        }

        for (const f of fields) {
          const resolved = resolveBrowserTarget(
            entry.page!,
            f.target,
            entry.snapshotRefs,
            entry.revision,
          );
          if (resolved.meta?.isSensitive) {
            throw new Error(
              `fill_fields recusou o campo sensível '${resolved.meta.ref}'. Use 'submit_secret' ou 'request_takeover'.`,
            );
          }
          if (!resolved.locator) {
            throw new Error("fill_fields requer seletores de elemento (ref, role, text ou css).");
          }
          const elAttrs = await resolved.locator.evaluate((el) => {
            const node = el as unknown as { getAttribute(attr: string): string | null };
            return {
              type: node.getAttribute("type") || "",
              autocomplete: node.getAttribute("autocomplete") || "",
              name: node.getAttribute("name") || "",
              id: node.getAttribute("id") || "",
              ariaLabel: node.getAttribute("aria-label") || "",
            };
          });
          if (isSensitiveFieldHint(elAttrs)) {
            throw new Error(
              "fill_fields detectou campo de senha/OTP/cartão no DOM e abortou o preenchimento por segurança.",
            );
          }
          await resolved.locator.fill(String(f.value ?? ""), { timeout: 10_000 });
        }

        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "press": {
        const entry = this.requireRealTab(input.tabId);
        const key = input.key?.trim();
        if (!key) throw new Error("Informe a tecla em 'key' (ex.: 'Enter', 'Escape', 'Tab').");
        if (input.target) {
          const resolved = resolveBrowserTarget(
            entry.page!,
            input.target,
            entry.snapshotRefs,
            entry.revision,
          );
          await resolved.locator?.press(key, { timeout: 8_000 });
        } else {
          await entry.page!.keyboard.press(key);
        }
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "hover": {
        const entry = this.requireRealTab(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em hover.");
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        if (resolved.point) {
          await entry.page!.mouse.move(resolved.point.x, resolved.point.y);
        } else {
          await resolved.locator?.hover({ timeout: 8_000 });
        }
        return await this.captureTabSnapshot(entry, false);
      }

      case "scroll": {
        const entry = this.requireRealTab(input.tabId);
        if (input.target && input.target.kind !== "point") {
          const resolved = resolveBrowserTarget(
            entry.page!,
            input.target,
            entry.snapshotRefs,
            entry.revision,
          );
          await resolved.locator?.scrollIntoViewIfNeeded({ timeout: 8_000 });
        } else {
          await entry.page!.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 480);
        }
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "select_option": {
        const entry = this.requireRealTab(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em select_option.");
        const vals = Array.isArray(input.values) ? input.values : [];
        if (vals.length === 0) throw new Error("Informe 'values' em select_option.");
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        await resolved.locator?.selectOption(vals, { timeout: 8_000 });
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "set_checked": {
        const entry = this.requireRealTab(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em set_checked.");
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        await resolved.locator?.setChecked(Boolean(input.checked), { timeout: 8_000 });
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "drag": {
        const entry = this.requireRealTab(input.tabId);
        if (!input.target || !input.toTarget) {
          throw new Error("Informe 'target' e 'toTarget' em drag.");
        }
        const from = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        const to = resolveBrowserTarget(
          entry.page!,
          input.toTarget,
          entry.snapshotRefs,
          entry.revision,
        );
        if (from.locator && to.locator) {
          await from.locator.dragTo(to.locator, { timeout: 10_000 });
        } else if (from.point && to.point) {
          await entry.page!.mouse.move(from.point.x, from.point.y);
          await entry.page!.mouse.down();
          await entry.page!.mouse.move(to.point.x, to.point.y, { steps: 8 });
          await entry.page!.mouse.up();
        }
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "upload_files": {
        const entry = this.requireRealTab(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em upload_files.");
        const safeFiles = assertSafeUploadPaths(
          input.paths ?? [],
          this.workspaceRoot,
          input.agenteId ?? entry.agenteId,
        );
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        await resolved.locator?.setInputFiles(safeFiles, { timeout: 10_000 });
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "wait_for": {
        const entry = this.requireRealTab(input.tabId);
        const timeout = Math.min(Math.max(input.timeoutMs ?? 10_000, 200), 30_000);
        const kind = input.waitKind ?? "load";
        if (kind === "text" && input.waitValue) {
          await entry.page!.getByText(input.waitValue).first().waitFor({ timeout });
        } else if (kind === "selector" && input.waitValue) {
          await entry.page!.locator(input.waitValue).first().waitFor({ timeout });
        } else if (kind === "url" && input.waitValue) {
          await entry.page!.waitForURL(`**/*${input.waitValue}*`, { timeout });
        } else {
          await entry.page!.waitForLoadState("networkidle", { timeout }).catch(() => {});
        }
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "screenshot": {
        const entry = this.requireRealTab(input.tabId);
        const buf = await entry.page!.screenshot({ type: "png" });
        const shotsDir = resolve(this.workspaceRoot, "dados", "browser-screenshots");
        mkdirSync(shotsDir, { recursive: true });
        const fileName = `shot-${entry.tabId}-${Date.now()}.png`;
        const absPath = resolve(shotsDir, fileName);
        writeFileSync(absPath, buf);
        return {
          ok: true,
          tabId: entry.tabId,
          path: absPath,
          dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
        };
      }

      case "evaluate": {
        if (input.permissionLevel === "workspace") {
          throw new Error(
            "A ação 'evaluate' requer nível de permissão 'ask' ou 'full' no agente para executar scripts arbitrários.",
          );
        }
        const entry = this.requireRealTab(input.tabId);
        const expr = input.expression?.trim();
        if (!expr) throw new Error("Informe 'expression' em evaluate.");
        const rawOut = await Promise.race([
          entry.page!.evaluate((code: string) => {
            // Avaliação confinada ao contexto isolado da página remota
            return (0, eval)(code);
          }, expr),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout de 5s atingido em evaluate.")), 5_000),
          ),
        ]);
        const serialized = JSON.stringify(rawOut ?? null)?.slice(0, 16_000) ?? "null";
        return { ok: true, tabId: entry.tabId, result: JSON.parse(serialized) };
      }

      case "handle_dialog": {
        const entry = this.requireRealTab(input.tabId);
        if (!entry.pendingDialogObj) {
          return { ok: false, note: "Nenhum diálogo nativo pendente nesta aba." };
        }
        const dlg = entry.pendingDialogObj;
        entry.pendingDialogObj = null;
        if (input.accept !== false) {
          await dlg.accept(input.promptText);
        } else {
          await dlg.dismiss();
        }
        return { ok: true, handled: entry.lastDialog };
      }

      case "set_environment": {
        const entry = this.requireRealTab(input.tabId);
        if (input.viewport) {
          await entry.page!.setViewportSize({
            width: Math.min(Math.max(320, Math.round(input.viewport.width)), 2560),
            height: Math.min(Math.max(320, Math.round(input.viewport.height)), 1600),
          });
        }
        if (input.colorScheme) {
          await entry.page!.emulateMedia({ colorScheme: input.colorScheme });
        }
        if (input.userAgent && entry.cdpSession) {
          await entry.cdpSession.send("Network.setUserAgentOverride", {
            userAgent: input.userAgent.slice(0, 300),
            ...(input.locale ? { acceptLanguage: input.locale.slice(0, 32) } : {}),
          });
        }
        if (input.timezoneId && entry.cdpSession) {
          await entry.cdpSession
            .send("Emulation.setTimezoneOverride", { timezoneId: input.timezoneId })
            .catch(() => {});
        }
        entry.revision += 1;
        return await this.captureTabSnapshot(entry, false);
      }

      case "close_tab": {
        if (!input.tabId) throw new Error("Informe 'tabId' em close_tab.");
        const closed = await this.sessionManager.closeTab(input.tabId);
        return { ok: closed, tabId: input.tabId };
      }

      case "request_takeover": {
        if (!input.tabId) throw new Error("Informe 'tabId' em request_takeover.");
        return await this.requestTakeover({
          tabId: input.tabId,
          agenteId: input.agenteId ?? null,
          canalId: input.canalId ?? null,
          reason: input.reason ?? "manual",
          waitForResolution: Boolean(input.waitForTakeover),
        });
      }

      default:
        throw new Error(`Ação CDP desconhecida: '${String(action)}'.`);
    }
  }

  // ===========================================================================
  // 4. BrowserTakeover, submit_secret & BrowserTeachBar (BRWS-02)
  // ===========================================================================

  public createVirtualTabForSession(params: {
    perfilId?: string;
    agenteId?: string | null;
    url: string;
    title?: string;
  }): ManagedTabEntry {
    const safeUrl = assertSafeNavigationUrl(params.url);
    return this.sessionManager.createVirtualTab({
      perfilId: params.perfilId ?? SHARED_BROWSER_PROFILE_ID,
      agenteId: params.agenteId ?? null,
      url: safeUrl.toString(),
      title: params.title,
    });
  }

  public async requestTakeover(params: {
    tabId: string;
    agenteId: string | null;
    canalId?: string | null;
    reason: BrowserTakeoverReason;
    waitForResolution?: boolean;
  }): Promise<
    | BrowserTakeoverSession
    | { decision: "complete" | "cancel"; takeoverId: string; tabId: string; snapshot?: BrowserSnapshotResult }
  > {
    const tab = this.sessionManager.getTab(params.tabId);
    if (!tab) {
      throw new Error(`Aba '${params.tabId}' não encontrada para iniciar BrowserTakeover.`);
    }

    tab.userControl = true;
    tab.lastActivityAt = Date.now();

    let previewDataUrl: string | null = null;
    if (tab.page) {
      try {
        const buf = await tab.page.screenshot({ type: "jpeg", quality: 68 });
        previewDataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
      } catch {
        previewDataUrl = null;
      }
    }

    const existing = this.activeTakeovers.get(params.tabId);
    const session: BrowserTakeoverSession = existing?.session ?? {
      takeoverId: `tkv-${randomUUID().slice(0, 8)}`,
      tabId: tab.tabId,
      perfilId: tab.perfilId,
      agenteId: params.agenteId ?? tab.agenteId,
      canalId: params.canalId ?? null,
      reason: params.reason,
      url: tab.page ? tab.page.url() : tab.virtualUrl,
      title: tab.virtualTitle || "Sessão do Navegador",
      status: "active",
      previewDataUrl,
      criadoEm: new Date().toISOString(),
    };

    const pendingEntry: PendingTakeoverEntry = existing ?? { session, resolvers: [] };
    this.activeTakeovers.set(params.tabId, pendingEntry);

    await this.sessionManager.startScreencast(params.tabId, (frame) => {
      this.wsHub?.broadcast("browser:frame", {
        ...frame,
        agenteId: session.agenteId,
        perfilId: tab.perfilId,
      });
    });

    this.wsHub?.broadcast("browser:takeover_requested", session);

    if (!params.waitForResolution) {
      return session;
    }

    return await new Promise((resolvePromise) => {
      pendingEntry.resolvers.push((res) => {
        resolvePromise({
          decision: res.decision,
          takeoverId: session.takeoverId,
          tabId: tab.tabId,
          snapshot: res.snapshot,
        });
      });
    });
  }

  public async resolveTakeover(
    tabId: string,
    decision: "complete" | "cancel",
  ): Promise<{
    ok: boolean;
    takeoverId: string | null;
    tabId: string;
    decision: "complete" | "cancel";
    snapshot: BrowserSnapshotResult;
  }> {
    const tab = this.sessionManager.getTab(tabId);
    if (!tab) {
      throw new Error(`Aba '${tabId}' não encontrada.`);
    }

    tab.userControl = false;
    await this.sessionManager.stopScreencast(tabId);
    if (tab.teachRecording) {
      this.stopTeachRecording(tabId, "save");
    }

    tab.revision += 1;
    const snapshot = await this.captureTabSnapshot(tab, false);

    const pending = this.activeTakeovers.get(tabId);
    this.activeTakeovers.delete(tabId);
    const takeoverId = pending?.session.takeoverId ?? null;

    if (pending) {
      pending.session.status = decision === "complete" ? "completed" : "cancelled";
      for (const fn of pending.resolvers) {
        fn({ decision, snapshot });
      }
    }

    this.wsHub?.broadcast("browser:takeover_resolved", {
      takeoverId: takeoverId ?? `tkv-${tabId}`,
      tabId,
      agenteId: tab.agenteId,
      decision,
      url: snapshot.url,
      title: snapshot.title,
    });

    return {
      ok: true,
      takeoverId,
      tabId,
      decision,
      snapshot,
    };
  }

  public async dispatchTakeoverInput(tabId: string, event: HumanCdpInputEvent): Promise<{ ok: boolean }> {
    const tab = this.sessionManager.getTab(tabId);
    if (!tab) {
      throw new Error(`Aba '${tabId}' não encontrada.`);
    }
    if (!tab.userControl) {
      throw new Error(
        `Input humano recusado: a aba '${tabId}' não está em modo de controle humano ativo (BrowserTakeover).`,
      );
    }

    await this.sessionManager.dispatchHumanInput(tabId, event);

    // Durante gravação BrowserTeachBar, registra cliques resolvendo role/name sem gravar teclas digitadas
    if (tab.teachRecording && tab.agenteId && event.type === "mousePressed") {
      let clickedRole = "elemento";
      let clickedName: string | null = null;
      if (tab.page && typeof event.x === "number" && typeof event.y === "number") {
        try {
          const hit = await tab.page.evaluate(
            ({ x, y }) => {
              const g = globalThis as unknown as {
                document: {
                  elementFromPoint(px: number, py: number): {
                    tagName: string;
                    innerText?: string;
                    getAttribute(attr: string): string | null;
                  } | null;
                };
              };
              const el = g.document.elementFromPoint(x, y);
              if (!el) return null;
              const role = el.getAttribute("role") || el.tagName.toLowerCase();
              const name = (
                el.getAttribute("aria-label") ||
                el.innerText ||
                el.getAttribute("placeholder") ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80);
              return { role, name };
            },
            { x: event.x, y: event.y },
          );
          if (hit) {
            clickedRole = hit.role;
            clickedName = hit.name || null;
          }
        } catch {
          // ignora falha de inspeção puntual
        }
      }

      this.browsingLog.recordStep(tab.agenteId, {
        kind: "click",
        url: tab.page ? tab.page.url() : tab.virtualUrl,
        role: clickedRole,
        name: clickedName,
      });
      this.broadcastTeachStatus(tab);
    }

    return { ok: true };
  }

  /**
   * Injeta senha/OTP diretamente via CDP/DOM sem jamais retornar ou logar o valor em claro.
   */
  public async submitSecret(params: {
    tabId: string;
    method: "password" | "otp" | "authenticator";
    targets: BrowserTargetSelector[];
    loginId?: string | null;
    username?: string | null;
    secret?: string | null;
    saveToVault?: boolean;
    loginLabel?: string | null;
    submission?: "enter" | "click" | "none";
    submitTarget?: BrowserTargetSelector | null;
  }): Promise<{
    ok: boolean;
    tabId: string;
    filledFields: number;
    savedLoginId: string | null;
  }> {
    const tab = this.sessionManager.getTab(params.tabId);
    if (!tab) {
      throw new Error(`Aba '${params.tabId}' não encontrada.`);
    }

    let plainSecret = typeof params.secret === "string" ? params.secret : null;
    let resolvedUsername = typeof params.username === "string" ? params.username : null;

    if (!plainSecret && params.loginId && this.vault) {
      const rawStored = this.vault.getSecret(`vault_login:${params.loginId}`);
      if (rawStored) {
        try {
          const parsed = JSON.parse(rawStored) as { username?: string; secret?: string };
          plainSecret = parsed.secret ?? null;
          if (!resolvedUsername && parsed.username) resolvedUsername = parsed.username;
        } catch {
          plainSecret = rawStored;
        }
      }
    }

    if (!plainSecret) {
      throw new Error("Nenhuma credencial fornecida ou encontrada no Cofre para preenchimento.");
    }

    let savedLoginId: string | null = null;
    if (params.saveToVault && this.vault) {
      savedLoginId = params.loginId?.trim() || `login-${randomUUID().slice(0, 8)}`;
      this.vault.setSecret(
        `vault_login:${savedLoginId}`,
        JSON.stringify({
          label: params.loginLabel ?? tab.virtualUrl,
          username: resolvedUsername ?? "",
          secret: plainSecret,
          updatedAt: new Date().toISOString(),
        }),
      );
    }

    let filledFields = 0;
    if (tab.page && params.targets.length > 0) {
      if (params.method !== "password" && params.targets.length > 1) {
        const chars = Array.from(plainSecret);
        for (let idx = 0; idx < params.targets.length && idx < chars.length; idx += 1) {
          const resolved = resolveBrowserTarget(
            tab.page,
            params.targets[idx]!,
            tab.snapshotRefs,
            tab.revision,
          );
          if (resolved.locator) {
            await resolved.locator.fill(chars[idx]!, { timeout: 6_000 });
            filledFields += 1;
          }
        }
      } else {
        const primary = resolveBrowserTarget(
          tab.page,
          params.targets[0]!,
          tab.snapshotRefs,
          tab.revision,
        );
        if (primary.locator) {
          await primary.locator.fill(plainSecret, { timeout: 8_000 });
          filledFields += 1;
          if (params.submission === "enter") {
            await primary.locator.press("Enter");
          }
        }
      }

      if (params.submission === "click" && params.submitTarget) {
        const btn = resolveBrowserTarget(
          tab.page,
          params.submitTarget,
          tab.snapshotRefs,
          tab.revision,
        );
        await btn.locator?.click({ timeout: 8_000 });
      }
      tab.revision += 1;
    } else {
      filledFields = Math.max(1, params.targets.length);
    }

    return {
      ok: true,
      tabId: tab.tabId,
      filledFields,
      savedLoginId,
    };
  }

  private broadcastTeachStatus(tab: ManagedTabEntry): void {
    if (!tab.agenteId) return;
    const steps = this.browsingLog.listSteps(tab.agenteId, { onlyUnreviewed: true });
    this.wsHub?.broadcast("browser:teach_status", {
      tabId: tab.tabId,
      agenteId: tab.agenteId,
      recording: tab.teachRecording,
      startedAt: tab.teachStartedAt,
      stepsCount: steps.length,
    });
  }

  public startTeachRecording(
    tabId: string,
    agenteId?: string | null,
  ): { ok: boolean; tabId: string; agenteId: string; startedAt: number } {
    const tab = this.sessionManager.getTab(tabId);
    if (!tab) {
      throw new Error(`Aba '${tabId}' não encontrada.`);
    }
    const effectiveAgent = agenteId?.trim() || tab.agenteId || "estrategista";
    tab.agenteId = effectiveAgent;
    tab.teachRecording = true;
    tab.teachStartedAt = Date.now();

    this.browsingLog.recordStep(effectiveAgent, {
      kind: "page",
      url: tab.page ? tab.page.url() : tab.virtualUrl,
      title: tab.virtualTitle,
    });
    this.broadcastTeachStatus(tab);

    return {
      ok: true,
      tabId: tab.tabId,
      agenteId: effectiveAgent,
      startedAt: tab.teachStartedAt,
    };
  }

  public stopTeachRecording(
    tabId: string,
    action: "save" | "discard",
  ): {
    ok: boolean;
    action: "save" | "discard";
    steps: UserBrowsingStep[];
    recordedTaskText: string;
  } {
    const tab = this.sessionManager.getTab(tabId);
    if (!tab) {
      throw new Error(`Aba '${tabId}' não encontrada.`);
    }
    const effectiveAgent = tab.agenteId ?? "estrategista";
    tab.teachRecording = false;
    tab.teachStartedAt = null;

    if (action === "discard") {
      this.browsingLog.clearSteps(effectiveAgent);
      this.broadcastTeachStatus(tab);
      return {
        ok: true,
        action: "discard",
        steps: [],
        recordedTaskText: this.browsingLog.formatRecordedTaskFile([]),
      };
    }

    const steps = this.browsingLog.listSteps(effectiveAgent, { onlyUnreviewed: true });
    this.broadcastTeachStatus(tab);
    return {
      ok: true,
      action: "save",
      steps,
      recordedTaskText: this.browsingLog.formatRecordedTaskFile(steps),
    };
  }

  public async closeAll(): Promise<void> {
    this.activeTakeovers.clear();
    await this.sessionManager.closeAll();
  }
}
