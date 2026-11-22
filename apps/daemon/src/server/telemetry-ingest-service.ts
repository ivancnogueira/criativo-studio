import {
  randomUUID,
} from "node:crypto";
import {
  existsSync,
} from "node:fs";
import {
  homedir,
} from "node:os";
import {
  join,
} from "node:path";
import {
  DatabaseSync,
} from "node:sqlite";
import type {
  CriativoDatabase,
} from "../database/client.ts";

export function recordChatTurnUsage(
  db: CriativoDatabase,
  input: {
    agentId: string;
    sessionId: string;
    turnId: string;
    provider: string;
    model: string;
    uncachedInput: number;
    cachedInput: number;
    cacheCreation?: number;
    output: number;
    estimatedCostUsd?: number | null;
    rateBasis?: string | null;
    occurredAt?: string;
  }
): void {
  const nowIso = input.occurredAt ?? new Date().toISOString();
  const recordId = `criativo:${randomUUID()}`;
  db.connection
    .prepare(
      `INSERT OR IGNORE INTO projecao_uso_registros
       (record_id, agent_id, session_id, turn_id, provider, model, occurred_at, uncached_input, cached_input, cache_creation, output_tokens, estimated_cost_usd, rate_basis, origem, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'criativo', ?);`
    )
    .run(
      recordId,
      input.agentId,
      input.sessionId,
      input.turnId,
      input.provider,
      input.model,
      nowIso,
      Math.max(0, Math.round(input.uncachedInput)),
      Math.max(0, Math.round(input.cachedInput)),
      Math.max(0, Math.round(input.cacheCreation ?? 0)),
      Math.max(0, Math.round(input.output)),
      input.estimatedCostUsd ?? null,
      input.rateBasis ?? null,
      new Date().toISOString()
    );
}

export function recordSkillLoadUsage(
  db: CriativoDatabase,
  input: {
    agentId: string;
    sessionId: string;
    turnId: string;
    provider: string;
    model: string;
    skill: string;
    tokens: number | null;
  }
): void {
  const loadId = `skill:${randomUUID().slice(0, 12)}`;
  db.connection
    .prepare(
      `INSERT OR IGNORE INTO projecao_uso_skills
       (load_id, agent_id, session_id, turn_id, provider, model, skill, tokens, estimated_cost_usd, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?);`
    )
    .run(
      loadId,
      input.agentId,
      input.sessionId,
      input.turnId,
      input.provider,
      input.model,
      input.skill,
      input.tokens,
      new Date().toISOString()
    );
}

export function importExternalTelemetryIfAvailable(db: CriativoDatabase, customExternalDbPath?: string): number {
  if (!customExternalDbPath && process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return 0;
  }
  const appDataDir = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const extDbPath = customExternalDbPath ?? join(appDataDir, "CriativoStudio", "external-telemetry.db");
  if (!existsSync(extDbPath)) {
    return 0;
  }

  let imported = 0;
  try {
    const extDb = new DatabaseSync(extDbPath, { readOnly: true });
    try {
      const records = extDb
        .prepare(
          `SELECT agent_id, record_id, session_id, turn_id, provider, model, occurred_at, tokens_json, estimated_cost_usd, rate_basis, recorded_at
           FROM agent_usage_records;`
        )
        .all() as Array<{
        agent_id: string;
        record_id: string;
        session_id: string;
        turn_id: string;
        provider: string;
        model: string;
        occurred_at: string;
        tokens_json: string;
        estimated_cost_usd: number | null;
        rate_basis: string | null;
        recorded_at: string;
      }>;

      const insertStmt = db.connection.prepare(
        `INSERT OR IGNORE INTO projecao_uso_registros
         (record_id, agent_id, session_id, turn_id, provider, model, occurred_at, uncached_input, cached_input, cache_creation, output_tokens, estimated_cost_usd, rate_basis, origem, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'externo_importado', ?);`
      );

      for (const r of records) {
        let parsed = { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
        try {
          const obj = JSON.parse(r.tokens_json) as Record<string, unknown>;
          parsed = {
            uncachedInput: Number(obj.uncachedInput ?? 0) || 0,
            cachedInput: Number(obj.cachedInput ?? 0) || 0,
            cacheCreation: Number(obj.cacheCreation ?? 0) || 0,
            output: Number(obj.output ?? 0) || 0,
          };
        } catch {
          // ignora erro de parse
        }
        const res = insertStmt.run(
          `ob:${r.record_id}`,
          r.agent_id,
          r.session_id,
          r.turn_id,
          r.provider,
          r.model,
          r.occurred_at,
          parsed.uncachedInput,
          parsed.cachedInput,
          parsed.cacheCreation,
          parsed.output,
          r.estimated_cost_usd,
          r.rate_basis,
          r.recorded_at
        );
        if (Number(res.changes ?? 0) > 0) imported += 1;
      }

      // Importa nomes dos agentes externos compatíveis para exibição amigável
      try {
        const extAgents = extDb
          .prepare(`SELECT agent_id, agent_json FROM projection_agents;`)
          .all() as Array<{ agent_id: string; agent_json: string }>;
        const nameMap: Record<string, string> = {};
        for (const a of extAgents) {
          try {
            const parsed = JSON.parse(a.agent_json) as { name?: string };
            if (parsed.name) nameMap[a.agent_id] = parsed.name;
          } catch {
            // ignora
          }
        }
        if (Object.keys(nameMap).length > 0) {
          db.connection
            .prepare(
              `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
               VALUES ('analytics_nomes_externos', ?, ?)
               ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
            )
            .run(JSON.stringify(nameMap), new Date().toISOString());
        }
      } catch {
        // tabela pode não existir em versões antigas
      }

      // Importa skill loads se existir
      try {
        const skillRows = extDb
          .prepare(
            `SELECT agent_id, load_id, session_id, turn_id, provider, model, skill, tokens, estimated_cost_usd, occurred_at
             FROM agent_usage_skill_loads;`
          )
          .all() as Array<{
          agent_id: string;
          load_id: string;
          session_id: string;
          turn_id: string;
          provider: string;
          model: string;
          skill: string;
          tokens: number | null;
          estimated_cost_usd: number | null;
          occurred_at: string;
        }>;
        const insertSkillStmt = db.connection.prepare(
          `INSERT OR IGNORE INTO projecao_uso_skills
           (load_id, agent_id, session_id, turn_id, provider, model, skill, tokens, estimated_cost_usd, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
        );
        for (const s of skillRows) {
          insertSkillStmt.run(
            `ob:${s.load_id}`,
            s.agent_id,
            s.session_id,
            s.turn_id,
            s.provider,
            s.model,
            s.skill,
            s.tokens,
            s.estimated_cost_usd,
            s.occurred_at
          );
        }
      } catch {
        // ignora se ausente
      }
    } finally {
      extDb.close();
    }
  } catch {
    // banco externo bloqueado ou indisponível
  }
  return imported;
}

