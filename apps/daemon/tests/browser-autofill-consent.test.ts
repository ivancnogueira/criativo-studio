import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { LoginVaultService } from "../src/vault/login-vault-service.ts";
import { PasswordManagerRegistry } from "../src/vault/password-managers/registry.ts";
import { BrowserAutomationService } from "../src/engine/tools/browser-automation.ts";
import { BrowserAutofillService } from "../src/vault/browser-autofill-service.ts";

test("browser_autofill_login nunca expõe senha ao LLM e exige consentimento humano explícito", async () => {
  const dir = mkdtempSync(join(tmpdir(), "criativo-autofill-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();

  try {
    const vault = new VaultService(db, "chave-autofill-teste");
    const loginVault = new LoginVaultService(db, vault);
    const created = loginVault.createLogin({
      title: "Conta Portal Parceiro",
      domain: "portal.parceiro.test",
      username: "agente@parceiro.test",
      password: "SUPER_SECRET_PASSWORD_999",
      autofillPolicy: "exact",
    });

    const browserService = new BrowserAutomationService(db, vault, undefined, dir);
    const tab = browserService.createVirtualTabForSession({
      url: "https://portal.parceiro.test/login",
      title: "Login Parceiro",
      agenteId: "estrategista",
    });

    const passwordManagers = new PasswordManagerRegistry(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "ENOENT",
    }));

    const events: Array<{ event: string; payload: unknown }> = [];
    const fakeWsHub = {
      broadcast(event: string, payload: unknown) {
        events.push({ event, payload });
      },
    } as unknown as import("../src/server/websocket-hub.ts").WebSocketHub;

    const autofill = new BrowserAutofillService({
      loginVault,
      passwordManagers,
      browserService,
      wsHub: fakeWsHub,
    });

    // 1. Agente solicita autofill -> retorna metadados + requiresApproval=true e ZERO senha
    const llmResult = await autofill.requestAutofill({
      tabId: tab.tabId,
      agenteId: "estrategista",
    });
    assert.equal(llmResult.ok, true);
    assert.equal(llmResult.requiresApproval, true);
    assert.ok(llmResult.requestId);
    assert.equal(llmResult.candidatesCount, 1);
    assert.equal(JSON.stringify(llmResult).includes("SUPER_SECRET_PASSWORD_999"), false);
    assert.equal(events[0]?.event, "browser:autofill_requested");

    // 2. Operador recusa -> nada é preenchido
    const denied = await autofill.resolveConsent({
      requestId: llmResult.requestId!,
      approved: false,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.approved, false);
    assert.equal(denied.filledFields, 0);

    // 3. Nova solicitação + operador aprova -> preenche de forma segura sem retornar a senha
    const req2 = await autofill.requestAutofill({
      tabId: tab.tabId,
      agenteId: "estrategista",
    });
    const approved = await autofill.resolveConsent({
      requestId: req2.requestId!,
      approved: true,
      selectedLoginId: created.id,
    });
    assert.equal(approved.ok, true);
    assert.equal(approved.approved, true);
    assert.equal(approved.filledFields, 2);
    assert.equal(JSON.stringify(approved).includes("SUPER_SECRET_PASSWORD_999"), false);

    await browserService.closeAll();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
