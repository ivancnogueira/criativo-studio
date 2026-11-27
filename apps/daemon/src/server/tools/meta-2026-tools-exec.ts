import type { NativeAppConnectionsStore } from "../../marketplace/native-app-connections-store.ts";
import { MetaFirstCommentService } from "../../social/meta-first-comment-service.ts";
import { MetaMediaDeletionService } from "../../social/meta-media-deletion-service.ts";
import type { StudioExtensionToolDeps } from "./phase10-tools-schema.ts";
import { isMeta2026ToolName } from "./meta-2026-tools-schema.ts";
import { readStringArg } from "./studio-tool-helpers.ts";

export { isMeta2026ToolName };

/**
 * Executor das tools Meta Graph API 2026 (Fase 44).
 */
export async function executeMeta2026Tool(
  toolName: string,
  args: Record<string, unknown>,
  deps: StudioExtensionToolDeps,
  ctx: { workspaceRoot: string; nativeStore: NativeAppConnectionsStore | null }
): Promise<unknown> {
  if (toolName === "meta_agendar_primeiro_comentario") {
    const mediaId = readStringArg(args, "media_id", "mediaId") ?? "";
    const commentText = readStringArg(args, "comment_text", "commentText") ?? "";
    const approvedByHuman = args.approved_by_human === true;
    const delaySeconds =
      typeof args.delay_seconds === "number" && Number.isFinite(args.delay_seconds)
        ? args.delay_seconds
        : 30;

    const service = new MetaFirstCommentService({
      db: deps.db,
      vault: deps.vault,
      nativeStore: ctx.nativeStore ?? deps.nativeStore,
      wsHub: deps.wsHub,
      fetchImpl: deps.fetchImpl,
    });

    let job = service.enqueueFirstComment({
      mediaId,
      commentText,
      approvedByHuman,
      delaySeconds,
      editorialPostId: readStringArg(args, "editorial_post_id", "editorialPostId") ?? null,
      contaId: readStringArg(args, "conta_id", "contaId") ?? null,
    });

    if (approvedByHuman && job.delay_seconds === 0) {
      await service.dispatchDueComments();
      job = service.getCommentJob(job.comment_job_id) ?? job;
    }

    return {
      ok: true,
      job,
      mensagem: approvedByHuman
        ? job.status === "posted"
          ? "1º comentário publicado imediatamente com aprovação humana."
          : `1º comentário aprovado e agendado para ${job.delay_seconds}s.`
        : "Rascunho do 1º comentário salvo como 'pending_approval'. Aprove explicitamente no Estúdio Social Media para liberar o disparo.",
    };
  }

  if (toolName === "meta_excluir_midia") {
    const mediaId = readStringArg(args, "media_id", "mediaId") ?? "";
    const confirmText =
      readStringArg(args, "confirm_media_id", "confirm_text", "confirmMediaId") ?? "";
    const deletionService = new MetaMediaDeletionService({
      db: deps.db,
      vault: deps.vault,
      nativeStore: ctx.nativeStore ?? deps.nativeStore,
      wsHub: deps.wsHub,
      fetchImpl: deps.fetchImpl,
    });
    return await deletionService.deletePublishedMedia({
      mediaId,
      approvedByHuman: args.approved_by_human === true,
      confirmText,
      actorLabel: deps.agenteId ? `agente:${deps.agenteId}` : "sistema",
      reason: readStringArg(args, "reason"),
      contaId: readStringArg(args, "conta_id", "contaId") ?? null,
    });
  }

  throw new Error(`Ferramenta Meta 2026 não suportada: ${toolName}`);
}
