import { resolveMetaGraphApiBase } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { NativeAppConnectionsStore } from "../../marketplace/native-app-connections-store.ts";
import { EditorialCalendarService } from "../../social/editorial-calendar-service.ts";
import type { FetchLike } from "../providers/provider-interface.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import { resolveMetaCredentials } from "./meta-insights.ts";

export interface MetaPublishParams {
  media_type: "IMAGE" | "CAROUSEL" | "REELS" | "STORIES";
  media_urls: string[];
  caption: string;
  approved_by_human: boolean;
  conta_id?: string;
  editorial_post_id?: string;
}

export interface MetaPublishResult {
  published: boolean;
  media_id: string;
  permalink: string;
  editorial_post_id?: string | null;
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

  // 1. Criação do container de mídia
  const containerRes = await fetchFn(
    `${graphBase}/${encodeURIComponent(igUserId)}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: params.media_type === "IMAGE" || params.media_type === "STORIES" ? params.media_urls[0] : undefined,
        video_url: params.media_type === "REELS" ? params.media_urls[0] : undefined,
        media_type: params.media_type === "REELS" ? "REELS" : params.media_type === "STORIES" ? "STORIES" : undefined,
        caption: params.caption,
        access_token: accessToken,
      }),
    }
  );
  const containerData = (await containerRes.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!containerRes.ok || !containerData.id) {
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

  return {
    published: true,
    media_id: publishData.id,
    permalink: `https://www.instagram.com/p/${publishData.id}/`,
    ...(linkedEditorialId ? { editorial_post_id: linkedEditorialId } : {}),
  };
}
