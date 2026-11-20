import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { initializeDatabase } from "../src/database/client.ts";
import { seedDefaultStudioExperience } from "../src/engine/runner/roster-defaults.ts";
import { BrowserAutomationService } from "../src/engine/tools/browser-automation.ts";
import { BrowserCdpSessionManager } from "../src/engine/tools/browser-cdp-session.ts";
import { NativeCdpPage } from "../src/engine/tools/browser-native-cdp.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import {
  formatMarkdownForWhatsApp,
  markdownToWhatsAppText,
} from "../src/whatsapp/whatsapp-formatter.ts";

function decodeWsClientFrames(buf: Buffer, onText: (text: string) => void): void {
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const second = buf[offset + 1]!;
    const masked = (second & 0x80) !== 0;
    let len = second & 0x7f;
    let headerLen = 2;
    if (len === 126) {
      if (offset + 4 > buf.length) break;
      len = buf.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (len === 127) {
      if (offset + 10 > buf.length) break;
      len = Number(buf.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }
    const maskBytes = masked ? 4 : 0;
    if (offset + headerLen + maskBytes + len > buf.length) break;
    const payload = Buffer.from(buf.subarray(offset + headerLen + maskBytes, offset + headerLen + maskBytes + len));
    if (masked) {
      const mask = buf.subarray(offset + headerLen, offset + headerLen + 4);
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] = payload[i]! ^ mask[i % 4]!;
      }
    }
    onText(payload.toString("utf8"));
    offset += headerLen + maskBytes + len;
  }
}

function sendWsTextFrame(socket: import("node:net").Socket, text: string): void {
  const payload = Buffer.from(text, "utf8");
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

describe("Fase 22 — CDP sem __name, Takeover sem trava, WhatsApp Formatter e Floating Dock", () => {
  const tempDirs: string[] = [];
  const servers: HttpServer[] = [];

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  after(async () => {
    for (const s of servers) {
      await new Promise<void>((resolveClose) => s.close(() => resolveClose()));
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("1. (WPP22-01) Converte Markdown (#, **, listas, links, tabelas |...|) em texto limpo para WhatsApp e faz chunking", () => {
    const md = [
      "# Calendário Editorial — [NOME_DA_MARCA] (TESTE)",
      "",
      "> **Aviso:** roteiro fictício para validar [@SEU_PERFIL].",
      "",
      "## Premissas de teste",
      "| Item | Valor assumido |",
      "|---|---|",
      "| Nicho | Ferramentas digitais |",
      "| Tom | Direto e prático |",
      "",
      "- Primeiro item com **negrito** e [link](https://example.invalid/teste)",
      "* Segundo item com ~~riscado~~ e `codigo`",
    ].join("\n");

    const plain = markdownToWhatsAppText(md);
    assert.doesNotMatch(plain, /^#/m);
    assert.doesNotMatch(plain, /\|---\|/);
    assert.doesNotMatch(plain, /\*\*/);
    assert.match(plain, /\*Calendário Editorial — \[NOME_DA_MARCA\] \(TESTE\)\*/);
    assert.match(plain, /• \*Nicho:\* Ferramentas digitais/);
    assert.match(plain, /• \*Tom:\* Direto e prático/);
    assert.match(plain, /• Primeiro item com \*negrito\* e link \(https:\/\/example\.invalid\/teste\)/);
    assert.match(plain, /• Segundo item com ~riscado~ e codigo/);

    const longBlocks = Array.from({ length: 12 }, (_, idx) =>
      `Parágrafo ${idx + 1}: ${"conteúdo informativo conciso para teste ".repeat(8).trim()}`
    ).join("\n\n");
    const chunks = formatMarkdownForWhatsApp(longBlocks, { maxChunkLength: 500, maxChunks: 3 });
    assert.equal(chunks.length, 3);
    for (const ch of chunks) {
      assert.ok(ch.length <= 500, `Chunk excedeu 500 caracteres: ${ch.length}`);
    }
    assert.match(chunks[2]!, /Resumo completo disponível no chat/);
  });

  it("2. (CDP22-01) prepare-bundle usa keepNames: false e NativeCdpPage.evaluate executa funções com __name sem ReferenceError", async () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const prepareBundleSrc = readFileSync(
      join(repoRoot, "apps/desktop/scripts/prepare-bundle.mjs"),
      "utf8"
    );
    assert.match(prepareBundleSrc, /keepNames:\s*false/);
    assert.doesNotMatch(prepareBundleSrc, /keepNames:\s*true/);

    const snapshotSrc = readFileSync(
      join(repoRoot, "apps/daemon/src/engine/tools/browser-snapshot.ts"),
      "utf8"
    );
    assert.match(snapshotSrc, /function escapeCssIdent/);

    // Mock CDP executando realmente em vm.runInNewContext para garantir ausência de "__name is not defined"
    let cdpTargetUrl = "https://example.invalid/";
    const wsSockets = new Set<import("node:net").Socket>();
    const cdpServer = createHttpServer((req, res) => {
      const addr = cdpServer.address() as import("node:net").AddressInfo;
      if (req.url === "/json/version") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            Browser: "Chrome/132.0.0.0",
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/browser/test`,
          })
        );
        return;
      }
      if (req.url?.startsWith("/json/new")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "tab-vm-1",
            url: cdpTargetUrl,
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/tab-vm-1`,
          })
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    });

    cdpServer.on("upgrade", (req, socket) => {
      const key = String(req.headers["sec-websocket-key"] ?? "");
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      wsSockets.add(socket);
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      socket.on("data", (buf) => {
        decodeWsClientFrames(buf, (raw) => {
          const msg = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
          let result: unknown = {};
          if (msg.method === "Browser.getVersion") {
            result = { userAgent: "Mozilla/5.0 HeadlessChrome/132.0.0.0 Safari/537.36" };
          } else if (msg.method === "Page.getNavigationHistory") {
            result = { currentIndex: 1, entries: [{ id: 1, url: "https://a.invalid" }, { id: 2, url: "https://b.invalid" }] };
          } else if (msg.method === "Page.navigateToHistoryEntry") {
            cdpTargetUrl = "https://a.invalid";
          } else if (msg.method === "Page.captureScreenshot") {
            result = { data: Buffer.from("ok").toString("base64") };
          } else if (msg.method === "Runtime.evaluate") {
            const expr = String(msg.params?.expression ?? "");
            const sandbox = { document: { title: "Página Real" }, location: { href: cdpTargetUrl } };
            const val = vm.runInNewContext(expr, sandbox);
            result = { result: { value: val } };
          }
          sendWsTextFrame(socket, JSON.stringify({ id: msg.id, result }));
        });
      });
      socket.on("close", () => wsSockets.delete(socket));
    });

    await new Promise<void>((r) => cdpServer.listen(0, "127.0.0.1", r));
    servers.push(cdpServer);
    const addr = cdpServer.address() as import("node:net").AddressInfo;

    const prevDriver = process.env.CRIATIVO_BROWSER_DRIVER;
    process.env.CRIATIVO_BROWSER_DRIVER = "native";
    const dir = makeTempDir("p22-cdp-vm-");
    const mgr = new BrowserCdpSessionManager(dir);
    try {
      const tab = await mgr.openTab({
        perfilId: "prf-vm",
        userDataDir: join(dir, "prf"),
        agenteId: "prospectador",
        url: "https://example.invalid/",
        cdpUrl: `http://127.0.0.1:${addr.port}`,
        headless: true,
      });
      const page = tab.page as unknown as NativeCdpPage;
      // Simula função transformada com __name dentro do corpo avaliado em V8 isolado sem __name global
      const simFn = function () {
        const inner = (x: number) => x + 1;
        // @ts-expect-error __name será provido pelo shim injetado em NativeCdpPage.evaluate
        __name(inner, "inner");
        return inner(41);
      };
      const evalRes = await page.evaluate(simFn);
      assert.equal(evalRes, 42);

      assert.equal(await page.goBack(), true);
      assert.equal(page.url(), "https://a.invalid");
    } finally {
      for (const s of wsSockets) s.destroy();
      await mgr.closeAll();
      if (prevDriver === undefined) delete process.env.CRIATIVO_BROWSER_DRIVER;
      else process.env.CRIATIVO_BROWSER_DRIVER = prevDriver;
    }
  });

  it("3. (BRWS22-01) BrowserAutomationService não trava em requestTakeover(waitForResolution) e suporta autoAssume + events", async () => {
    const dir = makeTempDir("p22-brws-");
    const db = initializeDatabase({ dbPath: join(dir, "brws.sqlite") });
    seedDefaultStudioExperience(db);
    const vault = new VaultService(
      db,
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    const broadcasts: Array<{ event: string; data: any }> = [];
    const fakeWsHub = {
      broadcast: (event: string, data: any) => {
        broadcasts.push({ event, data });
      },
    } as any;

    const browser = new BrowserAutomationService(db, vault, fakeWsHub, dir);
    try {
      const tab = browser.createVirtualTabForSession({
        agenteId: "prospectador",
        url: "https://example.invalid/whatsapp",
        title: "Sessão Teste",
      });

      // Timeout curto ao aguardar resolução não pode travar
      const waited = (await browser.requestTakeover({
        tabId: tab.tabId,
        agenteId: "prospectador",
        reason: "login",
        waitForResolution: true,
        timeoutMs: 1000,
      })) as { decision: string };
      assert.equal(waited.decision, "timeout");
      assert.ok(broadcasts.some((b) => b.event === "browser:tabs_updated"));
      assert.ok(broadcasts.some((b) => b.event === "browser:takeover_requested"));

      // release_takeover via executeAction
      const released = (await browser.executeAction({
        action: "release_takeover",
        tabId: tab.tabId,
      })) as { ok: boolean; decision: string };
      assert.equal(released.ok, true);
      assert.equal(released.decision, "complete");
      assert.equal(tab.userControl, false);

      // dispatchTakeoverInput com autoAssume = true assume o controle automaticamente
      const inputRes = await browser.dispatchTakeoverInput(
        tab.tabId,
        { type: "mousePressed", x: 100, y: 120, button: "left" },
        { autoAssume: true }
      );
      assert.equal(inputRes.ok, true);
      assert.equal(tab.userControl, true);
    } finally {
      await browser.closeAll();
      db.close();
    }
  });

  it("4. (DESK22-01 & SYNC22-01) Verifica Electron desktopCapturer/FloatingDock, timeout OpenCode >= 180s e sync WhatsApp->Chat", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const desktopMainSrc = readFileSync(join(repoRoot, "apps/desktop/src/main.ts"), "utf8");
    const desktopDockSrc = readFileSync(join(repoRoot, "apps/desktop/src/floating-dock.ts"), "utf8");
    const openCodeSrc = readFileSync(
      join(repoRoot, "apps/daemon/src/providers/opencode-live-service.ts"),
      "utf8"
    );
    const daemonServerSrc = readFileSync(
      join(repoRoot, "apps/daemon/src/server/daemon-server.ts"),
      "utf8"
    );

    assert.match(desktopMainSrc, /desktopCapturer/);
    assert.match(desktopMainSrc, /setDisplayMediaRequestHandler/);
    assert.match(desktopMainSrc, /FloatingDockController/);
    assert.match(desktopMainSrc, /criativo:dock-set-expanded/);
    assert.match(desktopMainSrc, /criativo:open-main-window/);

    assert.equal(existsSync(join(repoRoot, "apps/desktop/src/floating-dock.ts")), true);
    assert.match(desktopDockSrc, /alwaysOnTop:\s*true/);
    assert.match(desktopDockSrc, /mode=floating-dock/);

    assert.match(openCodeSrc, /EXEC_TIMEOUT_MS\s*=\s*180_000/);

    assert.match(daemonServerSrc, /formatMarkdownForWhatsApp/);
    assert.match(daemonServerSrc, /channelOrigin:\s*"whatsapp"/);
    assert.match(daemonServerSrc, /origem:\s*"whatsapp"/);
  });
});
