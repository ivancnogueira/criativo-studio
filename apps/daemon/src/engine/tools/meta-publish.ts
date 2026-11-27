import {
  resolveMetaGraphApiBase,
  type MetaFirstCommentStatus,
  type MetaTrialGraduationStrategy,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { NativeAppConnectionsStore } from "../../marketplace/native-app-connections-store.ts";
import { EditorialCalendarService } from "../../social/editorial-calendar-service.ts";
import { MetaFirstCommentService } from "../../social/meta-first-comment-service.ts";
import type { FetchLike } from "../providers/provider-interface.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import { resolveMetaCredentials } from "./meta-insights.ts";
import {
  checkMetaTrialReelEligibility,
  mapTrialReelContainerError,
} from "./meta-trial-eligibility.ts";

export interface MetaPublishParams {
  media_type: "IMAGE" | "CAROUSEL" | "REELS" | "STORIES";
  media_urls: string[];
  caption: string;
  approved_by_human: boolean;
  conta_id?: string;
  editorial_post_id?: string;
  trial_reel?: boolean;
  trial_graduation_strategy?: MetaTrialGraduationStrategy;
  first_comment?: string;
  first_comment_approved?: boolean;
  first_comment_delay_seconds?: number;
}

export interface MetaPublishResult {
  published: boolean;
  media_id: string;
  permalink: string;
  editorial_post_id?: string | null;
  is_trial_reel?: boolean;
  trial_graduation_strategy?: MetaTrialGraduationStrategy;
  followers_count_checked?: number | null;
  first_comment_job_id?: string | null;
  first_comment_status?: MetaFirstCommentStatus | null;
}

/**
 * Publicador seguro da Meta Graph API (v27.0).
 * Invariante crítica de segurança (AI-SPEC.md):
 * JAMAIS publica na conta do usuário sem `approved_by_human === true`.
 */
export async function metaPublishTool(
  params: MetaPublishParams,
  deps: {
    vault: VaultService;
    db?: CriativoDatabase;
    nativeStore?: NativeAppConnectionsStore;
    fetchImpl?: FetchLike;
  }
): Promise<MetaPublishResult> {
  if (params.approved_by_human !== true) {
    throw new Error(
      "BLOQUEIO DE SEGURANÇA: A publicação oficial na Meta Graph API requer aprovação humana explícita (approved_by_human = true)."
    );
  }

  const creds = resolveMetaCredentials(deps.vault, deps.nativeStore, params.conta_id);
  const accessToken = creds.accessToken;
  const igUserId = creds.accountId;
  if (!accessToken || !igUserId) {
    throw new Error(
      "Credenciais Meta (instagram_access_token/META_ACCESS_TOKEN ou instagram_business_account_id/META_IG_USER_ID) ausentes no Cofre de Segredos."
    );
  }

  const fetchFn = deps.fetchImpl ?? fetch;
  const graphBase = resolveMetaGraphApiBase();
  const isTrialReel = params.trial_reel === true;
  const trialStrategy: MetaTrialGraduationStrategy =
    params.trial_graduation_strategy === "MANUAL" ? "MANUAL" : "SS_PERFORMANCE";
  let followersCountChecked: number | null | undefined;

  if (isTrialReel) {
    if (params.media_type !== "REELS") {
      throw new Error(
        "CRV-META-TRIAL-TYPE: Trial Reels só são suportados para publicações do tipo REELS (vídeo vertical 9:16)."
      );
    }
    const eligibility = await checkMetaTrialReelEligibility({
      accessToken,
      igUserId,
      fetchImpl: fetchFn,
    });
    if (!eligibility.eligible) {
      throw new Error(
        `${eligibility.error_code ?? "CRV-META-TRIAL-ELIGIBILITY"}: ${eligibility.reason}`
      );
    }
    followersCountChecked = eligibility.followers_count;
  }

  // 1. Criação do container de mídia
  const containerBody: Record<string, unknown> = {
    image_url: params.media_type === "IMAGE" || params.media_type === "STORIES" ? params.media_urls[0] : undefined,
    video_url: params.media_type === "REELS" ? params.media_urls[0] : undefined,
    media_type: params.media_type === "REELS" ? "REELS" : params.media_type === "STORIES" ? "STORIES" : undefined,
    caption: params.caption,
    access_token: accessToken,
    ...(isTrialReel ? { trial_params: { graduation_strategy: trialStrategy } } : {}),
  };

  const containerRes = await fetchFn(
    `${graphBase}/${encodeURIComponent(igUserId)}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(containerBody),
    }
  );
  const containerData = (await containerRes.json()) as {
    id?: string;
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  if (!containerRes.ok || !containerData.id) {
    if (isTrialReel) {
      throw new Error(mapTrialReelContainerError(containerData.error, containerRes.status));
    }
    throw new Error(
      containerData.error?.message ?? `Erro ao criar container Meta API: HTTP ${containerRes.status}`
    );
  }

  // 2. Publicação oficial do container
  const publishRes = await fetchFn(
    `${graphBase}/${encodeURIComponent(igUserId)}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: accessToken,
      }),
    }
  );
  const publishData = (await publishRes.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!publishRes.ok || !publishData.id) {
    throw new Error(
      publishData.error?.message ?? `Erro ao publicar mídia na Meta API: HTTP ${publishRes.status}`
    );
  }

  let linkedEditorialId: string | null = null;
  if (params.editorial_post_id && deps.db) {
    const updated = new EditorialCalendarService(deps.db).markPublished(
      params.editorial_post_id,
      publishData.id
    );
    linkedEditorialId = updated?.id ?? null;
  }

  let firstCommentJobId: string | null = null;
  let firstCommentStatus: MetaFirstCommentStatus | null = null;
  const trimmedFirstComment = params.first_comment?.trim();
  if (trimmedFirstComment && deps.db) {
    const commentService = new MetaFirstCommentService({
      db: deps.db,
      vault: deps.vault,
      nativeStore: deps.nativeStore,
      fetchImpl: fetchFn,
    });
    const job = commentService.enqueueFirstComment({
      mediaId: publishData.id,
      commentText: trimmedFirstComment,
      approvedByHuman: params.first_comment_approved === true,
      delaySeconds: params.first_comment_delay_seconds,
      editorialPostId: params.editorial_post_id ?? null,
      contaId: params.conta_id ?? null,
    });
    firstCommentJobId = job.comment_job_id;
    firstCommentStatus = job.status;
    const effectiveDelay =
      typeof params.first_comment_delay_seconds === "number"
        ? params.first_comment_delay_seconds
        : 30;
    if (params.first_comment_approved === true && effectiveDelay === 0) {
      await commentService.dispatchDueComments();
      const refreshed = commentService.getCommentJob(job.comment_job_id);
      if (refreshed) {
        firstCommentStatus = refreshed.status;
      }
    }
  }

  return {
    published: true,
    media_id: publishData.id,
    permalink: `https://www.instagram.com/p/${publishData.id}/`,
    ...(linkedEditorialId ? { editorial_post_id: linkedEditorialId } : {}),
    ...(isTrialReel
      ? {
          is_trial_reel: true,
          trial_graduation_strategy: trialStrategy,
          followers_count_checked: followersCountChecked ?? null,
        }
      : {}),
    ...(firstCommentJobId
      ? {
          first_comment_job_id: firstCommentJobId,
          first_comment_status: firstCommentStatus,
        }
      : {}),
  };
}
