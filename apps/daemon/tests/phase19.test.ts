import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import { generateLicenseKeyPair } from "@criativo/contracts/license-crypto-node";
import type { OnboardingEstado } from "@criativo/contracts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";
import { fetchMetaAccountAndMediaInsights } from "../src/engine/tools/meta-insights.ts";
import { extractTextFromBrandPdfBuffer } from "../src/server/brand-onboarding-service.ts";
import { resolveSafeUpdateArtifactPath } from "../../desktop/src/daemon-launcher.ts";

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

function createFakePdfWithFlateText(textLine: string): Buffer {
  const escaped = textLine.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const streamContent = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  const compressed = deflateSync(Buffer.from(streamContent, "utf8"));
  const header = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Length " + compressed.length + " /Filter /FlateDecode >>\nstream\n",
    "latin1"
  );
  const footer = Buffer.from("\nendstream\nendobj\n%%EOF", "latin1");
  return Buffer.concat([header, compressed, footer]);
}

describe("Fase 19 — Onboarding Híbrido, Ponte MCP Nativa/Meta v27.0, Layout Dinâmico & Auto-Update Real", () => {
  const tempDirs: string[] = [];
  const runtimes: DaemonRuntime[] = [];
  const closeHooks: Array<() => Promise<void> | void> = [];
  let prevSkipProbe: string | undefined;

  before(() => {
    prevSkipProbe = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    process.env.CRIATIVO_SKIP_LOCAL_PROBE = "1";
  });

  after(async () => {
    if (prevSkipProbe === undefined) delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;
    else process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkipProbe;
    for (const rt of runtimes) {
      await rt.close().catch(() => {});
    }
    for (const fn of closeHooks) {
      await fn();
    }
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
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

  function createMetaMockFetch(requestedUrls: string[]) {
    return (async (input: string | URL) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.includes("/insights") && url.includes("178414000000999")) {
        return new Response(
          JSON.stringify({
            data: [
              { name: "reach", total_value: { value: 18400 } },
              { name: "views", total_value: { value: 27900 } },
              { name: "profile_views", total_value: { value: 640 } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("/media?")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "media_reel_1",
                caption: "Gancho forte de exemplo sobre processo criativo",
                media_type: "VIDEO",
                media_product_type: "REELS",
                permalink: "https://instagram.com/reel/teste1",
                timestamp: "2026-11-18T12:00:00+0000",
                like_count: 320,
                comments_count: 24,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("/media_reel_1/insights")) {
        return new Response(
          JSON.stringify({
            data: [
              { name: "reach", values: [{ value: 5000 }] },
              { name: "views", values: [{ value: 6800 }] },
              { name: "saved", values: [{ value: 240 }] },
              { name: "shares", values: [{ value: 85 }] },
              { name: "total_interactions", values: [{ value: 669 }] },
              { name: "ig_reels_avg_watch_time", values: [{ value: 14200 }] },
              { name: "ig_reels_video_view_total_time", values: [{ value: 96560000 }] },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("178414000000999")) {
        return new Response(
          JSON.stringify({
            id: "178414000000999",
            username: "marca_teste_demo",
            name: "Marca Teste Demo",
            followers_count: 4200,
            follows_count: 180,
            media_count: 64,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ error: { message: "not mocked: " + url } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  }

  it("Bloco 1 & 2 (MCP19-01/02) — Apps Nativos multi-conta, ACL de agentes, Meta v27.0 e consultar_metricas_meta", async () => {
    const dir = makeTempDir("criativo-p19-meta-");
    const requestedUrls: string[] = [];
    const runtime = await createDaemonServer({
      port: 0,
      dbPath: join(dir, "criativo.db"),
      workspaceRoot: dir,
      productRoot: dir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      bypassLicenseForTests: true,
      fetchImpl: createMetaMockFetch(requestedUrls),
    });
    runtimes.push(runtime);
    const addr = runtime.httpServer.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // 1. Conectar App Nativo Instagram via API HTTP da Loja (com Graph API v27.0 mockada)
    const connRes = await fetch(`${baseUrl}/api/loja/apps/instagram/conectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flowId: "instagram-vault-keys",
        kind: "key",
        contaRotulo: "Conta Marca Demo",
        fields: {
          IG_USER_ID: "178414000000999",
          IG_ACCESS_TOKEN: "EAA_TOKEN_SECRETO_TESTE_99999999",
        },
        acesso: {
          mode: "agents",
          agentIds: ["analista_bi"],
        },
      }),
    });
    assert.equal(connRes.status, 200);
    const connJson = (await connRes.json()) as {
      ok: boolean;
      native?: boolean;
      nativeAccount?: {
        conta_id: string;
        conta_rotulo: string;
        testado_ok: boolean;
        campos_mascarados: Record<string, string>;
        campos_visiveis: Record<string, string>;
        perfil_conectado?: { username?: string };
        acesso: { mode: string; agentIds: string[] };
      };
      validationReport?: { ok: boolean; api_version: string };
    };
    assert.equal(connJson.ok, true);
    assert.equal(connJson.native, true);
    assert.equal(connJson.validationReport?.ok, true);
    assert.equal(connJson.validationReport?.api_version, "v27.0");
    assert.equal(connJson.nativeAccount?.conta_rotulo, "Conta Marca Demo");
    assert.equal(connJson.nativeAccount?.testado_ok, true);
    assert.equal(connJson.nativeAccount?.campos_visiveis.IG_USER_ID, "178414000000999");
    assert.match(connJson.nativeAccount?.campos_mascarados.IG_ACCESS_TOKEN ?? "", /^[•*]+/);
    assert.equal(connJson.nativeAccount?.perfil_conectado?.username, "marca_teste_demo");
    assert.deepEqual(connJson.nativeAccount?.acesso, { mode: "agents", agentIds: ["analista_bi"] });

    // 2. Ao reabrir getAppDetail HTTP, rótulo, valores visíveis, mascarados e perfil permanecem salvos
    const detailRes = await fetch(`${baseUrl}/api/loja/apps/instagram`);
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as {
      nativeAccounts: Array<{
        conta_id: string;
        conta_rotulo: string;
        campos_visiveis: Record<string, string>;
        campos_mascarados: Record<string, string>;
        acesso: { mode: string; agentIds: string[] };
      }>;
    };
    assert.equal(detailJson.nativeAccounts.length, 1);
    assert.equal(detailJson.nativeAccounts[0].conta_rotulo, "Conta Marca Demo");
    assert.equal(detailJson.nativeAccounts[0].campos_visiveis.IG_USER_ID, "178414000000999");

    // 3. Testar conexão sob demanda usando token salvo no Cofre
    const retestRes = await fetch(`${baseUrl}/api/loja/apps/instagram/testar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contaId: detailJson.nativeAccounts[0].conta_id }),
    });
    assert.equal(retestRes.status, 200);
    const retestJson = (await retestRes.json()) as { ok: boolean; validationReport?: { api_version: string } };
    assert.equal(retestJson.ok, true);
    assert.equal(retestJson.validationReport?.api_version, "v27.0");

    // 4. consultar_metricas_meta direto com Meta v27.0 (`views` e `ig_reels_avg_watch_time`, zero `impressions`/`plays`)
    const report = await fetchMetaAccountAndMediaInsights(
      { periodo: "30d", limite_posts: 5, incluir_reels: true },
      { vault: runtime.vault, fetchImpl: createMetaMockFetch(requestedUrls) }
    );
    assert.equal(report.ok, true);
    assert.equal(report.api_version, "v27.0");
    assert.equal(report.conta.username, "marca_teste_demo");
    assert.equal(report.insights_conta_30d_max.reach, 18400);
    assert.equal(report.insights_conta_30d_max.views, 27900);
    assert.equal(report.posts.length, 1);
    assert.equal(report.posts[0].views, 6800);
    assert.equal(report.posts[0].saved, 240);
    assert.equal(report.posts[0].avg_watch_time_ms, 14200);
    assert.ok(requestedUrls.some((u) => u.includes("graph.facebook.com/v27.0/")));
    assert.ok(!requestedUrls.some((u) => u.includes("impressions")));

    // 5. Remoção de conta limpa do Cofre
    const delRes = await fetch(
      `${baseUrl}/api/loja/apps/instagram/contas/${encodeURIComponent(detailJson.nativeAccounts[0].conta_id)}`,
      { method: "DELETE" }
    );
    assert.equal(delRes.status, 200);
    const afterDel = (await (await fetch(`${baseUrl}/api/loja/apps/instagram`)).json()) as {
      nativeAccounts: unknown[];
    };
    assert.equal(afterDel.nativeAccounts.length, 0);
  });

  it("Bloco 3 (MCP19-02) — CriativoStudioMcpBridge (/api/internal/mcp) autentica por token, filtra tools por agentId e bloqueia não autorizados", async () => {
    const dir = makeTempDir("criativo-p19-bridge-");
    const requestedUrls: string[] = [];
    const runtime = await createDaemonServer({
      port: 0,
      dbPath: join(dir, "criativo.db"),
      workspaceRoot: dir,
      productRoot: dir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      bypassLicenseForTests: true,
      fetchImpl: createMetaMockFetch(requestedUrls),
    });
    runtimes.push(runtime);
    const addr = runtime.httpServer.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Configura Instagram liberado SOMENTE para analista_bi
    await fetch(`${baseUrl}/api/loja/apps/instagram/conectar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flowId: "instagram-vault-keys",
        kind: "key",
        contaRotulo: "Conta Analytics",
        fields: {
          IG_USER_ID: "178414000000999",
          IG_ACCESS_TOKEN: "EAA_TOKEN_ANALYTICS_99999999",
        },
        acesso: {
          mode: "agents",
          agentIds: ["analista_bi"],
        },
      }),
    });

    const bridgeToken = runtime.studioMcpBridge.getAuthToken();
    const urlAnalista = runtime.studioMcpBridge.getEndpointUrlForAgent("analista_bi");
    const urlCopy = runtime.studioMcpBridge.getEndpointUrlForAgent("copywriter");
    assert.ok(urlAnalista && urlCopy);

    // 1. Sem token deve bloquear HTTP 401
    const unauth = await fetch(urlAnalista, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(unauth.status, 401);

    // 2. initialize com token válido
    const initRes = await fetch(urlAnalista, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Mcp-Token": bridgeToken,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(initRes.status, 200);
    const initJson = (await initRes.json()) as { result: { serverInfo: { name: string } } };
    assert.equal(initJson.result.serverInfo.name, "criativo-studio");

    // 3. tools/list para analista_bi contém consultar_metricas_meta; para copywriter NÃO contém!
    const listAnalistaRes = await fetch(urlAnalista, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Mcp-Token": bridgeToken,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const listAnalista = (await listAnalistaRes.json()) as { result: { tools: Array<{ name: string }> } };
    assert.ok(listAnalista.result.tools.some((t) => t.name === "consultar_metricas_meta"));

    const listCopyRes = await fetch(urlCopy, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Mcp-Token": bridgeToken,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    const listCopy = (await listCopyRes.json()) as { result: { tools: Array<{ name: string }> } };
    assert.equal(
      listCopy.result.tools.some((t) => t.name === "consultar_metricas_meta"),
      false
    );

    // 4. tools/call de consultar_metricas_meta funciona para analista_bi e é bloqueada para copywriter
    const callOkRes = await fetch(urlAnalista, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Mcp-Token": bridgeToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "consultar_metricas_meta", arguments: { periodo: "30d", limite_posts: 3 } },
      }),
    });
    assert.equal(callOkRes.status, 200);
    const callOkJson = (await callOkRes.json()) as {
      result?: { isError?: boolean; content: Array<{ text: string }> };
    };
    assert.ok(!callOkJson.result?.isError);
    assert.match(callOkJson.result?.content[0]?.text ?? "", /marca_teste_demo/);

    const callDeniedRes = await fetch(urlCopy, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Criativo-Mcp-Token": bridgeToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "consultar_metricas_meta", arguments: { periodo: "30d" } },
      }),
    });
    const callDeniedJson = (await callDeniedRes.json()) as {
      result?: { isError?: boolean; content: Array<{ text: string }> };
      error?: { message?: string };
    };
    const deniedText = callDeniedJson.error?.message || callDeniedJson.result?.content?.[0]?.text || "";
    assert.match(deniedText, /permissão|negad|autoriz/i);

    // 5. Specs geradas para ACP e Claude CLI apontam para /api/internal/mcp sem vazamento
    const acpSpec = runtime.studioMcpBridge.getAcpBridgeServerSpec("analista_bi");
    assert.ok(acpSpec && "url" in acpSpec && acpSpec.url.includes("/api/internal/mcp"));
    const claudeCfg = runtime.studioMcpBridge.getClaudeMcpConfigObject("analista_bi") as {
      mcpServers: { criativo_studio: { url: string; headers: Record<string, string> } };
    };
    assert.ok(claudeCfg.mcpServers.criativo_studio.headers["X-Criativo-Mcp-Token"] === bridgeToken);
  });

  it("Bloco 4 (UX19-02/04) — Extrator PDF FlateDecode, upload categorizado, assistente_setup auto-ocultável e contagem dinâmica por licença", async () => {
    const dir = makeTempDir("criativo-p19-onb-");
    // Prepara template mínimo perfil-da-marca.md no workspace temporário
    mkdirSync(join(dir, "conteudos"), { recursive: true });
    writeFileSync(
      join(dir, "conteudos", "perfil-da-marca.md"),
      [
        "# Perfil da Marca",
        "- Nome: [A PREENCHER]",
        "- Nicho: [A PREENCHER]",
        "- Publico: Público VIP existente",
        "- Tom de voz: [A PREENCHER]",
      ].join("\n"),
      "utf8"
    );

    // Sobe hub efêmero para emitir licença real individual (sem bonus/video -> 9 agentes base)
    const hubDir = makeTempDir("criativo-p19-hub-");
    const keys = generateLicenseKeyPair();
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
    closeHooks.push(async () => {
      licenseHub.close();
      await new Promise<void>((r) => hubServer.close(() => r()));
    });

    const licIssued = licenseHub.issueOrUpdateLicenseFromSale({
      email: "buyer@teste.local",
      customerName: "Comprador Teste",
      planTier: "individual",
      addUpgrades: [],
    });

    const runtime = await createDaemonServer({
      port: 0,
      dbPath: join(dir, "criativo.db"),
      workspaceRoot: dir,
      productRoot: dir,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      licenseHubUrl: hubUrl,
      licensePublicKeyPem: keys.publicKeyPem,
      enforceLicense: true,
      bypassLicenseForTests: false,
    });
    runtimes.push(runtime);
    const addr = runtime.httpServer.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Ativa licença padrão (sem upgrades -> 9 agentes base desbloqueados)
    const actRes = await fetch(`${baseUrl}/api/studio/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_key: licIssued.license_key,
        email: "buyer@teste.local",
      }),
    });
    assert.equal(actRes.status, 200);

    // 1. Antes do onboarding, assistente_setup NÃO aparece em GET /api/agentes (preserva legado) e contagem é dinâmica = 9
    const agPre = (await (await fetch(`${baseUrl}/api/agentes`)).json()) as {
      agentes: Array<{ agente_id: string }>;
      unlocked_agents_count: number;
    };
    assert.equal(agPre.unlocked_agents_count, 9);
    assert.equal(agPre.agentes.some((a) => a.agente_id === "assistente_setup"), false);

    // 2. Teste direto do extrator PDF FlateDecode em Node puro
    const rawExtracted = extractTextFromBrandPdfBuffer(
      createFakePdfWithFlateText("Marca: Estudio Lumina Teste - Nicho: Arquitetura Residencial - Tom de voz: Sofisticado e direto")
    );
    assert.match(rawExtracted, /Estudio Lumina Teste/);

    // 3. Upload categorizado via API HTTP para logo e ficha_pdf (preserva Publico manual e preenche [A PREENCHER])
    const pdfBuf = createFakePdfWithFlateText("Nome: Atelier Norte Teste\nNicho: Design Editorial");
    const upPdf = await fetch(`${baseUrl}/api/arquivos/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "ficha-empresa.pdf",
        mime_type: "application/pdf",
        categoria: "ficha_pdf",
        conteudo_base64: `data:application/pdf;base64,${pdfBuf.toString("base64")}`,
      }),
    });
    assert.equal(upPdf.status, 201);
    const upPdfJson = (await upPdf.json()) as {
      arquivo: { caminho_relativo: string; tipo_uso: string };
      brandExtraction?: { ok: boolean; extracted_chars: number; patch: Record<string, unknown> } | null;
    };
    assert.match(upPdfJson.arquivo.caminho_relativo, /^conteudos\/ficha\//);
    assert.ok((upPdfJson.brandExtraction?.extracted_chars ?? 0) > 10);

    const perfilMd = readFileSync(join(dir, "conteudos", "perfil-da-marca.md"), "utf8");
    assert.match(perfilMd, /Público VIP existente/);

    const upLogo = await fetch(`${baseUrl}/api/arquivos/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: "logo-marca.png",
        mime_type: "image/png",
        categoria: "logo",
        conteudo_base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      }),
    });
    assert.equal(upLogo.status, 201);
    const upLogoJson = (await upLogo.json()) as { arquivo: { caminho_relativo: string } };
    assert.match(upLogoJson.arquivo.caminho_relativo, /^recursos\/logos\//);

    // 4. Conclui Onboarding com pulos -> assistente_setup passa a aparecer; depois concluir_setup_inicial oculta; depois reopen reabre
    const onbPut = await fetch(`${baseUrl}/api/onboarding`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_concluido: true } satisfies Partial<OnboardingEstado>),
    });
    assert.equal(onbPut.status, 200);
    const agDuringSetup = (await (await fetch(`${baseUrl}/api/agentes`)).json()) as {
      agentes: Array<{ agente_id: string }>;
      setup_assistant_visible: boolean;
    };
    assert.equal(agDuringSetup.setup_assistant_visible, true);
    assert.equal(agDuringSetup.agentes.some((a) => a.agente_id === "assistente_setup"), true);

    const dismissRes = await fetch(`${baseUrl}/api/onboarding/setup-assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    });
    assert.equal(dismissRes.status, 200);
    const agAfterDismiss = (await (await fetch(`${baseUrl}/api/agentes`)).json()) as {
      agentes: Array<{ agente_id: string }>;
      setup_assistant_visible: boolean;
    };
    assert.equal(agAfterDismiss.setup_assistant_visible, false);
    assert.equal(agAfterDismiss.agentes.some((a) => a.agente_id === "assistente_setup"), false);

    await fetch(`${baseUrl}/api/onboarding/setup-assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen" }),
    });
    const agReopened = (await (await fetch(`${baseUrl}/api/agentes`)).json()) as {
      setup_assistant_visible: boolean;
    };
    assert.equal(agReopened.setup_assistant_visible, true);
  });

  it("Bloco 5 (UPD19-01) — AutoUpdateService v2 (utf8 + base64), trava Path Traversal e POST /api/studio/updates/restart", async () => {
    const dir = makeTempDir("criativo-p19-upd-");
    const productRoot = join(dir, "app-product");
    const userDataDir = join(dir, "user-data");
    mkdirSync(productRoot, { recursive: true });
    mkdirSync(join(productRoot, "dados"), { recursive: true });
    writeFileSync(join(productRoot, "produto.json"), JSON.stringify({ versao: "1.0.0" }), "utf8");
    writeFileSync(join(productRoot, "dados", "nao-tocar.txt"), "preservado", "utf8");

    // Teste unitário de segurança Path Traversal do launcher Desktop
    const updatesFolder = join(userDataDir, "updates");
    mkdirSync(updatesFolder, { recursive: true });
    const safeExe = resolveSafeUpdateArtifactPath(userDataDir, join(updatesFolder, "CriativoAIStudio-Setup-1.1.0.exe"));
    assert.ok(safeExe && safeExe.endsWith("CriativoAIStudio-Setup-1.1.0.exe"));
    assert.equal(resolveSafeUpdateArtifactPath(userDataDir, join(dir, "Windows", "System32", "cmd.exe")), null);
    assert.equal(resolveSafeUpdateArtifactPath(userDataDir, join(updatesFolder, "..", "evil.exe")), null);

    // Prepara bundle v2 + mock HTTP feed + restart hook monitorado
    const binarySample = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const bundleV2 = {
      format: "criativo-update-bundle-v2",
      version: "1.1.0",
      files: [
        { path: "produto.json", encoding: "utf8", content: JSON.stringify({ versao: "1.1.0" }) },
        { path: "apps/web/dist/app.js", encoding: "utf8", content: "console.log('v1.1.0');" },
        { path: "apps/web/dist/icon.png", encoding: "base64", content: binarySample.toString("base64") },
        { path: "dados/nao-tocar.txt", encoding: "utf8", content: "SOBRESCRITA_PROIBIDA" },
      ],
    };
    const bundleBuf = Buffer.from(JSON.stringify(bundleV2), "utf8");
    const bundleSha = createHash("sha256").update(bundleBuf).digest("hex");

    const hubDir = makeTempDir("criativo-p19-upd-hub-");
    const keys = generateLicenseKeyPair();
    const adminToken = "adm-token-p19-upd";
    const { app, licenseHub } = createLandingApp({
      distDir: join(hubDir, "dist-empty"),
      bonusDir: join(hubDir, "bonus-empty"),
      licenseHub: {
        dbPath: join(hubDir, "licencas.db"),
        releasesDir: join(hubDir, "releases"),
        privateKeyPem: keys.privateKeyPem,
        publicKeyPem: keys.publicKeyPem,
        adminToken,
      },
    });
    const hubServer = await new Promise<import("node:http").Server>((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    const hubUrl = `http://127.0.0.1:${(hubServer.address() as { port: number }).port}`;
    closeHooks.push(async () => {
      licenseHub.close();
      await new Promise<void>((r) => hubServer.close(() => r()));
    });

    const pubRes = await fetch(`${hubUrl}/api/admin/releases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        version: "1.1.0",
        channel: "stable",
        changelog_markdown: "- Hot-bundle v2 Fase 19",
        artifactFiles: [
          {
            platform: "vps-tarball",
            arch: "x64",
            filename: "criativo-update-1.1.0.json",
            content: bundleBuf.toString("utf8"),
            sha256: bundleSha,
          },
        ],
      }),
    });
    assert.equal(pubRes.status, 201);

    const licIssued = licenseHub.issueOrUpdateLicenseFromSale({
      email: "upd@teste.local",
      customerName: "Updater",
      planTier: "agencia_10",
    });

    const restartEvents: Array<{ mode: string; stagedArtifactPath: string | null; version: string }> = [];
    const runtime = await createDaemonServer({
      port: 0,
      dbPath: join(dir, "criativo.db"),
      workspaceRoot: userDataDir,
      productRoot,
      autoStartLoops: false,
      autoBootWhatsApp: false,
      licenseHubUrl: hubUrl,
      licensePublicKeyPem: keys.publicKeyPem,
      enforceLicense: true,
      bypassLicenseForTests: false,
      onRestartRequested: (ctx) => {
        if (ctx) restartEvents.push(ctx);
      },
    });
    runtimes.push(runtime);
    const daemonBaseUrl = `http://127.0.0.1:${(runtime.httpServer.address() as { port: number }).port}`;

    const actUpdRes = await fetch(`${daemonBaseUrl}/api/studio/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key: licIssued.license_key, email: "upd@teste.local" }),
    });
    assert.equal(actUpdRes.status, 200);

    const applyRes = await fetch(`${daemonBaseUrl}/api/studio/updates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "vps-tarball" }),
    });
    assert.equal(applyRes.status, 200);
    const applyJson = (await applyRes.json()) as {
      status: { state: string; install_mode?: string; staged_artifact_name?: string | null };
    };
    assert.equal(applyJson.status.state, "ready_to_restart");
    assert.equal(applyJson.status.install_mode, "hot_bundle");

    assert.equal(readFileSync(join(productRoot, "apps/web/dist/app.js"), "utf8"), "console.log('v1.1.0');");
    assert.deepEqual(readFileSync(join(productRoot, "apps/web/dist/icon.png")), binarySample);
    assert.equal(readFileSync(join(productRoot, "dados/nao-tocar.txt"), "utf8"), "preservado");

    const restartRes = await fetch(`${daemonBaseUrl}/api/studio/updates/restart`, { method: "POST" });
    assert.equal(restartRes.status, 200);
    const restartJson = (await restartRes.json()) as { ok: boolean; triggered: boolean; mode: string; version: string };
    assert.equal(restartJson.triggered, true);
    assert.equal(restartJson.mode, "hot_bundle");
    assert.equal(restartEvents.length, 1);
    assert.equal(restartEvents[0].mode, "hot_bundle");
    assert.equal(existsSync(resolve(productRoot, "produto.json")), true);
  });
});
