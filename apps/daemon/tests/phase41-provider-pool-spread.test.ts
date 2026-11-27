import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContaProvedorInfo, PoolContasConfig } from "@criativo/contracts";
import { initializeDatabase } from "../src/database/client.ts";
import {
  AccountTurnCoordinator,
  selectPoolAccount,
} from "../src/providers/provider-account-pool.ts";
import { CliOAuthAccountsService } from "../src/providers/cli-oauth-accounts-service.ts";
import { AntigravityLiveService } from "../src/providers/antigravity-live-service.ts";

function makeAccount(
  id: string,
  opts: { remaining5h: number; remainingWeekly?: number; resetAtIso?: string },
): ContaProvedorInfo {
  const weekly = opts.remainingWeekly ?? opts.remaining5h;
  return {
    id,
    provedor: "claude",
    rotulo: id,
    email: `${id}@criativo.local`,
    estado: "conectado",
    grupos_cota: [
      {
        nome: "Geral",
        modelos: [],
        janela_5h: {
          rotulo: "5h",
          janela: "5h",
          duracao_minutos: 300,
          restante_percentual: opts.remaining5h,
          usado_percentual: 100 - opts.remaining5h,
          reseta_em: opts.resetAtIso ?? "2026-12-01T10:00:00.000Z",
          reseta_em_texto: "em breve",
        },
        janela_semanal: {
          rotulo: "Semanal",
          janela: "semanal",
          duracao_minutos: 10080,
          restante_percentual: weekly,
          usado_percentual: 100 - weekly,
          reseta_em: opts.resetAtIso ?? "2026-12-07T10:00:00.000Z",
          reseta_em_texto: "7d",
        },
      },
    ],
  };
}

describe("Fase 41-02 — Pool Spread e Remoção Segura", () => {
  it("fill_first mantém afinidade sticky e reset mais próximo", () => {
    const contas = [
      makeAccount("acc-1", { remaining5h: 70, resetAtIso: "2026-12-02T10:00:00.000Z" }),
      makeAccount("acc-2", { remaining5h: 95, resetAtIso: "2026-12-03T10:00:00.000Z" }),
    ];
    const pool: PoolContasConfig = {
      habilitado: true,
      contas_excluidas: [],
      conta_em_uso: "acc-1",
      estrategia: "fill_first",
    };

    const chosen = selectPoolAccount(contas, pool);
    assert.equal(chosen?.id, "acc-1");
  });

  it("spread distribui 3 Criativos concorrentes entre 3 contas por maior folga de cota e turnos ativos", () => {
    const coordinator = new AccountTurnCoordinator();
    const contas = [
      makeAccount("acc-a", { remaining5h: 92 }),
      makeAccount("acc-b", { remaining5h: 90 }),
      makeAccount("acc-c", { remaining5h: 88 }),
    ];
    const pool: PoolContasConfig = {
      habilitado: true,
      contas_excluidas: [],
      conta_em_uso: "acc-a",
      estrategia: "spread",
    };

    // Turno 1 vai para acc-a (92% folga, 0 turnos)
    const picked1 = selectPoolAccount(contas, pool, null, {
      activeTurnsByAccount: coordinator.getActiveTurnsMap("claude"),
      drainingAccountIds: coordinator.getDrainingAccountIds("claude"),
    });
    assert.equal(picked1?.id, "acc-a");
    const rel1 = coordinator.beginTurn("claude", picked1!.id);
    assert.ok(rel1);

    // Turno 2 vê acc-a com headroom 92-5=87%, então distribui para acc-b (90%)
    const picked2 = selectPoolAccount(contas, pool, null, {
      activeTurnsByAccount: coordinator.getActiveTurnsMap("claude"),
      drainingAccountIds: coordinator.getDrainingAccountIds("claude"),
    });
    assert.equal(picked2?.id, "acc-b");
    const rel2 = coordinator.beginTurn("claude", picked2!.id);
    assert.ok(rel2);

    // Turno 3 vê acc-a(87%), acc-b(85%), então distribui para acc-c (88%)
    const picked3 = selectPoolAccount(contas, pool, null, {
      activeTurnsByAccount: coordinator.getActiveTurnsMap("claude"),
      drainingAccountIds: coordinator.getDrainingAccountIds("claude"),
    });
    assert.equal(picked3?.id, "acc-c");
    const rel3 = coordinator.beginTurn("claude", picked3!.id);
    assert.ok(rel3);

    rel1();
    rel2();
    rel3();
  });

  it("remoção segura em CliOAuth aguarda conclusão do turno ativo, migra conta_em_uso e limpa pasta só ao finalizar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crv-41-02-cli-"));
    const db = initializeDatabase({ dbPath: join(dir, "test.db") });
    try {
      const cli = new CliOAuthAccountsService({ db, workspaceCwd: dir });
      const dirA = join(dir, "claude-a");
      const dirB = join(dir, "claude-b");
      mkdirSync(dirA, { recursive: true });
      mkdirSync(dirB, { recursive: true });
      writeFileSync(join(dirA, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "tk-a" } }));
      writeFileSync(join(dirB, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "tk-b" } }));

      (cli as unknown as { saveStoredRecords: (r: unknown[]) => void }).saveStoredRecords([
        { id: "cli-a", provedor: "claude", configDir: dirA, label: "Conta A", email: "a@criativo.local", plano: "Pro" },
        { id: "cli-b", provedor: "claude", configDir: dirB, label: "Conta B", email: "b@criativo.local", plano: "Max" },
      ]);
      cli.setPoolSettings("claude", { habilitado: true, conta_em_uso: "cli-a", estrategia: "spread" });
      assert.equal(cli.getPoolConfig("claude")?.estrategia, "spread");

      const { accountTurnCoordinator } = await import("../src/providers/provider-account-pool.ts");
      const release = accountTurnCoordinator.beginTurn("claude", "cli-a");
      assert.ok(release);

      let finalizedCalled = false;
      const safeRes = cli.requestSafeRemoveAccount("claude", "cli-a", () => {
        finalizedCalled = true;
      });
      assert.equal(safeRes.pendingRemoval, true);
      assert.equal(safeRes.removedImmediately, false);
      assert.equal(safeRes.activeTurns, 1);
      assert.equal(safeRes.migratedToAccountId, "cli-b");

      // Pasta e registro ainda existem enquanto o turno está ativo, e conta está marcada como removendo
      assert.equal(existsSync(dirA), true);
      assert.equal(cli.listAccounts("claude").find((c) => c.id === "cli-a")?.removendo, true);
      assert.equal(cli.getPoolConfig("claude")?.conta_em_uso, "cli-b");
      // Novos turnos são recusados nesta conta
      assert.equal(accountTurnCoordinator.beginTurn("claude", "cli-a"), null);

      release();
      await new Promise((r) => setTimeout(r, 40));

      assert.equal(finalizedCalled, true);
      assert.equal(existsSync(dirA), false);
      assert.equal(cli.listAccounts("claude").some((c) => c.id === "cli-a"), false);
    } finally {
      db.connection.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AntigravityLiveService persiste estrategia spread e executa drenagem segura", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crv-41-02-ag-"));
    const db = initializeDatabase({ dbPath: join(dir, "test.db") });
    try {
      const ag = new AntigravityLiveService({ db, workspaceCwd: dir });
      const gemA = join(dir, "gem-a");
      const gemB = join(dir, "gem-b");
      mkdirSync(gemA, { recursive: true });
      mkdirSync(gemB, { recursive: true });
      writeFileSync(join(gemA, "antigravity_auth.json"), JSON.stringify({ token: { access_token: "a", refresh_token: "ra" } }));
      writeFileSync(join(gemB, "antigravity_auth.json"), JSON.stringify({ token: { access_token: "b", refresh_token: "rb" } }));

      (ag as unknown as { saveStudioRecords: (r: unknown[]) => void }).saveStudioRecords([
        { id: "gem-a", geminiDir: gemA, label: "Gem A", email: "ga@criativo.local" },
        { id: "gem-b", geminiDir: gemB, label: "Gem B", email: "gb@criativo.local" },
      ]);
      ag.setPoolSettings({ habilitado: true, estrategia: "spread", conta_em_uso: "gem-a" });

      const { accountTurnCoordinator } = await import("../src/providers/provider-account-pool.ts");
      const release = accountTurnCoordinator.beginTurn("gemini", "gem-a");
      assert.ok(release);

      const safeRes = ag.requestSafeRemoveAccount("gem-a");
      assert.equal(safeRes.pendingRemoval, true);
      assert.equal(safeRes.migratedToAccountId, "gem-b");
      assert.equal(existsSync(gemA), true);

      release();
      await new Promise((r) => setTimeout(r, 40));
      assert.equal(existsSync(gemA), false);
      ag.close();
    } finally {
      db.connection.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
