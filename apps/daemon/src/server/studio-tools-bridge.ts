import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import type { ArquivoStudio } from "@criativo/contracts";
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

const STUDIO_MEDIA_MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export interface ScannedWorkspaceFile {
  nome_original: string;
  caminho_relativo: string;
  mime_type: string;
  tamanho_bytes: number;
  tipo_uso: ArquivoStudio["tipo_uso"];
  criado_em: string;
  diskPath: string;
}

/**
 * Escaneia arquivos reais presentes nas pastas do workspace (`recursos/` e `saidas/`)
 * para exibição no Cockpit Web e injeção no contexto/ImagePaths dos agentes.
 */
export function scanWorkspaceMediaFiles(workspaceRoot: string, limit = 120): ScannedWorkspaceFile[] {
  const roots: Array<{ dir: string; tipoUso: ArquivoStudio["tipo_uso"] }> = [
    { dir: resolve(workspaceRoot, "recursos", "referencias"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "recursos", "fotos"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "recursos", "logos"), tipoUso: "logo" },
    { dir: resolve(workspaceRoot, "recursos", "personagens"), tipoUso: "personagem" },
    { dir: resolve(workspaceRoot, "recursos", "uploads"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "saidas"), tipoUso: "gerado" },
  ];

  const found: ScannedWorkspaceFile[] = [];

  const walk = (dir: string, defaultUso: ArquivoStudio["tipo_uso"]): void => {
    if (found.length >= limit || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) break;
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, defaultUso);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      const mime = STUDIO_MEDIA_MIME_MAP[ext];
      if (!mime) continue;
      try {
        const st = statSync(fullPath);
        if (st.size <= 0) continue;
        const rel = relative(workspaceRoot, fullPath).replaceAll("\\", "/");
        const tipoUso: ArquivoStudio["tipo_uso"] =
          mime.startsWith("video/") && defaultUso === "gerado" ? "video" : defaultUso;
        found.push({
          nome_original: basename(entry.name),
          caminho_relativo: rel,
          mime_type: mime,
          tamanho_bytes: st.size,
          tipo_uso: tipoUso,
          criado_em: st.mtime.toISOString(),
          diskPath: fullPath,
        });
      } catch {
        // ignora arquivo inacessível
      }
    }
  };

  for (const r of roots) {
    walk(r.dir, r.tipoUso);
  }

  return found.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}

/**
 * Sincroniza de forma idempotente arquivos do disco para `projecao_arquivos` no SQLite.
 */
export function syncWorkspaceFilesToDatabase(db: CriativoDatabase, workspaceRoot: string): number {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") return 0;

  const existingRows = db.connection
    .prepare(`SELECT caminho_relativo FROM projecao_arquivos;`)
    .all() as Array<{ caminho_relativo: string }>;
  const known = new Set(existingRows.map((r) => r.caminho_relativo.replaceAll("\\", "/")));

  const scanned = scanWorkspaceMediaFiles(workspaceRoot);
  const insertStmt = db.connection.prepare(
    `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?);`
  );

  let added = 0;
  for (const item of scanned) {
    if (known.has(item.caminho_relativo)) continue;
    insertStmt.run(
      `arq-${randomUUID().slice(0, 8)}`,
      item.nome_original,
      item.caminho_relativo,
      item.mime_type,
      item.tamanho_bytes,
      item.tipo_uso,
      item.criado_em
    );
    known.add(item.caminho_relativo);
    added += 1;
  }
  return added;
}

function readBrandSnippetIfRich(filePath: string, maxChars: number): string {
  if (!existsSync(filePath)) return "";
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return "";
    const onlyTemplates =
      raw.includes("[A PREENCHER]") && raw.includes("[NOME_DA_MARCA]") && raw.length < 300;
    return onlyTemplates ? "" : raw.slice(0, maxChars);
  } catch {
    return "";
  }
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
  syncWorkspaceFilesToDatabase(deps.db, deps.workspaceRoot);

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
      `SELECT nome_original, caminho_relativo, tipo_uso FROM projecao_arquivos ORDER BY criado_em DESC LIMIT 20;`
    )
    .all() as Array<{ nome_original: string; caminho_relativo: string; tipo_uso: string }>;

  const canReadDisk = process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1";
  const perfilFileSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "conteudos", "perfil-da-marca.md"), 2500)
    : "";
  const idVisualSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "conteudos", "identidade-visual.yml"), 1400)
    : "";
  const brandbookSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "recursos", "brand", "brandbook.md"), 1500)
    : "";
  const designSystemSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "recursos", "brand", "design-system.md"), 1200)
    : "";

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
      `- Arquivos/Referências/ImagePaths disponíveis (${files.length}): ${files
        .map((f) => `${f.nome_original} (${f.tipo_uso}: ${f.caminho_relativo})`)
        .join("; ")}`
    );
  } else {
    lines.push(
      "- Arquivos/Referências/ImagePaths disponíveis: nenhuma mídia salva ainda em recursos/referencias/, recursos/fotos/ ou recursos/logos/."
    );
  }

  if (perfilFileSnippet) {
    lines.push("", "### Memória Estratégica (conteudos/perfil-da-marca.md)", perfilFileSnippet);
  }
  if (idVisualSnippet) {
    lines.push("", "### Identidade Visual (conteudos/identidade-visual.yml)", idVisualSnippet);
  }
  if (brandbookSnippet) {
    lines.push("", "### Brandbook da Marca (recursos/brand/brandbook.md)", brandbookSnippet);
  }
  if (designSystemSnippet) {
    lines.push("", "### Design System (recursos/brand/design-system.md)", designSystemSnippet);
  }

  lines.push(
    "",
    "### Equipe de Colegas para Handoff",
    ROSTER_15_AGENTES.map((a) => `- \`@${a.agente_id}\`: ${a.nome} — ${a.papel}`).join("\n"),
    "IMPORTANTE SOBRE HANDOFF: Só emita a tag `[HANDOFF:agente_id]` quando o usuário tiver pedido explicitamente para executar uma tarefa prática que exija passar o bastão para aquele especialista. NUNCA emita `[HANDOFF:...]` nem transfira a conversa quando estiver apenas se apresentando, respondendo 'oi', explicando o que você/sua equipe fazem ou tirando dúvidas."
  );

  return lines.join("\n");
}
