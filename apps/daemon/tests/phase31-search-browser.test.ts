import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { HistorySearchService } from "../src/engine/runner/history-search-service.ts";
import { inspectBrowserChallenge } from "../src/engine/tools/browser-challenge-detector.ts";
import { BrowserPolicyGuard } from "../src/engine/tools/browser-policy-guard.ts";

test("HistorySearchService.searchGlobalStudio retorna agentes/workflows/arquivos e aplica redacao de segredos", () => {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();
  const now = new Date().toISOString();

  db.connection
    .prepare(
      `INSERT INTO projecao_agentes (
        agente_id, nome, papel, modelo_padrao, status, skills_paths_json, config_json, ordem_exibicao, atualizado_em
      ) VALUES ('estrategista', 'Estrategista Editorial', 'Planejamento', 'gemini-2.5-flash', 'ocioso', '[]', '{}', 1, ?);`
    )
    .run(now);

  db.connection
    .prepare(
      `INSERT INTO projecao_conversas_chat (
        mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
        anexos_json, steps_json, lida, criado_em, item_type, status, ordinal, metadados_json
      ) VALUES (?, 'agente:estrategista', 'estrategista', 'usuario', 'Você', ?, '[]', '[]', 1, ?, 'mensagem', 'completed', 0, '{}');`
    )
    .run(
      `msg-${randomUUID().slice(0, 8)}`,
      "Campanha editorial com token secreto sk-segredo1234567890abcd",
      now
    );

  const search = new HistorySearchService({
    db,
    redactSecrets: (txt) => txt.replace(/sk-[a-z0-9]+/gi, "[REDACTED]"),
  });

  // Busca por segredo não encontra correspondência e não vaza
  const oracleAttempt = search.searchGlobalStudio("sk-segredo1234567890abcd", 5);
  assert.equal(oracleAttempt.grupos.mensagens.length, 0);

  // Busca legítima retorna agente e mensagem redigida
  const out = search.searchGlobalStudio("editorial", 5);
  assert.equal(out.grupos.agentes.length, 1);
  assert.equal(out.grupos.mensagens.length, 1);
  assert.ok(!out.grupos.mensagens[0]!.titulo.includes("sk-segredo1234567890abcd"));
  assert.ok(out.grupos.mensagens[0]!.titulo.includes("[REDACTED]"));
});

test("BrowserChallengeDetector identifica Turnstile, reCAPTCHA, hCaptcha e 2FA pausando para humano sem bypass", () => {
  const turnstile = inspectBrowserChallenge({
    url: "https://example.com/cdn-cgi/challenge-platform/h/b/orchestrate",
    title: "Just a moment...",
    selectorHits: [".cf-turnstile"],
  });
  assert.equal(turnstile.detected, true);
  assert.equal(turnstile.kind, "turnstile");
  assert.equal(turnstile.action, "pause_for_human");
  assert.equal(turnstile.bypassAttempted, false);

  const recaptcha = inspectBrowserChallenge({
    url: "https://example.com/checkout",
    selectorHits: [".g-recaptcha"],
  });
  assert.equal(recaptcha.detected, true);
  assert.equal(recaptcha.kind, "recaptcha");
  assert.equal(recaptcha.bypassAttempted, false);

  const hcaptcha = inspectBrowserChallenge({
    url: "https://example.com/verify",
    textSnippet: "Please complete the security check via hCaptcha",
  });
  assert.equal(hcaptcha.detected, true);
  assert.equal(hcaptcha.kind, "hcaptcha");

  const twoFa = inspectBrowserChallenge({
    url: "https://example.com/2fa/verify",
    selectorHits: ['input[autocomplete="one-time-code"]'],
  });
  assert.equal(twoFa.detected, true);
  assert.equal(twoFa.kind, "2fa");

  const clean = inspectBrowserChallenge({
    url: "https://instagram.example/explore",
    title: "Feed Público",
  });
  assert.equal(clean.detected, false);
  assert.equal(clean.action, "continue");
});

test("BrowserPolicyGuard bloqueia dominios fora da allowlist, dominios bloqueados e acoes de pagamento", () => {
  const guard = new BrowserPolicyGuard({
    allowedDomains: ["instagram.com", "developers.facebook.com"],
    blockedDomains: ["evil.instagram.com", "tracker.example"],
    blockSensitiveActions: true,
  });

  guard.assertUrlAllowed("https://www.instagram.com/accounts/login/");
  guard.assertUrlAllowed("https://developers.facebook.com/docs");

  assert.throws(
    () => guard.assertUrlAllowed("https://evil.instagram.com/phishing"),
    (err: unknown) => err instanceof Error && err.message.includes("CRV-AUTH-002")
  );
  assert.throws(
    () => guard.assertUrlAllowed("https://untrusted-site.example/"),
    (err: unknown) => err instanceof Error && err.message.includes("CRV-AUTH-002")
  );
  assert.throws(
    () => guard.assertSensitiveActionAllowed("payment_submit", "Finalizar compra"),
    (err: unknown) => err instanceof Error && err.message.includes("CRV-AUTH-002")
  );
});
