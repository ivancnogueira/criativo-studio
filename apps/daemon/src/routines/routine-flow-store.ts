import { randomUUID } from "node:crypto";
import type {
  RoutineFlowLink,
  RoutineFlowRun,
  RoutineFlowStep,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import {
  collectAffectedAgents,
  routineFlowConnectProblem,
  strandedLinks,
} from "./routine-flow-graph.ts";

interface FlowLinkRow {
  link_id: string;
  rotina_id: string;
  from_agent_id: string;
  to_agent_id: string;
  instrucao: string;
  criado_em: string;
}

interface FlowPositionRow {
  canvas_agent_id: string;
  node_key: string;
  x: number;
  y: number;
  atualizado_em: string;
}

interface FlowRunRow {
  flow_run_id: string;
  execucao_id: string;
  rotina_id: string;
  root_agent_id: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  criado_em: string;
  atualizado_em: string;
}

interface FlowStepRow {
  step_id: string;
  flow_run_id: string;
  execucao_id: string;
  agente_id: string;
  tarefa_id: string | null;
  input: string;
  output: string | null;
  status: "running" | "succeeded" | "failed" | "skipped" | "cancelled";
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
}

export class RoutineFlowStoreError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = "ROUTINE_FLOW_ERROR", statusCode = 400) {
    super(message);
    this.name = "RoutineFlowStoreError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface CreateFlowLinkInput {
  rotina_id: string;
  owner_id: string;
  from_agent_id: string;
  to_agent_id: string;
  instrucao?: string;
}

export interface CreateFlowRunInput {
  flow_run_id?: string;
  execucao_id: string;
  rotina_id: string;
  root_agent_id: string;
  status?: "running" | "succeeded" | "failed" | "cancelled";
  criado_em?: string;
}

export interface CreateFlowStepInput {
  step_id?: string;
  flow_run_id: string;
  execucao_id: string;
  agente_id: string;
  tarefa_id?: string | null;
  input: string;
  output?: string | null;
  status: "running" | "succeeded" | "failed" | "skipped" | "cancelled";
  erro?: string | null;
}

export interface UpdateFlowStepPatch {
  tarefa_id?: string | null;
  output?: string | null;
  status?: "running" | "succeeded" | "failed" | "skipped" | "cancelled";
  erro?: string | null;
}

/**
 * Persistência transacional para links, posições visuais e execuções em cascata
 * do canvas de Fluxos de Rotinas (DAG por `rotina_id`).
 */
export class RoutineFlowStore {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  private mapLink(row: FlowLinkRow): RoutineFlowLink {
    return {
      link_id: row.link_id,
      rotina_id: row.rotina_id,
      from_agent_id: row.from_agent_id,
      to_agent_id: row.to_agent_id,
      instrucao: row.instrucao,
      criado_em: row.criado_em,
    };
  }

  private mapStep(row: FlowStepRow): RoutineFlowStep {
    return {
      step_id: row.step_id,
      flow_run_id: row.flow_run_id,
      execucao_id: row.execucao_id,
      agente_id: row.agente_id,
      tarefa_id: row.tarefa_id,
      input: row.input,
      output: row.output,
      status: row.status,
      erro: row.erro,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    };
  }

  private mapFlowRun(row: FlowRunRow, steps: RoutineFlowStep[]): RoutineFlowRun {
    return {
      flow_run_id: row.flow_run_id,
      execucao_id: row.execucao_id,
      rotina_id: row.rotina_id,
      root_agent_id: row.root_agent_id,
      status: row.status,
      steps,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    };
  }

  public listLinksByRoutine(rotinaId: string): RoutineFlowLink[] {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_routine_flow_links
        WHERE rotina_id = ?
        ORDER BY criado_em ASC, link_id ASC;
      `
      )
      .all(rotinaId) as unknown as FlowLinkRow[];
    return rows.map((row) => this.mapLink(row));
  }

  public listLinksByRoutineIds(rotinaIds: readonly string[]): RoutineFlowLink[] {
    if (rotinaIds.length === 0) return [];
    const placeholders = rotinaIds.map(() => "?").join(", ");
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_routine_flow_links
        WHERE rotina_id IN (${placeholders})
        ORDER BY criado_em ASC, link_id ASC;
      `
      )
      .all(...rotinaIds) as unknown as FlowLinkRow[];
    return rows.map((row) => this.mapLink(row));
  }

  public listAllLinksForAgent(agenteId: string): RoutineFlowLink[] {
    const rows = this.db.connection
      .prepare(
        `
        SELECT DISTINCT l.*
        FROM projecao_routine_flow_links l
        LEFT JOIN projecao_agente_rotinas r ON r.rotina_id = l.rotina_id
        WHERE l.from_agent_id = ?
           OR l.to_agent_id = ?
           OR (r.owner_kind = 'agente' AND r.owner_id = ?)
        ORDER BY l.criado_em ASC, l.link_id ASC;
      `
      )
      .all(agenteId, agenteId, agenteId) as unknown as FlowLinkRow[];
    return rows.map((row) => this.mapLink(row));
  }

  public getLink(linkId: string): RoutineFlowLink | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_routine_flow_links WHERE link_id = ? LIMIT 1;`)
      .get(linkId) as unknown as FlowLinkRow | undefined;
    return row ? this.mapLink(row) : null;
  }

  public createLink(input: CreateFlowLinkInput): RoutineFlowLink {
    return this.db.runInTransaction(() => {
      const currentLinks = this.listLinksByRoutine(input.rotina_id);
      const problem = routineFlowConnectProblem(
        input.owner_id,
        input.from_agent_id,
        input.to_agent_id,
        currentLinks
      );

      if (problem) {
        const msgByProblem: Record<typeof problem, string> = {
          "same-agent": "Um agente não pode conectar a rotina a si mesmo.",
          "into-owner": "Não é permitido apontar de volta para o agente dono da rotina.",
          "not-on-path": "O agente de origem precisa estar conectado ao caminho da rotina.",
          duplicate: "Esta ligação entre os dois agentes já existe nesta rotina.",
          cycle: "Esta conexão formaria um ciclo inválido no fluxo.",
        };
        throw new RoutineFlowStoreError(msgByProblem[problem], `FLOW_${problem.toUpperCase()}`, 400);
      }

      const linkId = `rfl-${randomUUID()}`;
      const criadoEm = new Date().toISOString();
      const instrucao = (input.instrucao ?? "").trim();

      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_routine_flow_links (
            link_id, rotina_id, from_agent_id, to_agent_id, instrucao, criado_em
          ) VALUES (?, ?, ?, ?, ?, ?);
        `
        )
        .run(
          linkId,
          input.rotina_id,
          input.from_agent_id,
          input.to_agent_id,
          instrucao,
          criadoEm
        );

      return {
        link_id: linkId,
        rotina_id: input.rotina_id,
        from_agent_id: input.from_agent_id,
        to_agent_id: input.to_agent_id,
        instrucao,
        criado_em: criadoEm,
      };
    });
  }

  public updateLink(linkId: string, instrucao: string): RoutineFlowLink | null {
    const existing = this.getLink(linkId);
    if (!existing) return null;

    const clean = instrucao.trim();
    this.db.connection
      .prepare(`UPDATE projecao_routine_flow_links SET instrucao = ? WHERE link_id = ?;`)
      .run(clean, linkId);

    return {
      ...existing,
      instrucao: clean,
    };
  }

  public deleteLink(
    linkId: string,
    ownerId: string
  ): { deletedLinkIds: string[]; affectedAgents: string[] } | null {
    return this.db.runInTransaction(() => {
      const target = this.getLink(linkId);
      if (!target) return null;

      const allRoutineLinks = this.listLinksByRoutine(target.rotina_id);
      const remaining = allRoutineLinks.filter((l) => l.link_id !== linkId);
      const stranded = strandedLinks(ownerId, remaining);
      const deletedLinkIds = [linkId, ...stranded.map((l) => l.link_id)];

      const placeholders = deletedLinkIds.map(() => "?").join(", ");
      this.db.connection
        .prepare(
          `DELETE FROM projecao_routine_flow_links WHERE link_id IN (${placeholders});`
        )
        .run(...deletedLinkIds);

      return {
        deletedLinkIds,
        affectedAgents: collectAffectedAgents(ownerId, allRoutineLinks),
      };
    });
  }

  // ====================================================================
  // Posições no Canvas (`projecao_routine_flow_posicoes`)
  // ====================================================================

  public listPositions(canvasAgentId: string): Array<{ node_key: string; x: number; y: number }> {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_routine_flow_posicoes
        WHERE canvas_agent_id = ?
        ORDER BY node_key ASC;
      `
      )
      .all(canvasAgentId) as unknown as FlowPositionRow[];
    return rows.map((row) => ({
      node_key: row.node_key,
      x: Number(row.x),
      y: Number(row.y),
    }));
  }

  public upsertPosition(canvasAgentId: string, nodeKey: string, x: number, y: number): void {
    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `
        INSERT INTO projecao_routine_flow_posicoes (
          canvas_agent_id, node_key, x, y, atualizado_em
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(canvas_agent_id, node_key) DO UPDATE SET
          x = excluded.x,
          y = excluded.y,
          atualizado_em = excluded.atualizado_em;
      `
      )
      .run(canvasAgentId, nodeKey, x, y, agora);
  }

  public deletePosition(canvasAgentId: string, nodeKey: string): boolean {
    const res = this.db.connection
      .prepare(
        `DELETE FROM projecao_routine_flow_posicoes WHERE canvas_agent_id = ? AND node_key = ?;`
      )
      .run(canvasAgentId, nodeKey);
    return Number(res.changes ?? 0) > 0;
  }

  // ====================================================================
  // Execuções & Etapas (`projecao_routine_flow_runs`, `projecao_routine_flow_etapas`)
  // ====================================================================

  public createFlowRun(input: CreateFlowRunInput): RoutineFlowRun {
    const flowRunId = input.flow_run_id ?? `rfr-${randomUUID()}`;
    const agora = input.criado_em ?? new Date().toISOString();
    const status = input.status ?? "running";

    this.db.connection
      .prepare(
        `
        INSERT OR IGNORE INTO projecao_routine_flow_runs (
          flow_run_id, execucao_id, rotina_id, root_agent_id, status, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
      `
      )
      .run(
        flowRunId,
        input.execucao_id,
        input.rotina_id,
        input.root_agent_id,
        status,
        agora,
        agora
      );

    return this.getFlowRunByExecucaoId(input.execucao_id)!;
  }

  public getFlowRunByExecucaoId(execucaoId: string): RoutineFlowRun | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_routine_flow_runs WHERE execucao_id = ? LIMIT 1;`)
      .get(execucaoId) as unknown as FlowRunRow | undefined;
    if (!row) return null;
    const steps = this.listStepsByExecucao(execucaoId);
    return this.mapFlowRun(row, steps);
  }

  public getLatestFlowRunByRoutine(rotinaId: string): RoutineFlowRun | null {
    const row = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_routine_flow_runs
        WHERE rotina_id = ?
        ORDER BY criado_em DESC
        LIMIT 1;
      `
      )
      .get(rotinaId) as unknown as FlowRunRow | undefined;
    if (!row) return null;
    const steps = this.listStepsByExecucao(row.execucao_id);
    return this.mapFlowRun(row, steps);
  }

  public listPendingFlowRuns(sinceIso?: string): RoutineFlowRun[] {
    const rows = sinceIso
      ? (this.db.connection
          .prepare(
            `
            SELECT * FROM projecao_routine_flow_runs
            WHERE status = 'running' AND criado_em >= ?
            ORDER BY criado_em ASC;
          `
          )
          .all(sinceIso) as unknown as FlowRunRow[])
      : (this.db.connection
          .prepare(
            `
            SELECT * FROM projecao_routine_flow_runs
            WHERE status = 'running'
            ORDER BY criado_em ASC;
          `
          )
          .all() as unknown as FlowRunRow[]);

    return rows.map((row) => this.mapFlowRun(row, this.listStepsByExecucao(row.execucao_id)));
  }

  public updateFlowRunStatus(
    flowRunId: string,
    status: "running" | "succeeded" | "failed" | "cancelled"
  ): void {
    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `UPDATE projecao_routine_flow_runs SET status = ?, atualizado_em = ? WHERE flow_run_id = ?;`
      )
      .run(status, agora, flowRunId);
  }

  public listStepsByExecucao(execucaoId: string): RoutineFlowStep[] {
    const rows = this.db.connection
      .prepare(
        `
        SELECT * FROM projecao_routine_flow_etapas
        WHERE execucao_id = ?
        ORDER BY criado_em ASC, step_id ASC;
      `
      )
      .all(execucaoId) as unknown as FlowStepRow[];
    return rows.map((row) => this.mapStep(row));
  }

  public getStepByTaskId(tarefaId: string): RoutineFlowStep | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_routine_flow_etapas WHERE tarefa_id = ? LIMIT 1;`)
      .get(tarefaId) as unknown as FlowStepRow | undefined;
    return row ? this.mapStep(row) : null;
  }

  public createStepIdempotent(input: CreateFlowStepInput): RoutineFlowStep | null {
    const stepId = input.step_id ?? `rfs-${randomUUID()}`;
    const agora = new Date().toISOString();

    const res = this.db.connection
      .prepare(
        `
        INSERT OR IGNORE INTO projecao_routine_flow_etapas (
          step_id, flow_run_id, execucao_id, agente_id, tarefa_id,
          input, output, status, erro, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `
      )
      .run(
        stepId,
        input.flow_run_id,
        input.execucao_id,
        input.agente_id,
        input.tarefa_id ?? null,
        input.input,
        input.output ?? null,
        input.status,
        input.erro ?? null,
        agora,
        agora
      );

    if (Number(res.changes ?? 0) === 0) {
      return null;
    }

    const inserted = this.db.connection
      .prepare(`SELECT * FROM projecao_routine_flow_etapas WHERE step_id = ? LIMIT 1;`)
      .get(stepId) as unknown as FlowStepRow | undefined;
    return inserted ? this.mapStep(inserted) : null;
  }

  public updateStep(stepId: string, patch: UpdateFlowStepPatch): RoutineFlowStep | null {
    const row = this.db.connection
      .prepare(`SELECT * FROM projecao_routine_flow_etapas WHERE step_id = ? LIMIT 1;`)
      .get(stepId) as unknown as FlowStepRow | undefined;
    if (!row) return null;

    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `
        UPDATE projecao_routine_flow_etapas
        SET tarefa_id = ?,
            output = ?,
            status = ?,
            erro = ?,
            atualizado_em = ?
        WHERE step_id = ?;
      `
      )
      .run(
        patch.tarefa_id !== undefined ? patch.tarefa_id : row.tarefa_id,
        patch.output !== undefined ? patch.output : row.output,
        patch.status ?? row.status,
        patch.erro !== undefined ? patch.erro : row.erro,
        agora,
        stepId
      );

    const updated = this.db.connection
      .prepare(`SELECT * FROM projecao_routine_flow_etapas WHERE step_id = ? LIMIT 1;`)
      .get(stepId) as unknown as FlowStepRow | undefined;
    return updated ? this.mapStep(updated) : null;
  }

  public updateStepByTaskId(tarefaId: string, patch: UpdateFlowStepPatch): RoutineFlowStep | null {
    const existing = this.getStepByTaskId(tarefaId);
    if (!existing) return null;
    return this.updateStep(existing.step_id, patch);
  }
}
