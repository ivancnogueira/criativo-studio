import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

/**
 * Gerencia a chave mestra do Cofre no aplicativo Desktop usando `electron.safeStorage`.
 * - Na primeira execução (se `safeStorage` estiver disponível), gera 32 bytes aleatórios e salva cifrada em `vault.key.enc`.
 * - Nas execuções seguintes, decifra apenas em memória para repassar ao daemon filho via `CRIATIVO_VAULT_KEY`.
 * - Em Linux sem keyring disponível, grava chave aleatória com permissão restritiva `0600` e aviso estruturado.
 */
export function loadOrCreateSafeVaultMasterKey(
  userDataDir: string,
  safeStorageApi: SafeStorageLike | null | undefined,
  onLog?: (msg: string) => void
): string {
  mkdirSync(userDataDir, { recursive: true });
  const envKey = process.env.CRIATIVO_VAULT_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  const encryptedPath = join(userDataDir, "vault.key.enc");
  const fallbackPath = join(userDataDir, "vault.key.fallback");

  if (safeStorageApi && safeStorageApi.isEncryptionAvailable()) {
    if (existsSync(encryptedPath)) {
      try {
        const cipherBuf = readFileSync(encryptedPath);
        const plain = safeStorageApi.decryptString(cipherBuf).trim();
        if (plain.length >= 16) {
          return plain;
        }
      } catch (err) {
        onLog?.(
          `[VaultKey] Falha ao decifrar vault.key.enc (${err instanceof Error ? err.message : String(err)}); verificando fallback/regeneração.`
        );
      }
    }

    const freshSecret = randomBytes(32).toString("hex");
    const cipherBuf = safeStorageApi.encryptString(freshSecret);
    mkdirSync(dirname(encryptedPath), { recursive: true });
    writeFileSync(encryptedPath, cipherBuf);
    try {
      chmodSync(encryptedPath, 0o600);
    } catch {
      // chmod é best-effort em Windows
    }
    onLog?.("[VaultKey] Chave mestra do Cofre protegida com electron.safeStorage (vault.key.enc).");
    return freshSecret;
  }

  // Fallback para ambientes Linux sem keyring/SecretService ativo
  if (existsSync(fallbackPath)) {
    const existing = readFileSync(fallbackPath, "utf8").trim();
    if (existing.length >= 16) {
      onLog?.(
        "[VaultKey] AVISO: safeStorage indisponível; utilizando vault.key.fallback com permissão 0600."
      );
      return existing;
    }
  }

  const fallbackSecret = randomBytes(32).toString("hex");
  writeFileSync(fallbackPath, `${fallbackSecret}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(fallbackPath, 0o600);
  } catch {
    // chmod é best-effort em Windows
  }
  onLog?.(
    "[VaultKey] AVISO: keyring/safeStorage indisponível neste SO; gerada chave local em vault.key.fallback (0600)."
  );
  return fallbackSecret;
}
