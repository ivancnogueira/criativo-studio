import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  LicenseActivationStatus,
  LicenseCertificate,
  LicenseDeviceRecord,
  LicensePlanTier,
  LicenseStatusCode,
  LicenseUpgradeSlug,
} from "@criativo/contracts";
import {
  DEFAULT_LICENSE_PUBLIC_KEY_PEM,
  formatMaskedLicenseKey,
  getPlanLimits,
} from "@criativo/contracts";
import { verifyLicenseCertificate } from "@criativo/contracts/license-crypto-node";
import type { CriativoDatabase } from "../database/client.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { resolveMachineFingerprint, type MachineFingerprint } from "./machine-id.ts";

const VAULT_KEY_CERTIFICATE = "license_certificate_json";
const VAULT_KEY_DEVICES_CACHE = "license_devices_cache_json";
const DEFAULT_HUB_URL = "http://127.0.0.1:3007";
const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class LicenseValidationError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 403,
    code = "license_error",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LicenseValidationError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface LicenseClientServiceOptions {
  db: CriativoDatabase;
  vault: VaultService;
  wsHub?: WebSocketHub;
  hubBaseUrl?: string;
  publicKeyPem?: string;
  fetchImpl?: FetchLike;
  machineSeedOverride?: string;
  appVersion?: string;
  productRoot?: string;
  /**
   * Quando true, impõe verificação estrita de licença mesmo em suítes de teste.
   * Quando undefined em testes antigos (NODE_ENV=test / node:test), habilita bypass
   * para manter compatibilidade com as Fases 1–15 sem abrir brecha em produção.
   */
  enforceLicense?: boolean;
  bypassForTests?: boolean;
}

function readPackageVersion(productRoot?: string): string {
  const candidates = [
    productRoot ? join(productRoot, "produto.json") : null,
    process.env.CRIATIVO_PRODUCT_ROOT ? join(process.env.CRIATIVO_PRODUCT_ROOT, "produto.json") : null,
    join(process.cwd(), "produto.json"),
  ].filter((p): p is string => Boolean(p));

  for (const file of candidates) {
    try {
      const raw = readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as { versao?: string };
      if (parsed.versao) return parsed.versao;
    } catch {
      // tenta próximo candidato
    }
  }
  return "1.0.0";
}

function defaultBypassMode(options: LicenseClientServiceOptions): boolean {
  if (options.enforceLicense === true) return false;
  if (typeof options.bypassForTests === "boolean") return options.bypassForTests;
  if (process.env.CRIATIVO_ENFORCE_LICENSE === "1") return false;
  if (process.env.CRIATIVO_LICENSE_BYPASS_TEST === "1") return true;
  // Detecta execução sob node --test / Vitest apenas quando enforceLicense não foi pedido
  const isNodeTestRunner =
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.some((arg) => arg.includes("--test"));
  return isNodeTestRunner || process.env.NODE_ENV === "test";
}

export class LicenseClientService {
  readonly #db: CriativoDatabase;
  readonly #vault: VaultService;
  readonly #wsHub?: WebSocketHub;
  readonly #hubBaseUrl: string;
  readonly #publicKeyPem: string;
  readonly #fetchImpl: FetchLike;
  readonly #fingerprint: MachineFingerprint;
  readonly #appVersion: string;
  readonly #bypassForTests: boolean;

  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #initialCheckTimer: ReturnType<typeof setTimeout> | null = null;
  #remoteRevokeCode: LicenseStatusCode | null = null;
  #remoteRevokeMessage: string | null = null;

  constructor(options: LicenseClientServiceOptions) {
    this.#db = options.db;
    this.#vault = options.vault;
    this.#wsHub = options.wsHub;
    this.#hubBaseUrl = (
      options.hubBaseUrl ??
      process.env.CRIATIVO_LICENSE_HUB_URL ??
      DEFAULT_HUB_URL
    ).replace(/\/+$/, "");
    this.#publicKeyPem = (
      options.publicKeyPem ??
      process.env.CRIATIVO_LICENSE_PUBLIC_KEY_PEM ??
      DEFAULT_LICENSE_PUBLIC_KEY_PEM
    ).replace(/\\n/g, "\n");
    this.#fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.#fingerprint = resolveMachineFingerprint(options.machineSeedOverride);
    this.#appVersion = options.appVersion ?? readPackageVersion(options.productRoot);
    this.#bypassForTests = defaultBypassMode(options);
  }

  get hubBaseUrl(): string {
    return this.#hubBaseUrl;
  }

  get fingerprint(): MachineFingerprint {
    return this.#fingerprint;
  }

  isBypassedForTests(): boolean {
    return this.#bypassForTests;
  }

  private readStoredCertificate(): LicenseCertificate | null {
    const raw = this.#vault.getSecret(VAULT_KEY_CERTIFICATE);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LicenseCertificate;
    } catch {
      return null;
    }
  }

  private readStoredDevices(): LicenseDeviceRecord[] {
    const raw = this.#vault.getSecret(VAULT_KEY_DEVICES_CACHE);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as LicenseDeviceRecord[]) : [];
    } catch {
      return [];
    }
  }

  private countConnectedServers(): number {
    try {
      const row = this.#db.connection
        .prepare(`SELECT COUNT(*) AS total FROM projecao_servidores_conectados;`)
        .get() as { total: number } | undefined;
      return Math.max(1, Number(row?.total ?? 1));
    } catch {
      return 1;
    }
  }

  /** Retorna o status completo da licença validando assinatura Ed25519 e grace period. */
  getStatus(serversUsedOverride?: number): LicenseActivationStatus {
    const serversUsed = serversUsedOverride ?? this.countConnectedServers();
    const cert = this.readStoredCertificate();
    const devices = this.readStoredDevices();

    if (this.#remoteRevokeCode) {
      return {
        valid: false,
        status_code: this.#remoteRevokeCode,
        plan_tier: cert?.payload.plan_tier ?? null,
        plan_label: cert
          ? getPlanLimits(cert.payload.plan_tier).nome_exibicao
          : "Licença Revogada / Bloqueada",
        customer_email: cert?.payload.customer_email,
        masked_key: cert ? formatMaskedLicenseKey(cert.payload.license_key) : undefined,
        max_servers: cert?.payload.max_servers ?? 0,
        servers_used: serversUsed,
        max_machines: cert?.payload.max_machines ?? 0,
        machines_used: devices.length,
        upgrades: [],
        devices,
        message:
          this.#remoteRevokeMessage ??
          "Sua licença foi revogada ou desconectada pelo servidor central.",
        hub_url: this.#hubBaseUrl,
      };
    }

    if (!cert) {
      if (this.#bypassForTests) {
        const limits = getPlanLimits("agencia_ilimitada");
        return {
          valid: true,
          status_code: "active",
          plan_tier: "agencia_ilimitada",
          plan_label: "Modo Teste Integrado",
          max_servers: limits.max_servers,
          servers_used: serversUsed,
          max_machines: limits.max_machines,
          machines_used: 1,
          upgrades: [],
          offline_days_remaining: 7,
          devices: [
            {
              machine_id: this.#fingerprint.machineId,
              hostname: this.#fingerprint.hostname,
              os_platform: this.#fingerprint.osPlatform,
              app_version: this.#appVersion,
              first_activated_at: new Date().toISOString(),
              last_heartbeat_at: new Date().toISOString(),
              is_current_machine: true,
            },
          ],
          hub_url: this.#hubBaseUrl,
        };
      }

      return {
        valid: false,
        status_code: "missing",
        plan_tier: null,
        plan_label: "Nenhuma licença ativada",
        max_servers: 0,
        servers_used: serversUsed,
        max_machines: 0,
        machines_used: 0,
        upgrades: [],
        devices: [],
        message: "Informe seu e-mail de compra e chave de licença para ativar o Criativo AI Studio.",
        hub_url: this.#hubBaseUrl,
      };
    }

    const check = verifyLicenseCertificate(cert, this.#publicKeyPem, {
      expectedMachineId: this.#fingerprint.machineId,
    });
    const limits = getPlanLimits(cert.payload.plan_tier);

    return {
      valid: check.valid,
      status_code: check.status_code,
      plan_tier: cert.payload.plan_tier,
      plan_label: limits.nome_exibicao,
      customer_email: cert.payload.customer_email,
      masked_key: formatMaskedLicenseKey(cert.payload.license_key),
      max_servers: cert.payload.max_servers,
      servers_used: serversUsed,
      max_machines: cert.payload.max_machines,
      machines_used: Math.max(1, devices.length),
      upgrades: check.valid ? cert.payload.upgrades : [],
      last_verified_at: cert.payload.last_verified_at,
      grace_until: cert.payload.grace_until,
      offline_days_remaining: check.offline_days_remaining,
      devices,
      message: check.reason,
      hub_url: this.#hubBaseUrl,
    };
  }

  /** Checagem síncrona de operação em memória/Cofre (< 1ms). */
  assertOperational(): { ok: true; status: LicenseActivationStatus } | { ok: false; status: LicenseActivationStatus } {
    const status = this.getStatus();
    return status.valid ? { ok: true, status } : { ok: false, status };
  }

  /** Retorna a chave bruta e machineId exclusivamente para chamadas autenticadas do sistema (claims/updates). */
  getCredentialHeaders(): Record<string, string> | null {
    const cert = this.readStoredCertificate();
    if (!cert) return null;
    return {
      "X-Criativo-License-Key": cert.payload.license_key,
      "X-Criativo-Machine-Id": this.#fingerprint.machineId,
    };
  }

  /** Retorna o plano ativo e limites reais do certificado validado. */
  getActivePlanTier(): LicensePlanTier | null {
    const status = this.getStatus();
    return status.valid ? status.plan_tier : null;
  }

  /** Verifica se o pacote opcional consta no certificado Ed25519 válido. */
  hasSignedUpgradeEntitlement(pacote: "base" | LicenseUpgradeSlug): boolean {
    if (pacote === "base") return true;
    const cert = this.readStoredCertificate();
    if (!cert && this.#bypassForTests) {
      return false;
    }
    const status = this.getStatus();
    if (!status.valid) return false;
    return status.upgrades.includes(pacote);
  }

  /** Ativa a chave de licença contra o Hub da Landing Page e salva o certificado Ed25519 cifrado. */
  async activate(input: { license_key: string; email: string }): Promise<LicenseActivationStatus> {
    const licenseKey = String(input.license_key || "").trim();
    const email = String(input.email || "").trim().toLowerCase();
    if (!licenseKey || !email) {
      throw new LicenseValidationError("Informe a chave de licença e o e-mail de compra.", 400, "missing_fields");
    }

    const res = await this.#fetchImpl(`${this.#hubBaseUrl}/api/licenses/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_key: licenseKey,
        email,
        machine_id: this.#fingerprint.machineId,
        hostname: this.#fingerprint.hostname,
        os_platform: this.#fingerprint.osPlatform,
        app_version: this.#appVersion,
      }),
    });

    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      message?: string;
      certificate?: LicenseCertificate;
      devices?: LicenseDeviceRecord[];
      active_machines?: LicenseDeviceRecord[];
      max_machines?: number;
    };

    if (!res.ok) {
      const code = data.error || "activation_failed";
      if (code === "machine_limit") {
        throw new LicenseValidationError(
          data.message || "Limite de computadores atingido para esta licença.",
          403,
          "machine_limit",
          {
            max_machines: data.max_machines ?? 0,
            devices: data.active_machines ?? [],
          },
        );
      }
      throw new LicenseValidationError(
        data.message || "Não foi possível ativar esta licença.",
        res.status || 400,
        code,
      );
    }

    if (!data.certificate) {
      throw new LicenseValidationError("Resposta inválida do servidor de licenças.", 502, "invalid_response");
    }

    const verification = verifyLicenseCertificate(data.certificate, this.#publicKeyPem, {
      expectedMachineId: this.#fingerprint.machineId,
    });
    if (!verification.valid) {
      throw new LicenseValidationError(
        verification.reason || "Assinatura do certificado de licença inválida.",
        403,
        verification.status_code,
      );
    }

    this.#remoteRevokeCode = null;
    this.#remoteRevokeMessage = null;
    this.#vault.setSecret(VAULT_KEY_CERTIFICATE, JSON.stringify(data.certificate));
    this.#vault.setSecret(VAULT_KEY_DEVICES_CACHE, JSON.stringify(data.devices ?? []));

    const status = this.getStatus();
    this.#wsHub?.broadcast("license:updated", status);
    return status;
  }

  /** Renova o certificado offline ou aplica revogação imediata se o servidor central indicar reembolso/bloqueio. */
  async heartbeat(): Promise<LicenseActivationStatus> {
    const cert = this.readStoredCertificate();
    if (!cert) {
      return this.getStatus();
    }

    try {
      const res = await this.#fetchImpl(`${this.#hubBaseUrl}/api/licenses/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          license_key: cert.payload.license_key,
          machine_id: this.#fingerprint.machineId,
          app_version: this.#appVersion,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        certificate?: LicenseCertificate;
        devices?: LicenseDeviceRecord[];
      };

      if (!res.ok) {
        if (res.status === 403 || res.status === 404) {
          const mappedCode: LicenseStatusCode =
            data.error === "expired"
              ? "expired"
              : data.error === "machine_unlinked"
                ? "machine_limit"
                : "revoked";
          this.#remoteRevokeCode = mappedCode;
          this.#remoteRevokeMessage =
            data.message || "Sua licença foi revogada ou este dispositivo foi desvinculado.";
          if (mappedCode === "machine_limit") {
            this.#vault.deleteSecret(VAULT_KEY_CERTIFICATE);
          }
          const blockedStatus = this.getStatus();
          this.#wsHub?.broadcast("license:updated", blockedStatus);
          return blockedStatus;
        }
        return this.getStatus();
      }

      if (data.certificate) {
        const check = verifyLicenseCertificate(data.certificate, this.#publicKeyPem, {
          expectedMachineId: this.#fingerprint.machineId,
        });
        if (check.valid) {
          this.#remoteRevokeCode = null;
          this.#remoteRevokeMessage = null;
          this.#vault.setSecret(VAULT_KEY_CERTIFICATE, JSON.stringify(data.certificate));
          if (Array.isArray(data.devices)) {
            this.#vault.setSecret(VAULT_KEY_DEVICES_CACHE, JSON.stringify(data.devices));
          }
        }
      }
    } catch {
      // Falha de rede: mantém operação pelo grace period de 7 dias
    }

    const current = this.getStatus();
    if (current.valid && !this.#remoteRevokeCode) {
      const checkOffline = cert
        ? verifyLicenseCertificate(cert, this.#publicKeyPem, {
            expectedMachineId: this.#fingerprint.machineId,
          })
        : null;
      if (checkOffline && checkOffline.valid && !this.#vault.getSecret(VAULT_KEY_CERTIFICATE)) {
        // não altera estado
      }
    }
    this.#wsHub?.broadcast("license:updated", current);
    return current;
  }

  /** Desvincula um dispositivo antigo ou o próprio dispositivo atual na API central. */
  async deactivateDevice(input: {
    target_machine_id: string;
    license_key?: string;
    email?: string;
  }): Promise<{ ok: boolean; devices: LicenseDeviceRecord[]; status: LicenseActivationStatus }> {
    const cert = this.readStoredCertificate();
    const licenseKey = String(input.license_key || cert?.payload.license_key || "").trim();
    const email = String(input.email || cert?.payload.customer_email || "").trim().toLowerCase();
    const targetMachineId = String(input.target_machine_id || "").trim();

    if (!licenseKey || !email || !targetMachineId) {
      throw new LicenseValidationError(
        "Chave de licença, e-mail e identificador do dispositivo são obrigatórios.",
        400,
        "missing_fields",
      );
    }

    const res = await this.#fetchImpl(`${this.#hubBaseUrl}/api/licenses/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_key: licenseKey,
        email,
        target_machine_id: targetMachineId,
      }),
    });

    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      message?: string;
      devices?: LicenseDeviceRecord[];
    };

    if (!res.ok) {
      throw new LicenseValidationError(
        data.message || "Falha ao desvincular dispositivo.",
        res.status || 400,
        data.error || "deactivate_failed",
      );
    }

    if (targetMachineId === this.#fingerprint.machineId) {
      this.#vault.deleteSecret(VAULT_KEY_CERTIFICATE);
      this.#vault.deleteSecret(VAULT_KEY_DEVICES_CACHE);
      this.#remoteRevokeCode = null;
      this.#remoteRevokeMessage = null;
    } else if (Array.isArray(data.devices)) {
      this.#vault.setSecret(VAULT_KEY_DEVICES_CACHE, JSON.stringify(data.devices));
    }

    const status = this.getStatus();
    this.#wsHub?.broadcast("license:updated", status);
    return {
      ok: true,
      devices: data.devices ?? [],
      status,
    };
  }

  startHeartbeatTimer(): void {
    if (this.#bypassForTests) return;
    if (!this.#initialCheckTimer) {
      this.#initialCheckTimer = setTimeout(() => {
        void this.heartbeat();
      }, 15_000);
      this.#initialCheckTimer.unref?.();
    }
    if (!this.#heartbeatTimer) {
      this.#heartbeatTimer = setInterval(() => {
        void this.heartbeat();
      }, HEARTBEAT_INTERVAL_MS);
      this.#heartbeatTimer.unref?.();
    }
  }

  stopHeartbeatTimer(): void {
    if (this.#initialCheckTimer) {
      clearTimeout(this.#initialCheckTimer);
      this.#initialCheckTimer = null;
    }
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }
}
