import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { resolveConfinedWorkingDirectory } from "../src/engine/sandbox/workspace-sandbox.ts";
import { sanitizeChildEnv } from "../src/engine/sandbox/process-confinement.ts";
import { McpApprovalAutomationService } from "../src/mcp/approval-automation.ts";

test("workspace-sandbox e process-confinement sanitizam variáveis sensíveis e bloqueiam escape de cwd", () => {
  const workspaceRoot = join(tmpdir(), "criativo-ws-sandbox-test");

  const validSubdir = resolveConfinedWorkingDirectory({
    requestedCwd: "saidas/renders",
    workspaceRoot,
  });
  assert.ok(validSubdir.startsWith(workspaceRoot));

  assert.throws(() =>
    resolveConfinedWorkingDirectory({
      requestedCwd: "../../Windows/System32",
      workspaceRoot,
    }),
  );

  assert.throws(() =>
    resolveConfinedWorkingDirectory({
      requestedCwd: "\\\\servidor-remoto\\compartilhamento",
      workspaceRoot,
    }),
  );

  const allowedExtra = join(tmpdir(), "criativo-extra-folder");
  const permitted = resolveConfinedWorkingDirectory({
    requestedCwd: allowedExtra,
    workspaceRoot,
    allowedFolders: [{ path: allowedExtra, mode: "ro" }],
  });
  assert.equal(permitted, allowedExtra);

  const sanitized = sanitizeChildEnv({
    sourceEnv: {
      PATH: "/usr/bin",
      NODE_ENV: "production",
      CRIATIVO_VAULT_KEY: "chave-mestra-daemon-nao-deve-vazar",
      OPENAI_API_KEY: "sk-nao-vazar",
      CUSTOM_ALLOWED: "ok-123",
    },
    passthroughKeys: ["CUSTOM_ALLOWED"],
  });

  assert.equal(sanitized.env.PATH, "/usr/bin");
  assert.equal(sanitized.env.CUSTOM_ALLOWED, "ok-123");
  assert.equal("CRIATIVO_VAULT_KEY" in sanitized.env, false);
  assert.equal("OPENAI_API_KEY" in sanitized.env, false);
  assert.equal(sanitized.removedSecretKeysCount, 2);
});

test("McpApprovalAutomationService aplica regras always_allow, allow_once, ask e deny com trilha auditável", () => {
  const dir = mkdtempSync(join(tmpdir(), "criativo-mcp-consent-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();

  try {
    const svc = new McpApprovalAutomationService(db);

    const denyRule = svc.upsertConsent({
      agenteId: "estrategista",
      mcpId: "filesystem",
      toolName: "delete_file",
      decision: "deny",
    });
    const denyRes = svc.evaluateExecution({
      agenteId: "estrategista",
      mcpId: "filesystem",
      toolName: "delete_file",
      args: { path: "a.txt" },
    });
    assert.equal(denyRes.allowed, false);
    assert.equal(denyRes.requiresConsent, false);
    assert.equal(denyRes.decision, "deny");

    svc.upsertConsent({
      agenteId: "estrategista",
      mcpId: "github",
      toolName: "list_issues",
      decision: "always_allow",
      argPattern: "org-exemplo",
    });
    const matchArg = svc.evaluateExecution({
      agenteId: "estrategista",
      mcpId: "github",
      toolName: "list_issues",
      args: { repo: "org-exemplo/repo" },
    });
    assert.equal(matchArg.allowed, true);

    const mismatchArg = svc.evaluateExecution({
      agenteId: "estrategista",
      mcpId: "github",
      toolName: "list_issues",
      args: { repo: "outro/repo" },
    });
    assert.equal(mismatchArg.allowed, false);
    assert.equal(mismatchArg.requiresConsent, true);

    svc.upsertConsent({
      agenteId: "estrategista",
      mcpId: "slack",
      toolName: "post_message",
      decision: "allow_once",
    });
    const firstOnce = svc.evaluateExecution({
      agenteId: "estrategista",
      mcpId: "slack",
      toolName: "post_message",
      args: { channel: "C1" },
    });
    assert.equal(firstOnce.allowed, true);
    assert.equal(firstOnce.decision, "allow_once");

    // Após consumo de allow_once com fallback "ask", exige nova confirmação
    const afterOnce = svc.evaluateExecution({
      agenteId: "estrategista",
      mcpId: "slack",
      toolName: "post_message",
      args: { channel: "C1" },
      defaultWhenUnset: "ask",
    });
    assert.equal(afterOnce.allowed, false);
    assert.equal(afterOnce.requiresConsent, true);

    const audit = svc.listAudit("estrategista", 20);
    assert.equal(audit.length, 5);

    assert.equal(svc.revokeConsent(denyRule.consentId), true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
