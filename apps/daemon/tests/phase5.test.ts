import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createDaemonServer } from "../src/server/daemon-server.ts";

describe("Fase 5 — Integração HTTP Cockpit Web <-> Daemon API", () => {
  it("serve o bundle do Cockpit em '/' e expõe os 15 agentes via GET/PUT /api/agentes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "criativo-phase5-"));
    const runtime = await createDaemonServer({
      port: 0,
      dbPath: join(tempDir, "phase5.db"),
      vaultMasterKey: "chave-fase-5-teste",
      autoStartLoops: false,
    });

    try {
      const htmlRes = await fetch(`http://127.0.0.1:${runtime.port}/`);
      assert.equal(htmlRes.status, 200);
      const htmlText = await htmlRes.text();
      assert.match(htmlText, /Criativo AI Studio Online/);

      const agentsRes = await fetch(`http://127.0.0.1:${runtime.port}/api/agentes`);
      assert.equal(agentsRes.status, 200);
      const agentsJson = (await agentsRes.json()) as {
        agentes: Array<{ agente_id: string; modelo_padrao: string }>;
      };
      assert.equal(agentsJson.agentes.length, 15);

      const updateRes = await fetch(
        `http://127.0.0.1:${runtime.port}/api/agentes/copywriter`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelo_padrao: "gpt-4o" }),
        }
      );
      assert.equal(updateRes.status, 200);
      const updated = (await updateRes.json()) as {
        agente: { modelo_padrao: string };
      };
      assert.equal(updated.agente.modelo_padrao, "gpt-4o");
    } finally {
      await runtime.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
