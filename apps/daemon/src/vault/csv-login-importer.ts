import type {
  CsvLoginImportPreview,
  CsvLoginImportPreviewItem,
  LoginAutofillPolicy,
} from "@criativo/contracts";
import type { LoginVaultService } from "./login-vault-service.ts";
import { normalizeLoginDomain } from "./login-vault-service.ts";

interface ParsedLoginRecord {
  title: string;
  domain: string;
  username: string;
  password: string;
  totpSecret?: string;
  notes?: string;
  autofillPolicy: LoginAutofillPolicy;
}

/**
 * Parser RFC 4180 para CSV com suporte a campos entre aspas duplas, escape `""` e quebras de linha internas.
 */
export function parseCsvRows(csvText: string): string[][] {
  const input = String(csvText ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      if (row.some((c) => c.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand);
    if (idx >= 0) return idx;
  }
  return -1;
}

export function extractCsvLoginRecords(csvText: string): ParsedLoginRecord[] {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0]!;
  const titleIdx = findColumnIndex(headers, ["name", "title", "titulo", "nome", "service"]);
  const urlIdx = findColumnIndex(headers, ["url", "login_uri", "website", "domain", "dominio", "host"]);
  const userIdx = findColumnIndex(headers, ["username", "login_username", "user", "usuario", "email"]);
  const passIdx = findColumnIndex(headers, ["password", "login_password", "senha", "pass"]);
  const totpIdx = findColumnIndex(headers, ["totp", "login_totp", "otp", "otpauth"]);
  const notesIdx = findColumnIndex(headers, ["notes", "note", "notas", "extra"]);

  if (urlIdx < 0 || userIdx < 0 || passIdx < 0) {
    throw new Error(
      "Cabeçalho CSV inválido: informe ao menos colunas de URL/domínio (url/domain), usuário (username) e senha (password).",
    );
  }

  const parsed: ParsedLoginRecord[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cols = rows[i]!;
    const rawUrl = (cols[urlIdx] ?? "").trim();
    const domain = normalizeLoginDomain(rawUrl);
    const username = (cols[userIdx] ?? "").trim();
    const password = cols[passIdx] ?? "";
    if (!domain || !username || !password) continue;

    const rawTitle = titleIdx >= 0 ? (cols[titleIdx] ?? "").trim() : "";
    const title = rawTitle || domain;
    const totpSecret = totpIdx >= 0 ? (cols[totpIdx] ?? "").trim() || undefined : undefined;
    const notes = notesIdx >= 0 ? (cols[notesIdx] ?? "").trim() || undefined : undefined;

    parsed.push({
      title,
      domain,
      username,
      password,
      totpSecret,
      notes,
      autofillPolicy: "exact",
    });
  }

  return parsed;
}

/**
 * Executa prévia (`preview`) ou importação (`commit`) de CSV de logins no `LoginVaultService`,
 * deduplicando entradas já cadastradas por `(domínio, usuário)`.
 */
export function importCsvLogins(options: {
  vault: LoginVaultService;
  csvText: string;
  mode: "preview" | "commit";
  defaultPolicy?: LoginAutofillPolicy;
}): CsvLoginImportPreview {
  const records = extractCsvLoginRecords(options.csvText);
  const seenInBatch = new Set<string>();
  const items: CsvLoginImportPreviewItem[] = [];
  let newCount = 0;
  let duplicateCount = 0;
  let importedCount = 0;

  for (const rec of records) {
    const key = `${normalizeLoginDomain(rec.domain)}::${rec.username.toLowerCase()}`;
    const existsInDb = Boolean(options.vault.findByDomainAndUsername(rec.domain, rec.username));
    const duplicate = existsInDb || seenInBatch.has(key);
    seenInBatch.add(key);

    const policy = options.defaultPolicy ?? rec.autofillPolicy;
    items.push({
      title: rec.title,
      domain: rec.domain,
      username: rec.username,
      duplicate,
      autofillPolicy: policy,
    });

    if (duplicate) {
      duplicateCount += 1;
      continue;
    }

    newCount += 1;
    if (options.mode === "commit") {
      options.vault.createLogin({
        title: rec.title,
        domain: rec.domain,
        username: rec.username,
        password: rec.password,
        totpSecret: rec.totpSecret,
        notes: rec.notes,
        autofillPolicy: policy,
      });
      importedCount += 1;
    }
  }

  return {
    mode: options.mode,
    totalParsed: records.length,
    newCount,
    duplicateCount,
    importedCount,
    items,
  };
}
