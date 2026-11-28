import type {
  CreateEditorialPostInput,
  EditorialPostFormato,
  EditorialPostStatus,
  MetaGalleryPeriod,
  MetaPostingIntelligencePeriod,
  UpdateEditorialPostInput,
} from "@criativo/contracts";
import { EditorialCalendarService } from "../social/editorial-calendar-service.ts";
import { MetaGalleryService } from "../social/meta-gallery-service.ts";
import type { StudioRouteContext } from "./routes/route-helpers.ts";
import { tryHandleSocialMeta2026Routes } from "./social-meta-2026-routes.ts";
import { tryHandleSocialCommentDmRoutes } from "./social-comment-dm-routes.ts";
import { resolveNativeAppConnectionsStore } from "./studio-tools-bridge.ts";

/**
 * Rotas HTTP do Estúdio Social Media Avançado (Fase 32):
 * - Calendário Editorial (`/api/editorial/posts*`)
 * - Galeria de Posts Publicados com Métricas Meta (`/api/instagram/galeria-metricas`)
 */
export async function tryHandleSocialStudioRoutes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub } = ctx;
  const { sendJson, readJsonBody } = deps;

  if (path === "/api/editorial/posts" && method === "GET") {
    const calendar = new EditorialCalendarService(db);
    const mes = url.searchParams.get("mes") ?? undefined;
    const statusParam = url.searchParams.get("status") ?? undefined;
    const formatoParam = url.searchParams.get("formato") ?? undefined;
    const pilar = url.searchParams.get("pilar") ?? undefined;
    const busca = url.searchParams.get("busca") ?? undefined;

    const posts = calendar.listPosts({
      mes,
      status: statusParam as EditorialPostStatus | undefined,
      formato: formatoParam as EditorialPostFormato | undefined,
      pilar,
      busca,
    });
    sendJson(res, 200, { ok: true, posts });
    return true;
  }

  if (path === "/api/editorial/posts" && method === "POST") {
    const body = (await readJsonBody(req)) as unknown as CreateEditorialPostInput;
    const calendar = new EditorialCalendarService(db);
    try {
      const post = calendar.createPost(body);
      wsHub.broadcast("editorial:updated", { acao: "criado", id: post.id });
      sendJson(res, 201, { ok: true, post });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        erro: err instanceof Error ? err.message : "Dados inválidos para pauta editorial.",
      });
    }
    return true;
  }

  const postMatch = path.match(/^\/api\/editorial\/posts\/([^/]+)$/);
  if (postMatch) {
    const id = decodeURIComponent(postMatch[1]);
    const calendar = new EditorialCalendarService(db);

    if (method === "GET") {
      const post = calendar.getPost(id);
      if (!post) {
        sendJson(res, 404, { ok: false, erro: `Pauta '${id}' não encontrada.` });
        return true;
      }
      sendJson(res, 200, { ok: true, post });
      return true;
    }

    if (method === "PATCH") {
      const body = (await readJsonBody(req)) as unknown as UpdateEditorialPostInput;
      try {
        const post = calendar.updatePost(id, body);
        wsHub.broadcast("editorial:updated", { acao: "atualizado", id: post.id });
        sendJson(res, 200, { ok: true, post });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Falha ao atualizar pauta.";
        const statusCode = msg.includes("não encontrada") ? 404 : 400;
        sendJson(res, statusCode, { ok: false, erro: msg });
      }
      return true;
    }

    if (method === "DELETE") {
      const deleted = calendar.deletePost(id);
      if (!deleted) {
        sendJson(res, 404, { ok: false, erro: `Pauta '${id}' não encontrada.` });
        return true;
      }
      wsHub.broadcast("editorial:updated", { acao: "excluido", id });
      sendJson(res, 200, { ok: true, id });
      return true;
    }
  }

  const produceMatch = path.match(/^\/api\/editorial\/posts\/([^/]+)\/produzir$/);
  if (produceMatch && method === "POST") {
    const id = decodeURIComponent(produceMatch[1]);
    const body = await readJsonBody(req);
    const calendar = new EditorialCalendarService(db);
    const post = calendar.getPost(id);
    if (!post) {
      sendJson(res, 404, { ok: false, erro: `Pauta '${id}' não encontrada.` });
      return true;
    }

    const agenteId =
      (typeof body.agente_id === "string" && body.agente_id.trim()) ||
      post.agente_id ||
      "designer_chefe";
    const instrucoesExtras =
      typeof body.instrucoes === "string" && body.instrucoes.trim()
        ? `\n\nInstruções adicionais: ${body.instrucoes.trim()}`
        : "";
    const prompt = [
      `Produzir criativo para o Calendário Editorial (${post.id}):`,
      `- Título: ${post.titulo}`,
      `- Formato: ${post.formato}`,
      post.pilar ? `- Pilar: ${post.pilar}` : null,
      post.data_agendada ? `- Data prevista: ${post.data_agendada}` : null,
      post.legenda ? `- Rascunho de legenda/copy:\n${post.legenda}` : null,
      instrucoesExtras || null,
    ]
      .filter(Boolean)
      .join("\n");

    let tarefaId: string;
    let threadId: string | null = null;
    if (deps.phase13?.tasksService) {
      const created = deps.phase13.tasksService.createTaskThread({
        agenteId,
        titulo: `Editorial: ${post.titulo}`,
        conteudo: prompt,
        origem: "usuario",
      });
      tarefaId = created.tarefa.tarefa_id;
      threadId = created.thread.thread_id;
    } else {
      const tarefa = deps.queue.enqueueTask({
        agente_id: agenteId,
        canal_origem: "web",
        tipo: post.formato,
        titulo: `Editorial: ${post.titulo}`,
        prioridade: 4,
        payload: {
          editorial_post_id: post.id,
          formato: post.formato,
          prompt,
        },
      });
      tarefaId = tarefa.tarefa_id;
      wsHub.broadcast("task:queued", {
        tarefa_id: tarefa.tarefa_id,
        tipo: tarefa.tipo,
        titulo: tarefa.titulo,
        prioridade: tarefa.prioridade,
        canal_origem: tarefa.canal_origem,
      });
    }

    const updatedPost = calendar.updatePost(post.id, {
      status: "em_producao",
      agente_id: agenteId,
      tarefa_id: tarefaId,
    });
    wsHub.broadcast("editorial:updated", { acao: "em_producao", id: post.id, tarefa_id: tarefaId });
    sendJson(res, 200, {
      ok: true,
      post: updatedPost,
      tarefa_id: tarefaId,
      thread_id: threadId,
      agente_id: agenteId,
    });
    return true;
  }

  if (path === "/api/editorial/inteligencia-horarios" && method === "GET") {
    const periodoParam = url.searchParams.get("periodo");
    const periodo: MetaPostingIntelligencePeriod =
      periodoParam === "90d" || periodoParam === "all" ? periodoParam : "30d";
    const formatoRaw = url.searchParams.get("formato");
    const formato =
      formatoRaw === "carrossel" ||
      formatoRaw === "reels" ||
      formatoRaw === "imagem" ||
      formatoRaw === "story"
        ? formatoRaw
        : undefined;
    const contaId = url.searchParams.get("conta_id")?.trim() || undefined;
    const timezone = url.searchParams.get("timezone")?.trim() || undefined;

    const report = new EditorialCalendarService(db).getPostingIntelligence({
      periodo,
      formato,
      contaId,
      timezone,
    });
    sendJson(res, 200, report);
    return true;
  }

  if (path === "/api/instagram/galeria-metricas" && method === "GET") {
    const periodoParam = url.searchParams.get("periodo");
    const periodo: MetaGalleryPeriod =
      periodoParam === "7d" || periodoParam === "28d" || periodoParam === "90d"
        ? periodoParam
        : "30d";
    const refreshRaw = url.searchParams.get("refresh") ?? "";
    const refresh = refreshRaw === "1" || refreshRaw === "true";
    const contaId = url.searchParams.get("conta_id") ?? undefined;
    const limitePostsRaw = Number(url.searchParams.get("limite") ?? "24");
    const limitePosts = Number.isFinite(limitePostsRaw) ? Math.max(1, Math.min(30, limitePostsRaw)) : 24;

    const nativeStore =
      deps.catalogService?.nativeStore ??
      resolveNativeAppConnectionsStore({ db, vault: deps.vault }) ??
      undefined;

    const galleryService = new MetaGalleryService({
      db,
      vault: deps.vault,
      nativeStore,
    });

    const report = await galleryService.getGallery({
      periodo,
      refresh,
      contaId,
      limitePosts,
    });
    sendJson(res, 200, report);
    return true;
  }

  if (await tryHandleSocialMeta2026Routes(ctx)) {
    return true;
  }

  if (await tryHandleSocialCommentDmRoutes(ctx)) {
    return true;
  }

  return false;
}
