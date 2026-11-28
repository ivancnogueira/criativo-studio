import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStudioPaths } from "../src/config/app-paths.ts";
import type { LicenseClientService } from "../src/license/license-service.ts";
import { modelSupportsImageCodex } from "../src/providers/cli-oauth/codex-models-http.ts";
import {
  installCodexStandaloneBinary,
  selectCodexReleaseAsset,
} from "../src/providers/codex-standalone-installer.ts";
import { checkManagedRuntimesUpdateStatus } from "../src/providers/provider-runtime-updater.ts";
import { AutoUpdateService } from "../src/updater/auto-update-service.ts";
import { buildWindowsUpdateRelaunchScript } from "../../desktop/src/update-relauncher.ts";
import { initializeDatabase } from "../src/database/client.ts";
import { seedDefaultAgents } from "../src/engine/runner/roster-defaults.ts";
import {
  DEFAULT_FALLBACK_FREE_MODEL,
  LEGACY_OR_DEPRECATED_DEFAULT_MODELS,
  pickBestAvailableModel,
  reconcileAgentsDefaultModels,
} from "../src/providers/default-model-resolver.ts";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createMockLicenseService(): LicenseClientService {
  return {
    hubBaseUrl: "https://painel.criativo.test",
    isBypassedForTests: () => false,
    getStatus: () => ({
      valid: true,
      status: "active",
      license_key: "CRV-TEST-4010",
      plan_tier: "agencia_ilimitada",
      max_servers: -1,
      max_machines: 10,
      upgrades: ["video", "whatsapp", "carousel", "ads"],
      expires_at: null,
      offline_grace_until: null,
      last_verified_at: new Date().toISOString(),
      machine_id: "mach-40-10",
      server_id: "srv-40-10",
      error_code: null,
      error_message: null,
    }),
    getCredentialHeaders: () => ({
      "x-criativo-license-key": "CRV-TEST-4010",
      "x-criativo-machine-id": "mach-40-10",
    }),
  } as unknown as LicenseClientService;
}

describe("Subfase 40.10 — Auto-Update com Relaunch, Codex CLI Standalone & Flag de Imagem GPT", () => {
  it("1. AutoUpdateService baixa atualização automaticamente em background e dispara reinício quando solicitado", async () => {
    const dir = makeTempDir("crv-p4010-autoupdate-");
    try {
      const productRoot = join(dir, "product");
      mkdirSync(productRoot, { recursive: true });
      writeFileSync(join(productRoot, "produto.json"), JSON.stringify({ versao: "1.0.8" }), "utf8");

      const bundleContent = JSON.stringify({
        format: "criativo-update-bundle-v1",
        version: "1.0.9",
        files: { "VERSAO_APLICADA.txt": "1.0.9" },
      });
      const sha256 = createHash("sha256").update(bundleContent, "utf8").digest("hex");

      let restartedWithVersion: string | null = null;
      const service = new AutoUpdateService({
        licenseService: createMockLicenseService(),
        paths: resolveStudioPaths({ productRoot, dataRoot: join(dir, "dados") }),
        currentVersion: "1.0.8",
        autoDownload: true,
        onRestartRequested: (ctx) => {
          restartedWithVersion = ctx?.version ?? null;
        },
        fetchImpl: async (url) => {
          const u = String(url);
          if (u.includes("/api/releases/latest")) {
            return new Response(
              JSON.stringify({
                version: "1.0.9",
                published_at: new Date().toISOString(),
                channel: "stable",
                changelog_markdown: "- Relaunch automatico e Codex standalone",
                artifacts: [
                  {
                    platform: "vps-tarball",
                    filename: "criativo-bundle-1.0.9.json",
                    download_path: "/api/releases/download/v1.0.9/criativo-bundle-1.0.9.json",
                    sha256,
                    size_bytes: Buffer.byteLength(bundleContent),
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(bundleContent, { status: 200 });
        },
      });

      await service.checkForUpdates();
      const deadline = Date.now() + 2000;
      while (service.getStatus().state !== "ready_to_restart" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }

      const snap = service.getStatus();
      assert.equal(snap.state, "ready_to_restart");
      assert.equal(snap.current_version, "1.0.9");
      assert.equal(snap.staged_artifact_name, "criativo-bundle-1.0.9.json");

      const restartRes = await service.triggerRestart({ force: true });
      assert.equal(restartRes.triggered, true);
      assert.equal(restartedWithVersion, "1.0.9");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("2. buildWindowsUpdateRelaunchScript aguarda PID encerrar, executa instalador /S /currentuser --updated e reabre executável via env vars", () => {
    const script = buildWindowsUpdateRelaunchScript();
    assert.match(script, /CRIATIVO_UPDATER_PID/);
    assert.match(script, /CRIATIVO_UPDATER_INSTALLER/);
    assert.match(script, /CRIATIVO_UPDATER_EXE/);
    assert.match(script, /ArgumentList\s+@\('\/S',\s*'\/currentuser',\s*'--updated'\)/);
    assert.match(script, /Start-Process\s+-FilePath\s+\$exePath/);
  });

  it("3. installCodexStandaloneBinary baixa binário nativo oficial com SHA-256 sem exigir npm em Windows/macOS/Linux", async () => {
    const assets = [
      {
        name: "codex-x86_64-pc-windows-msvc.exe.zip",
        browser_download_url: "https://github.com/openai/codex/releases/download/rust-v0.175.0/codex-x86_64-pc-windows-msvc.exe.zip",
        digest: "sha256:" + "a".repeat(64),
      },
      {
        name: "codex-aarch64-apple-darwin.tar.gz",
        browser_download_url: "https://github.com/openai/codex/releases/download/rust-v0.175.0/codex-aarch64-apple-darwin.tar.gz",
      },
      {
        name: "codex-x86_64-unknown-linux-musl.tar.gz",
        browser_download_url: "https://github.com/openai/codex/releases/download/rust-v0.175.0/codex-x86_64-unknown-linux-musl.tar.gz",
      },
    ];
    assert.equal(selectCodexReleaseAsset(assets, "win32", "x64")?.binName, "codex.exe");
    assert.equal(selectCodexReleaseAsset(assets, "darwin", "arm64")?.archiveKind, "tar.gz");
    assert.equal(selectCodexReleaseAsset(assets, "linux", "x64")?.archiveKind, "tar.gz");

    const dir = makeTempDir("crv-p4010-codex-");
    try {
      const fakeArchiveBytes = Buffer.from("fake-codex-zip-payload", "utf8");
      const sha256 = createHash("sha256").update(fakeArchiveBytes).digest("hex");
      const targetBinName = process.platform === "win32" ? "codex.exe" : "codex";

      const installRes = await installCodexStandaloneBinary({
        appDataDir: dir,
        forceInstall: true,
        fetchImpl: async (url) => {
          const u = String(url);
          if (u.includes("/releases/latest")) {
            return new Response(
              JSON.stringify({
                tag_name: "rust-v0.175.0",
                assets: [
                  {
                    name:
                      process.platform === "win32"
                        ? "codex-x86_64-pc-windows-msvc.exe.zip"
                        : process.platform === "darwin"
                          ? "codex-aarch64-apple-darwin.tar.gz"
                          : "codex-x86_64-unknown-linux-musl.tar.gz",
                    browser_download_url:
                      "https://github.com/openai/codex/releases/download/rust-v0.175.0/codex-x86_64-pc-windows-msvc.exe.zip",
                    digest: `sha256:${sha256}`,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(fakeArchiveBytes, { status: 200 });
        },
        extractImpl: async (_archivePath, destDir) => {
          writeFileSync(join(destDir, targetBinName), "binary", "utf8");
        },
      });

      assert.equal(installRes.installedNow, true);
      assert.equal(installRes.version, "0.175.0");
      assert.ok(installRes.executable && existsSync(installRes.executable));

      // Verifica checkManagedRuntimesUpdateStatus detectando atualização disponível (0.175.0 -> 0.176.0)
      const updates = await checkManagedRuntimesUpdateStatus({
        appDataDir: dir,
        folders: ["codex"],
        forceCheck: true,
        fetchImpl: async () =>
          new Response(JSON.stringify({ version: "0.176.0" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      });
      assert.equal(updates.length, 1);
      assert.equal(updates[0].provider, "openai");
      assert.equal(updates[0].currentVersion, "0.175.0");
      assert.equal(updates[0].latestVersion, "0.176.0");
      assert.equal(updates[0].updateAvailable, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("4. modelSupportsImageCodex marca modelos GPT multimodais e dedicados de imagem sem marcar text-only", () => {
    assert.equal(modelSupportsImageCodex({ id: "gpt-6.2-sol" }), true);
    assert.equal(
      modelSupportsImageCodex({ id: "gpt-5.6-astra", input_modalities: ["text", "image"] }),
      true
    );
    assert.equal(modelSupportsImageCodex({ id: "gpt-image-2.6-sunburst" }), true);
    assert.equal(
      modelSupportsImageCodex({ id: "gpt-5-codex-mini", input_modalities: ["text"] }),
      false
    );
    assert.equal(modelSupportsImageCodex({ id: "gpt-4o-realtime-preview" }), false);
  });

  it("5. Agentes nascem sem modelos descontinuados e reconciliam automaticamente ao conectar provedores reais", () => {
    const dir = makeTempDir("crv-p4010-default-models-");
    const dbPath = join(dir, "studio.sqlite");
    const db = initializeDatabase({ dbPath });
    try {
      // Sem provedores conectados: fallback vai para OpenCode free
      assert.equal(pickBestAvailableModel([]), DEFAULT_FALLBACK_FREE_MODEL);

      // Com apenas OpenCode conectado: usa modelo OpenCode gratuito (ignorando legados)
      assert.equal(
        pickBestAvailableModel([
          {
            provedor: "opencode",
            rotulo: "OpenCode",
            conectado: true,
            modo_conexao: "cli",
            modelos: [
              { id: "opencode/glm-5.3-flash-free", rotulo: "GLM 5.3 Flash Free", padrao: true },
            ],
          },
        ]),
        "opencode/glm-5.3-flash-free"
      );

      // Com conta paga OpenAI + OpenCode conectada: prioriza modelo de chat da conta paga (ignora image-only)
      assert.equal(
        pickBestAvailableModel([
          {
            provedor: "opencode",
            rotulo: "OpenCode",
            conectado: true,
            modo_conexao: "cli",
            modelos: [{ id: "opencode/glm-5.3-flash-free", rotulo: "GLM 5.3 Flash Free", padrao: true }],
          },
          {
            provedor: "openai",
            rotulo: "ChatGPT",
            conectado: true,
            modo_conexao: "assinatura",
            modelos: [
              { id: "gpt-image-2.6-sunburst", rotulo: "GPT Image", suporta_imagem: true },
              { id: "gpt-6.2-sol", rotulo: "GPT-6.2 Sol", padrao: true, suporta_imagem: true },
            ],
          },
        ]),
        "gpt-6.2-sol"
      );

      // Seed cria todos os agentes sem nenhum modelo descontinuado hardcoded
      seedDefaultAgents(db);
      const seededRows = db.connection
        .prepare(`SELECT agente_id, modelo_padrao FROM projecao_agentes;`)
        .all() as Array<{ agente_id: string; modelo_padrao: string }>;
      assert.ok(seededRows.length >= 15);
      for (const r of seededRows) {
        assert.equal(
          LEGACY_OR_DEPRECATED_DEFAULT_MODELS.has(r.modelo_padrao),
          false,
          `Agente ${r.agente_id} nasceu com modelo legado ${r.modelo_padrao}`
        );
        assert.equal(r.modelo_padrao, DEFAULT_FALLBACK_FREE_MODEL);
      }

      // Simula agente legado pré-existente + agente manualmente fixado pelo usuário
      const now = new Date().toISOString();
      db.connection
        .prepare(`UPDATE projecao_agentes SET modelo_padrao = 'gemini-2.5-pro' WHERE agente_id = 'estrategista';`)
        .run();
      db.connection
        .prepare(
          `INSERT INTO projecao_agentes (
             agente_id, nome, papel, modelo_padrao, status, skills_paths_json, ordem_exibicao, config_json, atualizado_em
           ) VALUES ('custom_fixado', 'Custom Fixado', 'Teste', 'grok-4.6', 'ocioso', '[]', 99, ?, ?);`
        )
        .run(JSON.stringify({ customizado: true, modelo_fixado_usuario: true }), now);

      const rec = reconcileAgentsDefaultModels(db, [
        {
          provedor: "openai",
          rotulo: "ChatGPT",
          conectado: true,
          modo_conexao: "assinatura",
          modelos: [{ id: "gpt-6.2-sol", rotulo: "GPT-6.2 Sol", padrao: true }],
        },
      ]);

      assert.ok(rec.updatedIds.includes("estrategista"));
      assert.ok(!rec.updatedIds.includes("custom_fixado"));

      const estRow = db.connection
        .prepare(`SELECT modelo_padrao FROM projecao_agentes WHERE agente_id = 'estrategista';`)
        .get() as { modelo_padrao: string };
      assert.equal(estRow.modelo_padrao, "gpt-6.2-sol");

      const fixedRow = db.connection
        .prepare(`SELECT modelo_padrao FROM projecao_agentes WHERE agente_id = 'custom_fixado';`)
        .get() as { modelo_padrao: string };
      assert.equal(fixedRow.modelo_padrao, "grok-4.6");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
