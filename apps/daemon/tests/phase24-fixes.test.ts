import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CriativoDatabase } from "../src/database/client.ts";
import { MemoryManager } from "../src/engine/runner/memory-manager.ts";
import { AntigravityLiveService } from "../src/providers/antigravity-live-service.ts";
import { RemoteClaimService } from "../src/servers/remote-claim-service.ts";
import {
  listInstalledSkills,
  loadSkillPromptBySlug,
} from "../src/server/analytics-skills-service.ts";
import { getUserSettings, updateUserSettings } from "../src/server/settings-storage-service.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { generateLicenseKeyPair } from "@criativo/contracts/license-crypto-node";

const daemonRoot = resolve(fileURLToPath(import.meta.url), "../..");
const landingServerUrl = new URL("../../../../criativo-ai-studio-landing/server.js", import.meta.url).href;

describe("Fase 24 — Hotfixes RemoteClaim HTML Fallback, Auto-Refresh de Cotas e Configurações do Dock", () => {
  let tempDir: string;
  let runtime: DaemonRuntime;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "criativo-phase24-"));
    runtime = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(tempDir, "criativo-p24.db"),
      workspaceRoot: tempDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      bypassLicenseForTests: true,
    });
  });

  after(async () => {
    await runtime.close().catch(() => {});
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
    } catch {
      // ignora lock residual no Windows
    }
  });

  it("1. (SRV24-01) RemoteClaimService faz fallback limpo quando Hub retorna HTML <!DOCTYPE...>", async () => {
    const htmlFetch = (async () =>
      new Response("<!DOCTYPE html><html><body>404 Not Found</body></html>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      })) as unknown as typeof fetch;

    const svc = new RemoteClaimService({
      localServerManager: runtime.localServerManager,
      licenseService: runtime.licenseService,
      wsHub: runtime.wsHub,
      fetchImpl: htmlFetch as never,
    });

    const ticket = await svc.createRemoteClaim("VPS Teste Fallback");
    assert.ok(ticket.claim_id.startsWith("clm_"));
    assert.equal(ticket.status, "pending");
    assert.match(ticket.command_bash, /CRIATIVO_CLAIM=CRV_/);
    assert.match(ticket.command_agent_prompt, /CRIATIVO_CLAIM=CRV_/);

    const polled = await svc.pollRemoteClaim(ticket.claim_id);
    assert.equal(polled.claim_id, ticket.claim_id);
    assert.equal(polled.status, "pending");

    // Erro JSON de negócio (ex.: 403) deve continuar lançando normalmente
    const errJsonFetch = (async () =>
      new Response(JSON.stringify({ error: "quota_exceeded", message: "Limite de VPS excedido." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const svcWithErr = new RemoteClaimService({
      localServerManager: runtime.localServerManager,
      licenseService: runtime.licenseService,
      wsHub: runtime.wsHub,
      fetchImpl: errJsonFetch as never,
    });
    await assert.rejects(() => svcWithErr.createRemoteClaim("VPS Bloqueada"), /Limite de VPS excedido/);
  });

  it("2. (QUOTA24-01) AntigravityLiveService renova token expirado sem forceRefresh e retorna grupos_cota", async () => {
    const accountsRoot = join(tempDir, "contas-gemini-p24");
    mkdirSync(accountsRoot, { recursive: true });

    let refreshCalls = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith(":loadCodeAssist")) {
        return new Response(JSON.stringify({ cloudaicompanionProject: "proj-p24" }), { status: 200 });
      }
      if (url.endsWith(":retrieveUserQuotaSummary")) {
        return new Response(
          JSON.stringify({
            groups: [
              {
                displayName: "Gemini Models",
                description: "Models within this group: Gemini 3.8 Flash",
                buckets: [
                  { window: "5h", remainingFraction: 0.92, resetTime: new Date(Date.now() + 3600_000).toISOString() },
                  { window: "weekly", remainingFraction: 0.78, resetTime: new Date(Date.now() + 5 * 86400_000).toISOString() },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    };

    const fakeAcp = {
      getCliExecutable: () => "mock-agy-cli",
      refreshAccountToken: async (_id: string, geminiDir: string) => {
        refreshCalls += 1;
        const tokPath = join(geminiDir, "antigravity-acp", "antigravity-oauth-token");
        const nextExp = new Date(Date.now() + 55 * 60_000).toISOString();
        const cur = JSON.parse(readFileSync(tokPath, "utf8")) as Record<string, unknown>;
        cur.token = { access_token: "ya29.token-renovado-p24", refresh_token: "1//ref-p24", expiry: nextExp };
        writeFileSync(tokPath, JSON.stringify(cur), "utf8");
        return { accessToken: "ya29.token-renovado-p24", expiryIso: nextExp, email: "quota-auto@exemplo.local" };
      },
      listAvailableModels: async () => ({ models: [], defaultModelId: null }),
      closeAll: () => {},
    };

    const agSvc = new AntigravityLiveService({
      db: runtime.db,
      accountsRootDir: accountsRoot,
      workspaceCwd: tempDir,
      fetchImpl: mockFetch,
      acpService: fakeAcp as never,
    });

    const acc = agSvc.addManualTokenAccount({
      email: "quota-auto@exemplo.local",
      accessToken: "ya29.token-expirado",
      refreshToken: "1//ref-p24",
    });

    // Força expiração no arquivo em disco
    const tokFile = join(accountsRoot, acc.id, "antigravity-acp", "antigravity-oauth-token");
    const parsed = JSON.parse(readFileSync(tokFile, "utf8")) as {
      token: { access_token: string; refresh_token: string; expiry: string };
    };
    parsed.token.expiry = new Date(Date.now() - 600_000).toISOString();
    writeFileSync(tokFile, JSON.stringify(parsed), "utf8");

    // Chamada normal com forceRefresh=false (como ocorre no boot do app)
    const snap = await agSvc.getLiveSnapshot(false);
    assert.equal(refreshCalls, 1);
    assert.equal(snap.contas.length, 1);
    assert.equal(snap.contas[0]!.grupos_cota.length, 1);
    assert.equal(snap.contas[0]!.grupos_cota[0]!.janela_5h?.restante_percentual, 92);
    assert.equal(snap.contas[0]!.grupos_cota[0]!.janela_semanal?.restante_percentual, 78);
  });

  it("3. (DOCK24-01) StudioUserSettings.dock persiste, deduplica agentes e aplica clamp 80..150%", () => {
    const saved = updateUserSettings(
      runtime.db,
      {
        dock: {
          mostrar_dock: true,
          posicao: "apenas_janela",
          tela: "secundaria",
          borda: "left",
          tamanho_percentual: 240,
          ocultar_quando_inativo: true,
          mostrar_faixa_borda: false,
          mostrar_trabalho_concluido: true,
          mostrar_agentes_com_novidades: true,
          agentes_ids: ["estrategista", "copywriter", "estrategista"],
        },
      },
      runtime.wsHub,
    );

    assert.equal(saved.dock?.posicao, "apenas_janela");
    assert.equal(saved.dock?.borda, "left");
    assert.equal(saved.dock?.tamanho_percentual, 150);
    assert.equal(saved.dock?.ocultar_quando_inativo, true);
    assert.equal(saved.dock?.mostrar_faixa_borda, false);
    assert.equal(saved.dock?.mostrar_agentes_com_novidades, true);
    assert.deepEqual(saved.dock?.agentes_ids, ["estrategista", "copywriter"]);

    const loaded = getUserSettings(runtime.db);
    assert.equal(loaded.dock?.tamanho_percentual, 150);
    assert.deepEqual(loaded.dock?.agentes_ids, ["estrategista", "copywriter"]);
    assert.ok(daemonRoot);
  });

  it("4. (VPS25-01) install-server.sh é resiliente a PPAs depreciados e preserva captura de CRIATIVO_CLAIM", () => {
    const repoScript = readFileSync(resolve(daemonRoot, "../../scripts/install-server.sh"), "utf8");
    assert.match(repoScript, /AllowReleaseInfoChange=true/);
    assert.match(repoScript, /AllowReleaseInfoChange::Label=true/);
    assert.match(repoScript, /safe_apt_update/);
    assert.match(repoScript, /CRIATIVO_CLAIM/);
    assert.match(repoScript, /server-claims\/redeem/);
    assert.match(repoScript, /servers\/claims\/redeem/);
  });

  it("5. (VPS25-02) assistente_servidor_vps fica oculto por padrão, aparece sob demanda via POST /api/servers/vps-assistant e não entra na contagem permanente", async () => {
    const addr = runtime.httpServer.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // 1. Por padrão, assistente_servidor_vps NÃO aparece em GET /api/agentes
    const resDefault = await fetch(`${baseUrl}/api/agentes`);
    assert.equal(resDefault.status, 200);
    const jsonDefault = (await resDefault.json()) as {
      agentes: Array<{ agente_id: string }>;
      unlocked_agents_count: number;
      vps_assistant_visible: boolean;
    };
    assert.equal(jsonDefault.vps_assistant_visible, false);
    assert.equal(jsonDefault.agentes.some((a) => a.agente_id === "assistente_servidor_vps"), false);
    const baselineUnlocked = jsonDefault.unlocked_agents_count;

    // 2. Reabre o especialista VPS -> passa a aparecer com incluir_vps / GET /api/agentes sem inflar unlocked_agents_count
    const resReopen = await fetch(`${baseUrl}/api/servers/vps-assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen" }),
    });
    assert.equal(resReopen.status, 200);
    const reopenJson = (await resReopen.json()) as { ok: boolean; vps_assistant_visible: boolean };
    assert.equal(reopenJson.ok, true);
    assert.equal(reopenJson.vps_assistant_visible, true);

    const resAfterReopen = await fetch(`${baseUrl}/api/agentes`);
    const jsonAfterReopen = (await resAfterReopen.json()) as {
      agentes: Array<{ agente_id: string; nome: string }>;
      unlocked_agents_count: number;
      vps_assistant_visible: boolean;
    };
    assert.equal(jsonAfterReopen.vps_assistant_visible, true);
    assert.equal(jsonAfterReopen.unlocked_agents_count, baselineUnlocked);
    assert.equal(
      jsonAfterReopen.agentes.some((a) => a.agente_id === "assistente_servidor_vps"),
      true,
    );

    // 3. Dispensa / oculta novamente
    const resDismiss = await fetch(`${baseUrl}/api/servers/vps-assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    });
    assert.equal(resDismiss.status, 200);
    const resAfterDismiss = await fetch(`${baseUrl}/api/agentes`);
    const jsonAfterDismiss = (await resAfterDismiss.json()) as {
      agentes: Array<{ agente_id: string }>;
      vps_assistant_visible: boolean;
    };
    assert.equal(jsonAfterDismiss.vps_assistant_visible, false);
    assert.equal(
      jsonAfterDismiss.agentes.some((a) => a.agente_id === "assistente_servidor_vps"),
      false,
    );
  });

  it("6. (VPS26-01) install-server.sh usa porta exclusiva padrão 3777, detecta porta livre 3777..3799 e valida assinatura criativo-daemon no /health", () => {
    const repoScript = readFileSync(resolve(daemonRoot, "../../scripts/install-server.sh"), "utf8");
    assert.match(repoScript, /SERVER_PORT="\$\{CRIATIVO_SERVER_PORT:-3777\}"/);
    assert.match(repoScript, /is_port_in_use/);
    assert.match(repoScript, /seq 3777 3799/);
    assert.match(repoScript, /"criativo-daemon"/);
    assert.match(repoScript, /CRIATIVO_ISOLATED_SERVER=1/);
  });

  it("7. (VPS26-02) Desktop sincroniza certificado de licença para VPS com enforceLicense, libera 15 agentes + Loja >=253 apps e isola provedores", async () => {
    const { createLandingApp } = (await import(landingServerUrl)) as {
      createLandingApp: (options?: Record<string, unknown>) => {
        app: { listen: (port: number, host: string, cb: () => void) => import("node:http").Server };
        licenseHub: {
          issueOrUpdateLicenseFromSale: (input: Record<string, unknown>) => { license_key: string; id: string };
          close: () => void;
        };
      };
    };

    const keys = generateLicenseKeyPair();
    const hubDir = join(tempDir, "hub-vps26");
    mkdirSync(hubDir, { recursive: true });
    const { app, licenseHub } = createLandingApp({
      distDir: join(hubDir, "dist-empty"),
      bonusDir: join(hubDir, "bonus-empty"),
      licenseHub: {
        dbPath: join(hubDir, "licencas.db"),
        releasesDir: join(hubDir, "releases"),
        privateKeyPem: keys.privateKeyPem,
        publicKeyPem: keys.publicKeyPem,
      },
    });
    const hubServer = await new Promise<import("node:http").Server>((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    const hubPort = (hubServer.address() as { port: number }).port;
    const hubUrl = `http://127.0.0.1:${hubPort}`;

    const licIssued = licenseHub.issueOrUpdateLicenseFromSale({
      email: "agencia-sync@exemplo.invalid",
      customerName: "Agencia Sync VPS",
      planTier: "agencia_ilimitada",
      addUpgrades: ["bonus", "video"],
      provider: "manual",
    });

    const desktopDir = join(tempDir, "desktop-p26");
    const vpsDir = join(tempDir, "vps-p26");
    mkdirSync(desktopDir, { recursive: true });
    mkdirSync(vpsDir, { recursive: true });

    const desktopRt = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(desktopDir, "criativo.db"),
      workspaceRoot: desktopDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      enforceLicense: true,
      licenseHubUrl: hubUrl,
      licensePublicKeyPem: keys.publicKeyPem,
      machineSeedOverride: "desktop-sync-seed-p26",
    });

    const vpsAccessToken = "vps-token-sync-p26-secret";
    const vpsRt = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(vpsDir, "criativo.db"),
      workspaceRoot: vpsDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      enforceLicense: true,
      accessToken: vpsAccessToken,
      licenseHubUrl: hubUrl,
      licensePublicKeyPem: keys.publicKeyPem,
      machineSeedOverride: "vps-remote-seed-p26",
    });

    try {
      // Ativa licença no Desktop e conecta uma API key somente no Desktop
      const actRes = await fetch(`http://127.0.0.1:${desktopRt.port}/api/studio/license/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          license_key: licIssued.license_key,
          email: "agencia-sync@exemplo.invalid",
        }),
      });
      assert.equal(actRes.status, 200);
      desktopRt.vault.setSecret("openai_api_key", "sk-desktop-only-secret-test");

      // Registra a VPS no Desktop
      const vpsRec = desktopRt.localServerManager!.registerRemoteServer({
        nome: "VPS Isolada Sync",
        kind: "remote_vps",
        base_url: `http://127.0.0.1:${vpsRt.port}`,
        access_token: vpsAccessToken,
        remote_ip: "203.0.113.55",
      });

      // 1. Consulta /api/onboarding na VPS -> cada servidor novo preserva onboarding próprio pendente
      const onbRes = await fetch(`http://127.0.0.1:${desktopRt.port}/api/onboarding`, {
        headers: { "X-Criativo-Server-Id": vpsRec.server_id },
      });
      assert.equal(onbRes.status, 200);
      const onbJson = (await onbRes.json()) as { onboarding: { onboarding_concluido: boolean } };
      assert.equal(onbJson.onboarding.onboarding_concluido, false);

      // 2. Consulta /api/agentes na VPS -> Desktop sincroniza o certificado e VPS desbloqueia os 15 agentes
      const agRes = await fetch(`http://127.0.0.1:${desktopRt.port}/api/agentes?apenas_desbloqueados=1`, {
        headers: { "X-Criativo-Server-Id": vpsRec.server_id },
      });
      assert.equal(agRes.status, 200);
      const agJson = (await agRes.json()) as {
        agentes: Array<{ agente_id: string }>;
        unlocked_agents_count: number;
      };
      assert.equal(agJson.unlocked_agents_count, 15);
      assert.equal(agJson.agentes.length, 15);

      // 3. Catálogo completo da Loja acessível na VPS
      const lojaRes = await fetch(`http://127.0.0.1:${desktopRt.port}/api/loja/catalogo`, {
        headers: { "X-Criativo-Server-Id": vpsRec.server_id },
      });
      assert.equal(lojaRes.status, 200);
      const lojaJson = (await lojaRes.json()) as { apps: unknown[] };
      assert.ok((lojaJson.apps ?? []).length >= 253);

      // 4. Licença delegada validada na própria VPS com agência ilimitada + upgrades bonus/video
      const vpsLic = vpsRt.licenseService.getStatus();
      assert.equal(vpsLic.valid, true);
      assert.equal(vpsLic.plan_tier, "agencia_ilimitada");
      assert.equal(vpsLic.upgrades.includes("bonus"), true);
      assert.equal(vpsLic.upgrades.includes("video"), true);

      // 5. Provedores permanecem isolados (chave OpenAI do Desktop NÃO vazou para a VPS)
      assert.equal(vpsRt.vault.getSecret("openai_api_key"), null);
      const provRes = await fetch(`http://127.0.0.1:${desktopRt.port}/api/provedores/status`, {
        headers: { "X-Criativo-Server-Id": vpsRec.server_id },
      });
      assert.equal(provRes.status, 200);
      const provJson = (await provRes.json()) as {
        provedores: Array<{ provedor: string; conectado: boolean }>;
      };
      const openaiOnVps = provJson.provedores.find((p) => p.provedor === "openai");
      assert.equal(openaiOnVps?.conectado, false);
    } finally {
      await vpsRt.close().catch(() => {});
      await desktopRt.close().catch(() => {});
      licenseHub.close();
      await new Promise<void>((r) => hubServer.close(() => r()));
    }
  });

  it("8. (VPS26-03) CriativoDatabase e MemoryManager funcionam integralmente sem módulo SQLite FTS5 (fallback Linux/VPS)", () => {
    const noFtsDbPath = join(tempDir, "criativo-no-fts5.db");
    const dbNoFts = new CriativoDatabase({ dbPath: noFtsDbPath, disableFts5: true });
    let dbWithFts: CriativoDatabase | null = null;

    try {
      dbNoFts.initializeDatabase();
      assert.equal(dbNoFts.fts5Enabled, false);
      assert.equal(dbNoFts.hasTable("agente_memorias_fts"), false);
      assert.equal(dbNoFts.hasFts5MemoriesTable(), false);
      assert.equal(dbNoFts.hasTable("projecao_agente_memorias"), true);

      const nowIso = new Date().toISOString();
      dbNoFts.connection
        .prepare(
          `INSERT INTO projecao_agentes (
            agente_id, nome, papel, modelo_padrao, atualizado_em
          ) VALUES (?, ?, ?, ?, ?);`,
        )
        .run(
          "agente_fallback",
          "Agente Fallback",
          "Especialista em fallback de memória",
          "gemini-2.5-flash",
          nowIso,
        );

      const mgr = new MemoryManager(dbNoFts);

      // 1. Criação e atualização via addMemory
      const m1 = mgr.addMemory(
        "agente_fallback",
        "Diretriz de criação editorial para [NOME_DA_MARCA] com acentuação impecável",
        "automatica",
        { categoria: "searchable", escopoSite: "example.com" },
      );
      assert.ok(m1);
      const m1Updated = mgr.addMemory(
        "agente_fallback",
        "Diretriz de criação editorial para [NOME_DA_MARCA] com acentuação impecável",
        "automatica",
        { categoria: "essential", escopoSite: "example.com" },
      );
      assert.equal(m1Updated?.categoria, "essential");

      // 2. Staging transacional por turno concluído
      const stageRes = mgr.stageTurnMutation("turn-no-fts-1", "agente_fallback", {
        action: "remember",
        texto: "Publicar carrosséis educativos sobre automação criativa na terça-feira",
        categoria: "searchable",
        escopoSite: "blog.example.com",
      });
      assert.equal(stageRes.ok, true);
      const commitRes = mgr.commitTurnMutations("turn-no-fts-1", "completed");
      assert.equal(commitRes.committed, true);

      // 3. Atualização manual
      const mManual = mgr.addMemory(
        "agente_fallback",
        "Observação provisória do briefing semanal",
        "manual",
        { categoria: "searchable" },
      );
      assert.ok(mManual);
      const updatedManual = mgr.updateManualMemory("agente_fallback", mManual.memoria_id, {
        texto: "Briefing estratégico definitivo com segredo TOKEN_RESTRITO_123",
      });
      assert.match(updatedManual.texto, /Briefing estratégico definitivo/);

      // 4. Buscas no fallback SQL: termos não adjacentes, acentuação PT-BR, prefixo >= 6 chars, site e redação
      const hitsNonAdj = mgr.searchMemoriesFts("agente_fallback", "criacao editorial acentuacao", {
        site: "example.com",
      });
      assert.equal(hitsNonAdj.length, 1);
      assert.equal(hitsNonAdj[0]?.memoria_id, m1.memoria_id);

      const hitsPrefixAndSite = mgr.searchMemoriesFts("agente_fallback", "automac carross", {
        site: "blog.example.com",
      });
      assert.equal(hitsPrefixAndSite.length, 1);
      assert.match(hitsPrefixAndSite[0]!.texto, /carrosséis educativos/);

      const hitsRedacted = mgr.searchMemoriesFts("agente_fallback", "briefing estrategico", {
        redact: (s) => s.replace("TOKEN_RESTRITO_123", "[REDACTED]"),
      });
      assert.equal(hitsRedacted.length, 1);
      assert.equal(hitsRedacted[0]?.texto.includes("TOKEN_RESTRITO_123"), false);
      assert.equal(hitsRedacted[0]?.texto.includes("[REDACTED]"), true);

      // 5. Remoção sem erros SQLite
      const deleted = mgr.deleteMemory("agente_fallback", m1.memoria_id, true);
      assert.equal(deleted, true);

      // 6. Reabre o mesmo arquivo com FTS5 habilitado (se disponível neste SO) e valida backfill automático
      dbNoFts.close();
      dbWithFts = new CriativoDatabase({ dbPath: noFtsDbPath, disableFts5: false });
      dbWithFts.initializeDatabase();
      if (dbWithFts.fts5Enabled) {
        assert.equal(dbWithFts.hasFts5MemoriesTable(), true);
        const mgrWithFts = new MemoryManager(dbWithFts);
        const ftsBackfillHits = mgrWithFts.searchMemoriesFts("agente_fallback", "automação criativa", {
          site: "blog.example.com",
        });
        assert.ok(ftsBackfillHits.length >= 1);
        assert.match(ftsBackfillHits[0]!.texto, /carrosséis educativos/);
      }
    } finally {
      try {
        dbNoFts.close();
      } catch {
        // já fechado após teste de reabertura
      }
      try {
        dbWithFts?.close();
      } catch {
        // ignora erro de fechamento
      }
    }
  });

  it("9. (VPS27-01) Skills bonus e video ficam embutidas em .agents/skills-upgrades com gating estrito pela licença Ed25519 (9 -> 12 -> 15)", async () => {
    const repoRoot = resolve(daemonRoot, "../..");
    const prevProbeEnv = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
    const { createLandingApp } = (await import(landingServerUrl)) as {
      createLandingApp: (options?: Record<string, unknown>) => {
        app: { listen: (port: number, host: string, cb: () => void) => import("node:http").Server };
        licenseHub: {
          issueOrUpdateLicenseFromSale: (input: Record<string, unknown>) => { license_key: string; id: string };
          close: () => void;
        };
      };
    };

    const keys = generateLicenseKeyPair();
    const hubDir = join(tempDir, "hub-vps27-skills");
    mkdirSync(hubDir, { recursive: true });
    const { app, licenseHub } = createLandingApp({
      distDir: join(hubDir, "dist-empty"),
      bonusDir: join(hubDir, "bonus-empty"),
      licenseHub: {
        dbPath: join(hubDir, "licencas.db"),
        releasesDir: join(hubDir, "releases"),
        privateKeyPem: keys.privateKeyPem,
        publicKeyPem: keys.publicKeyPem,
      },
    });
    const hubServer = await new Promise<import("node:http").Server>((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    const hubPort = (hubServer.address() as { port: number }).port;
    const hubUrl = `http://127.0.0.1:${hubPort}`;

    const baseOnly = licenseHub.issueOrUpdateLicenseFromSale({
      email: "base-skills@exemplo.invalid",
      customerName: "Cliente Base",
      planTier: "individual",
      addUpgrades: [],
      provider: "manual",
    });
    const bonusOnly = licenseHub.issueOrUpdateLicenseFromSale({
      email: "bonus-skills@exemplo.invalid",
      customerName: "Cliente Bonus",
      planTier: "agencia_10",
      addUpgrades: ["bonus"],
      provider: "manual",
    });
    const fullLic = licenseHub.issueOrUpdateLicenseFromSale({
      email: "full-skills@exemplo.invalid",
      customerName: "Cliente Completo",
      planTier: "agencia_ilimitada",
      addUpgrades: ["bonus", "video"],
      provider: "manual",
    });

    const testCases: Array<{
      licKey: string;
      email: string;
      expectedCount: number;
      expectBonus: boolean;
      expectVideo: boolean;
    }> = [
      { licKey: baseOnly.license_key, email: "base-skills@exemplo.invalid", expectedCount: 9, expectBonus: false, expectVideo: false },
      { licKey: bonusOnly.license_key, email: "bonus-skills@exemplo.invalid", expectedCount: 12, expectBonus: true, expectVideo: false },
      { licKey: fullLic.license_key, email: "full-skills@exemplo.invalid", expectedCount: 15, expectBonus: true, expectVideo: true },
    ];

    try {
      for (let idx = 0; idx < testCases.length; idx += 1) {
        const tc = testCases[idx]!;
        const caseDir = join(tempDir, `skills-case-${idx}`);
        mkdirSync(caseDir, { recursive: true });
        const rt = await createDaemonServer({
          port: 0,
          host: "127.0.0.1",
          dbPath: join(caseDir, "criativo.db"),
          workspaceRoot: repoRoot,
          productRoot: repoRoot,
          autoStartLoops: false,
          autoBootWhatsApp: false,
          controlSocketPath: null,
          enforceLicense: true,
          licenseHubUrl: hubUrl,
          licensePublicKeyPem: keys.publicKeyPem,
          machineSeedOverride: `skills-seed-${idx}`,
        });
        try {
          const actRes = await fetch(`http://127.0.0.1:${rt.port}/api/studio/license/activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ license_key: tc.licKey, email: tc.email }),
          });
          assert.equal(actRes.status, 200);

          const habRes = await fetch(`http://127.0.0.1:${rt.port}/api/habilidades`);
          assert.equal(habRes.status, 200);
          const habJson = (await habRes.json()) as { habilidades: Array<{ id: string }> };
          const ids = new Set(habJson.habilidades.map((h) => h.id));
          assert.equal(ids.size, tc.expectedCount);
          assert.equal(ids.has("consistencia-personagem"), tc.expectBonus);
          assert.equal(ids.has("engenharia-reversa-concorrentes"), tc.expectBonus);
          assert.equal(ids.has("gerador-de-entregaveis"), tc.expectBonus);
          assert.equal(ids.has("criar-video-reels"), tc.expectVideo);
          assert.equal(ids.has("roteirista-faceless"), tc.expectVideo);
          assert.equal(ids.has("roteirista-talking-head"), tc.expectVideo);

          const bonusPrompt = loadSkillPromptBySlug("consistencia-personagem", undefined, repoRoot, {
            db: rt.db,
            licenseService: rt.licenseService,
            productRoot: repoRoot,
          });
          assert.equal(Boolean(bonusPrompt), tc.expectBonus);

          const videoPrompt = loadSkillPromptBySlug("criar-video-reels", undefined, repoRoot, {
            db: rt.db,
            licenseService: rt.licenseService,
            productRoot: repoRoot,
          });
          assert.equal(Boolean(videoPrompt), tc.expectVideo);

          const directSkills = listInstalledSkills(rt.db, undefined, repoRoot, rt.licenseService, repoRoot);
          assert.equal(directSkills.length, tc.expectedCount);
        } finally {
          await rt.close().catch(() => {});
        }
      }
    } finally {
      if (prevProbeEnv === undefined) {
        delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
      } else {
        process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevProbeEnv;
      }
      licenseHub.close();
      await new Promise<void>((r) => hubServer.close(() => r()));
    }
  });

  it("10. (VPS27-02) RemoteOAuthBridgeService + oauth-callback-relay encaminham callback loopback 127.0.0.1 do Desktop para a VPS sem ERR_CONNECTION_REFUSED", async () => {
    const desktopDir = join(tempDir, "desktop-oauth-bridge");
    const vpsDir = join(tempDir, "vps-oauth-bridge");
    mkdirSync(desktopDir, { recursive: true });
    mkdirSync(vpsDir, { recursive: true });

    const desktopRt = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(desktopDir, "criativo.db"),
      workspaceRoot: desktopDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      bypassLicenseForTests: true,
    });

    const vpsAccessToken = "vps-oauth-bridge-secret-27";
    const vpsRt = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(vpsDir, "criativo.db"),
      workspaceRoot: vpsDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      bypassLicenseForTests: true,
      accessToken: vpsAccessToken,
    });

    let receivedCallbackPath: string | null = null;
    const mockVpsLoopback = createHttpServer((req, res) => {
      receivedCallbackPath = req.url ?? null;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body>CODEX_LOOPBACK_OK</body></html>");
    });
    await new Promise<void>((r) => mockVpsLoopback.listen(0, "127.0.0.1", () => r()));
    const vpsLoopbackPort = (mockVpsLoopback.address() as { port: number }).port;

    // Encontra uma porta livre no Desktop para a ponte temporária sem colidir com o mock acima
    const probeBridge = createHttpServer();
    await new Promise<void>((r) => probeBridge.listen(0, "127.0.0.1", () => r()));
    const bridgePort = (probeBridge.address() as { port: number }).port;
    await new Promise<void>((r) => probeBridge.close(() => r()));

    try {
      const vpsRec = desktopRt.localServerManager!.registerRemoteServer({
        nome: "VPS OAuth Test",
        kind: "remote_vps",
        base_url: `http://127.0.0.1:${vpsRt.port}`,
        access_token: vpsAccessToken,
      });

      vpsRt.providerConnection.getCliOAuthService().registerPendingLoopbackPort("openai", vpsLoopbackPort);

      const authUrl = `https://auth.example.invalid/oauth/authorize?client_id=test&redirect_uri=${encodeURIComponent(
        `http://127.0.0.1:${bridgePort}/auth/callback`
      )}&state=ST27`;

      const prepRes = await fetch(
        `http://127.0.0.1:${desktopRt.port}/api/studio/servers/${encodeURIComponent(vpsRec.server_id)}/oauth-bridge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provedor: "openai", auth_url: authUrl }),
        }
      );
      assert.equal(prepRes.status, 200);
      const prepJson = (await prepRes.json()) as { ok: boolean; bridged: boolean; port: number };
      assert.equal(prepJson.ok, true);
      assert.equal(prepJson.bridged, true);
      assert.equal(prepJson.port, bridgePort);

      // Simula o redirecionamento final do navegador do PC Desktop para 127.0.0.1:<bridgePort>
      const browserRedirectRes = await fetch(
        `http://127.0.0.1:${bridgePort}/auth/callback?code=CODE_VPS_27&state=ST27`
      );
      assert.equal(browserRedirectRes.status, 200);
      const htmlBody = await browserRedirectRes.text();
      assert.match(htmlBody, /Autenticação concluída/i);
      assert.equal(receivedCallbackPath, "/auth/callback?code=CODE_VPS_27&state=ST27");
    } finally {
      await new Promise<void>((r) => mockVpsLoopback.close(() => r()));
      await vpsRt.close().catch(() => {});
      await desktopRt.close().catch(() => {});
    }
  });

  it("11. (VPS27-03) Provedores reportam runtime_host/runtime_platform e addManualTokenAccount invalida cache deixando Gemini conectado na VPS", async () => {
    const provRes = await fetch(
      `http://127.0.0.1:${(runtime.httpServer.address() as { port: number }).port}/api/provedores/status`
    );
    assert.equal(provRes.status, 200);
    const provJson = (await provRes.json()) as {
      provedores: Array<{
        provedor: string;
        runtime_host?: string | null;
        runtime_platform?: string | null;
      }>;
    };
    const oc = provJson.provedores.find((p) => p.provedor === "opencode");
    assert.ok(oc);
    assert.ok(typeof oc.runtime_host === "string" && oc.runtime_host.length > 0);
    assert.equal(oc.runtime_platform, process.platform);

    const vpsGeminiDir = join(tempDir, "vps-gemini-acc");
    mkdirSync(vpsGeminiDir, { recursive: true });
    const vpsRt = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      dbPath: join(vpsGeminiDir, "criativo.db"),
      workspaceRoot: vpsGeminiDir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      bypassLicenseForTests: true,
    });

    try {
      // Aquece cache inicial vazio antes da importação
      const snapEmpty = await vpsRt.providerConnection.getAntigravityService().getLiveSnapshot(false);
      assert.equal(snapEmpty.contas.length, 0);

      const postRes = await fetch(`http://127.0.0.1:${vpsRt.port}/api/provedores/gemini/contas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "gemini-vps27@exemplo.invalid",
          label: "Conta VPS",
          access_token: "ya29.vps27-token-valido",
          refresh_token: "1//vps27-refresh",
          expiry: new Date(Date.now() + 55 * 60_000).toISOString(),
        }),
      });
      assert.equal(postRes.status, 201);
      const postJson = (await postRes.json()) as {
        conta: { email: string };
        provedores: Array<{ provedor: string; conectado: boolean; modo_conexao: string; contas?: Array<{ email: string }> }>;
      };
      assert.equal(postJson.conta.email, "gemini-vps27@exemplo.invalid");
      const geminiStatus = postJson.provedores.find((p) => p.provedor === "gemini");
      assert.equal(geminiStatus?.conectado, true);
      assert.equal(geminiStatus?.modo_conexao, "assinatura");
      assert.equal(geminiStatus?.contas?.[0]?.email, "gemini-vps27@exemplo.invalid");
    } finally {
      await vpsRt.close().catch(() => {});
    }
  });
});
