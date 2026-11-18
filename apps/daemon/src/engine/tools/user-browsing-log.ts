/**
 * Registro estritamente redigido de passos de navegação do usuário (`UserBrowsingLogService` — BRWS-02 / D-02).
 * Remove query strings e hashes, mascara segmentos de código/UUID/token como `:id`,
 * jamais armazena texto digitado/senhas, trunca rótulos em 80 chars e aplica teto de 80 passos / 30 dias.
 */
import { randomUUID } from "node:crypto";
import type { UserBrowsingStep } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";

export const USER_BROWSING_TEXT_CHARACTERS = 80;
export const STEPS_PER_AGENT = 80;
export const USER_BROWSING_RETENTION_MS = 30 * 86_400_000;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURE_HEX_LONG_REGEX = /^[0-9a-f]{16,}$/i;
const PURE_DIGITS_LONG_REGEX = /^\d{6,}$/;

/**
 * Detecta segmentos dinâmicos de URL (UUIDs, tokens longos >= 32 chars, hashes hex ou IDs mistos)
 * para substituí-los por `:id` na trilha de aprendizado.
 */
export function isCodeSegment(segment: string): boolean {
  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();

  if (decoded.length >= 32) return true;
  if (UUID_REGEX.test(decoded)) return true;
  if (PURE_HEX_LONG_REGEX.test(decoded)) return true;
  if (PURE_DIGITS_LONG_REGEX.test(decoded)) return true;

  if (decoded.length >= 16 && /[a-z]/i.test(decoded) && /\d/.test(decoded)) {
    const digitCount = (decoded.match(/\d/g) ?? []).length;
    if (digitCount >= 3) return true;
  }

  return false;
}

/**
 * Extrai apenas `{ host, path }` de URLs HTTP(S), descartando integralmente `?search` e `#hash`
 * e mascarando segmentos sensíveis com `:id`.
 */
export function stepPlace(rawUrl: string): { host: string; path: string } | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) return null;

  const segments = parsed.pathname
    .split("/")
    .filter((s) => s.length > 0)
    .map((seg) => (isCodeSegment(seg) ? ":id" : seg.slice(0, 64)));

  const path = segments.length > 0 ? `/${segments.join("/")}` : "/";
  return { host, path };
}

function sanitizeShortLabel(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const clean = raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, USER_BROWSING_TEXT_CHARACTERS);
}

interface BrowsingLogRow {
  log_id: string;
  agente_id: string;
  kind: "page" | "click";
  host: string;
  path: string;
  title: string | null;
  role: string | null;
  name: string | null;
  revisado: number;
  criado_em: number;
}

export class UserBrowsingLogService {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  private mapRow(row: BrowsingLogRow): UserBrowsingStep {
    return {
      log_id: row.log_id,
      agente_id: row.agente_id,
      kind: row.kind,
      host: row.host,
      path: row.path,
      title: row.title,
      role: row.role,
      name: row.name,
      revisado: Boolean(row.revisado),
      criado_em: Number(row.criado_em),
    };
  }

  public recordStep(
    agenteId: string,
    step: {
      kind: "page" | "click";
      url: string;
      title?: string | null;
      role?: string | null;
      name?: string | null;
      timestampMs?: number;
    },
  ): UserBrowsingStep | null {
    if (step.kind !== "page" && step.kind !== "click") {
      return null;
    }
    const place = stepPlace(step.url);
    if (!place) return null;

    const nowMs =
      typeof step.timestampMs === "number" && Number.isFinite(step.timestampMs)
        ? Math.floor(step.timestampMs)
        : Date.now();
    const cutoffMs = nowMs - USER_BROWSING_RETENTION_MS;
    const logId = `ubl-${randomUUID().slice(0, 10)}`;

    const safeTitle = sanitizeShortLabel(step.title);
    const safeRole = step.kind === "click" ? sanitizeShortLabel(step.role) : null;
    const safeName = step.kind === "click" ? sanitizeShortLabel(step.name) : null;

    this.db.runInTransaction(() => {
      // Remove entradas expiradas (> 30 dias)
      this.db.connection
        .prepare("DELETE FROM projecao_agent_browsing_log WHERE criado_em < ?;")
        .run(cutoffMs);

      this.db.connection
        .prepare(
          `INSERT INTO projecao_agent_browsing_log (
            log_id, agente_id, kind, host, path, title, role, name, revisado, criado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?);`,
        )
        .run(
          logId,
          agenteId,
          step.kind,
          place.host,
          place.path,
          safeTitle,
          safeRole,
          safeName,
          nowMs,
        );

      // Mantém apenas os STEPS_PER_AGENT (80) passos mais recentes do agente
      this.db.connection
        .prepare(
          `DELETE FROM projecao_agent_browsing_log
           WHERE agente_id = ?
             AND log_id NOT IN (
               SELECT log_id FROM projecao_agent_browsing_log
               WHERE agente_id = ?
               ORDER BY criado_em DESC, rowid DESC
               LIMIT ?
             );`,
        )
        .run(agenteId, agenteId, STEPS_PER_AGENT);
    });

    const inserted = this.db.connection
      .prepare("SELECT * FROM projecao_agent_browsing_log WHERE log_id = ? LIMIT 1;")
      .get(logId) as BrowsingLogRow | undefined;
    return inserted ? this.mapRow(inserted) : null;
  }

  public listSteps(
    agenteId: string,
    options?: { onlyUnreviewed?: boolean },
  ): UserBrowsingStep[] {
    const cutoffMs = Date.now() - USER_BROWSING_RETENTION_MS;
    this.db.connection
      .prepare("DELETE FROM projecao_agent_browsing_log WHERE criado_em < ?;")
      .run(cutoffMs);

    const rows = (
      options?.onlyUnreviewed
        ? this.db.connection
            .prepare(
              `SELECT * FROM projecao_agent_browsing_log
               WHERE agente_id = ? AND revisado = 0
               ORDER BY criado_em ASC, rowid ASC
               LIMIT ?;`,
            )
            .all(agenteId, STEPS_PER_AGENT)
        : this.db.connection
            .prepare(
              `SELECT * FROM projecao_agent_browsing_log
               WHERE agente_id = ?
               ORDER BY criado_em ASC, rowid ASC
               LIMIT ?;`,
            )
            .all(agenteId, STEPS_PER_AGENT)
    ) as unknown as BrowsingLogRow[];

    return rows.map((r) => this.mapRow(r));
  }

  public clearSteps(agenteId: string): number {
    const res = this.db.connection
      .prepare("DELETE FROM projecao_agent_browsing_log WHERE agente_id = ?;")
      .run(agenteId);
    return Number(res.changes ?? 0);
  }

  public markReviewed(agenteId: string): number {
    const res = this.db.connection
      .prepare("UPDATE projecao_agent_browsing_log SET revisado = 1 WHERE agente_id = ? AND revisado = 0;")
      .run(agenteId);
    return Number(res.changes ?? 0);
  }

  /**
   * Formata os passos redigidos para o anexo `recorded-task.txt` (sem valores digitados nem parâmetros sensíveis).
   */
  public formatRecordedTaskFile(steps: UserBrowsingStep[]): string {
    const header = [
      "# Fluxo de Navegação Gravado (recorded-task.txt)",
      "# Observação: query strings, hashes e textos digitados foram omitidos por segurança.",
      "",
    ];

    if (steps.length === 0) {
      return [...header, "(Nenhum passo registrado)"].join("\n");
    }

    const lines = steps.map((st, idx) => {
      if (st.kind === "page") {
        const titlePart = st.title ? ` — "${st.title}"` : "";
        return `${idx + 1}. [Página] ${st.host}${st.path}${titlePart}`;
      }
      const targetDesc = [st.role, st.name ? `"${st.name}"` : null].filter(Boolean).join(" ");
      return `${idx + 1}. [Clique] ${st.host}${st.path} -> ${targetDesc || "elemento"}`;
    });

    return [...header, ...lines].join("\n");
  }
}
