import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ProvedorStatusInfo } from "@criativo/contracts";
import { CriativoDatabase } from "../src/database/client.ts";
import {
  persistProvidersSnapshot,
  PROVIDER_STATUS_SNAPSHOT_KEY,
  readOrRefreshProviderStatusSnapshot,
  readPersistedProvidersSnapshot,
  withProviderProbeTimeout,
} from "../src/providers/provider-status-cache.ts";
import {
  buildDaemonChildEnv,
  createWatchdogRecoveryController,
} from "../../desktop/src/daemon-launcher.ts";

function fakeProvider(id: ProvedorStatusInfo["provedor"], email: string | null = null): ProvedorStatusInfo {
  return {
    provedor: id,
    rotulo: id.toUpperCase(),
    subtitulo: "Teste",
    conectado: true,
    cli_detectado: true,
    cli_versao: "1.0.0",
    cli_executavel: "/bin/stub",
    runtime_host: "localhost",
    runtime_platform: "win32",
    vault_configurado: false,
    modo_conexao: "assinatura",
    modelos: [{ id: `${id}/modelo-1`, rotulo: "Modelo 1", padrao: true }],
    contas: [
      {
        id: "acc-1",
        provedor: id,
        rotulo: "Conta Teste",
        email,
        plano: "Pro",
        estado: "conectado",
        token_valido: true,
      },
    ],
    pool: null,
    usado_por_agentes: [],
    reporta_cota: false,
  };
}

test("EX48-03: provider-status-cache entrega snapshot instantaneo, sanitiza e-mail e isola timeout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crv-ex48-status-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "status.sqlite") });
  db.initializeDatabase();
  const prevSkip = process.env.CRIATIVO_SKIP_LOCAL_PROBE;
  delete process.env.CRIATIVO_SKIP_LOCAL_PROBE;

  try {
    const timedOut = await withProviderProbeTimeout(
      new Promise<string>((r) => setTimeout(() => r("tarde"), 400)),
      50,
      "fallback-rapido"
    );
    assert.equal(timedOut, "fallback-rapido");

    let computeCalls = 0;
    const first = await readOrRefreshProviderStatusSnapshot({
      db,
      forceProbe: false,
      ttlMs: 60_000,
      computeFresh: async () => {
        computeCalls += 1;
        return [fakeProvider("openai", "privado@exemplo.invalid")];
      },
    });
    assert.equal(computeCalls, 1);
    assert.equal(first.length, 1);

    // Persisted snapshot deve remover e-mail pessoal
    const persisted = readPersistedProvidersSnapshot(db);
    assert.ok(persisted);
    assert.equal(persisted.data[0]?.contas?.[0]?.email, null);
    const rawRow = db.connection
      .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = ?;`)
      .get(PROVIDER_STATUS_SNAPSHOT_KEY) as { valor_json: string };
    assert.equal(rawRow.valor_json.includes("privado@exemplo.invalid"), false);

    // Segunda leitura dentro do TTL retorna instantaneo sem rechamar computeFresh
    const second = await readOrRefreshProviderStatusSnapshot({
      db,
      forceProbe: false,
      ttlMs: 60_000,
      computeFresh: async () => {
        computeCalls += 1;
        return [];
      },
    });
    assert.equal(computeCalls, 1);
    assert.equal(second[0]?.provedor, "openai");
  } finally {
    db.close();
    if (prevSkip !== undefined) process.env.CRIATIVO_SKIP_LOCAL_PROBE = prevSkip;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("EX48-03: buildDaemonChildEnv isola Crashpad e createWatchdogRecoveryController cancela timer pendente", async () => {
  const childEnv = buildDaemonChildEnv(
    {
      PATH: process.env.PATH ?? "",
      CHROME_CRASHPAD_PIPE_NAME: "\\\\.\\pipe\\crashpad_stale",
      ELECTRON_ENABLE_LOGGING: "1",
      NODE_OPTIONS: "--inspect",
    },
    { isPackaged: true, appVersion: "1.1.2" },
    { port: 3000, productRoot: "C:\\app", userDataDir: "C:\\data" }
  );

  assert.equal(childEnv.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(childEnv.ELECTRON_NO_ATTACH_CONSOLE, "1");
  assert.equal(childEnv.CHROME_CRASHPAD_PIPE_NAME, undefined);
  assert.equal(childEnv.ELECTRON_ENABLE_LOGGING, undefined);
  assert.equal(childEnv.NODE_OPTIONS, undefined);

  let cancelled = 0;
  let spawned = 0;
  let current = { exitCode: 1 as number | null, killed: false };
  const ctrl = createWatchdogRecoveryController({
    port: 3000,
    getCurrentProc: () => current,
    setCurrentProc: (n) => {
      current = n;
    },
    spawnProc: () => {
      spawned += 1;
      return { exitCode: null, killed: false };
    },
    waitHealthy: async () => {},
    attachWatchdog: () => {},
    cancelPendingTimer: () => {
      cancelled += 1;
    },
    checkHealth: async () => false,
    isStopping: () => false,
  });

  const rec = await ctrl.ensureRunning();
  assert.equal(rec.ok, true);
  assert.equal(rec.restarted, true);
  assert.equal(cancelled, 1);
  assert.equal(spawned, 1);
});

test("EX48-03: readPersistedProvidersSnapshot tolera persistencia direta e reidrata", () => {
  const dir = mkdtempSync(join(tmpdir(), "crv-ex48-rehydrate-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "rehydrate.sqlite") });
  db.initializeDatabase();
  try {
    persistProvidersSnapshot(db, [fakeProvider("claude")]);
    const loaded = readPersistedProvidersSnapshot(db);
    assert.ok(loaded && loaded.data[0]?.provedor === "claude");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
