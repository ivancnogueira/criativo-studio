import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AgentRoutine, RoutineCalendarFeedInfo } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { expandScheduleOccurrences } from "./routine-schedule-calc.ts";

const STUDIO_CONFIG_ICS_KEY = "rotinas_ics_feed_token";

export function escapeIcsText(raw: string): string {
  return String(raw ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Aplica folding RFC 5545 em linhas acima de 75 octetos UTF-8 com CRLF + espaço.
 */
export function foldIcsLine(line: string): string {
  const buf = Buffer.from(line, "utf8");
  if (buf.length <= 75) return line;
  const parts: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < buf.length) {
    let end = Math.min(buf.length, offset + limit);
    // Evita cortar no meio de caractere UTF-8 multi-byte
    while (end < buf.length && (buf[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    if (end <= offset) end = Math.min(buf.length, offset + limit);
    const chunk = buf.subarray(offset, end).toString("utf8");
    parts.push(parts.length === 0 ? chunk : ` ${chunk}`);
    offset = end;
    limit = 74; // subsequentes contam o espaço inicial no limite de 75 octetos
  }
  return parts.join("\r\n");
}

export function formatIcsUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

export function buildRoutinesIcsFeed(
  routines: AgentRoutine[],
  options: { fromDate?: Date; daysAhead?: number; defaultDurationMinutes?: number } = {}
): string {
  const now = options.fromDate ?? new Date();
  const daysAhead = Math.max(1, Math.min(90, options.daysAhead ?? 30));
  const durationMs = (options.defaultDurationMinutes ?? 15) * 60_000;
  const toDate = new Date(now.getTime() + daysAhead * 86_400_000);
  const dtStamp = formatIcsUtc(now);

  const rawLines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Criativo AI Studio//Rotinas//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Criativo AI Studio - Rotinas",
  ];

  for (const routine of routines) {
    if (!routine.ativa || !routine.schedule) continue;
    const occurrences = expandScheduleOccurrences(
      routine.schedule,
      routine.timezone || "America/Sao_Paulo",
      now,
      toDate,
      60
    );

    for (const occ of occurrences) {
      const uidHash = createHash("sha1")
        .update(`${routine.rotina_id}:${occ.toISOString()}`)
        .digest("hex")
        .slice(0, 16);
      const startStr = formatIcsUtc(occ);
      const endStr = formatIcsUtc(new Date(occ.getTime() + durationMs));
      const desc = `${routine.instrucao || ""}\nResponsável: ${routine.owner_kind}:${routine.owner_id}`.trim();

      rawLines.push("BEGIN:VEVENT");
      rawLines.push(`UID:criativo-rotina-${uidHash}@criativo.local`);
      rawLines.push(`DTSTAMP:${dtStamp}`);
      rawLines.push(`DTSTART:${startStr}`);
      rawLines.push(`DTEND:${endStr}`);
      rawLines.push(`SUMMARY:${escapeIcsText(routine.nome)}`);
      if (desc) {
        rawLines.push(`DESCRIPTION:${escapeIcsText(desc.slice(0, 500))}`);
      }
      rawLines.push("END:VEVENT");
    }
  }

  rawLines.push("END:VCALENDAR");
  return `${rawLines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function getOrCreateIcsFeedToken(db: CriativoDatabase): { token: string; updatedAt: string } {
  const row = db.connection
    .prepare("SELECT valor_json, atualizado_em FROM projecao_studio_config WHERE chave = ? LIMIT 1;")
    .get(STUDIO_CONFIG_ICS_KEY) as { valor_json: string; atualizado_em: string } | undefined;

  if (row?.valor_json) {
    try {
      const parsed = JSON.parse(row.valor_json) as { token?: string; updatedAt?: string };
      if (typeof parsed.token === "string" && parsed.token.trim().length >= 16) {
        return { token: parsed.token.trim(), updatedAt: parsed.updatedAt ?? row.atualizado_em };
      }
    } catch {
      // regenera abaixo
    }
  }

  return rotateIcsFeedToken(db);
}

export function rotateIcsFeedToken(db: CriativoDatabase): { token: string; updatedAt: string } {
  const token = randomBytes(32).toString("hex");
  const updatedAt = new Date().toISOString();
  db.connection
    .prepare(
      `
      INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
      VALUES (?, ?, ?)
      ON CONFLICT(chave) DO UPDATE SET
        valor_json = excluded.valor_json,
        atualizado_em = excluded.atualizado_em;
    `
    )
    .run(STUDIO_CONFIG_ICS_KEY, JSON.stringify({ token, updatedAt }), updatedAt);
  return { token, updatedAt };
}

export function verifyIcsFeedToken(db: CriativoDatabase, candidate: string | null | undefined): boolean {
  const provided = typeof candidate === "string" ? candidate.trim() : "";
  if (!provided) return false;
  const { token } = getOrCreateIcsFeedToken(db);
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(token, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getIcsFeedConfig(db: CriativoDatabase): RoutineCalendarFeedInfo & { token: string } {
  const { token, updatedAt } = getOrCreateIcsFeedToken(db);
  return {
    enabled: true,
    feedPath: `/api/rotinas/feed.ics?token=${encodeURIComponent(token)}`,
    updatedAt,
    token,
  };
}
