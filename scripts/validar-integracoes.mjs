#!/usr/bin/env node
import { createDecipheriv, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function lerEnv(caminho) {
  if (!existsSync(caminho)) return {};
  const map = {};
  const raw = readFileSync(caminho, "utf8");
  for (const linha of raw.split(/\r?\n/)) {
    const trimmed = linha.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k) map[k] = v;
  }
  return map;
}

function decifrarSegredoCofre(dbPath, masterSecret, chaves) {
  if (!existsSync(dbPath)) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    for (const chave of chaves) {
      const row = db
        .prepare(`SELECT valor_criptografado, iv FROM cofre_segredos WHERE chave_nome = ?;`)
        .get(chave);
      if (!row) continue;
      const parts = String(row.iv).split(":");
      if (parts.length !== 3) continue;
      const [saltHex, ivHex, tagHex] = parts;
      const derivedKey = scryptSync(masterSecret, Buffer.from(saltHex, "hex"), 32);
      const decipher = createDecipheriv("aes-256-gcm", derivedKey, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(row.valor_criptografado, "base64")),
        decipher.final(),
      ]);
      const val = decrypted.toString("utf8").trim();
      if (val) return val;
    }
    return null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function validarIntegracoes({ diretorioRaiz = raiz, fetchFn = fetch } = {}) {
  const env = lerEnv(join(diretorioRaiz, ".env"));
  const dbPath =
    process.env.CRIATIVO_DB_PATH ||
    env.CRIATIVO_DB_PATH ||
    join(diretorioRaiz, "apps", "daemon", "dados", "criativo.db");
  const masterSecret =
    process.env.CRIATIVO_VAULT_KEY ||
    env.CRIATIVO_VAULT_KEY ||
    process.env.VAULT_MASTER_KEY ||
    "criativo-os-chave-padrao-desenvolvimento-trocar-em-producao";

  const token =
    decifrarSegredoCofre(dbPath, masterSecret, ["instagram_access_token", "META_ACCESS_TOKEN"]) ||
    process.env.META_ACCESS_TOKEN ||
    env.META_ACCESS_TOKEN ||
    process.env.INSTAGRAM_ACCESS_TOKEN ||
    env.INSTAGRAM_ACCESS_TOKEN ||
    null;

  const igUserId =
    decifrarSegredoCofre(dbPath, masterSecret, ["instagram_business_account_id", "META_IG_USER_ID"]) ||
    process.env.META_IG_USER_ID ||
    env.META_IG_USER_ID ||
    process.env.INSTAGRAM_BUSINESS_ID ||
    env.INSTAGRAM_BUSINESS_ID ||
    null;

  if (!token || !igUserId) {
    return {
      ok: false,
      estagio: 3,
      tokenConfigurado: Boolean(token),
      accountIdConfigurado: Boolean(igUserId),
      mensagem: "Credenciais Meta ausentes no Cofre SQLite e no .env local.",
    };
  }

  const versao = env.META_API_VERSION || process.env.META_API_VERSION || "v27.0";
  const res = await fetchFn(
    `https://graph.facebook.com/${encodeURIComponent(versao)}/${encodeURIComponent(igUserId)}?fields=id,username,followers_count,media_count`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    }
  );
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    return {
      ok: false,
      estagio: 7,
      tokenConfigurado: true,
      accountIdConfigurado: true,
      httpStatus: res.status,
      mensagem: `Meta Graph API respondeu HTTP ${res.status}: ${body?.error?.message || "Verifique permissões e validade do token."}`,
    };
  }

  return {
    ok: true,
    estagio: 5,
    tokenConfigurado: true,
    accountIdConfigurado: true,
    httpStatus: res.status,
    idConfere: String(body.id || "") === String(igUserId),
    usernamePresente: Boolean(body.username),
    followersPresente: typeof body.followers_count === "number",
    mensagem: "Integração Meta / Instagram validada via Graph API sem expor segredos.",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validarIntegracoes()
    .then((res) => {
      console.log("\n=== Validação de Integrações (CriativoOS) ===");
      console.log(`Token Meta no Cofre/.env:  ${res.tokenConfigurado ? "✅ Configurado" : "❌ Ausente"}`);
      console.log(`IG Business Account ID:    ${res.accountIdConfigurado ? "✅ Configurado" : "❌ Ausente"}`);
      console.log(`Meta Graph API (${res.ok ? "✅ HTTP " + res.httpStatus + " OK" : "❌ " + res.mensagem})`);
      if (!res.ok) process.exitCode = 1;
    })
    .catch((err) => {
      console.error(`Erro ao validar integrações: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}
