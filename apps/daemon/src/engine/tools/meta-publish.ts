import type { FetchLike } from "../providers/provider-interface.ts";
import type { VaultService } from "../../vault/vault-service.ts";

export interface MetaPublishParams {
  media_type: "IMAGE" | "CAROUSEL" | "REELS" | "STORIES";
  media_urls: string[];
  caption: string;
  approved_by_human: boolean;
}

export interface MetaPublishResult {
  published: boolean;
  media_id: string;
  permalink: string;
}

/**
 * Publicador seguro da Meta Graph API.
 * Invariante crítica de segurança (AI-SPEC.md):
 * JAMAIS publica na conta do usuário sem `approved_by_human === true`.
 */
export async function metaPublishTool(
  params: MetaPublishParams,
  deps: { vault: VaultService; fetchImpl?: FetchLike }
): Promise<MetaPublishResult> {
  if (params.approved_by_human !== true) {
    throw new Error(
      "BLOQUEIO DE SEGURANÇA: A publicação oficial na Meta Graph API requer aprovação humana explícita (approved_by_human = true)."
    );
  }

  const accessToken =
    deps.vault.getSecret("instagram_access_token") ||
    deps.vault.getSecret("META_ACCESS_TOKEN");
  const igUserId =
    deps.vault.getSecret("instagram_business_account_id") ||
    deps.vault.getSecret("META_IG_USER_ID");
  if (!accessToken || !igUserId) {
    throw new Error(
      "Credenciais Meta (instagram_access_token/META_ACCESS_TOKEN ou instagram_business_account_id/META_IG_USER_ID) ausentes no Cofre de Segredos."
    );
  }

  const fetchFn = deps.fetchImpl ?? fetch;
  const graphBase = "https://graph.facebook.com/v21.0";

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

  return {
    published: true,
    media_id: publishData.id,
    permalink: `https://www.instagram.com/p/${publishData.id}/`,
  };
}
