import type { MetaFirstCommentStatus } from "@criativo/contracts";
import { resolveMetaCredentials } from "../engine/tools/meta-insights.ts";
import {
  checkMetaTrialReelEligibility,
  MIN_TRIAL_REEL_FOLLOWERS,
} from "../engine/tools/meta-trial-eligibility.ts";
import { MetaFirstCommentService } from "../social/meta-first-comment-service.ts";
import { MetaMediaDeletionService } from "../social/meta-media-deletion-service.ts";
import type { StudioRouteContext } from "./routes/route-helpers.ts";
import { resolveNativeAppConnectionsStore } from "./studio-tools-bridge.ts";

/**
 * Rotas HTTP da Meta Graph API 2026 (Fase 44):
 * - `GET /api/instagram/elegibilidade-trial` (Wave 1)
 * - `GET|POST /api/instagram/primeiro-comentario*` (Wave 2)
 */
export async function tryHandleSocialMeta2026Routes(ctx: StudioRouteContext): Promise<boolean> {
  const { req, res, path, method, url, deps, db, wsHub } = ctx;
  const { sendJson, readJsonBody } = deps;

  const resolveNative = () =>
    deps.catalogService?.nativeStore ??
    resolveNativeAppConnectionsStore({ db, vault: deps.vault }) ??
    undefined;

  if (path === "/api/instagram/elegibilidade-trial" && method === "GET") {
    const contaId = url.searchParams.get("conta_id")?.trim() || undefined;
    const creds = resolveMetaCredentials(deps.vault, resolveNative(), contaId);

    if (!creds.accessToken || !creds.accountId) {
      sendJson(res, 200, {
        ok: false,
        eligible: false,
        followers_count: null,
        min_followers: MIN_TRIAL_REEL_FOLLOWERS,
        username: null,
        account_type: null,
        error_code: "CRV-META-001",
        reason: "Credenciais Meta ausentes no Cofre AES-256-GCM.",
      });
      return true;
    }

    const report = await checkMetaTrialReelEligibility({
      accessToken: creds.accessToken,
      igUserId: creds.accountId,
      fetchImpl: deps.fetchImpl,
    });
    sendJson(res, 200, report);
    return true;
  }

  const getCommentService = () =>
    deps.metaFirstCommentService ??
    new MetaFirstCommentService({
      db,
      vault: deps.vault,
      nativeStore: resolveNative(),
      wsHub,
      fetchImpl: deps.fetchImpl,
    });

  if (path === "/api/instagram/primeiro-comentario" && method === "GET") {
    const mediaId = url.searchParams.get("media_id")?.trim() || undefined;
    const editorialPostId = url.searchParams.get("editorial_post_id")?.trim() || undefined;
    const statusParam = url.searchParams.get("status")?.trim() as MetaFirstCommentStatus | undefined;
    const jobs = getCommentService().listComments({
      mediaId,
      editorialPostId,
      status: statusParam,
    });
    sendJson(res, 200, { ok: true, jobs });
    return true;
  }

  if (path === "/api/instagram/primeiro-comentario" && method === "POST") {
    const body = await readJsonBody(req);
    const service = getCommentService();
    try {
      let job = service.enqueueFirstComment({
        mediaId: typeof body.media_id === "string" ? body.media_id : "",
        commentText: typeof body.comment_text === "string" ? body.comment_text : "",
        approvedByHuman: body.approved_by_human === true,
        delaySeconds: typeof body.delay_seconds === "number" ? body.delay_seconds : undefined,
        editorialPostId:
          typeof body.editorial_post_id === "string" ? body.editorial_post_id : null,
        contaId: typeof body.conta_id === "string" ? body.conta_id : null,
      });
      if (job.approved_by_human && job.delay_seconds === 0) {
        await service.dispatchDueComments();
        job = service.getCommentJob(job.comment_job_id) ?? job;
      }
      sendJson(res, 201, { ok: true, job });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        erro: err instanceof Error ? err.message : "Falha ao agendar 1º comentário.",
      });
    }
    return true;
  }

  const approveMatch = path.match(/^\/api\/instagram\/primeiro-comentario\/([^/]+)\/aprovar$/);
  if (approveMatch && method === "POST") {
    const id = decodeURIComponent(approveMatch[1]);
    const body = await readJsonBody(req);
    const service = getCommentService();
    try {
      const delayOverride =
        typeof body.delay_seconds === "number" ? body.delay_seconds : undefined;
      let job = service.approveFirstComment(id, delayOverride);
      if (job.delay_seconds === 0) {
        await service.dispatchDueComments();
        job = service.getCommentJob(id) ?? job;
      }
      sendJson(res, 200, { ok: true, job });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao aprovar 1º comentário.";
      sendJson(res, msg.includes("não encontrado") ? 404 : 400, { ok: false, erro: msg });
    }
    return true;
  }

  const cancelMatch = path.match(/^\/api\/instagram\/primeiro-comentario\/([^/]+)\/cancelar$/);
  if (cancelMatch && method === "POST") {
    const id = decodeURIComponent(cancelMatch[1]);
    const service = getCommentService();
    try {
      const job = service.cancelFirstComment(id);
      sendJson(res, 200, { ok: true, job });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao cancelar 1º comentário.";
      sendJson(res, msg.includes("não encontrado") ? 404 : 400, { ok: false, erro: msg });
    }
    return true;
  }

  const getDeletionService = () =>
    new MetaMediaDeletionService({
      db,
      vault: deps.vault,
      nativeStore: resolveNative(),
      wsHub,
      fetchImpl: deps.fetchImpl,
    });

  const deleteMatch = path.match(/^\/api\/instagram\/midia\/([^/]+)\/excluir$/);
  if (deleteMatch && method === "POST") {
    const mediaId = decodeURIComponent(deleteMatch[1]);
    const body = await readJsonBody(req);
    const confirmText =
      typeof body.confirm_text === "string"
        ? body.confirm_text
        : typeof body.confirm_media_id === "string"
          ? body.confirm_media_id
          : "";
    try {
      const result = await getDeletionService().deletePublishedMedia({
        mediaId,
        approvedByHuman: body.approved_by_human === true,
        confirmText,
        actorLabel: "operador_cockpit",
        reason: typeof body.reason === "string" ? body.reason : undefined,
        contaId: typeof body.conta_id === "string" ? body.conta_id : null,
        removeFromLocalCacheOnUnsupported: body.remove_from_local_cache === true,
      });
      const status =
        result.deleted_remote || result.limitation_code === "META_DELETE_UNSUPPORTED" ? 200 : 502;
      sendJson(res, status, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao excluir mídia Meta.";
      const status = msg.includes("BLOQUEIO DE SEGURANÇA") ? 403 : 400;
      sendJson(res, status, {
        ok: false,
        deleted_remote: false,
        removed_local_cache: false,
        media_id: mediaId,
        limitation_code: status === 403 ? "CONFIRMATION_REQUIRED" : "META_API_ERROR",
        message: msg,
        erro: msg,
      });
    }
    return true;
  }

  if (path === "/api/instagram/auditoria" && method === "GET") {
    const mediaId = url.searchParams.get("media_id")?.trim() || undefined;
    const action = url.searchParams.get("action")?.trim() || undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const logs = getDeletionService().listAuditLogs({ mediaId, action, limit });
    sendJson(res, 200, { ok: true, logs });
    return true;
  }

  return false;
}
