import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRoutine } from "@criativo/contracts";
import { CriativoDatabase } from "../src/database/client.ts";
import {
  buildRoutinesIcsFeed,
  escapeIcsText,
  foldIcsLine,
  getOrCreateIcsFeedToken,
  rotateIcsFeedToken,
  verifyIcsFeedToken,
} from "../src/routines/routine-feed-ics.ts";

test("routine-feed-ics: gera VCALENDAR RFC 5545 válido com escaping e folding em 75 octetos", () => {
  assert.equal(escapeIcsText("Resumo, parte 1; linha\nnova"), "Resumo\\, parte 1\\; linha\\nnova");

  const longLine = `DESCRIPTION:${"A".repeat(120)}`;
  const folded = foldIcsLine(longLine);
  const segments = folded.split("\r\n");
  assert.ok(segments.length >= 2);
  assert.ok(segments[1].startsWith(" "));
  assert.ok(Buffer.from(segments[0], "utf8").length <= 75);

  const sampleRoutine: AgentRoutine = {
    rotina_id: "rot-ics-1",
    owner_kind: "agente",
    owner_id: "estrategista",
    nome: "Revisão Semanal, Métricas; IG",
    instrucao: "Avaliar salvamentos\ne alcance",
    trigger_kind: "schedule",
    schedule: { kind: "daily", time: "09:30" },
    next_run_at: null,
    timezone: "America/Sao_Paulo",
    ativa: true,
    limit_policy: "wait",
    missed_policy: "skip",
    run_in: "side_thread",
    destino_resultado: { tipo: "none" },
    webhook: null,
    criado_em: "2026-11-22T00:00:00.000Z",
    atualizado_em: "2026-11-22T00:00:00.000Z",
  };

  const pausedRoutine: AgentRoutine = {
    ...sampleRoutine,
    rotina_id: "rot-ics-paused",
    nome: "Rotina Pausada",
    ativa: false,
  };

  const ics = buildRoutinesIcsFeed([sampleRoutine, pausedRoutine], {
    fromDate: new Date("2026-11-22T10:00:00.000Z"),
    daysAhead: 5,
  });

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /X-WR-CALNAME:CriativoOS - Rotinas/);
  assert.match(ics, /BEGIN:VEVENT\r\n/);
  assert.match(ics, /SUMMARY:Revisão Semanal\\, Métricas\\; IG/);
  assert.equal(ics.includes("Rotina Pausada"), false);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test("routine-feed-ics: gerencia, verifica com timingSafeEqual e rotaciona token", () => {
  const db = new CriativoDatabase({ dbPath: ":memory:" });
  db.initializeDatabase();

  const first = getOrCreateIcsFeedToken(db);
  assert.ok(first.token.length >= 32);
  assert.equal(verifyIcsFeedToken(db, first.token), true);
  assert.equal(verifyIcsFeedToken(db, "token-errado"), false);

  const rotated = rotateIcsFeedToken(db);
  assert.notEqual(rotated.token, first.token);
  assert.equal(verifyIcsFeedToken(db, first.token), false);
  assert.equal(verifyIcsFeedToken(db, rotated.token), true);
});
