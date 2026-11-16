import { randomUUID } from "node:crypto";
import type { CriativoDatabase } from "../../database/client.ts";

export interface AgenteMemoria {
  memoria_id: string;
  agente_id: string;
  texto: string;
  origem: "automatica" | "manual";
  criado_em: string;
}

/**
 * Gerenciador de memórias de longo prazo por agente em `projecao_agente_memorias`.
 */
export class MemoryManager {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  public addMemory(
    agenteId: string,
    texto: string,
    origem: "automatica" | "manual" = "automatica"
  ): AgenteMemoria | null {
    const cleanText = texto.trim();
    if (!cleanText) return null;

    const memoriaId = randomUUID();
    const agora = new Date().toISOString();

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_agente_memorias (memoria_id, agente_id, texto, origem, criado_em)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(agente_id, texto) DO NOTHING;
        `
        )
        .run(memoriaId, agenteId, cleanText, origem, agora);

      const recent = this.listMemories(agenteId, 5)
        .map((m) => m.texto)
        .join(" | ");
      this.db.connection
        .prepare(
          `UPDATE projecao_agentes SET memoria_resumo = ?, atualizado_em = ? WHERE agente_id = ?;`
        )
        .run(recent.slice(0, 500), agora, agenteId);
    });

    return (
      (this.db.connection
        .prepare(
          `SELECT * FROM projecao_agente_memorias WHERE agente_id = ? AND texto = ?;`
        )
        .get(agenteId, cleanText) as unknown as AgenteMemoria | undefined) ?? null
    );
  }

  public listMemories(agenteId: string, limit = 15): AgenteMemoria[] {
    return this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_agente_memorias
        WHERE agente_id = ?
        ORDER BY criado_em DESC
        LIMIT ?;
      `
      )
      .all(agenteId, limit) as unknown as AgenteMemoria[];
  }
}
