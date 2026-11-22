import {
  resolveMetaGraphApiVersion,
  type AgentAllowedFolder,
  type AgentNotificationLevel,
  type AnexoChat,
  type AprendizadoConfig,
  type ArquivoStudio,
  type AvatarStyle,
  type BackupModelChoice,
  type BackupModelsConfig,
  type CanalEquipe,
  type CanalMemoria,
  type CanalNavegadorModo,
  type ChatVisualMeta,
  type ConversationMessage,
  type ConversationUiBlock,
  type DeletedNativeAgentInfo,
  type MemoriaInclusao,
  type MemoryReviewAlteracao,
  type MensagemChat,
  type OnboardingEstado,
  type PassoChat,
  type PermissionLevel,
  type ProviderName,
  type SkillSugestaoItem,
  type ToolDefinition,
  type UiBlockSubmitPayload,
  type UsageLimitAskPayload,
  type WorkflowAresta,
  type WorkflowNo,
  type WorkflowTraco,
  type WorkflowVisual,
} from "@criativo/contracts";
import type { WorkflowEngine } from "../../workflows/workflow-engine.ts";
import { WorkflowStore, WorkflowValidationError } from "../../workflows/workflow-store.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { resolveWorkflowRuntime } from "./route-helpers.ts";

export async function tryHandleWorkflowsCrudRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody } = deps;

  if (method === "GET" && path === "/api/workflows") {
    const { store } = resolveWorkflowRuntime(deps);
    sendJson(res, 200, { workflows: store.listWorkflows() });
    return true;
  }

  if (method === "POST" && path === "/api/workflows") {
    const body = await readJsonBody(req);
    const { store } = resolveWorkflowRuntime(deps);
    try {
      const detail = store.createWorkflow({
        workflow_id: typeof body.workflow_id === "string" ? body.workflow_id : undefined,
        nome: typeof body.nome === "string" ? body.nome : undefined,
        descricao: typeof body.descricao === "string" ? body.descricao : undefined,
        nos: Array.isArray(body.nos) ? (body.nos as WorkflowNo[]) : [],
        arestas: Array.isArray(body.arestas) ? (body.arestas as WorkflowAresta[]) : [],
        tracos: Array.isArray(body.tracos) ? (body.tracos as WorkflowTraco[]) : [],
        ativo: typeof body.ativo === "boolean" ? body.ativo : true,
      });
      wsHub.broadcast("workflow:updated", {
        workflow_id: detail.workflow.workflow_id,
        revisao_grafo: detail.workflow.revisao_grafo ?? 0,
        acao: "created",
      });
      sendJson(res, 201, { workflow: detail.workflow, detail });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfVersionsMatch = path.match(/^\/api\/workflows\/([^/]+)\/versoes$/);
  if (method === "GET" && wfVersionsMatch) {
    const wfId = decodeURIComponent(wfVersionsMatch[1]);
    const { store } = resolveWorkflowRuntime(deps);
    sendJson(res, 200, { versoes: store.listVersions(wfId) });
    return true;
  }

  const wfVersionRestoreMatch = path.match(
    /^\/api\/workflows\/([^/]+)\/versoes\/([^/]+)\/restaurar$/
  );
  if (method === "POST" && wfVersionRestoreMatch) {
    const wfId = decodeURIComponent(wfVersionRestoreMatch[1]);
    const versionId = decodeURIComponent(wfVersionRestoreMatch[2]);
    const { store } = resolveWorkflowRuntime(deps);
    try {
      const detail = store.restoreVersion(wfId, versionId);
      if (!detail) {
        sendJson(res, 404, { erro: "Workflow ou versão não encontrados." });
        return true;
      }
      wsHub.broadcast("workflow:updated", {
        workflow_id: detail.workflow.workflow_id,
        revisao_grafo: detail.workflow.revisao_grafo ?? 0,
        acao: "restored",
      });
      sendJson(res, 200, { workflow: detail.workflow, detail });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfVersionGetMatch = path.match(/^\/api\/workflows\/([^/]+)\/versoes\/([^/]+)$/);
  if (method === "GET" && wfVersionGetMatch) {
    const wfId = decodeURIComponent(wfVersionGetMatch[1]);
    const versionId = decodeURIComponent(wfVersionGetMatch[2]);
    const { store } = resolveWorkflowRuntime(deps);
    const versao = store.getVersion(wfId, versionId);
    if (!versao) {
      sendJson(res, 404, { erro: `Versão '${versionId}' não encontrada.` });
      return true;
    }
    sendJson(res, 200, { versao });
    return true;
  }

  const wfExecMatch = path.match(/^\/api\/workflows\/([^/]+)\/executar$/);
  if (method === "POST" && wfExecMatch) {
    const wfId = decodeURIComponent(wfExecMatch[1]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const execucao = await deps.workflowEngine.startRun({
        workflowId: wfId,
        origem: "manual",
        fromNodeId: typeof body.from_node_id === "string" ? body.from_node_id : undefined,
        triggerNodeId:
          typeof body.trigger_node_id === "string" ? body.trigger_node_id : undefined,
        payload: body.payload,
        requestId: typeof body.request_id === "string" ? body.request_id : undefined,
      });
      const tarefasCriadas = execucao.steps
        .map((s) => s.tarefa_id)
        .filter((id): id is string => Boolean(id));
      sendJson(res, 200, {
        ok: true,
        execucao,
        workflow_id: wfId,
        run_id: execucao.run.run_id,
        numero: execucao.run.numero,
        status: execucao.run.status,
        tarefas_criadas: tarefasCriadas,
      });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfNodeRunMatch = path.match(/^\/api\/workflows\/([^/]+)\/nos\/([^/]+)\/executar$/);
  if (method === "POST" && wfNodeRunMatch) {
    const wfId = decodeURIComponent(wfNodeRunMatch[1]);
    const nodeId = decodeURIComponent(wfNodeRunMatch[2]);
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      const step = await deps.workflowEngine.runStep({
        workflowId: wfId,
        nodeId,
        requestId: typeof body.request_id === "string" ? body.request_id : undefined,
        payload: body.payload,
      });
      sendJson(res, 200, { ok: true, step });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfRunsListMatch = path.match(/^\/api\/workflows\/([^/]+)\/execucoes$/);
  if (method === "GET" && wfRunsListMatch) {
    const wfId = decodeURIComponent(wfRunsListMatch[1]);
    const { store } = resolveWorkflowRuntime(deps);
    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 20;
    const rawBefore = url.searchParams.get("before");
    const offset = rawBefore ? Math.max(0, Number.parseInt(rawBefore, 10) || 0) : 0;
    const runs = store.listRunsPaginated(wfId, limit, offset);
    const execucoes = runs
      .map((r) => store.getRunDetail(r.run_id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
    const soloSteps = store.listSoloSteps(wfId, 50);
    sendJson(res, 200, { execucoes, solo_steps: soloSteps });
    return true;
  }

  const wfRotateWebhookMatch = path.match(
    /^\/api\/workflows\/([^/]+)\/gatilhos\/([^/]+)\/rotacionar-webhook$/
  );
  if (method === "POST" && wfRotateWebhookMatch) {
    const wfId = decodeURIComponent(wfRotateWebhookMatch[1]);
    const nodeId = decodeURIComponent(wfRotateWebhookMatch[2]);
    const { store } = resolveWorkflowRuntime(deps);
    try {
      const rotated = store.rotateWebhookSecret(wfId, nodeId);
      sendJson(res, 200, {
        ok: true,
        route_id: rotated.routeId,
        webhook_url: rotated.webhookUrl,
        secret: rotated.secret,
      });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const wfMatch = path.match(/^\/api\/workflows\/([^/]+)$/);
  if (wfMatch && (method === "GET" || method === "PUT" || method === "DELETE")) {
    const wfId = decodeURIComponent(wfMatch[1]);
    const { store } = resolveWorkflowRuntime(deps);

    if (method === "GET") {
      const detail = store.getWorkflowDetail(wfId);
      if (!detail) {
        sendJson(res, 404, { erro: `Workflow '${wfId}' não encontrado.` });
        return true;
      }
      sendJson(res, 200, detail);
      return true;
    }

    if (method === "DELETE") {
      if (deps.workflowEngine) {
        const activeRuns = store
          .listRunsPaginated(wfId, 50, 0)
          .filter(
            (r) => r.status === "running" || r.status === "approval" || r.status === "stopping"
          );
        for (const r of activeRuns) {
          await deps.workflowEngine.stopRun(r.run_id);
        }
      }
      const deleted = store.deleteWorkflow(wfId);
      if (!deleted) {
        sendJson(res, 404, { erro: `Workflow '${wfId}' não encontrado.` });
        return true;
      }
      wsHub.broadcast("workflow:updated", {
        workflow_id: wfId,
        revisao_grafo: 0,
        acao: "deleted",
      });
      sendJson(res, 200, { ok: true, workflow_id: wfId });
      return true;
    }

    const body = await readJsonBody(req);
    try {
      const saved = store.saveWorkflow(wfId, {
        nome: typeof body.nome === "string" ? body.nome : undefined,
        descricao: typeof body.descricao === "string" ? body.descricao : undefined,
        nos: Array.isArray(body.nos) ? (body.nos as WorkflowNo[]) : undefined,
        arestas: Array.isArray(body.arestas) ? (body.arestas as WorkflowAresta[]) : undefined,
        tracos: Array.isArray(body.tracos) ? (body.tracos as WorkflowTraco[]) : undefined,
        ativo: typeof body.ativo === "boolean" ? body.ativo : undefined,
        base_revision:
          typeof body.base_revision === "number" ? body.base_revision : undefined,
      });

      if (!saved) {
        sendJson(res, 404, { erro: `Workflow '${wfId}' não encontrado.` });
        return true;
      }

      if (!saved.ok) {
        sendJson(res, 409, {
          ok: false,
          erro: "O fluxo foi atualizado em outra sessão ou por um agente.",
          conflict: saved.conflict,
        });
        return true;
      }

      wsHub.broadcast("workflow:updated", {
        workflow_id: saved.detail.workflow.workflow_id,
        revisao_grafo: saved.detail.workflow.revisao_grafo ?? 0,
        acao: "saved",
      });
      sendJson(res, 200, { workflow: saved.detail.workflow, detail: saved.detail });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  return false;
}
