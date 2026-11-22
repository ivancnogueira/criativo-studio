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
import { MemoryManager } from "../../engine/runner/memory-manager.ts";
import type { MemoryReviewService } from "../../engine/runner/memory-review-service.ts";
import type { ChatVisualPreviewService } from "../../engine/runner/chat-visual-preview-service.ts";
import type { StudioRouteContext } from "./route-helpers.ts";
import { safeJsonParse } from "./route-helpers.ts";

export async function tryHandleAgentsMemoryRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub, workspaceRoot } = ctx;
  const { sendJson, readJsonBody } = deps;

  // Páginas visuais interativas (Generative UI — html_render)
  const visualPageMatch = path.match(/^\/api\/agentes\/([^/]+)\/visual-pages\/([^/]+)$/);
  if (method === "GET" && visualPageMatch) {
    const arquivoId = decodeURIComponent(visualPageMatch[2]);
    if (!deps.visualPreview) {
      sendJson(res, 503, { erro: "ChatVisualPreviewService não inicializado neste daemon." });
      return true;
    }
    const theme = url.searchParams.get("theme") === "light" ? "light" : "dark";
    const page = deps.visualPreview.getCompiledPage(arquivoId, theme);
    if (!page) {
      sendJson(res, 404, { erro: `Página visual '${arquivoId}' não encontrada.` });
      return true;
    }
    if (url.searchParams.get("raw") === "1") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Content-Security-Policy": "sandbox allow-scripts allow-forms;",
      });
      res.end(page.html);
      return true;
    }
    sendJson(res, 200, { ok: true, ...page });
    return true;
  }

  // Memórias do agente (Fase 14 — FTS5, orçamento 8.192 bytes, edição manual e revisão imediata)
  const agentMemoriesReviewMatch = path.match(/^\/api\/agentes\/([^/]+)\/memorias\/revisar$/);
  if (method === "POST" && agentMemoriesReviewMatch) {
    const agenteId = decodeURIComponent(agentMemoriesReviewMatch[1]);
    if (!deps.memoryReview) {
      sendJson(res, 503, { erro: "MemoryReviewService não inicializado neste daemon." });
      return true;
    }
    const body = await readJsonBody(req);
    const threadId = typeof body.thread_id === "string" ? body.thread_id : null;
    const alteracoes = await deps.memoryReview.triggerNow(agenteId, threadId);
    sendJson(res, 200, { ok: true, alteracoes });
    return true;
  }

  const agentMemoryItemMatch = path.match(/^\/api\/agentes\/([^/]+)\/memorias\/([^/]+)$/);
  if (agentMemoryItemMatch && (method === "PUT" || method === "DELETE")) {
    const agenteId = decodeURIComponent(agentMemoryItemMatch[1]);
    const memoriaId = decodeURIComponent(agentMemoryItemMatch[2]);
    const memMgr = deps.memoryManager ?? new MemoryManager(db);

    if (method === "DELETE") {
      const removed = memMgr.deleteMemory(agenteId, memoriaId, true);
      if (!removed) {
        sendJson(res, 404, { erro: `Memória '${memoriaId}' não encontrada.` });
        return true;
      }
      sendJson(res, 200, { ok: true, memoria_id: memoriaId, snapshot: memMgr.getMemoriesSnapshot(agenteId) });
      return true;
    }

    const body = await readJsonBody(req);
    try {
      const updated = memMgr.updateManualMemory(agenteId, memoriaId, {
        texto: typeof body.texto === "string" ? body.texto : undefined,
        categoria:
          body.categoria === "essential" || body.categoria === "searchable"
            ? body.categoria
            : undefined,
        escopo_site:
          typeof body.escopo_site === "string" || body.escopo_site === null
            ? body.escopo_site
            : undefined,
      });
      sendJson(res, 200, { ok: true, memoria: updated, snapshot: memMgr.getMemoriesSnapshot(agenteId) });
    } catch (err) {
      sendJson(res, 400, { erro: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const agentMemoriesMatch = path.match(/^\/api\/agentes\/([^/]+)\/memorias$/);
  if (agentMemoriesMatch && (method === "GET" || method === "POST")) {
    const agenteId = decodeURIComponent(agentMemoriesMatch[1]);
    const memMgr = deps.memoryManager ?? new MemoryManager(db);

    if (method === "GET") {
      const snap = memMgr.getMemoriesSnapshot(agenteId);
      const rawCat = url.searchParams.get("categoria");
      const categoria: MemoriaInclusao | undefined =
        rawCat === "essential" || rawCat === "searchable" ? rawCat : undefined;
      const site = url.searchParams.get("site");
      const busca = url.searchParams.get("busca") ?? undefined;
      const after = url.searchParams.get("after") ?? undefined;

      if (categoria || site || busca || after) {
        const filtered = memMgr.listMemoriesPaginated(agenteId, {
          categoria,
          site,
          busca,
          after,
          limit: 100,
        });
        sendJson(res, 200, {
          memorias: filtered.items,
          nextCursor: filtered.nextCursor,
          usedBytes: snap.usedBytes,
          budgetBytes: snap.budgetBytes,
          total: snap.total,
          limit: snap.limit,
        });
        return true;
      }

      sendJson(res, 200, snap);
      return true;
    }

    const body = await readJsonBody(req);
    if (typeof body.texto !== "string" || body.texto.trim().length === 0) {
      sendJson(res, 400, { erro: "Campo obrigatório: 'texto'." });
      return true;
    }
    const rawCat = body.categoria;
    const categoria: MemoriaInclusao =
      rawCat === "searchable" ? "searchable" : "essential";
    const escopoSite = typeof body.escopo_site === "string" ? body.escopo_site : null;
    const added = memMgr.addMemory(agenteId, body.texto.trim(), "manual", {
      categoria,
      escopoSite,
    });
    if (!added) {
      sendJson(res, 400, { erro: "Não foi possível registrar a memória." });
      return true;
    }
    sendJson(res, 201, {
      memoria_id: added.memoria_id,
      texto: added.texto,
      criado_em: added.criado_em,
      memoria: added,
      snapshot: memMgr.getMemoriesSnapshot(agenteId),
    });
    return true;
  }

  return false;
}
