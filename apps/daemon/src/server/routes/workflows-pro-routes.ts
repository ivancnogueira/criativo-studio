import { VAULT_KEYS_BY_PROVIDER } from "../../workflows/engine/workflow-engine-types.ts";
import { resolveViableWorkflowModel } from "../../workflows/workflow-model-resolver.ts";
import {
  exportPortableWorkflow,
  importPortableWorkflow,
} from "../../workflows/workflow-portability-service.ts";
import { WORKFLOW_MARKETING_TEMPLATES } from "../../workflows/workflow-templates-catalog.ts";
import { WorkflowValidationError } from "../../workflows/workflow-store.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { resolveWorkflowRuntime } from "./route-helpers.ts";

/**
 * Rotas da Fase 42 (Workflows Pro): templates, modelo viável, retry em lote e portabilidade.
 * Registrada antes de `tryHandleWorkflowsCrudRoutes` para evitar captura por `/api/workflows/:id`.
 */
export async function tryHandleWorkflowsProRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, deps } = ctx;
  const { sendJson } = deps;

  const hasVaultApiKey = deps.vault
    ? (provider: string) => {
        const keys = VAULT_KEYS_BY_PROVIDER[provider] ?? [];
        return keys.some((k) => {
          const val = deps.vault!.getSecret(k);
          return Boolean(val && val.trim().length > 0);
        });
      }
    : undefined;

  if (method === "GET" && path === "/api/workflows/templates") {
    const viableModel = await resolveViableWorkflowModel({
      providers: deps.providers,
      providerConnection: deps.providerConnection,
      hasVaultApiKey,
    });
    sendJson(res, 200, {
      templates: WORKFLOW_MARKETING_TEMPLATES,
      viable_model: viableModel,
    });
    return true;
  }

  if (method === "GET" && path === "/api/workflows/modelo-viavel") {
    const viableModel = await resolveViableWorkflowModel({
      providers: deps.providers,
      providerConnection: deps.providerConnection,
      hasVaultApiKey,
    });
    sendJson(res, 200, viableModel);
    return true;
  }

  const retryVarMatch = path.match(/^\/api\/workflows\/etapas\/([^/]+)\/variacoes\/(\d+)\/retentar$/);
  if (method === "POST" && retryVarMatch) {
    if (!deps.workflowEngine) {
      sendJson(res, 503, { erro: "WorkflowEngine não inicializado neste daemon." });
      return true;
    }
    const stepId = decodeURIComponent(retryVarMatch[1]);
    const slotIndex = Number.parseInt(retryVarMatch[2], 10);
    try {
      const result = await deps.workflowEngine.retryStepVariant(stepId, slotIndex);
      sendJson(res, 200, { ok: true, step: result.step, variants: result.variants });
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  if (method === "POST" && path === "/api/workflows/importar") {
    let rawBody: Record<string, unknown>;
    try {
      rawBody = await deps.readJsonBody(req, 75 * 1024 * 1024);
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 413) {
        sendJson(res, 413, { erro: "Pacote de workflow excede o limite de 75 MB." });
        return true;
      }
      throw err;
    }
    const { store } = resolveWorkflowRuntime(deps);
    try {
      const result = importPortableWorkflow(
        { db: ctx.db, store, workspaceRoot: ctx.workspaceRoot },
        rawBody
      );
      ctx.wsHub.broadcast("workflow:updated", {
        workflow_id: result.workflow.workflow_id,
        revisao_grafo: result.workflow.revisao_grafo ?? 0,
        acao: "created",
      });
      sendJson(res, 201, result);
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        sendJson(res, err.statusCode, { erro: err.message });
      } else {
        throw err;
      }
    }
    return true;
  }

  const exportMatch = path.match(/^\/api\/workflows\/([^/]+)\/exportar$/);
  if (method === "GET" && exportMatch) {
    const wfId = decodeURIComponent(exportMatch[1]);
    const { store } = resolveWorkflowRuntime(deps);
    try {
      const bundle = exportPortableWorkflow(
        { db: ctx.db, store, workspaceRoot: ctx.workspaceRoot },
        wfId
      );
      const slug = bundle.workflow.nome
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || wfId;
      res.setHeader("Content-Disposition", `attachment; filename="${slug}.workflow.json"`);
      sendJson(res, 200, bundle);
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
