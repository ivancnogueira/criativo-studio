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
import type { VaultService } from "../../../vault/vault-service.ts";
import { SHARED_BROWSER_PROFILE_ID, inferProxyProtocol, normalizeProxyServerUrl, type BrowserAutomationRuntimeContext, type BrowserProfile, type ProxyRow } from "./browser-types.ts";

export function listBrowserProxies(
  ctx: BrowserAutomationRuntimeContext
): BrowserProxyConfig[] {
    const rows = ctx.db.connection
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

export function saveBrowserProxy(
  ctx: BrowserAutomationRuntimeContext,
input: {
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

    const prev = ctx.db.connection
      .prepare("SELECT * FROM projecao_browser_proxies WHERE proxy_id = ? LIMIT 1;")
      .get(proxyId) as ProxyRow | undefined;

    let vaultKey: string | null = prev?.senha_vault_chave ?? null;
    if (typeof input.senha === "string" && input.senha.trim().length > 0) {
      if (!ctx.vault) {
        throw new Error("VaultService não inicializado para cifrar senha do proxy.");
      }
      vaultKey = `browser_proxy:${proxyId}`;
      ctx.vault.setSecret(vaultKey, input.senha.trim());
    }

    const usuario =
      input.usuario !== undefined ? (input.usuario?.trim() || null) : (prev?.usuario ?? null);
    const ativoInt = input.ativo === false ? 0 : 1;

    ctx.db.connection
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

    return listBrowserProxies(ctx).find((p) => p.proxy_id === proxyId)!;
  }

export function deleteBrowserProxy(
  ctx: BrowserAutomationRuntimeContext,
proxyId: string): boolean {
    const prev = ctx.db.connection
      .prepare("SELECT * FROM projecao_browser_proxies WHERE proxy_id = ? LIMIT 1;")
      .get(proxyId) as ProxyRow | undefined;
    if (!prev) return false;

    if (prev.senha_vault_chave && ctx.vault) {
      ctx.vault.deleteSecret(prev.senha_vault_chave);
    }

    ctx.db.connection
      .prepare("DELETE FROM projecao_browser_proxies WHERE proxy_id = ?;")
      .run(proxyId);
    return true;
  }

export function resolveBrowserProfileAndLaunchProxy(
  ctx: BrowserAutomationRuntimeContext,

    requestedProfileId?: string | null,
    agenteId?: string | null,
  ): {
    profile: BrowserProfile;
    proxy: { server: string; username?: string; password?: string } | null;
  } {
    ctx.ensureDefaultSharedProfile();

    let effectiveId = requestedProfileId?.trim() || null;
    if (!effectiveId && agenteId) {
      const agRow = ctx.db.connection
        .prepare("SELECT browser_profile_id FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
        .get(agenteId) as { browser_profile_id?: string | null } | undefined;
      effectiveId = agRow?.browser_profile_id ?? null;
    }

    let profile: BrowserProfile | undefined;
    if (effectiveId === "agent" && agenteId) {
      const dedicatedId = `agent-${agenteId}`;
      profile = ctx.db.connection
        .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
        .get(dedicatedId) as BrowserProfile | undefined;
      if (!profile) {
        const userDataDir = resolve(ctx.workspaceRoot, "dados", "browser-profiles", dedicatedId);
        mkdirSync(userDataDir, { recursive: true });
        const agora = new Date().toISOString();
        ctx.db.connection
          .prepare(
            `INSERT INTO projecao_perfis_navegador (
              perfil_id, nome, user_data_dir, proxy_url, ultimo_uso_em, cor_hex, proxy_json, criado_em
            ) VALUES (?, ?, ?, NULL, ?, '#31CF76', '{}', ?);`,
          )
          .run(dedicatedId, `Exclusivo (${agenteId})`, userDataDir, agora, agora);
        profile = ctx.db.connection
          .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
          .get(dedicatedId) as unknown as BrowserProfile;
      }
    } else if (effectiveId) {
      profile = ctx.db.connection
        .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
        .get(effectiveId) as unknown as BrowserProfile | undefined;
    }

    if (!profile) {
      profile = ctx.db.connection
        .prepare("SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ? LIMIT 1;")
        .get(SHARED_BROWSER_PROFILE_ID) as unknown as BrowserProfile;
    }

    const proxyMeta = ctx.sanitizeProxyForClient(profile.proxy_json);
    let resolvedProxy: { server: string; username?: string; password?: string } | null = null;

    if (proxyMeta.proxy_id) {
      const proxyRow = ctx.db.connection
        .prepare("SELECT * FROM projecao_browser_proxies WHERE proxy_id = ? AND ativo = 1 LIMIT 1;")
        .get(proxyMeta.proxy_id) as ProxyRow | undefined;
      if (proxyRow) {
        const decryptedPass =
          proxyRow.senha_vault_chave && ctx.vault
            ? ctx.vault.getSecret(proxyRow.senha_vault_chave) ?? undefined
            : undefined;
        resolvedProxy = {
          server: proxyRow.servidor,
          ...(proxyRow.usuario ? { username: proxyRow.usuario } : {}),
          ...(decryptedPass ? { password: decryptedPass } : {}),
        };
      }
    } else if (proxyMeta.server || profile.proxy_url) {
      const decryptedPass =
        proxyMeta.password_vault_key && ctx.vault
          ? ctx.vault.getSecret(proxyMeta.password_vault_key) ?? undefined
          : undefined;
      resolvedProxy = {
        server: (proxyMeta.server ?? profile.proxy_url)!,
        ...(proxyMeta.username ? { username: proxyMeta.username } : {}),
        ...(decryptedPass ? { password: decryptedPass } : {}),
      };
    }

    return { profile, proxy: resolvedProxy };
  }
