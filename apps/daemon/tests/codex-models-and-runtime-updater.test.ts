import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  extractCleanCodexError,
  fetchCodexAccountModelsHttp,
  isCodexSchemaMismatchError,
  mapCodexModelsResponseToInfo,
} from "../src/providers/cli-oauth/codex-models-http.ts";
import {
  checkAndUpdateManagedRuntimes,
  resolveNpmCmdWrapperTarget,
  spawnProviderProcess,
} from "../src/providers/provider-runtime-resolver.ts";

describe("Codex Modelos Reais da Conta, Auto-Updater e Spawn Sem cmd.exe", () => {
  it("1. Executa wrapper .cmd do npm direto via Node preservando URLs com '&' no Windows", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "criativo-cmd-wrap-"));
    try {
      const binDir = join(tempDir, "node_modules", ".bin");
      const pkgBinDir = join(tempDir, "node_modules", "@openai", "codex", "bin");
      mkdirSync(binDir, { recursive: true });
      mkdirSync(pkgBinDir, { recursive: true });

      const targetJs = join(pkgBinDir, "codex.js");
      writeFileSync(
        targetJs,
        `process.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,
        "utf8"
      );

      const cmdPath = join(binDir, "codex.cmd");
      writeFileSync(
        cmdPath,
        `@ECHO off\r\n"%~dp0\\..\\@openai\\codex\\bin\\codex.js" %*\r\n`,
        "utf8"
      );

      const scriptPath = process.platform === "win32" ? cmdPath : targetJs;
      if (process.platform === "win32") {
        assert.equal(resolveNpmCmdWrapperTarget(cmdPath), targetJs);
      }

      const mcpUrlArg =
        'mcp_servers.criativo_studio.url="http://127.0.0.1:3000/mcp?agentId=a&scopes=read&threadId=t1"';
      const output = await new Promise<string>((resolveOut, rejectOut) => {
        const child = spawnProviderProcess(
          scriptPath,
          ["exec", "--json", "-c", mcpUrlArg, "--model", "gpt-5.5", "-"],
          { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
        );
        let out = "";
        let err = "";
        child.stdout.on("data", (c) => (out += c.toString("utf8")));
        child.stderr.on("data", (c) => (err += c.toString("utf8")));
        child.on("error", rejectOut);
        child.on("close", (code) => {
          if (code === 0) resolveOut(out);
          else rejectOut(new Error(`exit ${code}: ${err}`));
        });
      });

      const parsedArgv = JSON.parse(output) as string[];
      assert.deepEqual(parsedArgv, [
        "exec",
        "--json",
        "-c",
        mcpUrlArg,
        "--model",
        "gpt-5.5",
        "-",
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("2. Busca modelos reais da conta ChatGPT via HTTP, filtra ocultos/auto-review, corrige suporta_imagem e renova em 401", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "criativo-codex-http-"));
    try {
      const codexHome = join(tempDir, "codex-home");
      mkdirSync(codexHome, { recursive: true });

      const makeJwt = (payloadObj: Record<string, unknown>) => {
        const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
        const body = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
        return `${header}.${body}.sig`;
      };

      const writeAuth = (accessToken: string, accId: string) => {
        writeFileSync(
          join(codexHome, "auth.json"),
          JSON.stringify({
            tokens: {
              access_token: accessToken,
              refresh_token: "ref-tok-123",
              id_token: makeJwt({
                email: "tester@exemplo.local",
                "https://api.openai.com/auth": { chatgpt_account_id: accId },
              }),
            },
          }),
          "utf8"
        );
      };

      writeAuth("expired-access-token", "acc-org-001");

      let refreshCalls = 0;
      const seenHeaders: Array<{ auth: string | null; accountId: string | null; url: string }> = [];

      const mockFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        const h = new Headers(init?.headers);
        seenHeaders.push({
          auth: h.get("authorization"),
          accountId: h.get("chatgpt-account-id"),
          url,
        });

        if (h.get("authorization") === "Bearer expired-access-token") {
          return new Response("unauthorized", { status: 401 });
        }

        return new Response(
          JSON.stringify({
            models: [
              {
                slug: "codex-auto-review",
                display_name: "Codex Auto Review",
                visibility: "hide",
                priority: 1,
                supported_reasoning_levels: [{ effort: "medium" }, { effort: "max" }],
              },
              {
                slug: "gpt-5.4-mini",
                display_name: "GPT-5.4-Mini",
                visibility: "list",
                priority: 2,
                input_modalities: ["text", "image"],
                supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
              },
              {
                slug: "gpt-5.5",
                display_name: "GPT-5.5",
                visibility: "list",
                priority: 1,
                input_modalities: ["text", "image"],
                supported_reasoning_levels: [
                  { effort: "low" },
                  { effort: "medium" },
                  { effort: "high" },
                  { effort: "xhigh" },
                  { effort: "max" },
                ],
              },
              {
                slug: "gpt-image-1",
                display_name: "GPT Image 1",
                visibility: "list",
                priority: 3,
              },
              {
                slug: "gpt-4-text-only",
                display_name: "GPT Text Only",
                visibility: "list",
                priority: 4,
                input_modalities: ["text"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const models = await fetchCodexAccountModelsHttp({
        codexHome,
        fetchImpl: mockFetch,
        appDataDir: tempDir,
        onUnauthorizedRefresh: async () => {
          refreshCalls += 1;
          writeAuth("fresh-access-token", "acc-org-001");
        },
      });

      assert.equal(refreshCalls, 1);
      assert.equal(seenHeaders.length, 2);
      assert.equal(seenHeaders[1].auth, "Bearer fresh-access-token");
      assert.equal(seenHeaders[1].accountId, "acc-org-001");
      assert.match(seenHeaders[1].url, /client_version=0\.172\.0/);

      assert.deepEqual(
        models.map((m) => m.id),
        ["gpt-5.5", "gpt-5.4-mini", "gpt-image-1", "gpt-4-text-only"]
      );
      assert.equal(models[0].padrao, true);
      assert.equal(models[0].suporta_imagem, true);
      assert.deepEqual(models[0].esforcos_suportados, ["baixo", "medio", "alto"]);
      assert.equal(models[1].suporta_imagem, true);
      assert.equal(models[2].suporta_imagem, true);
      assert.equal(models[3].suporta_imagem, false);

      // Valida também mapCodexModelsResponseToInfo isolado contra hidden=true
      const directMapped = mapCodexModelsResponseToInfo([
        { slug: "hidden-flag-model", hidden: true, visibility: "list" },
        { slug: "gpt-5.5", visibility: "list" },
      ]);
      assert.deepEqual(
        directMapped.map((m) => m.id),
        ["gpt-5.5"]
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("3. Detecta erro de schema 'unknown variant max' e extrai mensagem limpa sem JSON dump", () => {
    const rawStderr = [
      "Reading prompt from stdin...",
      "",
      '2026-11-26T15:45:33.451944Z ERROR codex_models_manager::manager: failed to refresh available models: stream disconnected before completion: failed to decode models response: unknown variant max, expected one of none, minimal, low, medium, high, xhigh at line 1 column 1578; body: {"models":[{"slug":"codex-auto-review"}]}',
      "",
      "'scopes' is not recognized as an internal or external command,",
    ].join("\n");

    assert.equal(isCodexSchemaMismatchError(rawStderr), true);
    const clean = extractCleanCodexError(rawStderr, "");
    assert.equal(clean.includes('{"models"'), false);
    assert.equal(clean.includes("\n"), false);
    assert.match(clean, /Codex CLI desatualizada/i);
  });

  it("4. checkAndUpdateManagedRuntimes atualiza runtime desatualizado e respeita TTL de 24h", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "criativo-updater-"));
    try {
      const npmBinDir = join(tempDir, "CriativoStudio", "provider-runtimes", "codex", "npm", "node_modules", ".bin");
      const pkgDir = join(tempDir, "CriativoStudio", "provider-runtimes", "codex", "npm", "node_modules", "@openai", "codex");
      mkdirSync(npmBinDir, { recursive: true });
      mkdirSync(pkgDir, { recursive: true });

      const binName = process.platform === "win32" ? "codex.cmd" : "codex";
      const binPath = join(npmBinDir, binName);
      writeFileSync(binPath, "stub-bin", "utf8");
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@openai/codex", version: "0.150.0" }), "utf8");

      let fetchCalls = 0;
      let upgradeCalls = 0;
      const mockFetch: typeof fetch = async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ version: "0.172.0" }), { status: 200 });
      };

      const firstRun = await checkAndUpdateManagedRuntimes({
        appDataDir: tempDir,
        folders: ["codex"],
        fetchImpl: mockFetch,
        upgradeImpl: async (folder) => {
          upgradeCalls += 1;
          assert.equal(folder, "codex");
          writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@openai/codex", version: "0.172.0" }), "utf8");
          return { executable: binPath, version: "0.172.0", installedNow: true };
        },
      });

      assert.deepEqual(firstRun.checked, ["codex"]);
      assert.deepEqual(firstRun.updated, ["codex"]);
      assert.equal(fetchCalls, 1);
      assert.equal(upgradeCalls, 1);

      const checkFile = join(tempDir, "CriativoStudio", "provider-runtimes", ".update-check.json");
      const savedState = JSON.parse(readFileSync(checkFile, "utf8")) as { checkedAt?: Record<string, string> };
      assert.ok(savedState.checkedAt?.codex);

      // Segunda execução dentro de 24h deve pular sem consultar rede nem reinstalar
      const secondRun = await checkAndUpdateManagedRuntimes({
        appDataDir: tempDir,
        folders: ["codex"],
        fetchImpl: mockFetch,
        upgradeImpl: async () => {
          upgradeCalls += 1;
          return { executable: binPath, version: "0.172.0", installedNow: true };
        },
      });

      assert.deepEqual(secondRun.checked, []);
      assert.deepEqual(secondRun.updated, []);
      assert.equal(fetchCalls, 1);
      assert.equal(upgradeCalls, 1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
