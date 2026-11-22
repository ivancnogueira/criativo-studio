import { randomUUID } from "node:crypto";
import type {
  CreateLoginCredentialInput,
  LoginAutofillPolicy,
  LoginCredentialSummary,
  UpdateLoginCredentialInput,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { VaultService } from "./vault-service.ts";

interface LoginVaultRow {
  login_id: string;
  title: string;
  domain: string;
  username: string;
  password_encrypted: string;
  iv_envelope: string;
  totp_encrypted: string | null;
  totp_iv: string | null;
  autofill_policy: LoginAutofillPolicy;
  notes_encrypted: string | null;
  notes_iv: string | null;
  created_at: string;
  updated_at: string;
}

export function normalizeLoginDomain(raw: string): string {
  const trimmed = String(raw ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const withProto = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    const host = new URL(withProto).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return trimmed
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .replace(/^www\./, "");
  }
}

export function matchesDomainPolicy(
  entryDomain: string,
  targetUrlOrDomain: string,
  policy: LoginAutofillPolicy,
): boolean {
  if (policy === "never") return false;
  if (policy === "anywhere") return true;
  const targetHost = normalizeLoginDomain(targetUrlOrDomain);
  const storedHost = normalizeLoginDomain(entryDomain);
  if (!targetHost || !storedHost) return false;
  return targetHost === storedHost || targetHost.endsWith(`.${storedHost}`);
}

function toSummary(row: LoginVaultRow): LoginCredentialSummary {
  return {
    id: row.login_id,
    title: row.title,
    domain: row.domain,
    username: row.username,
    autofillPolicy: row.autofill_policy,
    source: "local",
    hasTotp: Boolean(row.totp_encrypted),
    hasNotes: Boolean(row.notes_encrypted),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Cofre estruturado de logins (`cofre_logins`) criptografado em AES-256-GCM via `VaultService`.
 * Nunca inclui senhas ou segredos TOTP em listagens ou resumos públicos.
 */
export class LoginVaultService {
  private readonly db: CriativoDatabase;
  private readonly vault: VaultService;

  constructor(db: CriativoDatabase, vault: VaultService) {
    this.db = db;
    this.vault = vault;
  }

  public listLogins(): LoginCredentialSummary[] {
    const rows = this.db.connection
      .prepare(
        `SELECT login_id, title, domain, username, password_encrypted, iv_envelope,
                totp_encrypted, totp_iv, autofill_policy, notes_encrypted, notes_iv,
                created_at, updated_at
         FROM cofre_logins
         ORDER BY updated_at DESC, title ASC;`,
      )
      .all() as unknown as LoginVaultRow[];

    return rows.map(toSummary);
  }

  public getLoginSummary(loginId: string): LoginCredentialSummary | null {
    const row = this.getRowById(loginId);
    return row ? toSummary(row) : null;
  }

  private getRowById(loginId: string): LoginVaultRow | undefined {
    return this.db.connection
      .prepare(
        `SELECT login_id, title, domain, username, password_encrypted, iv_envelope,
                totp_encrypted, totp_iv, autofill_policy, notes_encrypted, notes_iv,
                created_at, updated_at
         FROM cofre_logins
         WHERE login_id = ?;`,
      )
      .get(loginId) as unknown as LoginVaultRow | undefined;
  }

  public findByDomainAndUsername(
    domain: string,
    username: string,
  ): LoginCredentialSummary | null {
    const normDomain = normalizeLoginDomain(domain);
    const normUser = username.trim().toLowerCase();
    const rows = this.listLogins();
    return (
      rows.find(
        (item) =>
          normalizeLoginDomain(item.domain) === normDomain &&
          item.username.trim().toLowerCase() === normUser,
      ) ?? null
    );
  }

  public createLogin(input: CreateLoginCredentialInput): LoginCredentialSummary {
    const title = input.title.trim();
    const domain = normalizeLoginDomain(input.domain);
    const username = input.username.trim();
    if (!title || !domain || !username || !input.password) {
      throw new Error("Título, domínio, usuário e senha são obrigatórios para criar um login.");
    }

    const now = new Date().toISOString();
    const id = `login_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const passEnc = this.vault.encryptString(input.password);
    const totpEnc =
      input.totpSecret && input.totpSecret.trim()
        ? this.vault.encryptString(input.totpSecret.trim())
        : null;
    const notesEnc =
      input.notes && input.notes.trim() ? this.vault.encryptString(input.notes.trim()) : null;
    const policy: LoginAutofillPolicy = input.autofillPolicy ?? "exact";

    this.db.connection
      .prepare(
        `INSERT INTO cofre_logins (
          login_id, title, domain, username, password_encrypted, iv_envelope,
          totp_encrypted, totp_iv, autofill_policy, notes_encrypted, notes_iv,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      )
      .run(
        id,
        title,
        domain,
        username,
        passEnc.cipherBase64,
        passEnc.ivEnvelope,
        totpEnc?.cipherBase64 ?? null,
        totpEnc?.ivEnvelope ?? null,
        policy,
        notesEnc?.cipherBase64 ?? null,
        notesEnc?.ivEnvelope ?? null,
        now,
        now,
      );

    return this.getLoginSummary(id)!;
  }

  public updateLogin(
    loginId: string,
    input: UpdateLoginCredentialInput,
  ): LoginCredentialSummary | null {
    const existing = this.getRowById(loginId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const title = input.title !== undefined ? input.title.trim() : existing.title;
    const domain =
      input.domain !== undefined ? normalizeLoginDomain(input.domain) : existing.domain;
    const username = input.username !== undefined ? input.username.trim() : existing.username;
    const autofillPolicy = input.autofillPolicy ?? existing.autofill_policy;

    const passEnc =
      input.password && input.password.length > 0
        ? this.vault.encryptString(input.password)
        : { cipherBase64: existing.password_encrypted, ivEnvelope: existing.iv_envelope };

    let totpCipher = existing.totp_encrypted;
    let totpIv = existing.totp_iv;
    if (input.totpSecret !== undefined) {
      if (input.totpSecret && input.totpSecret.trim()) {
        const enc = this.vault.encryptString(input.totpSecret.trim());
        totpCipher = enc.cipherBase64;
        totpIv = enc.ivEnvelope;
      } else {
        totpCipher = null;
        totpIv = null;
      }
    }

    let notesCipher = existing.notes_encrypted;
    let notesIv = existing.notes_iv;
    if (input.notes !== undefined) {
      if (input.notes && input.notes.trim()) {
        const enc = this.vault.encryptString(input.notes.trim());
        notesCipher = enc.cipherBase64;
        notesIv = enc.ivEnvelope;
      } else {
        notesCipher = null;
        notesIv = null;
      }
    }

    this.db.connection
      .prepare(
        `UPDATE cofre_logins
         SET title = ?, domain = ?, username = ?, password_encrypted = ?, iv_envelope = ?,
             totp_encrypted = ?, totp_iv = ?, autofill_policy = ?, notes_encrypted = ?,
             notes_iv = ?, updated_at = ?
         WHERE login_id = ?;`,
      )
      .run(
        title,
        domain,
        username,
        passEnc.cipherBase64,
        passEnc.ivEnvelope,
        totpCipher,
        totpIv,
        autofillPolicy,
        notesCipher,
        notesIv,
        now,
        loginId,
      );

    return this.getLoginSummary(loginId);
  }

  public deleteLogin(loginId: string): boolean {
    const info = this.db.connection
      .prepare("DELETE FROM cofre_logins WHERE login_id = ?;")
      .run(loginId);
    return info.changes > 0;
  }

  public findMatchingForUrl(targetUrlOrDomain: string): LoginCredentialSummary[] {
    return this.listLogins().filter((item) =>
      matchesDomainPolicy(item.domain, targetUrlOrDomain, item.autofillPolicy),
    );
  }

  /**
   * Decifra username e password SOMENTE após consentimento humano explícito aprovado
   * para preenchimento direto em campos do Playwright. Nunca encaminhar retorno ao LLM.
   */
  public revealForAuthorizedAutofill(
    loginId: string,
    targetUrlOrDomain: string,
  ): { id: string; username: string; password: string; totpSecret?: string } | null {
    const row = this.getRowById(loginId);
    if (!row) return null;
    if (!matchesDomainPolicy(row.domain, targetUrlOrDomain, row.autofill_policy)) {
      throw new Error(
        `Política de autofill (${row.autofill_policy}) bloqueou preenchimento para ${targetUrlOrDomain}.`,
      );
    }

    const password = this.vault.decryptString(row.password_encrypted, row.iv_envelope);
    const totpSecret =
      row.totp_encrypted && row.totp_iv
        ? this.vault.decryptString(row.totp_encrypted, row.totp_iv)
        : undefined;

    return {
      id: row.login_id,
      username: row.username,
      password,
      ...(totpSecret ? { totpSecret } : {}),
    };
  }
}
