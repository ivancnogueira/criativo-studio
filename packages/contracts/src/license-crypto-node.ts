import { generateKeyPairSync, sign, verify } from "node:crypto";
import type { LicenseCertificate, LicensePayload, LicenseStatusCode } from "./index.ts";
import { canonicalizeLicensePayload, evaluateLicenseTemporalState } from "./license-crypto.ts";

/** Gera um par de chaves Ed25519 em PEM para assinatura de certificados de licença. */
export function generateLicenseKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/** Assina um payload canônico de licença usando chave privada Ed25519. */
export function signLicensePayload(
  payload: LicensePayload,
  privateKeyPem: string,
  keyId = "criativo-ed25519-1",
): LicenseCertificate {
  const canonical = canonicalizeLicensePayload(payload);
  const signature = sign(null, Buffer.from(canonical, "utf8"), privateKeyPem).toString("base64url");
  return {
    payload,
    signature,
    key_id: keyId,
  };
}

/** Verifica assinatura Ed25519, machine_id, status e prazo de tolerância offline de um certificado. */
export function verifyLicenseCertificate(
  cert: LicenseCertificate,
  publicKeyPem: string,
  options?: { expectedMachineId?: string; now?: Date },
): {
  valid: boolean;
  status_code: LicenseStatusCode;
  offline_days_remaining: number;
  reason?: string;
} {
  if (!cert || !cert.payload || typeof cert.signature !== "string" || !cert.signature) {
    return {
      valid: false,
      status_code: "invalid_signature",
      offline_days_remaining: 0,
      reason: "Certificado malformado.",
    };
  }

  try {
    const canonical = canonicalizeLicensePayload(cert.payload);
    const sigBuffer = Buffer.from(cert.signature, "base64url");
    const ok = verify(null, Buffer.from(canonical, "utf8"), publicKeyPem, sigBuffer);
    if (!ok) {
      return {
        valid: false,
        status_code: "invalid_signature",
        offline_days_remaining: 0,
        reason: "Assinatura Ed25519 inválida.",
      };
    }
  } catch {
    return {
      valid: false,
      status_code: "invalid_signature",
      offline_days_remaining: 0,
      reason: "Falha ao verificar chave pública Ed25519.",
    };
  }

  return evaluateLicenseTemporalState(cert, options);
}
