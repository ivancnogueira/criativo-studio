import { resolveMetaGraphApiBase, type MetaTrialEligibilityResult } from "@criativo/contracts";
import type { FetchLike } from "../providers/provider-interface.ts";

export const MIN_TRIAL_REEL_FOLLOWERS = 1000;

export function redactMetaSecrets(text: string, token?: string | null): string {
  let clean = text.replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]");
  if (token && token.trim().length > 0) {
    clean = clean.split(token.trim()).join("[REDACTED]");
  }
  return clean;
}

export async function checkMetaTrialReelEligibility(input: {
  accessToken: string;
  igUserId: string;
  apiVersion?: string;
  fetchImpl?: FetchLike;
}): Promise<MetaTrialEligibilityResult> {
  const accessToken = input.accessToken.trim();
  const igUserId = input.igUserId.trim();
  const fetchFn = input.fetchImpl ?? fetch;
  const graphBase = resolveMetaGraphApiBase(input.apiVersion);
  const endpoint =
    `${graphBase}/${encodeURIComponent(igUserId)}` +
    `?fields=id,username,followers_count,account_type&access_token=${encodeURIComponent(accessToken)}`;

  try {
    const res = await fetchFn(endpoint, { method: "GET" });
    const rawText = await res.text();
    let parsed: {
      id?: string;
      username?: string;
      followers_count?: number;
      account_type?: string;
      error?: { message?: string; code?: number; error_subcode?: number };
    } = {};
    try {
      parsed = rawText ? (JSON.parse(rawText) as typeof parsed) : {};
    } catch {
      parsed = {};
    }

    if (!res.ok) {
      const apiMsg = parsed.error?.message
        ? redactMetaSecrets(parsed.error.message, accessToken)
        : `HTTP ${res.status}`;
      return {
        ok: false,
        eligible: false,
        followers_count: null,
        min_followers: MIN_TRIAL_REEL_FOLLOWERS,
        username: null,
        account_type: null,
        error_code: "CRV-META-API-ERROR",
        reason: `Falha ao validar elegibilidade de Trial Reel na Meta Graph API: ${apiMsg}.`,
      };
    }

    const username = typeof parsed.username === "string" && parsed.username.trim()
      ? parsed.username.trim()
      : null;
    const accountType = typeof parsed.account_type === "string" && parsed.account_type.trim()
      ? parsed.account_type.trim()
      : null;
    const followersCount =
      typeof parsed.followers_count === "number" && Number.isFinite(parsed.followers_count)
        ? parsed.followers_count
        : null;

    if (accountType && accountType.toUpperCase() === "PERSONAL") {
      return {
        ok: true,
        eligible: false,
        followers_count: followersCount,
        min_followers: MIN_TRIAL_REEL_FOLLOWERS,
        username,
        account_type: accountType,
        error_code: "CRV-META-TRIAL-ACCOUNT-TYPE",
        reason: "Trial Reels exigem conta Instagram Profissional (Business ou Creator).",
      };
    }

    if (typeof followersCount === "number" && followersCount < MIN_TRIAL_REEL_FOLLOWERS) {
      return {
        ok: true,
        eligible: false,
        followers_count: followersCount,
        min_followers: MIN_TRIAL_REEL_FOLLOWERS,
        username,
        account_type: accountType,
        error_code: "CRV-META-TRIAL-ELIGIBILITY",
        reason:
          `Trial Reels requerem no mínimo 1.000 seguidores (conta atual possui ${followersCount}). ` +
          `Publique como Reel padrão ou aguarde atingir 1.000 seguidores.`,
      };
    }

    if (followersCount === null) {
      return {
        ok: true,
        eligible: false,
        followers_count: null,
        min_followers: MIN_TRIAL_REEL_FOLLOWERS,
        username,
        account_type: accountType,
        error_code: "CRV-META-TRIAL-FOLLOWERS-UNKNOWN",
        reason:
          "Não foi possível confirmar a contagem de seguidores da conta. " +
          "Verifique as permissões instagram_basic e instagram_manage_insights na Meta.",
      };
    }

    return {
      ok: true,
      eligible: true,
      followers_count: followersCount,
      min_followers: MIN_TRIAL_REEL_FOLLOWERS,
      username,
      account_type: accountType,
      reason: `Conta elegível para Trial Reels (${followersCount} seguidores).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? redactMetaSecrets(err.message, accessToken) : "Erro de rede";
    return {
      ok: false,
      eligible: false,
      followers_count: null,
      min_followers: MIN_TRIAL_REEL_FOLLOWERS,
      username: null,
      account_type: null,
      error_code: "CRV-META-API-ERROR",
      reason: `Erro ao consultar elegibilidade de Trial Reel na Meta Graph API: ${msg}.`,
    };
  }
}

export function mapTrialReelContainerError(
  errorPayload: { message?: string; code?: number; error_subcode?: number } | undefined,
  httpStatus: number
): string {
  const rawMsg = redactMetaSecrets(errorPayload?.message ?? "");
  const lower = rawMsg.toLowerCase();
  const code = errorPayload?.code;
  const subcode = errorPayload?.error_subcode;

  if (lower.includes("trial") || lower.includes("follower") || lower.includes("eligible")) {
    return (
      `CRV-META-TRIAL-ELIGIBILITY: A Meta Graph API recusou o container Trial Reel ` +
      `(HTTP ${httpStatus}${code ? ` / code ${code}` : ""}${subcode ? ` / subcode ${subcode}` : ""}). ` +
      `Verifique se a conta é pública, profissional e elegível a Trial Reels, ou publique como Reel padrão.`
    );
  }

  if (code === 10 || code === 200 || lower.includes("permission")) {
    return (
      `CRV-META-TRIAL-PERMISSION: Permissão insuficiente na Meta Graph API para criar Trial Reel ` +
      `(HTTP ${httpStatus}). Confirme o escopo instagram_content_publish e tente novamente.`
    );
  }

  return rawMsg
    ? `Falha ao criar container Trial Reel na Meta API (HTTP ${httpStatus}): ${rawMsg}`
    : `Falha ao criar container Trial Reel na Meta API: HTTP ${httpStatus}`;
}
