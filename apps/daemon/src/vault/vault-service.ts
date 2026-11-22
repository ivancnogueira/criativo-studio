import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import type { CriativoDatabase } from "../database/client.ts";

export interface SecretMetadata {
  chave_nome: string;
  atualizado_em: string;
  configurada: boolean;
}

interface SecretRow {
  chave_nome: string;
  valor_criptografado: string;
  iv: string;
  atualizado_em: string;
}

/**
 * Cofre de segredos local criptografado com AES-256-GCM.
 * Cada segredo recebe um salt aleatório de 16 bytes (derivação scrypt da chave mestre)
 * e um vetor de inicialização (IV) aleatório de 12 bytes, garantindo unicidade criptográfica.
 */
export class VaultService {
  private readonly db: CriativoDatabase;
  private readonly masterSecret: string;

  constructor(db: CriativoDatabase, masterSecret?: string) {
    this.db = db;
    const resolvedSecret =
      masterSecret?.trim() ||
      process.env.CRIATIVO_VAULT_KEY?.trim() ||
      process.env.VAULT_MASTER_KEY?.trim() ||
      "";

    if (!resolvedSecret) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "[CRV-VAULT-001] Chave mestra do Cofre ausente em produção. Defina CRIATIVO_VAULT_KEY no ambiente ou inicie via aplicativo Desktop com safeStorage."
        );
      }
      this.masterSecret = "criativo-os-chave-padrao-desenvolvimento-trocar-em-producao";
      return;
    }

    this.masterSecret = resolvedSecret;
  }

  private deriveKey(salt: Buffer): Buffer {
    return scryptSync(this.masterSecret, salt, 32);
  }

  public encryptString(plainValue: string): { cipherBase64: string; ivEnvelope: string } {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const derivedKey = this.deriveKey(salt);
    const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
    const encrypted = Buffer.concat([cipher.update(plainValue, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const ivEnvelope = `${salt.toString("hex")}:${iv.toString("hex")}:${authTag.toString("hex")}`;
    return {
      cipherBase64: encrypted.toString("base64"),
      ivEnvelope,
    };
  }

  public decryptString(cipherBase64: string, ivEnvelope: string): string {
    const parts = ivEnvelope.split(":");
    if (parts.length !== 3) {
      throw new Error("Envelope criptográfico corrompido no Cofre de Segredos.");
    }
    const [saltHex, ivHex, tagHex] = parts as [string, string, string];
    const salt = Buffer.from(saltHex, "hex");
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");

    const derivedKey = this.deriveKey(salt);
    const decipher = createDecipheriv("aes-256-gcm", derivedKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherBase64, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  /**
   * Criptografa e persiste (ou atualiza) um segredo no SQLite.
   */
  public setSecret(keyName: string, plainValue: string): void {
    const normalizedKey = keyName.trim();
    if (!normalizedKey) {
      throw new Error("Nome da chave no cofre não pode ser vazio.");
    }

    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const derivedKey = this.deriveKey(salt);

    const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainValue, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Armazena salt:iv:authTag na coluna `iv` preservando o DDL do API-SPEC.md
    const ivEnvelope = `${salt.toString("hex")}:${iv.toString("hex")}:${authTag.toString("hex")}`;
    const agora = new Date().toISOString();

    this.db.runInTransaction(() => {
      const stmt = this.db.connection.prepare(`
        INSERT INTO cofre_segredos (chave_nome, valor_criptografado, iv, atualizado_em)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(chave_nome) DO UPDATE SET
          valor_criptografado = excluded.valor_criptografado,
          iv = excluded.iv,
          atualizado_em = excluded.atualizado_em;
      `);
      stmt.run(normalizedKey, encrypted.toString("base64"), ivEnvelope, agora);
    });
  }

  /**
   * Recupera e descriptografa um segredo pelo nome, ou retorna null se não existir.
   */
  public getSecret(keyName: string): string | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM cofre_segredos WHERE chave_nome = ?;`)
      .get(keyName.trim()) as SecretRow | undefined;

    if (!row) {
      return null;
    }

    const parts = row.iv.split(":");
    if (parts.length !== 3) {
      throw new Error(`Formato de envelope criptográfico inválido para a chave: ${keyName}`);
    }

    const [saltHex, ivHex, tagHex] = parts;
    const salt = Buffer.from(saltHex, "hex");
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const encrypted = Buffer.from(row.valor_criptografado, "base64");

    const derivedKey = this.deriveKey(salt);
    const decipher = createDecipheriv("aes-256-gcm", derivedKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  }

  /**
   * Remove uma chave do cofre.
   */
  public deleteSecret(keyName: string): boolean {
    const info = this.db.connection
      .prepare(`DELETE FROM cofre_segredos WHERE chave_nome = ?;`)
      .run(keyName.trim());
    return Number(info.changes) > 0;
  }

  /**
   * Lista apenas os metadados (nomes e timestamps) sem expor nenhum valor descriptografado.
   */
  public listSecretsMetadata(): SecretMetadata[] {
    const rows = this.db.connection
      .prepare(
        `SELECT chave_nome, atualizado_em FROM cofre_segredos ORDER BY chave_nome ASC;`
      )
      .all() as Array<{ chave_nome: string; atualizado_em: string }>;

    return rows.map((row) => ({
      chave_nome: row.chave_nome,
      atualizado_em: row.atualizado_em,
      configurada: true,
    }));
  }
}
