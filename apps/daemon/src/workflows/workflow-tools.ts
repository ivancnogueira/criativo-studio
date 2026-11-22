import {
  randomUUID,
} from "node:crypto";
import {
  normalizeNodeKind,
  type WorkflowDetail,
  type WorkflowRunDetail,
} from "@criativo/contracts";
import type {
  WebSocketHub,
} from "../server/websocket-hub.ts";
import type {
  WorkflowEngine,
} from "./workflow-engine.ts";
import {
  WorkflowValidationError,
  type WorkflowStore,
} from "./workflow-store.ts";
import { MAX_STEP_PREVIEW_CHARS, type WorkflowOpInput } from "./workflow-tool-schemas.ts";
import { layoutNodes, applyWorkflowOps } from "./workflow-tool-layout-ops.ts";

export * from "./workflow-tool-schemas.ts";
export * from "./workflow-tool-layout-ops.ts";

function truncateText(value: string | null, max = MAX_STEP_PREVIEW_CHARS): string | null {
  if (value === null || value === undefined) return null;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}... [truncado]`;
}

export function compactGraphForAgent(
  detail: WorkflowDetail,
  includeLayout = false
): Record<string, unknown> {
  return {
    workflow_id: detail.workflow.workflow_id,
    nome: detail.workflow.nome,
    descricao: detail.workflow.descricao,
    ativo: detail.workflow.ativo,
    revisao_grafo: detail.workflow.revisao_grafo ?? 0,
    atualizado_em: detail.workflow.atualizado_em,
    nos: detail.workflow.nos.map((n) => {
      const base: Record<string, unknown> = {
        id: n.id,
        tipo: normalizeNodeKind(n.tipo),
        titulo: n.titulo,
        ...(n.subtitulo ? { subtitulo: n.subtitulo } : {}),
        ...(n.triggerKind ? { triggerKind: n.triggerKind } : {}),
        ...(n.agenteId ? { agenteId: n.agenteId } : {}),
        ...(n.model ? { model: n.model } : {}),
        ...(n.rule ? { rule: n.rule } : {}),
        ...(n.question ? { question: n.question } : {}),
        ...(n.target ? { target: n.target } : {}),
        ...(n.targetRef ? { targetRef: n.targetRef } : {}),
        ...(n.fileId ? { fileId: n.fileId } : {}),
        ...(n.prompt ? { prompt: truncateText(n.prompt, 400) } : {}),
      };
      if (includeLayout) {
        base.x = n.x;
        base.y = n.y;
        if (n.width !== undefined) base.width = n.width;
        if (n.height !== undefined) base.height = n.height;
      }
      return base;
    }),
    arestas: detail.workflow.arestas.map((a) => ({
      id: a.id,
      origem: a.origem,
      destino: a.destino,
      type: a.type ?? "text",
      ...(a.branch ? { branch: a.branch } : {}),
    })),
    gatilhos: detail.triggers.map((t) => ({
      node_id: t.node_id,
      tipo: t.tipo,
      timezone: t.timezone,
      proxima_execucao_em: t.proxima_execucao_em,
      webhook_url: t.webhook_url ?? null,
    })),
    ultimas_execucoes: detail.runs.slice(0, 5).map((r) => ({
      run_id: r.run_id,
      numero: r.numero,
      status: r.status,
      origem: r.origem,
      iniciado_em: r.iniciado_em,
      encerrado_em: r.encerrado_em,
    })),
  };
}

export function compactRunForAgent(detail: WorkflowRunDetail): Record<string, unknown> {
  return {
    run_id: detail.run.run_id,
    workflow_id: detail.run.workflow_id,
    numero: detail.run.numero,
    status: detail.run.status,
    origem: detail.run.origem,
    trigger_node_id: detail.run.trigger_node_id,
    from_node_id: detail.run.from_node_id,
    erro: detail.run.erro,
    iniciado_em: detail.run.iniciado_em,
    encerrado_em: detail.run.encerrado_em,
    steps: detail.steps.map((s) => ({
      step_id: s.step_id,
      node_id: s.node_id,
      kind: s.kind,
      tentativa: s.tentativa,
      status: s.status,
      branch: s.branch,
      erro: s.erro,
      input: truncateText(s.input, MAX_STEP_PREVIEW_CHARS),
      output: truncateText(s.output, MAX_STEP_PREVIEW_CHARS),
      output_tipo: s.output_tipo,
      tarefa_id: s.tarefa_id,
    })),
    deliveries: detail.deliveries.map((d) => ({
      step_id: d.step_id,
      destino: d.destino,
      destino_ref: d.destino_ref,
      status: d.status,
      motivo: d.motivo,
      enviado_em: d.enviado_em,
    })),
  };
}

export async function executeWorkflowToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    store: WorkflowStore;
    engine: WorkflowEngine;
    wsHub?: WebSocketHub;
    agenteId?: string;
    requestSeed?: string;
  }
): Promise<unknown> {
  switch (name) {
    case "list_workflows": {
      const list = ctx.store.listWorkflows();
      return {
        ok: true,
        total: list.length,
        workflows: list.map((w) => ({
          workflow_id: w.workflow_id,
          nome: w.nome,
          descricao: w.descricao,
          ativo: w.ativo,
          revisao_grafo: w.revisao_grafo,
          qtd_nos: w.qtd_nos,
          qtd_arestas: w.qtd_arestas,
          ultimo_run: w.last_run
            ? {
                run_id: w.last_run.run_id,
                numero: w.last_run.numero,
                status: w.last_run.status,
              }
            : null,
        })),
      };
    }

    case "read_workflow": {
      const workflowId = typeof args.workflow_id === "string" ? args.workflow_id.trim() : "";
      if (!workflowId) {
        return { ok: false, erro: "Informe 'workflow_id'." };
      }
      const detail = ctx.store.getWorkflowDetail(workflowId);
      if (!detail) {
        return { ok: false, erro: `Workflow não encontrado: ${workflowId}` };
      }
      return {
        ok: true,
        workflow: compactGraphForAgent(detail, args.layout === true),
      };
    }

    case "edit_workflow": {
      const workflowId =
        typeof args.workflow_id === "string" && args.workflow_id.trim()
          ? args.workflow_id.trim()
          : undefined;
      const ops = Array.isArray(args.ops) ? (args.ops as WorkflowOpInput[]) : [];
      const tidy = args.tidy === true;

      try {
        if (!workflowId) {
          const applied = applyWorkflowOps([], [], ops);
          const arrangedNos =
            applied.nos.length > 0 ? layoutNodes(applied.nos, applied.arestas) : [];
          const created = ctx.store.createWorkflow({
            nome: typeof args.nome === "string" ? args.nome : "Novo Workflow",
            descricao: typeof args.descricao === "string" ? args.descricao : "",
            nos: arrangedNos,
            arestas: applied.arestas,
            ativo: typeof args.ativo === "boolean" ? args.ativo : true,
          });
          ctx.wsHub?.broadcast("workflow:updated", {
            workflow_id: created.workflow.workflow_id,
            revisao_grafo: created.workflow.revisao_grafo ?? 0,
            agente_id: ctx.agenteId ?? null,
            acao: "created",
          });
          return {
            ok: true,
            acao: "created",
            workflow: compactGraphForAgent(created, false),
          };
        }

        // Edição existente com até 2 tentativas em conflito de revisão otimista
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = ctx.store.getWorkflowDetail(workflowId);
          if (!current) {
            return { ok: false, erro: `Workflow não encontrado: ${workflowId}` };
          }
          const applied = applyWorkflowOps(current.workflow.nos, current.workflow.arestas, ops);
          const finalNos = tidy ? layoutNodes(applied.nos, applied.arestas) : applied.nos;

          const saved = ctx.store.saveWorkflow(workflowId, {
            nome: typeof args.nome === "string" ? args.nome : undefined,
            descricao: typeof args.descricao === "string" ? args.descricao : undefined,
            ativo: typeof args.ativo === "boolean" ? args.ativo : undefined,
            nos: finalNos,
            arestas: applied.arestas,
            base_revision: current.workflow.revisao_grafo ?? 0,
          });

          if (!saved) {
            return { ok: false, erro: `Workflow não encontrado: ${workflowId}` };
          }

          if (saved.ok) {
            ctx.wsHub?.broadcast("workflow:updated", {
              workflow_id: saved.detail.workflow.workflow_id,
              revisao_grafo: saved.detail.workflow.revisao_grafo ?? 0,
              agente_id: ctx.agenteId ?? null,
              acao: "saved",
            });
            return {
              ok: true,
              acao: "saved",
              workflow: compactGraphForAgent(saved.detail, false),
            };
          }
        }

        return {
          ok: false,
          erro: "Conflito de concorrência ao editar o workflow após 2 tentativas. Releia com read_workflow e tente novamente.",
        };
      } catch (err) {
        if (err instanceof WorkflowValidationError) {
          return {
            ok: false,
            validation_error: true,
            erro: err.message,
          };
        }
        throw err;
      }
    }

    case "delete_workflow": {
      const workflowId = typeof args.workflow_id === "string" ? args.workflow_id.trim() : "";
      if (!workflowId) {
        return { ok: false, erro: "Informe 'workflow_id'." };
      }
      if (args.confirmed_by_human !== true) {
        return {
          ok: false,
          requires_confirmation: true,
          mensagem: "Confirmação humana obrigatória antes de excluir este workflow.",
        };
      }
      const detail = ctx.store.getWorkflowDetail(workflowId);
      if (!detail) {
        return { ok: false, erro: `Workflow não encontrado: ${workflowId}` };
      }
      const deleted = ctx.store.deleteWorkflow(workflowId);
      if (deleted) {
        ctx.wsHub?.broadcast("workflow:updated", {
          workflow_id: workflowId,
          revisao_grafo: detail.workflow.revisao_grafo ?? 0,
          agente_id: ctx.agenteId ?? null,
          acao: "deleted",
        });
      }
      return { ok: deleted, workflow_id: workflowId };
    }

    case "run_workflow": {
      const workflowId = typeof args.workflow_id === "string" ? args.workflow_id.trim() : "";
      if (!workflowId) {
        return { ok: false, erro: "Informe 'workflow_id'." };
      }
      const runDetail = await ctx.engine.startRun({
        workflowId,
        origem: "agente",
        triggerNodeId:
          typeof args.trigger_node_id === "string" ? args.trigger_node_id.trim() : undefined,
        fromNodeId:
          typeof args.from_node_id === "string" ? args.from_node_id.trim() : undefined,
        payload: args.payload,
        requestId: ctx.requestSeed
          ? `agent:${ctx.agenteId ?? "agent"}:${ctx.requestSeed}:${randomUUID().slice(0, 8)}`
          : undefined,
      });

      return {
        ok: true,
        execucao: compactRunForAgent(runDetail),
      };
    }

    case "read_workflow_runs": {
      const workflowId = typeof args.workflow_id === "string" ? args.workflow_id.trim() : "";
      if (!workflowId) {
        return { ok: false, erro: "Informe 'workflow_id'." };
      }
      const runId = typeof args.run_id === "string" ? args.run_id.trim() : "";
      if (runId) {
        const detail = ctx.store.getRunDetail(runId);
        if (!detail || detail.run.workflow_id !== workflowId) {
          return { ok: false, erro: `Execução não encontrada para o workflow: ${runId}` };
        }
        return {
          ok: true,
          execucao: compactRunForAgent(detail),
        };
      }

      const limit =
        typeof args.limit === "number" && Number.isFinite(args.limit)
          ? Math.max(1, Math.min(30, Math.floor(args.limit)))
          : 10;
      const runs = ctx.store.listRunsPaginated(workflowId, limit, 0);
      return {
        ok: true,
        total: runs.length,
        execucoes: runs.map((r) => ({
          run_id: r.run_id,
          numero: r.numero,
          status: r.status,
          origem: r.origem,
          trigger_node_id: r.trigger_node_id,
          from_node_id: r.from_node_id,
          erro: r.erro,
          iniciado_em: r.iniciado_em,
          encerrado_em: r.encerrado_em,
        })),
      };
    }

    default:
      throw new Error(`Ferramenta de workflow desconhecida: ${name}`);
  }
}

