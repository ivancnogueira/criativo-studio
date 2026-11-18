import { randomUUID } from "node:crypto";
import type { AgenteEspera } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

export const MAX_OPEN_WAITS_PER_AGENT = 20;
export const NEAR_WAIT_LIMIT_THRESHOLD = 17;

interface EsperaRow {
  espera_id: string;
  agente_id: string;
  entrega_origem_id: string;
  pedido_texto: string;
  nota: string;
  rotina_id: string | null;
  criado_em: string;
  despertada_em: string | null;
  entrega_despertar_id: string | null;
}

export interface OpenWaitInput {
  esperaId?: string;
  agenteId: string;
  entregaOrigemId: string;
  pedidoTexto: string;
  nota: string;
  rotinaId?: string | null;
}

/**
 * Store transacional em node:sqlite para Esperas Longas (agent_waits) com checagem atômica do teto de 20.
 */
export class AgentWaitStore {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  private mapRow(row: EsperaRow): AgenteEspera {
    return {
      espera_id: row.espera_id,
      agente_id: row.agente_id,
      entrega_origem_id: row.entrega_origem_id,
      pedido_texto: row.pedido_texto,
      nota: row.nota,
      rotina_id: row.rotina_id,
      criado_em: row.criado_em,
      despertada_em: row.despertada_em,
      entrega_despertar_id: row.entrega_despertar_id,
      estado: row.despertada_em ? "woken" : "waiting",
    };
  }

  public openWait(input: OpenWaitInput): {
    espera: AgenteEspera;
    openWaits: number;
    nearLimit: boolean;
  } {
    const esperaId = input.esperaId ?? `esp-${randomUUID().slice(0, 8)}`;
    const agora = new Date().toISOString();

    return this.db.runInTransaction(() => {
      const info = this.db.connection
        .prepare(
          `
          INSERT INTO projecao_agente_esperas (
            espera_id, agente_id, entrega_origem_id, pedido_texto, nota, rotina_id,
            criado_em, despertada_em, entrega_despertar_id
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, NULL, NULL
          WHERE (SELECT COUNT(*) FROM projecao_agente_esperas WHERE agente_id = ?) < ?;
        `,
        )
        .run(
          esperaId,
          input.agenteId,
          input.entregaOrigemId,
          input.pedidoTexto,
          input.nota.trim().slice(0, 2000),
          input.rotinaId ?? null,
          agora,
          input.agenteId,
          MAX_OPEN_WAITS_PER_AGENT,
        );

      if (info.changes === 0) {
        throw new Error(
          `Limite máximo de ${MAX_OPEN_WAITS_PER_AGENT} esperas abertas atingido para o agente '${input.agenteId}'. Encerre esperas concluídas com close_wait antes de abrir outra.`,
        );
      }

      const espera = this.getWait(esperaId);
      if (!espera) {
        throw new Error(`Falha inesperada ao carregar espera criada: ${esperaId}`);
      }
      const openWaits = this.listWaits(input.agenteId).length;
      return {
        espera,
        openWaits,
        nearLimit: openWaits >= NEAR_WAIT_LIMIT_THRESHOLD,
      };
    });
  }

  public listWaits(agenteId: string): AgenteEspera[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM projecao_agente_esperas WHERE agente_id = ? ORDER BY criado_em ASC;")
      .all(agenteId) as unknown as EsperaRow[];
    return rows.map((row) => this.mapRow(row));
  }

  public getWait(esperaId: string): AgenteEspera | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_agente_esperas WHERE espera_id = ?;")
      .get(esperaId) as EsperaRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  public closeWait(esperaId: string, agenteId?: string): boolean {
    return this.db.runInTransaction(() => {
      const info = agenteId
        ? this.db.connection
            .prepare("DELETE FROM projecao_agente_esperas WHERE espera_id = ? AND agente_id = ?;")
            .run(esperaId, agenteId)
        : this.db.connection
            .prepare("DELETE FROM projecao_agente_esperas WHERE espera_id = ?;")
            .run(esperaId);
      return info.changes > 0;
    });
  }

  public markWoken(esperaIds: string[], entregaDespertarId: string): AgenteEspera[] {
    if (esperaIds.length === 0) {
      return [];
    }
    return this.db.runInTransaction(() => {
      const agora = new Date().toISOString();
      const woken: AgenteEspera[] = [];
      const stmt = this.db.connection.prepare(`
        UPDATE projecao_agente_esperas
        SET despertada_em = ?,
            entrega_despertar_id = ?
        WHERE espera_id = ? AND despertada_em IS NULL;
      `);

      for (const id of esperaIds) {
        const info = stmt.run(agora, entregaDespertarId, id);
        if (info.changes > 0) {
          const updated = this.getWait(id);
          if (updated) {
            woken.push(updated);
          }
        }
      }
      return woken;
    });
  }
}
