import { randomUUID } from "node:crypto";
import {
  CRIATIVO_ERROR_CATALOG,
  getCriativoErrorByCode,
  type CriativoMappedError,
} from "@criativo/contracts";
import { sanitizeProviderError } from "../engine/providers/provider-interface.ts";
import { redactSensitiveText } from "./structured-logger.ts";

function sanitizeForDiagnosis(raw: string, secrets: string[] = []): string {
  const step1 = sanitizeProviderError(raw, secrets);
  return redactSensitiveText(step1, secrets);
}

/**
 * Converte qualquer exceção interna em um erro amigável catalogado (`CRV-*`)
 * com `traceId` único e redação estrita de tokens/segredos.
 */
export function mapErrorToCatalog(err: unknown, secrets: string[] = []): CriativoMappedError {
  const rawMessage = err instanceof Error ? err.message : String(err ?? "Erro desconhecido");
  const safeRaw = sanitizeForDiagnosis(rawMessage, secrets);
  const lower = safeRaw.toLowerCase();
  const traceId = `trc-${randomUUID().slice(0, 8)}`;

  // 1. Código explícito `[CRV-...]` ou `CRV-...` embutido na mensagem
  const explicitMatch = safeRaw.match(/\b(CRV-[A-Z]+-\d{3})\b/i);
  if (explicitMatch) {
    const found = getCriativoErrorByCode(explicitMatch[1]!);
    if (found) {
      return { ...found, traceId, rawSummary: safeRaw.slice(0, 260) };
    }
  }

  let selectedCode = "CRV-SYS-500";

  if (lower.includes("criativo_vault_key") || lower.includes("vault_master_key") || lower.includes("chave mestra")) {
    selectedCode = "CRV-VAULT-001";
  } else if (lower.includes("envelope criptográfico") || lower.includes("bad decrypt") || lower.includes("unsupported state")) {
    selectedCode = "CRV-VAULT-002";
  } else if (
    lower.includes("credenciais meta") ||
    lower.includes("instagram_access_token") ||
    lower.includes("instagram_business_account_id")
  ) {
    selectedCode = "CRV-META-001";
  } else if (lower.includes("approved_by_human") || (lower.includes("meta") && lower.includes("bloqueio"))) {
    selectedCode = "CRV-META-003";
  } else if (lower.includes("meta graph api") || lower.includes("graph.facebook") || lower.includes("graph.instagram")) {
    selectedCode = "CRV-META-002";
  } else if (lower.includes("whatsapp") && (lower.includes("autoriz") || lower.includes("allowlist") || lower.includes("bloque"))) {
    selectedCode = "CRV-WA-002";
  } else if (lower.includes("whatsapp") || lower.includes("baileys") || lower.includes("qr code")) {
    selectedCode = "CRV-WA-001";
  } else if (lower.includes("oauth") || lower.includes("pkce") || lower.includes("code_verifier")) {
    selectedCode = "CRV-AUTH-003";
  } else if (lower.includes("senderframe") || lower.includes("acesso bloqueado") || lower.includes("403")) {
    selectedCode = "CRV-AUTH-002";
  } else if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("token inválido")) {
    selectedCode = "CRV-AUTH-001";
  } else if (lower.includes("criativo_claim") || lower.includes("pareamento") || lower.includes("claim")) {
    selectedCode = "CRV-VPS-001";
  } else if (lower.includes("econnrefused") || lower.includes("ehostunreach") || lower.includes("ssh") || lower.includes("vps")) {
    selectedCode = "CRV-VPS-002";
  } else if (lower.includes("rate limit") || lower.includes("429") || lower.includes("quota") || lower.includes("cota") || lower.includes("usage limit")) {
    selectedCode = "CRV-PROV-002";
  } else if (lower.includes("api key") || lower.includes("chave ausente") || lower.includes("não conectado")) {
    selectedCode = "CRV-PROV-001";
  } else if (lower.includes("timeout") || lower.includes("etimedout") || lower.includes("ollama") || lower.includes("provedor")) {
    selectedCode = "CRV-PROV-003";
  } else if (lower.includes("captcha") || lower.includes("turnstile") || lower.includes("cloudflare") || lower.includes("2fa")) {
    selectedCode = "CRV-BROWSER-001";
  }

  const base = CRIATIVO_ERROR_CATALOG[selectedCode] ?? CRIATIVO_ERROR_CATALOG["CRV-SYS-500"]!;
  return {
    ...base,
    traceId,
    rawSummary: safeRaw.slice(0, 260),
  };
}
