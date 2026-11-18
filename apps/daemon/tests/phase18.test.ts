import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import type { UpdateStatusSnapshot } from "@criativo/contracts";
import { generateLicenseKeyPair } from "@criativo/contracts/license-crypto-node";
import {
  bootstrapUserDataDirectory,
  resolveDefaultUserDataDir,
  resolveStudioPaths,
} from "../src/config/app-paths.ts";
import { createDaemonServer, type DaemonRuntime } from "../src/server/daemon-server.ts";

const landingServerUrl = new URL("../../../../criativo-ai-studio-landing/server.js", import.meta.url).href;
const { createLandingApp } = (await import(landingServerUrl)) as {
  createLandingApp: (options?: Record<string, unknown>) => {
    app: { listen: (port: number, host: string, cb: () => void) => import("node:http").Server };
    licenseHub: {
      db: {
        prepare: (sql: string) => {
          get: (...args: unknown[]) => Record<string, unknown> | undefined;
          run: (...args: unknown[]) => void;
        };
      };
      issueOrUpdateLicenseFromSale: (input: Record<string, unknown>) => { license_key: string; id: string };
      close: () => void;
    };
  };
};

const prepareBundleUrl = new URL("../../../apps/desktop/scripts/prepare-bundle.mjs", import.meta.url).href;
const { prepareDesktopBundle } = (await import(prepareBundleUrl)) as {
  prepareDesktopBundle: (opts?: { repoRoot?: string; outDir?: string }) => string;
};

describe("Fase 18 — App Desktop Instalável, Isolamento UserData & Auto-Update SHA-256", () => {
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
        // ignora handle residual
      }
    }
  });

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function startEphemeralHub() {
    const dir = makeTempDir("criativo-p18-hub-");
    const keys = generateLicenseKeyPair();
    const adminToken = "adm-token-phase18-test";
    const { app, licenseHub } = createLandingApp({
      distDir: join(dir, "dist-empty"),
      bonusDir: join(dir, "bonus-empty"),
      licenseHub: {
        dbPath: join(dir, "licencas.db"),
        releasesDir: join(dir, "releases"),
        privateKeyPem: keys.privateKeyPem,
        publicKeyPem: keys.publicKeyPem,
        adminToken,
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

    return { keys, licenseHub, hubUrl, adminToken };
  }

  it("Bloco 1 — app-paths.ts separa productRoot vs userDataRoot e preserva dados no re-bootstrap", () => {
    const winDir = resolveDefaultUserDataDir("win32", { APPDATA: "C:\\Users\\Demo\\AppData\\Roaming" }, "C:\\Users\\Demo");
    assert.match(winDir, /CriativoAIStudio$/);
    assert.match(winDir, /AppData[\\/]Roaming/);

    const macDir = resolveDefaultUserDataDir("darwin", {}, "/Users/demo");
    assert.equal(macDir, resolve("/Users/demo/Library/Application Support/CriativoAIStudio"));

    const linDir = resolveDefaultUserDataDir("linux", { XDG_CONFIG_HOME: "/home/demo/.cfg" }, "/home/demo");
    assert.equal(linDir, resolve("/home/demo/.cfg/CriativoAIStudio"));

    const productDir = makeTempDir("criativo-p18-prod-");
    const userDir = makeTempDir("criativo-p18-user-");

    mkdirSync(join(productDir, "templates", "marca"), { recursive: true });
    writeFileSync(
      join(productDir, "templates", "marca", "perfil-da-marca.md"),
      "# Perfil\n\n- Marca: [NOME_DA_MARCA]\n",
      "utf8",
    );
    writeFileSync(join(productDir, ".env.example"), "PORT=3000\nCRIATIVO_VAULT_KEY=\n", "utf8");
    writeFileSync(join(productDir, "produto.json"), JSON.stringify({ versao: "1.0.0" }), "utf8");

    const resolved = resolveStudioPaths({
      productRoot: productDir,
      env: { CRIATIVO_PACKAGED: "1", CRIATIVO_USER_DATA_DIR: userDir },
      isPackaged: true,
    });
    assert.equal(resolved.separatedRoots, true);
    assert.equal(resolved.productRoot, resolve(productDir));
    assert.equal(resolved.userDataRoot, resolve(userDir));
    assert.equal(resolved.dbPath, resolve(userDir, "dados", "criativo.db"));

    const boot1 = bootstrapUserDataDirectory(resolved);
    assert.equal(boot1.createdEnv, true);
    assert.ok(existsSync(join(userDir, "conteudos", "perfil-da-marca.md")));
    assert.ok(existsSync(join(userDir, ".env")));
    const envContent1 = readFileSync(join(userDir, ".env"), "utf8");
    assert.match(envContent1, /CRIATIVO_VAULT_KEY=[0-9a-f]{64}/);

    // Simula personalização real do cliente
    const customPerfil = "# Perfil Real\n\n- Marca: Clínica Modelo Teste\n";
    writeFileSync(join(userDir, "conteudos", "perfil-da-marca.md"), customPerfil, "utf8");

    // Segundo bootstrap NÃO deve sobrescrever .env nem perfil personalizado
    const boot2 = bootstrapUserDataDirectory(resolved);
    assert.equal(boot2.createdEnv, false);
    assert.equal(readFileSync(join(userDir, "conteudos", "perfil-da-marca.md"), "utf8"), customPerfil);
    assert.equal(readFileSync(join(userDir, ".env"), "utf8"), envContent1);
  });

  it("Bloco 2 — prepareDesktopBundle empacota apenas artefatos compilados sem dados pessoais", () => {
    const outDir = makeTempDir("criativo-p18-bundle-");
    const result = prepareDesktopBundle({ outDir });
    assert.ok(existsSync(join(result, "apps", "daemon", "dist", "server", "daemon-server.js")));
    assert.ok(existsSync(join(result, "apps", "web", "dist", "index.html")));
    assert.ok(existsSync(join(result, "templates", "marca", "perfil-da-marca.md")));
    assert.equal(existsSync(join(result, ".env")), false);
    assert.equal(existsSync(join(result, "dados")), false);
    assert.equal(existsSync(join(result, "conteudos")), false);
    assert.equal(existsSync(join(result, "apps", "daemon", "src", "server", "daemon-server.ts")), false);
  });

  it("Bloco 3 — Feed /api/releases/* com trava de licença, verificação SHA-256 e preservação de dados", async () => {
    const { keys, licenseHub, hubUrl, adminToken } = await startEphemeralHub();
    const { license_key } = licenseHub.issueOrUpdateLicenseFromSale({
      email: "updater@exemplo.invalid",
      customerName: "Cliente Atualizacao",
      planTier: "agencia_10",
      provider: "manual",
    });

    const productDir = makeTempDir("criativo-p18-app-");
    const userDir = makeTempDir("criativo-p18-inst-");

    // Prepara productRoot simulado 1.0.0 e userDataRoot com dados do cliente
    mkdirSync(join(productDir, "templates", "marca"), { recursive: true });
    writeFileSync(join(productDir, "produto.json"), JSON.stringify({ versao: "1.0.0" }, null, 2), "utf8");
    writeFileSync(join(productDir, "CHANGELOG.txt"), "Versão 1.0.0 inicial\n", "utf8");
    writeFileSync(
      join(productDir, "templates", "marca", "perfil-da-marca.md"),
      "# Perfil Padrão\n- Marca: [NOME_DA_MARCA]\n",
      "utf8",
    );

    mkdirSync(join(userDir, "conteudos"), { recursive: true });
    const clientBrandText = "# Minha Marca Protegida\nDados críticos que nunca podem sumir.\n";
    writeFileSync(join(userDir, "conteudos", "perfil-da-marca.md"), clientBrandText, "utf8");
    const clientEnvText = "PORT=3000\nCRIATIVO_VAULT_KEY=chave_cliente_preservada\n";
    writeFileSync(join(userDir, ".env"), clientEnvText, "utf8");

    const rt = await createDaemonServer({
      port: 0,
      host: "127.0.0.1",
      productRoot: productDir,
      workspaceRoot: userDir,
      dbPath: join(userDir, "dados", "criativo.db"),
      autoStartLoops: false,
      autoBootWhatsApp: false,
      controlSocketPath: null,
      enforceLicense: true,
      licenseHubUrl: hubUrl,
      licensePublicKeyPem: keys.publicKeyPem,
      machineSeedOverride: "pc-phase18-updater-01",
    });
    runtimes.push(rt);
    const daemonUrl = `http://127.0.0.1:${rt.port}`;

    // Sem licença ativada, feed na VPS deve retornar 403 e daemon deve bloquear update
    const hubNoAuth = await fetch(`${hubUrl}/api/releases/latest`);
    assert.equal(hubNoAuth.status, 403);

    // Path traversal bloqueado mesmo se enviar chave falsa/ativa
    const actRes = await fetch(`${daemonUrl}/api/studio/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key, email: "updater@exemplo.invalid" }),
    });
    assert.equal(actRes.status, 200);

    const traversalRes = await fetch(`${hubUrl}/api/releases/download/..%2F..%2Fetc/passwd`, {
      headers: { "X-Criativo-License-Key": license_key },
    });
    assert.ok(traversalRes.status === 400 || traversalRes.status === 404);

    // Publica release 1.1.0 com pacote criativo-update-bundle-v1 (tentando inclusive tocar em .env e conteudos/!)
    const updateBundleObj = {
      format: "criativo-update-bundle-v1",
      version: "1.1.0",
      files: {
        "produto.json": JSON.stringify({ versao: "1.1.0" }, null, 2),
        "CHANGELOG.txt": "Versão 1.1.0 com novos recursos.\n",
        ".env": "SOBRESCRITO_INDEVIDAMENTE=1",
        "conteudos/perfil-da-marca.md": "SOBRESCRITO_INDEVIDAMENTE",
      },
    };
    const updateBundleJson = JSON.stringify(updateBundleObj);
    const validSha256 = crypto.createHash("sha256").update(Buffer.from(updateBundleJson, "utf8")).digest("hex");

    // 1) Primeiro publica com SHA-256 divergente para testar proteção anti-adulteração
    const pubBadRes = await fetch(`${hubUrl}/api/admin/releases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        version: "1.1.0",
        channel: "stable",
        changelog_markdown: "Melhorias de performance e Desktop 1.1.0",
        artifactFiles: [
          {
            platform: "vps-tarball",
            arch: "universal",
            filename: "criativo-update-1.1.0.json",
            content: updateBundleJson,
            sha256: "0".repeat(64),
          },
        ],
      }),
    });
    assert.equal(pubBadRes.status, 201);

    const checkRes = await fetch(`${daemonUrl}/api/studio/updates/check`, { method: "POST" });
    assert.equal(checkRes.status, 200);
    const checkJson = (await checkRes.json()) as { status: UpdateStatusSnapshot };
    assert.equal(checkJson.status.update_available, true);
    assert.equal(checkJson.status.latest_version, "1.1.0");
    assert.equal(checkJson.status.state, "available");

    const badApplyRes = await fetch(`${daemonUrl}/api/studio/updates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(badApplyRes.status, 422);
    const badStatusRes = (await fetch(`${daemonUrl}/api/studio/updates/status`).then((r) => r.json())) as {
      status: UpdateStatusSnapshot;
    };
    assert.equal(badStatusRes.status.state, "error");
    assert.match(String(badStatusRes.status.error_message), /SHA-256/);

    // 2) Publica SHA-256 íntegro e aplica atualização
    const pubGoodRes = await fetch(`${hubUrl}/api/admin/releases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        version: "1.1.0",
        channel: "stable",
        changelog_markdown: "Melhorias de performance e Desktop 1.1.0",
        artifactFiles: [
          {
            platform: "vps-tarball",
            arch: "universal",
            filename: "criativo-update-1.1.0.json",
            content: updateBundleJson,
            sha256: validSha256,
          },
        ],
      }),
    });
    assert.equal(pubGoodRes.status, 201);

    const goodApplyRes = await fetch(`${daemonUrl}/api/studio/updates/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(goodApplyRes.status, 200);
    const goodApplyJson = (await goodApplyRes.json()) as { status: UpdateStatusSnapshot };
    assert.equal(goodApplyJson.status.state, "ready_to_restart");
    assert.equal(goodApplyJson.status.current_version, "1.1.0");
    assert.equal(goodApplyJson.status.progress_percent, 100);

    // Confirma que productRoot foi atualizado para 1.1.0 E dados da instância NÃO foram tocados!
    const updatedProductPkg = JSON.parse(readFileSync(join(productDir, "produto.json"), "utf8")) as { versao: string };
    assert.equal(updatedProductPkg.versao, "1.1.0");
    assert.match(readFileSync(join(productDir, "CHANGELOG.txt"), "utf8"), /Versão 1\.1\.0/);
    assert.equal(readFileSync(join(userDir, "conteudos", "perfil-da-marca.md"), "utf8"), clientBrandText);
    assert.equal(readFileSync(join(userDir, ".env"), "utf8"), clientEnvText);

    // 3) Revogação da licença bloqueia imediatamente futuras consultas e downloads
    const revokeRes = await fetch(`${hubUrl}/api/admin/licenses/${encodeURIComponent(license_key)}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: "refund" }),
    });
    assert.equal(revokeRes.status, 200);

    const checkRevokedRes = await fetch(`${daemonUrl}/api/studio/updates/check`, { method: "POST" });
    assert.equal(checkRevokedRes.status, 200);
    const checkRevokedJson = (await checkRevokedRes.json()) as { status: UpdateStatusSnapshot };
    assert.equal(checkRevokedJson.status.state, "license_blocked");
    assert.equal(checkRevokedJson.status.update_available, false);

    const downloadRevokedRes = await fetch(`${hubUrl}/api/releases/download/1.1.0/criativo-update-1.1.0.json`, {
      headers: { "X-Criativo-License-Key": license_key },
    });
    assert.equal(downloadRevokedRes.status, 403);
  });

  it("Bloco 4 — Script install-server.sh na VPS e fronteiras de segurança Electron Desktop", async () => {
    const { hubUrl } = await startEphemeralHub();
    const scriptRes = await fetch(`${hubUrl}/api/releases/install-server.sh`);
    assert.equal(scriptRes.status, 200);
    const scriptText = await scriptRes.text();
    assert.match(scriptText, /CRIATIVO_CLAIM/);

    const desktopMainPath = new URL("../../../apps/desktop/src/main.ts", import.meta.url);
    const mainSource = readFileSync(desktopMainPath, "utf8");
    assert.match(mainSource, /contextIsolation:\s*true/);
    assert.match(mainSource, /nodeIntegration:\s*false/);
    assert.match(mainSource, /sandbox:\s*true/);
    assert.match(mainSource, /requestSingleInstanceLock/);

    const launcherPath = new URL("../../../apps/desktop/src/daemon-launcher.ts", import.meta.url);
    const launcherSource = readFileSync(launcherPath, "utf8");
    assert.match(launcherSource, /ELECTRON_RUN_AS_NODE:\s*"1"/);
    assert.match(launcherSource, /CRIATIVO_USER_DATA_DIR/);
  });
});
