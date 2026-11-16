import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CriativoDatabase } from "../database/client.ts";
import { ROSTER_15_AGENTES } from "../engine/runner/roster-defaults.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import type { VaultService } from "../vault/vault-service.ts";

export interface MetaCredentialsResolved {
  accessToken: string | null;
  accountId: string | null;
  tokenKeyFound: string | null;
  accountIdKeyFound: string | null;
  configured: boolean;
}

export interface MetaValidationReport {
  ok: boolean;
  estagio: 3 | 4 | 5 | 7;
  resumo: string;
  detalhes: {
    tokenConfigurado: boolean;
    accountIdConfigurado: boolean;
    httpStatus: number | null;
    graphApiOk: boolean;
    idConfere: boolean;
    username: string | null;
    followersCount: number | null;
    mediaCount: number | null;
    erro: string | null;
  };
}

export const UPGRADE_PACKAGE_SLUGS = {
  bonus: [
    "gerador-de-entregaveis",
    "engenharia-reversa-concorrentes",
    "consistencia-personagem",
  ],
  video: [
    "criar-video-reels",
    "roteirista-faceless",
    "roteirista-talking-head",
  ],
} as const;

export function resolveMetaCredentials(vault?: VaultService): MetaCredentialsResolved {
  if (!vault) {
    return {
      accessToken: null,
      accountId: null,
      tokenKeyFound: null,
      accountIdKeyFound: null,
      configured: false,
    };
  }

  let accessToken: string | null = null;
  let tokenKeyFound: string | null = null;
  for (const k of ["instagram_access_token", "META_ACCESS_TOKEN"]) {
    const val = vault.getSecret(k);
    if (val && val.trim().length > 0) {
      accessToken = val.trim();
      tokenKeyFound = k;
      break;
    }
  }

  let accountId: string | null = null;
  let accountIdKeyFound: string | null = null;
  for (const k of ["instagram_business_account_id", "META_IG_USER_ID"]) {
    const val = vault.getSecret(k);
    if (val && val.trim().length > 0) {
      accountId = val.trim();
      accountIdKeyFound = k;
      break;
    }
  }

  return {
    accessToken,
    accountId,
    tokenKeyFound,
    accountIdKeyFound,
    configured: Boolean(accessToken && accountId),
  };
}

/**
 * Executa validação segura da integração Meta Graph API v21.0 lendo do Cofre SQLite
 * sem jamais expor o token em logs, retornos ou mensagens ao usuário.
 */
export async function validateMetaIntegration(
  vault?: VaultService,
  fetchImpl: typeof fetch = fetch
): Promise<MetaValidationReport> {
  const creds = resolveMetaCredentials(vault);
  if (!creds.configured || !creds.accessToken || !creds.accountId) {
    return {
      ok: false,
      estagio: 3,
      resumo:
        "Credenciais Meta ausentes no Cofre AES-256-GCM. Salve Access Token e Business Account ID em Conexões → Apps & Canais → Instagram.",
      detalhes: {
        tokenConfigurado: Boolean(creds.accessToken),
        accountIdConfigurado: Boolean(creds.accountId),
        httpStatus: null,
        graphApiOk: false,
        idConfere: false,
        username: null,
        followersCount: null,
        mediaCount: null,
        erro: "Credenciais não cadastradas no Cofre.",
      },
    };
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(
      creds.accountId
    )}?fields=id,username,followers_count,media_count&access_token=${encodeURIComponent(
      creds.accessToken
    )}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      username?: string;
      followers_count?: number;
      media_count?: number;
      error?: { message?: string; code?: number };
    };

    if (!res.ok) {
      const msgErro = data.error?.message ?? `Meta Graph API respondeu HTTP ${res.status}`;
      return {
        ok: false,
        estagio: 7,
        resumo: `Falha na validação Meta Graph API (HTTP ${res.status}): ${msgErro}`,
        detalhes: {
          tokenConfigurado: true,
          accountIdConfigurado: true,
          httpStatus: res.status,
          graphApiOk: false,
          idConfere: false,
          username: null,
          followersCount: null,
          mediaCount: null,
          erro: msgErro,
        },
      };
    }

    const idConfere = String(data.id ?? "") === String(creds.accountId);
    const username = typeof data.username === "string" ? data.username : null;
    const followersCount = typeof data.followers_count === "number" ? data.followers_count : null;
    const mediaCount = typeof data.media_count === "number" ? data.media_count : null;

    return {
      ok: true,
      estagio: 5,
      resumo: `Integração Meta validada com sucesso (HTTP ${res.status} · Perfil conectado${
        username ? `: @${username}` : ""
      }).`,
      detalhes: {
        tokenConfigurado: true,
        accountIdConfigurado: true,
        httpStatus: res.status,
        graphApiOk: true,
        idConfere,
        username,
        followersCount,
        mediaCount,
        erro: null,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha de rede ao consultar Meta Graph API.";
    return {
      ok: false,
      estagio: 7,
      resumo: `Erro ao consultar Meta Graph API: ${msg}`,
      detalhes: {
        tokenConfigurado: true,
        accountIdConfigurado: true,
        httpStatus: null,
        graphApiOk: false,
        idConfere: false,
        username: null,
        followersCount: null,
        mediaCount: null,
        erro: msg,
      },
    };
  }
}

/**
 * Verifica se um pacote modular (`base`, `bonus` ou `video`) está desbloqueado na instalação.
 */
export function isUpgradeUnlocked(
  db: CriativoDatabase,
  workspaceRoot: string,
  pacote: "base" | "bonus" | "video"
): boolean {
  if (pacote === "base") return true;

  try {
    const row = db.connection
      .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'upgrades_instalados';`)
      .get() as { valor_json: string } | undefined;
    if (row) {
      const list = JSON.parse(row.valor_json) as unknown;
      if (Array.isArray(list) && list.includes(pacote)) {
        return true;
      }
    }
  } catch {
    // ignora erro de leitura
  }

  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return false;
  }

  const skillsDir = resolve(workspaceRoot, ".agents", "skills");
  const required = UPGRADE_PACKAGE_SLUGS[pacote];
  return required.some((slug) => existsSync(join(skillsDir, slug, "SKILL.md")));
}

/**
 * Monta o Contexto Vivo seguro do Studio para injetar no systemPrompt de qualquer agente no Chat.
 */
export function buildStudioLiveContext(deps: {
  db: CriativoDatabase;
  vault?: VaultService;
  providerConnection: ProviderConnectionService;
  workspaceRoot: string;
}): string {
  const onboarding = deps.providerConnection.getOnboardingState();
  const marcaConfig = deps.providerConnection.getStudioConfig<Record<string, unknown>>(
    "identidade_marca",
    {}
  );
  const metaCreds = resolveMetaCredentials(deps.vault);

  const secretsMeta = deps.vault ? deps.vault.listSecretsMetadata() : [];
  const secretNames = new Set(secretsMeta.map((s) => s.chave_nome));
  const hasEleven = secretNames.has("elevenlabs_api_key") || secretNames.has("ELEVENLABS_API_KEY");
  const hasTelegram = secretNames.has("telegram_bot_token") || secretNames.has("TELEGRAM_BOT_TOKEN");

  const files = deps.db.connection
    .prepare(
      `SELECT nome_original, caminho_relativo, tipo_uso FROM projecao_arquivos ORDER BY criado_em DESC LIMIT 12;`
    )
    .all() as Array<{ nome_original: string; caminho_relativo: string; tipo_uso: string }>;

  let perfilFileSnippet = "";
  const perfilPath = resolve(deps.workspaceRoot, "conteudos", "perfil-da-marca.md");
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1" && existsSync(perfilPath)) {
    try {
      const raw = readFileSync(perfilPath, "utf8");
      if (!raw.includes("[A PREENCHER]") || raw.length > 100) {
        perfilFileSnippet = raw.slice(0, 900);
      }
    } catch {
      // ignora
    }
  }

  const lines: string[] = [
    "## Contexto Vivo do Criativo AI Studio Online",
    `- Marca configurada: ${String(marcaConfig.marca_nome ?? onboarding.marca_nome)} (${String(
      marcaConfig.perfil_handle ?? onboarding.perfil_handle
    )})`,
    ...(typeof marcaConfig.nicho === "string" && marcaConfig.nicho
      ? [`- Nicho/Segmento: ${marcaConfig.nicho}`]
      : []),
    ...(typeof marcaConfig.tom_voz === "string" && marcaConfig.tom_voz
      ? [`- Tom de Voz: ${marcaConfig.tom_voz}`]
      : []),
    `- Cofre AES-256-GCM (SQLite) — Meta/Instagram: ${
      metaCreds.configured
        ? "CONFIGURADO (token e account ID salvos no Cofre; nunca peça token no chat)"
        : "NÃO CONFIGURADO (oriente salvar em Conexões -> Apps & Canais -> Instagram)"
    }`,
    `- Cofre — ElevenLabs TTS: ${hasEleven ? "Configurado" : "Não configurado (fallback edge-tts)"}`,
    `- Cofre — Telegram Bot: ${hasTelegram ? "Configurado" : "Não configurado"}`,
    `- Regra de Ouro do Studio Online: As credenciais NÃO ficam em .env visível; ficam cifradas no Cofre SQLite e validadas pela ferramenta nativa 'validar_integracao_meta' (ou via 'npm run validar:integracoes').`,
  ];

  if (files.length > 0) {
    lines.push(
      `- Arquivos/ImagePaths disponíveis (${files.length}): ${files
        .map((f) => `${f.nome_original} (${f.tipo_uso}: ${f.caminho_relativo})`)
        .join("; ")}`
    );
  }

  if (perfilFileSnippet) {
    lines.push("", "### Resumo de conteudos/perfil-da-marca.md", perfilFileSnippet);
  }

  lines.push(
    "",
    "### Equipe de Colegas para Handoff (@agente_id)",
    ROSTER_15_AGENTES.map((a) => `- \`@${a.agente_id}\`: ${a.nome} — ${a.papel}`).join("\n"),
    "Quando precisar delegar ou pedir ajuda a um colega especialista no chat, inclua `[HANDOFF:agente_id]` com instruções claras para ele continuar na mesma conversa."
  );

  return lines.join("\n");
}
