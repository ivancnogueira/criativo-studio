import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AntigravityLiveService } from "../src/providers/antigravity-live-service.ts";
import { RemoteClaimService } from "../src/servers/remote-claim-service.ts";
import { getUserSettings, updateUserSettings } from "../src/server/settings-storage-service.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";

const daemonRoot = resolve(fileURLToPath(import.meta.url), "../..");

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
});
