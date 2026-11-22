import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { redactTelemetryPayload, redactTelemetryString } from "../src/telemetry/telemetry-redactor.ts";
import { TelemetryService } from "../src/telemetry/telemetry-service.ts";

test("redactTelemetryString e redactTelemetryPayload removem caminhos pessoais, segredos, e-mails, handles e prompts", () => {
  const dirtyText =
    "Erro em C:\\Users\\OperadorLocal\\projetos\\criativo /home/dev/studio Token Bearer eyJhbGciOiJIUzI1NiJ9.abcdef12 chave sk-proj-1234567890 email operador@exemplo.com.br @perfil_real https://192.168.1.50/secret";
  const cleaned = redactTelemetryString(dirtyText);

  assert.equal(cleaned.includes("OperadorLocal"), false);
  assert.equal(cleaned.includes("/home/dev"), false);
  assert.equal(cleaned.includes("eyJhbGciOiJIUzI1NiJ9"), false);
  assert.equal(cleaned.includes("sk-proj-1234567890"), false);
  assert.equal(cleaned.includes("operador@exemplo.com.br"), false);
  assert.equal(cleaned.includes("@perfil_real"), false);
  assert.equal(cleaned.includes("192.168.1.50"), false);

  const payload = redactTelemetryPayload({
    step: "onboarding_provider",
    durationMs: 420,
    prompt: "Texto confidencial do briefing do cliente",
    password: "SenhaSecretaDoUsuario!",
    nested: {
      token: "xoxb-1234567890-abcdef",
      path: "/Users/usuario_mac/Desktop/logo.png",
    },
  });

  assert.equal(payload.step, "onboarding_provider");
  assert.equal(payload.durationMs, 420);
  assert.equal(payload.prompt, "<REDACTED_FIELD>");
  assert.equal(payload.password, "<REDACTED_FIELD>");
  assert.equal(payload["nested.token"], "<REDACTED_FIELD>");
  assert.equal(String(payload["nested.path"]).includes("usuario_mac"), false);
});

test("TelemetryService é opt-in desligado por padrão e só grava quando ativado explicitamente", () => {
  const dir = mkdtempSync(join(tmpdir(), "criativo-tel-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();

  try {
    const telemetry = new TelemetryService(db, "1.0.0");
    assert.equal(telemetry.isEnabled(), false);

    // Sem opt-in -> não registra evento
    const ignored = telemetry.recordEvent({
      eventName: "agent.turn.completed",
      durationMs: 250,
    });
    assert.equal(ignored, null);
    assert.equal(telemetry.listBufferedEvents().length, 0);

    // Ativa opt-in -> grava payload redigido
    telemetry.setOptIn(true);
    assert.equal(telemetry.isEnabled(), true);

    const recorded = telemetry.recordEvent({
      eventName: "agent.turn.completed",
      errorCode: "CRV-012",
      durationMs: 310,
      meta: { prompt: "segredo", userHome: "C:\\Users\\Alice\\docs" },
    });
    assert.ok(recorded);
    assert.equal(recorded!.meta.prompt, "<REDACTED_FIELD>");
    assert.equal(String(recorded!.meta.userHome).includes("Alice"), false);
    assert.equal(telemetry.listBufferedEvents().length, 1);

    // Desativar limpa o buffer
    telemetry.setOptIn(false);
    assert.equal(telemetry.listBufferedEvents().length, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
