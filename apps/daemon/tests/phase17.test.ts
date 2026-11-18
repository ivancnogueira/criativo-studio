import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type {
  LicenseActivationStatus,
  LicensePlanTier,
  ServerClaimTicket,
  ServerInviteToken,
  ServerQuotaSummary,
  StudioServerRecord,
} from "@criativo/contracts";
import { generateLicenseKeyPair } from "@criativo/contracts/license-crypto-node";
import {
  assertServerCreationAllowed,
  evaluateServerQuota,
  ServerQuotaExceededError,
} from "../src/servers/server-quota.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import {
  executePhase15ChatTool,
  PHASE15_TOOLS_SCHEMA,
} from "../src/server/studio-tools-bridge.ts";

const landingServerUrl = new URL("../../../../criativo-ai-studio-landing/server.js", import.meta.url).href;
const { createLandingApp } = (await import(landingServerUrl)) as {
  createLandingApp: (options?: Record<string, unknown>) => {
    app: { listen: (port: number, host: string, cb: () => void) => import("node:http").Server };
    licenseHub: {
      db: { prepare: (sql: string) => { get: (...args: unknown[]) => Record<string, unknown> | undefined } };
      issueOrUpdateLicenseFromSale: (input: Record<string, unknown>) => { license_key: string; id: string };
      close: () => void;
    };
  };
};

describe("Fase 17 — Multi-Servidores Local, CRIATIVO_CLAIM VPS, Proxy Router & Cotas", () => {
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
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
      } catch {
        // ignora handle residual no Windows
      }
    }
  });

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function makeServerStub(
    id: string,
    kind: StudioServerRecord["kind"],
  ): StudioServerRecord {
    return {
      server_id: id,
      nome: `Servidor ${id}`,
      slug: id,
      kind,
      status: "online",
      cor_hex: "#E88B2D",
      base_url: "http://127.0.0.1:3000",
      is_active: id === "primary",
      created_at: new Date().toISOString(),
    };
  }

  function makeLicenseStatus(planTier: LicensePlanTier | null, valid = true): LicenseActivationStatus {
    return {
      valid,
      status_code: valid ? "active" : "missing",
      plan_tier: planTier,
      plan_label: planTier ?? "Sem licença",
      max_servers: planTier === "individual" ? 2 : planTier === "agencia_10" ? 10 : -1,
      servers_used: 1,
      max_machines: planTier === "individual" ? 2 : planTier === "agencia_10" ? 3 : 5,
      machines_used: 1,
      upgrades: [],
      devices: [],
      hub_url: "http://127.0.0.1:3007",
    };
  }

  async function startHubAndKeys() {
    const dir = makeTempDir("criativo-p17-hub-");
    const keys = generateLicenseKeyPair();
    const { app, licenseHub } = createLandingApp({
      distDir: join(dir, "dist-empty"),
      bonusDir: join(dir, "bonus-empty"),
      licenseHub: {
        dbPath: join(dir, "licencas.db"),
        privateKeyPem: keys.privateKeyPem,
        publicKeyPem: keys.publicKeyPem,
        adminToken: "adm-token-phase17-test",
      },
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

    return { keys, licenseHub, hubUrl };
  }

  async function startPrimaryDaemon(options: {
    hubUrl: string;
    publicKeyPem: string;
    licenseKey: string;
    email: string;
  }): Promise<DaemonRuntime> {
    const root = makeTempDir("criativo-p17-primary-");
    const rt = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(root, "dados", "criativo.db"),
      workspaceRoot: root,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      enforceLicense: true,
      licenseHubUrl: options.hubUrl,
      licensePublicKeyPem: options.publicKeyPem,
      machineSeedOverride: `p17-machine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });
    runtimes.push(rt);

    const actRes = await fetch(`http://127.0.0.1:${rt.port}/api/studio/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key: options.licenseKey, email: options.email }),
    });
    assert.equal(actRes.status, 200);
    return rt;
  }

  it("Bloco 1 — Matriz de Cotas de Servidores nos 3 Planos (Individual / Agência 10 / Ilimitada)", () => {
    const noLic = evaluateServerQuota(makeLicenseStatus(null, false), [makeServerStub("primary", "primary")], "remote_vps");
    assert.equal(noLic.allowed, false);

    // Individual: max 2 servidores (1 local primary + 1 remoto). Bloqueia local_child extra!
    const indWithPrimary = [makeServerStub("primary", "primary")];
    const indLocalBlocked = evaluateServerQuota(makeLicenseStatus("individual"), indWithPrimary, "local_child");
    assert.equal(indLocalBlocked.allowed, false);
    assert.throws(
      () => assertServerCreationAllowed(makeLicenseStatus("individual"), indWithPrimary, "local_child"),
      ServerQuotaExceededError,
    );

    const indRemoteOk = evaluateServerQuota(makeLicenseStatus("individual"), indWithPrimary, "remote_vps");
    assert.equal(indRemoteOk.allowed, true);

    const indFull = [makeServerStub("primary", "primary"), makeServerStub("vps-1", "remote_vps")];
    const indFullBlocked = evaluateServerQuota(makeLicenseStatus("individual"), indFull, "joined");
    assert.equal(indFullBlocked.allowed, false);

    // Agência 10: permite até 10 e bloqueia o 11º
    const ag9 = [
      makeServerStub("primary", "primary"),
      ...Array.from({ length: 8 }, (_, idx) => makeServerStub(`c-${idx}`, "local_child")),
    ];
    assert.equal(evaluateServerQuota(makeLicenseStatus("agencia_10"), ag9, "local_child").allowed, true);
    const ag10 = [...ag9, makeServerStub("c-9", "remote_vps")];
    assert.equal(evaluateServerQuota(makeLicenseStatus("agencia_10"), ag10, "local_child").allowed, false);
    assert.equal(evaluateServerQuota(makeLicenseStatus("agencia_10"), ag10, "remote_vps").allowed, false);

    // Agência Ilimitada: max_servers = -1 permite > 10
    const ag12 = [
      makeServerStub("primary", "primary"),
      ...Array.from({ length: 12 }, (_, idx) => makeServerStub(`il-${idx}`, idx % 2 === 0 ? "local_child" : "remote_vps")),
    ];
    const unlimited = evaluateServerQuota(makeLicenseStatus("agencia_ilimitada"), ag12, "local_child");
    assert.equal(unlimited.allowed, true);
    assert.equal(unlimited.max_servers, -1);
  });

  it("Bloco 2 — Servidores Locais Isolados (LocalServerManager) + Proxy HTTP/WS + Teardown", async () => {
    const { keys, licenseHub, hubUrl } = await startHubAndKeys();
    const { license_key } = licenseHub.issueOrUpdateLicenseFromSale({
      email: "agencia-local@exemplo.invalid",
      customerName: "Agencia Multi Local",
      planTier: "agencia_10",
      provider: "manual",
    });
    const primary = await startPrimaryDaemon({
      hubUrl,
      publicKeyPem: keys.publicKeyPem,
      licenseKey: license_key,
      email: "agencia-local@exemplo.invalid",
    });
    const baseUrl = `http://127.0.0.1:${primary.port}`;

    // Cria 2 servidores locais filhos reais
    const createAlphaRes = await fetch(`${baseUrl}/api/studio/servers/local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Cliente Alpha", cor_hex: "#31CF76" }),
    });
    assert.equal(createAlphaRes.status, 201);
    const alphaData = (await createAlphaRes.json()) as {
      ok: boolean;
      server: StudioServerRecord;
      servers: StudioServerRecord[];
      quota: ServerQuotaSummary;
    };
    assert.equal(alphaData.ok, true);
    assert.equal(alphaData.server.kind, "local_child");
    assert.equal(alphaData.server.status, "online");
    assert.ok(alphaData.server.workspace_path);

    const createBetaRes = await fetch(`${baseUrl}/api/studio/servers/local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Cliente Beta", cor_hex: "#4E8DFF" }),
    });
    assert.equal(createBetaRes.status, 201);
    const betaData = (await createBetaRes.json()) as { server: StudioServerRecord };

    // Isolamento físico de banco e arquivo de marca
    assert.ok(existsSync(join(alphaData.server.workspace_path!, "dados", "criativo.db")));
    assert.ok(existsSync(join(betaData.server.workspace_path!, "dados", "criativo.db")));
    assert.ok(existsSync(join(alphaData.server.workspace_path!, "conteudos", "perfil-da-marca.md")));

    // Cria agente exclusivo no Cliente Alpha passando pelo ServerProxyRouter (X-Criativo-Server-Id)
    const agentRes = await fetch(`${baseUrl}/api/agentes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Server-Id": alphaData.server.server_id,
      },
      body: JSON.stringify({
        nome: "Estrategista Exclusivo Alpha",
        papel: "Especialista exclusivo da instância Alpha",
      }),
    });
    assert.equal(agentRes.status, 201);

    // Verifica que aparece em Alpha
    const alphaAgentsRes = await fetch(`${baseUrl}/api/agentes`, {
      headers: { "X-Criativo-Server-Id": alphaData.server.server_id },
    });
    assert.equal(alphaAgentsRes.status, 200);
    const alphaAgentsJson = (await alphaAgentsRes.json()) as { agentes: Array<{ nome: string }> };
    assert.ok(alphaAgentsJson.agentes.some((a) => a.nome === "Estrategista Exclusivo Alpha"));

    // Verifica que NÃO vaza para Beta nem para o Servidor Principal
    const betaAgentsRes = await fetch(`${baseUrl}/api/agentes`, {
      headers: { "X-Criativo-Server-Id": betaData.server.server_id },
    });
    const betaAgentsJson = (await betaAgentsRes.json()) as { agentes: Array<{ nome: string }> };
    assert.equal(
      betaAgentsJson.agentes.some((a) => a.nome === "Estrategista Exclusivo Alpha"),
      false,
    );

    const primaryAgentsRes = await fetch(`${baseUrl}/api/agentes`);
    const primaryAgentsJson = (await primaryAgentsRes.json()) as { agentes: Array<{ nome: string }> };
    assert.equal(
      primaryAgentsJson.agentes.some((a) => a.nome === "Estrategista Exclusivo Alpha"),
      false,
    );

    // Upgrade WebSocket via proxy (/ws?serverId=...) até o filho Alpha
    await new Promise<void>((resolveWs, rejectWs) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${primary.port}/ws?serverId=${encodeURIComponent(alphaData.server.server_id)}`,
      );
      const timer = setTimeout(() => {
        ws.close();
        rejectWs(new Error("Timeout aguardando proxy WebSocket para filho local."));
      }, 6000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        ws.close();
        resolveWs();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        rejectWs(new Error("Falha ao abrir WebSocket proxied para servidor local."));
      });
    });

    // Remoção limpa de Beta + arquivos
    const delRes = await fetch(
      `${baseUrl}/api/studio/servers/${encodeURIComponent(betaData.server.server_id)}?delete_files=1`,
      { method: "DELETE" },
    );
    assert.equal(delRes.status, 200);
    const listAfterDel = await fetch(`${baseUrl}/api/studio/servers`).then(
      (r) => r.json() as Promise<{ servers: StudioServerRecord[] }>,
    );
    assert.equal(
      listAfterDel.servers.some((s) => s.server_id === betaData.server.server_id),
      false,
    );
  });

  it("Bloco 3 — Fluxo Completo CRIATIVO_CLAIM + VPS Simulada + Proxy Bearer + Join/Invite", async () => {
    const { keys, licenseHub, hubUrl } = await startHubAndKeys();
    const { license_key } = licenseHub.issueOrUpdateLicenseFromSale({
      email: "agencia-vps@exemplo.invalid",
      customerName: "Agencia VPS Remote",
      planTier: "agencia_10",
      provider: "manual",
    });
    const primary = await startPrimaryDaemon({
      hubUrl,
      publicKeyPem: keys.publicKeyPem,
      licenseKey: license_key,
      email: "agencia-vps@exemplo.invalid",
    });
    const primaryUrl = `http://127.0.0.1:${primary.port}`;

    // 1) Desktop gera claim
    const claimRes = await fetch(`${primaryUrl}/api/studio/servers/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_name: "VPS Cliente Gamma" }),
    });
    assert.equal(claimRes.status, 201);
    const { claim } = (await claimRes.json()) as { ok: boolean; claim: ServerClaimTicket };
    assert.equal(claim.status, "pending");

    const match = /CRIATIVO_CLAIM=([A-Za-z0-9_-]+)/.exec(claim.command_bash);
    assert.ok(match?.[1], "Comando bash deve conter CRIATIVO_CLAIM=<token>");
    const claimSecret = match[1];

    // 2) Sobe VPS simulada protegida por token
    const vpsRoot = makeTempDir("criativo-p17-vps-");
    const vpsAccessToken = "vps-token-phase17-secret";
    const vpsRuntime = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(vpsRoot, "dados", "criativo.db"),
      workspaceRoot: vpsRoot,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      accessToken: vpsAccessToken,
      bypassLicenseForTests: true,
    });
    runtimes.push(vpsRuntime);
    const vpsUrl = `http://127.0.0.1:${vpsRuntime.port}`;

    // Acesso direto sem token à VPS deve falhar com 401
    const unauthVps = await fetch(`${vpsUrl}/api/agentes`);
    assert.equal(unauthVps.status, 401);

    // 3) VPS simulada executa redeem no Hub da Landing Page
    const redeemRes = await fetch(`${hubUrl}/api/server-claims/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_secret: claimSecret,
        server_name: "VPS Cliente Gamma",
        host_url: vpsUrl,
        public_ip: "203.0.113.77",
        server_port: vpsRuntime.port,
        server_api_token: vpsAccessToken,
        vps_machine_id: "vps-machine-gamma-01",
      }),
    });
    assert.equal(redeemRes.status, 200);
    const redeemData = (await redeemRes.json()) as {
      ok: boolean;
      certificate: { payload: { machine_id: string }; signature: string };
    };
    assert.equal(redeemData.ok, true);
    assert.equal(redeemData.certificate.payload.machine_id, "vps-machine-gamma-01");

    // Reutilizar o mesmo claim_secret deve retornar 409
    const secondRedeem = await fetch(`${hubUrl}/api/server-claims/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claim_secret: claimSecret,
        host_url: vpsUrl,
        server_api_token: vpsAccessToken,
      }),
    });
    assert.equal(secondRedeem.status, 409);

    // 4) Desktop consulta status do claim -> redeemed + registra servidor remote_vps
    const statusRes = await fetch(`${primaryUrl}/api/studio/servers/claims/${claim.claim_id}`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as { ok: boolean; claim: ServerClaimTicket };
    assert.equal(statusJson.claim.status, "redeemed");
    assert.ok(statusJson.claim.paired_server);
    const vpsServerId = statusJson.claim.paired_server!.server_id;

    // 5) Proxy transparentemente até a VPS simulada autenticando Bearer token do Cofre
    const createVpsAgent = await fetch(`${primaryUrl}/api/agentes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Server-Id": vpsServerId,
      },
      body: JSON.stringify({ nome: "Agente Remoto Gamma" }),
    });
    assert.equal(createVpsAgent.status, 201);

    const proxiedVpsAgents = (await fetch(`${primaryUrl}/api/agentes`, {
      headers: { "X-Criativo-Server-Id": vpsServerId },
    }).then((r) => r.json())) as { agentes: Array<{ nome: string }> };
    assert.ok(proxiedVpsAgents.agentes.some((a) => a.nome === "Agente Remoto Gamma"));

    // 6) Convite (criativo://join?...) + Entrada em um servidor
    const inviteRes = await fetch(
      `${primaryUrl}/api/studio/servers/${encodeURIComponent(vpsServerId)}/invite`,
      { method: "POST" },
    );
    assert.equal(inviteRes.status, 200);
    const { invite } = (await inviteRes.json()) as { invite: ServerInviteToken };
    assert.match(invite.invite_url, /^criativo:\/\/join\?/);

    // Remove e re-entra via invite_url
    await fetch(`${primaryUrl}/api/studio/servers/${encodeURIComponent(vpsServerId)}`, {
      method: "DELETE",
    });

    const joinRes = await fetch(`${primaryUrl}/api/studio/servers/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invite_url: invite.invite_url,
        nome: "VPS Gamma Reconectada",
      }),
    });
    assert.equal(joinRes.status, 201);
    const joinJson = (await joinRes.json()) as { server: StudioServerRecord };
    assert.equal(joinJson.server.kind, "joined");
    assert.equal(joinJson.server.nome, "VPS Gamma Reconectada");
  });

  it("Bloco 4 — Tool create_server_install_command exige aprovação e nunca salva segredo puro no Hub", async () => {
    assert.ok(
      PHASE15_TOOLS_SCHEMA.some((t) => t.name === "create_server_install_command"),
      "Tool create_server_install_command deve constar em PHASE15_TOOLS_SCHEMA",
    );

    const { keys, licenseHub, hubUrl } = await startHubAndKeys();
    const { license_key } = licenseHub.issueOrUpdateLicenseFromSale({
      email: "tool-claim@exemplo.invalid",
      customerName: "Tool Claim Teste",
      planTier: "agencia_ilimitada",
      provider: "manual",
    });
    const primary = await startPrimaryDaemon({
      hubUrl,
      publicKeyPem: keys.publicKeyPem,
      licenseKey: license_key,
      email: "tool-claim@exemplo.invalid",
    });

    const deps = {
      db: primary.db,
      wsHub: primary.wsHub,
      workspaceRoot: primary.localServerManager.getServer("primary")?.workspace_path || tmpdir(),
      remoteClaimService: primary.remoteClaimService,
    };

    // Sem aprovação humana -> pede confirmação
    const needApproval = (await executePhase15ChatTool({
      toolName: "create_server_install_command",
      args: { server_name: "VPS Agente Delta" },
      agenteId: "estrategista",
      canalId: "agente:estrategista",
      deps,
      aprovadoPorHumano: false,
    })) as { requiresApproval?: boolean };
    assert.equal(needApproval.requiresApproval, true);

    // Com aprovação humana -> gera comando e Hub armazena apenas claim_hash SHA-256
    const approved = (await executePhase15ChatTool({
      toolName: "create_server_install_command",
      args: { server_name: "VPS Agente Delta" },
      agenteId: "estrategista",
      canalId: "agente:estrategista",
      deps,
      aprovadoPorHumano: true,
    })) as { ok?: boolean; claim_id?: string; command_bash?: string };

    assert.equal(approved.ok, true);
    assert.ok(approved.claim_id);
    assert.match(String(approved.command_bash), /CRIATIVO_CLAIM=CRV_/);

    const secretMatch = /CRIATIVO_CLAIM=([A-Za-z0-9_-]+)/.exec(String(approved.command_bash));
    assert.ok(secretMatch?.[1]);

    const dbRow = licenseHub.db
      .prepare(`SELECT claim_hash, paired_info_json FROM server_claims WHERE claim_id = ?;`)
      .get(approved.claim_id);
    assert.ok(dbRow);
    assert.notEqual(dbRow.claim_hash, secretMatch[1]);
    assert.equal(String(dbRow.claim_hash).length, 64);

    // Confere que o script scripts/install-server.sh lê CRIATIVO_CLAIM via stdin e usa HTTPS/Hub
    const scriptPath = new URL("../../../scripts/install-server.sh", import.meta.url);
    const scriptContent = readFileSync(scriptPath, "utf8");
    assert.match(scriptContent, /CRIATIVO_CLAIM/);
    assert.match(scriptContent, /server-claims\/redeem/);
  });
});
