import type {
  LicenseCertificate,
  LicenseLimitsConfig,
  LicensePayload,
  LicensePlanTier,
  LicenseStatusCode,
} from "./index.ts";

/** Matriz comercial oficial dos 3 planos do Criativo AI Studio Online. */
export const LICENSE_PLAN_MATRIX: Record<LicensePlanTier, LicenseLimitsConfig> = {
  individual: {
    plan_tier: "individual",
    nome_exibicao: "Licença Individual",
    max_servers: 2,
    max_local_servers: 1,
    max_remote_servers: 1,
    max_machines: 2,
    permite_multimarca: false,
  },
  agencia_10: {
    plan_tier: "agencia_10",
    nome_exibicao: "Licença Agência 10",
    max_servers: 10,
    max_local_servers: 10,
    max_remote_servers: 10,
    max_machines: 3,
    permite_multimarca: true,
  },
  agencia_ilimitada: {
    plan_tier: "agencia_ilimitada",
    nome_exibicao: "Licença Agência Ilimitada",
    max_servers: -1,
    max_local_servers: -1,
    max_remote_servers: -1,
    max_machines: 5,
    permite_multimarca: true,
  },
};

/** Chave pública Ed25519 padrão (material público; pode ser sobrescrita via CRIATIVO_LICENSE_PUBLIC_KEY_PEM). */
export const DEFAULT_LICENSE_PUBLIC_KEY_PEM = [
  "-----BEGIN PUBLIC KEY-----",
  "MCowBQYDK2VwAyEAwNhY9x8gzbqvzpsjpUBfCYGiujGM++r07p3wQ6Vi7ds=",
  "-----END PUBLIC KEY-----",
  "",
].join("\n");

export const LICENSE_GRACE_DAYS = 7;

function sortValueRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValueRecursively(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const prop = (value as Record<string, unknown>)[key];
      if (prop !== undefined) {
        out[key] = sortValueRecursively(prop);
      }
    }
    return out;
  }
  return value;
}

/**
 * Serializa o payload de licença com chaves ordenadas deterministicamente
 * para assinatura/verificação idêntica entre Hub da Landing e Daemon.
 */
export function canonicalizeLicensePayload(payload: LicensePayload): string {
  return JSON.stringify(sortValueRecursively(payload));
}

export function formatMaskedLicenseKey(key: string): string {
  const clean = String(key || "").trim();
  if (!clean) return "";
  const parts = clean.split("-");
  if (parts.length >= 4) {
    return `${parts[0]}-${parts[1]}-••••-${parts[parts.length - 1]}`;
  }
  if (clean.length <= 8) return "••••";
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export function getPlanLimits(planTier: LicensePlanTier): LicenseLimitsConfig {
  return LICENSE_PLAN_MATRIX[planTier] ?? LICENSE_PLAN_MATRIX.individual;
}

/**
 * Avalia regras temporais e de máquina do certificado após verificação criptográfica da assinatura.
 */
export function evaluateLicenseTemporalState(
  cert: LicenseCertificate,
  options?: { expectedMachineId?: string; now?: Date },
): {
  valid: boolean;
  status_code: LicenseStatusCode;
  offline_days_remaining: number;
  reason?: string;
} {
  const nowMs = (options?.now ?? new Date()).getTime();
  const payload = cert.payload;

  if (options?.expectedMachineId && payload.machine_id !== options.expectedMachineId) {
    return {
      valid: false,
      status_code: "machine_limit",
      offline_days_remaining: 0,
      reason: "Certificado emitido para outro dispositivo (machine_id divergente).",
    };
  }

  if (payload.status === "revoked" || payload.status === "suspended") {
    return {
      valid: false,
      status_code: "revoked",
      offline_days_remaining: 0,
      reason: "Licença revogada ou suspensa (reembolso/cancelamento).",
    };
  }

  if (payload.status === "expired") {
    return {
      valid: false,
      status_code: "expired",
      offline_days_remaining: 0,
      reason: "Licença expirada.",
    };
  }

  if (payload.expires_at) {
    const expMs = Date.parse(payload.expires_at);
    if (Number.isFinite(expMs) && nowMs > expMs) {
      return {
        valid: false,
        status_code: "expired",
        offline_days_remaining: 0,
        reason: "Vigência do plano expirada.",
      };
    }
  }

  const graceMs = Date.parse(payload.grace_until);
  if (!Number.isFinite(graceMs)) {
    return {
      valid: false,
      status_code: "invalid_signature",
      offline_days_remaining: 0,
      reason: "Campo grace_until inválido no certificado.",
    };
  }

  const msRemaining = graceMs - nowMs;
  if (msRemaining < 0) {
    return {
      valid: false,
      status_code: "grace_exceeded",
      offline_days_remaining: 0,
      reason: "Prazo de tolerância offline de 7 dias excedido. Conecte-se à internet para validar.",
    };
  }

  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
  return {
    valid: true,
    status_code: "active",
    offline_days_remaining: daysRemaining,
  };
}
