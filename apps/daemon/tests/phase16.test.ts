import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  generateLicenseKeyPair,
  signLicensePayload,
  verifyLicenseCertificate,
} from "@criativo/contracts/license-crypto-node";
import type { LicensePayload } from "@criativo/contracts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { isUpgradeUnlocked } from "../src/server/studio-tools-bridge.ts";

// Import dinâmico tipado do Hub da Landing Page
const landingServerUrl = new URL("../../../../criativo-ai-studio-landing/server.js", import.meta.url).href;
const { createLandingApp } = (await import(landingServerUrl)) as {
  createLandingApp: (options?: Record<string, unknown>) => {
    app: { listen: (port: number, host: string, cb: () => void) => import("node:http").Server };
    licenseHub: {
      issueOrUpdateLicenseFromSale: (input: Record<string, unknown>) => { license_key: string; id: string };
      close: () => void;
    };
  };
};

describe("Fase 16 — Licenciamento 3 Planos, Hub VPS, Webhooks & Blindagem de Upgrades", () => {
  const tempDirs: string[] = [];
  const runtimes: DaemonRuntime[] = [];
  const closeHooks: Array<() => Promise<void> | void> = [];

  after(async () => {
    for (const rt of runtimes) {
      await rt.close().catch(() => {});
    }
    for (const fn of closeHooks) {
      await fn();
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function startEphemeralHub(overrides: Record<string, unknown> = {}) {
    const dir = makeTempDir("criativo-hub-");
    const keys = generateLicenseKeyPair();
    const adminToken = "adm-token-phase16-test";
    const hotmartHottok = "hottok-phase16-test";
    const kiwifyToken = "kiwify-phase16-test";
    const stripeSecret = "whsec_phase16_test";

    const { app, licenseHub } = createLandingApp({
      distDir: join(dir, "dist-empty"),
      bonusDir: join(dir, "bonus-empty"),
      licenseHub: {
        dbPath: join(dir, "licencas.db"),
        privateKeyPem: keys.privateKeyPem,
        publicKeyPem: keys.publicKeyPem,
        adminToken,
      },
      salesWebhooks: {
        hotmartHottok,
        kiwifyToken,
        stripeSecret,
        productMap: {
          PROD_IND: { planTier: "individual", addUpgrades: [] },
          PROD_UP_VIDEO: { planTier: "individual", addUpgrades: ["video"] },
          PROD_AG10: { planTier: "agencia_10", addUpgrades: ["bonus"] },
          PROD_AGIL: { planTier: "agencia_ilimitada", addUpgrades: ["bonus", "video"] },
        },
      },
      ...overrides,
    });

    const server = await new Promise<import("node:http").Server>((resolveListen) => {
      const s = app.listen(0, "127.0.0.1", () => resolveListen(s));
    });
    const addr = server.address() as { port: number };
    const hubUrl = `http://127.0.0.1:${addr.port}`;

    closeHooks.push(async () => {
      licenseHub.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    });

    return { hubUrl, keys, adminToken, hotmartHottok, kiwifyToken, stripeSecret, licenseHub };
  }

  it("Bloco 1: Assinatura Ed25519 aceita certificado íntegro e rejeita adulteração de plano/upgrades", () => {
    const keys = generateLicenseKeyPair();
    const now = new Date();
    const payload: LicensePayload = {
      version: 1,
      license_id: "lic_test_1",
      license_key: "CRIA-IND-1111-2222-3333",
      customer_email: "comprador@exemplo.invalid",
      plan_tier: "individual",
      status: "active",
      max_servers: 2,
      max_machines: 2,
      upgrades: [],
      machine_id: "machine-hash-abc",
      issued_at: now.toISOString(),
      last_verified_at: now.toISOString(),
      grace_until: new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString(),
      expires_at: null,
    };

    const cert = signLicensePayload(payload, keys.privateKeyPem, "test-key");
    const validRes = verifyLicenseCertificate(cert, keys.publicKeyPem, {
      expectedMachineId: "machine-hash-abc",
    });
    assert.equal(validRes.valid, true);
    assert.equal(validRes.status_code, "active");

    // Adulteração de upgrades ou plano deve falhar
    const tamperedUpgrades = {
      ...cert,
      payload: { ...cert.payload, upgrades: ["bonus", "video"] as Array<"bonus" | "video"> },
    };
    const badRes1 = verifyLicenseCertificate(tamperedUpgrades, keys.publicKeyPem, {
      expectedMachineId: "machine-hash-abc",
    });
    assert.equal(badRes1.valid, false);
    assert.equal(badRes1.status_code, "invalid_signature");

    // Adulteração de machine_id também falha na assinatura e na correspondência
    const wrongMachine = verifyLicenseCertificate(cert, keys.publicKeyPem, {
      expectedMachineId: "other-machine",
    });
    assert.equal(wrongMachine.valid, false);
    assert.equal(wrongMachine.status_code, "machine_limit");
  });

  it("Bloco 2: Aplica limites 2/3/5 dispositivos nos 3 planos e controla troca self-service no Hub", async () => {
    const { hubUrl, licenseHub } = await startEphemeralHub();

    const indLic = licenseHub.issueOrUpdateLicenseFromSale({
      email: "ind@exemplo.invalid",
      planTier: "individual",
    });
    const ag10Lic = licenseHub.issueOrUpdateLicenseFromSale({
      email: "ag10@exemplo.invalid",
      planTier: "agencia_10",
    });
    const agilLic = licenseHub.issueOrUpdateLicenseFromSale({
      email: "agil@exemplo.invalid",
      planTier: "agencia_ilimitada",
    });

    const activateMachine = async (license_key: string, email: string, machine_id: string) => {
      const r = await fetch(`${hubUrl}/api/licenses/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          license_key,
          email,
          machine_id,
          hostname: `pc-${machine_id}`,
          os_platform: "win32-x64",
        }),
      });
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    };

    // Individual: máx 2 máquinas
    assert.equal((await activateMachine(indLic.license_key, "ind@exemplo.invalid", "m1")).status, 200);
    assert.equal((await activateMachine(indLic.license_key, "ind@exemplo.invalid", "m2")).status, 200);
    const ind3 = await activateMachine(indLic.license_key, "ind@exemplo.invalid", "m3");
    assert.equal(ind3.status, 403);
    assert.equal(ind3.body.error, "machine_limit");

    // Desvinculação self-service libera slot (máx 2 trocas em 30d; 3ª bloqueia com 429)
    const deactivate = async (target: string) =>
      fetch(`${hubUrl}/api/licenses/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          license_key: indLic.license_key,
          email: "ind@exemplo.invalid",
          target_machine_id: target,
        }),
      });
    assert.equal((await deactivate("m1")).status, 200);
    assert.equal((await activateMachine(indLic.license_key, "ind@exemplo.invalid", "m3")).status, 200);
    assert.equal((await deactivate("m2")).status, 200);
    const thirdUnlink = await deactivate("m3");
    assert.equal(thirdUnlink.status, 429);

    // Agência 10: máx 3 máquinas
    for (const m of ["a1", "a2", "a3"]) {
      assert.equal((await activateMachine(ag10Lic.license_key, "ag10@exemplo.invalid", m)).status, 200);
    }
    const ag10_4 = await activateMachine(ag10Lic.license_key, "ag10@exemplo.invalid", "a4");
    assert.equal(ag10_4.status, 403);

    // Agência Ilimitada: máx 5 máquinas
    for (const m of ["u1", "u2", "u3", "u4", "u5"]) {
      assert.equal((await activateMachine(agilLic.license_key, "agil@exemplo.invalid", m)).status, 200);
    }
    const agil_6 = await activateMachine(agilLic.license_key, "agil@exemplo.invalid", "u6");
    assert.equal(agil_6.status, 403);
  });

  it("Bloco 3: Webhooks Hotmart/Kiwify/Stripe emitem licença/upgrade e reembolso bloqueia Daemon com HTTP 402", async () => {
    const { hubUrl, keys, hotmartHottok, kiwifyToken, stripeSecret } = await startEphemeralHub();
    const wsDir = makeTempDir("criativo-daemon-lic-");

    const runtime = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(wsDir, "criativo.db"),
      workspaceRoot: wsDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      licenseHubUrl: hubUrl,
      licensePublicKeyPem: keys.publicKeyPem,
      enforceLicense: true,
      machineSeedOverride: "pc-comprador-01",
    });
    runtimes.push(runtime);
    const daemonUrl = `http://127.0.0.1:${runtime.port}`;

    // Sem licença, rota protegida retorna 402
    const blockedRes = await fetch(`${daemonUrl}/api/agentes`);
    assert.equal(blockedRes.status, 402);

    // 1) Compra aprovada na Hotmart
    const hotmartRes = await fetch(`${hubUrl}/api/webhooks/sales?provider=hotmart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hotmart-Hottok": hotmartHottok,
      },
      body: JSON.stringify({
        event: "PURCHASE_APPROVED",
        data: {
          purchase: { transaction: "HP-1001" },
          buyer: { email: "cliente.vendas@exemplo.invalid", name: "Cliente Teste" },
          product: { id: "PROD_IND", name: "Criativo Individual" },
        },
      }),
    });
    const hotmartJson = (await hotmartRes.json()) as { ok: boolean; license_key: string };
    assert.equal(hotmartJson.ok, true);
    assert.match(hotmartJson.license_key, /^CRIA-IND-/);

    // 2) Upsell de Vídeo na Kiwify para o mesmo e-mail
    const kiwifyRes = await fetch(`${hubUrl}/api/webhooks/sales?provider=kiwify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kiwify-Token": kiwifyToken,
      },
      body: JSON.stringify({
        webhook_event_type: "compra_aprovada",
        order_id: "KW-2002",
        Customer: { email: "cliente.vendas@exemplo.invalid", full_name: "Cliente Teste" },
        Product: { product_id: "PROD_UP_VIDEO", product_name: "Criativo Video Studio" },
      }),
    });
    const kiwifyJson = (await kiwifyRes.json()) as { ok: boolean; license_key: string };
    assert.equal(kiwifyJson.license_key, hotmartJson.license_key);

    // Ativa no Daemon
    const actRes = await fetch(`${daemonUrl}/api/studio/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_key: hotmartJson.license_key,
        email: "cliente.vendas@exemplo.invalid",
      }),
    });
    assert.equal(actRes.status, 200);
    const actJson = (await actRes.json()) as { license: { valid: boolean; upgrades: string[] } };
    assert.equal(actJson.license.valid, true);
    assert.deepEqual(actJson.license.upgrades, ["video"]);

    // Agora rotas protegidas funcionam (200)
    const agentsRes = await fetch(`${daemonUrl}/api/agentes`);
    assert.equal(agentsRes.status, 200);

    // 3) Reembolso via Stripe HMAC-SHA256 revoga a licença
    const stripeBody = JSON.stringify({
      id: "evt_stripe_refund_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_123",
          receipt_email: "cliente.vendas@exemplo.invalid",
        },
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto
      .createHmac("sha256", stripeSecret)
      .update(`${ts}.${stripeBody}`)
      .digest("hex");

    const stripeRes = await fetch(`${hubUrl}/api/webhooks/sales?provider=stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${ts},v1=${sig}`,
      },
      body: stripeBody,
    });
    const stripeJson = (await stripeRes.json()) as { action: string };
    assert.equal(stripeJson.action, "revoked");

    // Heartbeat detecta revogação e Daemon volta a bloquear rotas com 402
    const hbRes = await fetch(`${daemonUrl}/api/studio/license/heartbeat`, { method: "POST" });
    const hbJson = (await hbRes.json()) as { ok: boolean; license: { valid: boolean; status_code: string } };
    assert.equal(hbJson.ok, false);
    assert.equal(hbJson.license.status_code, "revoked");

    const blockedAfterRefund = await fetch(`${daemonUrl}/api/agentes`);
    assert.equal(blockedAfterRefund.status, 402);
  });

  it("Bloco 4: Grace period offline de 7 dias e blindagem absoluta de upgrades contra edição no SQLite", async () => {
    const { hubUrl, keys, licenseHub } = await startEphemeralHub();
    const wsDir = makeTempDir("criativo-daemon-blind-");

    const lic = licenseHub.issueOrUpdateLicenseFromSale({
      email: "blindado@exemplo.invalid",
      planTier: "agencia_10",
      addUpgrades: [], // Nenhum upgrade comprado inicialmente
    });

    const runtime = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(wsDir, "criativo.db"),
      workspaceRoot: wsDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      licenseHubUrl: hubUrl,
      licensePublicKeyPem: keys.publicKeyPem,
      enforceLicense: true,
      machineSeedOverride: "pc-blindagem-01",
    });
    runtimes.push(runtime);
    const daemonUrl = `http://127.0.0.1:${runtime.port}`;

    await fetch(`${daemonUrl}/api/studio/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key: lic.license_key, email: "blindado@exemplo.invalid" }),
    });

    // Tentativa de fraude: injetar upgrades_instalados diretamente no SQLite
    runtime.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES ('upgrades_instalados', '["bonus","video"]', ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json;`,
      )
      .run(new Date().toISOString());

    assert.equal(isUpgradeUnlocked(runtime.db, wsDir, "bonus", runtime.licenseService), false);
    assert.equal(isUpgradeUnlocked(runtime.db, wsDir, "video", runtime.licenseService), false);

    // Rota de instalar upgrade deve recusar com 403 se licença não tiver entitlement
    const tryInstallRes = await fetch(`${daemonUrl}/api/upgrades/instalar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pacote: "bonus" }),
    });
    assert.equal(tryInstallRes.status, 403);

    // Após compra legítima no Hub + heartbeat, upgrade desbloqueia via certificado Ed25519
    licenseHub.issueOrUpdateLicenseFromSale({
      email: "blindado@exemplo.invalid",
      planTier: "agencia_10",
      addUpgrades: ["bonus"],
    });
    await runtime.licenseService.heartbeat();
    assert.equal(isUpgradeUnlocked(runtime.db, wsDir, "bonus", runtime.licenseService), true);
    assert.equal(isUpgradeUnlocked(runtime.db, wsDir, "video", runtime.licenseService), false);

    // Grace period offline: 6 dias no futuro ainda válido; 8 dias no futuro expira (grace_exceeded)
    const certRaw = runtime.vault.getSecret("license_certificate_json");
    assert.ok(certRaw);
    const parsedCert = JSON.parse(certRaw);
    const in6Days = new Date(Date.now() + 6 * 24 * 3600 * 1000);
    const in8Days = new Date(Date.now() + 8 * 24 * 3600 * 1000);
    assert.equal(
      verifyLicenseCertificate(parsedCert, keys.publicKeyPem, { now: in6Days }).valid,
      true,
    );
    const expiredCheck = verifyLicenseCertificate(parsedCert, keys.publicKeyPem, { now: in8Days });
    assert.equal(expiredCheck.valid, false);
    assert.equal(expiredCheck.status_code, "grace_exceeded");
  });
});
