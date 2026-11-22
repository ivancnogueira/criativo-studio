import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { CuaDriverClient, CuaSecurityError } from "../src/engine/tools/cua-driver-client.ts";
import { executeCuaTool } from "../src/engine/tools/cua-tools.ts";

test("CuaDriverClient bloqueia por padrão, valida hotkeys/coordenadas e aplica kill-switch global", async () => {
  const dir = mkdtempSync(join(tmpdir(), "criativo-cua-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();

  const cua = new CuaDriverClient({ db });
  const now = new Date().toISOString();
  db.connection
    .prepare(
      "INSERT INTO projecao_agentes (agente_id, nome, papel, modelo_padrao, status, skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em) VALUES (?, ?, ?, ?, 'ocioso', '[]', '', 1, ?, ?);",
    )
    .run("agente_cua", "Operador Desktop", "Operador", "gemini-2.5-flash", JSON.stringify({ cua_enabled: false }), now);

  try {
    // 1. Bloqueado quando cua_enabled está desativado
    await assert.rejects(
      () => cua.executeAction({ action: "click", agente_id: "agente_cua", x: 100, y: 120 }),
      CuaSecurityError,
    );

    // Ativa explicitamente cua_enabled no agente
    db.connection
      .prepare("UPDATE projecao_agentes SET config_json = ? WHERE agente_id = ?;")
      .run(JSON.stringify({ cua_enabled: true }), "agente_cua");

    // 2. Exige consentimento humano na tool nativa
    const needConsent = await executeCuaTool(
      "cua_execute",
      { action: "click", x: 10, y: 20 },
      { agenteId: "agente_cua", aprovadoPorHumano: false },
      cua,
    );
    assert.equal(needConsent.ok, false);
    assert.equal(needConsent.requiresHumanConsent, true);

    // 3. Rejeita coordenadas inválidas e hotkeys destrutivos
    await assert.rejects(
      () => cua.executeAction({ action: "click", agente_id: "agente_cua", x: -5, y: 50 }),
      CuaSecurityError,
    );
    await assert.rejects(
      () => cua.executeAction({ action: "hotkey", agente_id: "agente_cua", keys: ["Alt", "F4"] }),
      CuaSecurityError,
    );

    // 4. Executa ação válida com executor conectado e atualiza status
    cua.setPermissionGranted(true);
    cua.attachDesktopExecutor(async (req) => ({
      window_title: req.window_title ?? "CapCut Desktop",
      cursor: { x: req.x ?? 300, y: req.y ?? 240 },
      message: "Clique simulado concluído",
    }));

    const res = await cua.executeAction({
      action: "click",
      agente_id: "agente_cua",
      x: 320,
      y: 240,
      window_title: "CapCut Desktop",
      aprovado_por_humano: true,
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.cursor, { x: 320, y: 240 });
    assert.equal(cua.getStatus().active_window, "CapCut Desktop");

    // 5. Kill-switch global bloqueia execuções até liberação explícita
    const aborted = cua.abortAllCuaActions("Teste de emergência");
    assert.equal(aborted.aborted, true);
    await assert.rejects(
      () => cua.executeAction({ action: "click", agente_id: "agente_cua", x: 10, y: 10 }),
      CuaSecurityError,
    );
    cua.clearAbort();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
