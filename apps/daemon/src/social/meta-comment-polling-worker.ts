import { resolveMetaGraphApiBase } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { NativeAppConnectionsStore } from "../marketplace/native-app-connections-store.ts";
import type { VaultService } from "../vault/vault-service.ts";
import { resolveMetaCommentCredentials } from "./meta-comment-dm-client.ts";
import type { MetaCommentDmEngine } from "./meta-comment-dm-engine.ts";
import type { MetaCommentDmService } from "./meta-comment-dm-service.ts";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface GraphCommentItem {
  id?: string;
  text?: string;
  timestamp?: string;
  parent_id?: string;
  from?: { id?: string; username?: string };
}

/**
 * Scanner periódico local (Modo 1 - Polling zero-config) inspirado no padrão
 * paginado do ChatbotX para detectar comentários e recuperar até 7 dias pós-offline.
 */
export class MetaCommentPollingWorker {
  private readonly db: CriativoDatabase;
  private readonly vault?: VaultService;
  private readonly nativeStore?: NativeAppConnectionsStore;
  private readonly engine: MetaCommentDmEngine;
  private readonly service: MetaCommentDmService;
  private readonly fetchImpl: FetchLike;
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(deps: {
    db: CriativoDatabase;
    vault?: VaultService;
    nativeStore?: NativeAppConnectionsStore;
    engine: MetaCommentDmEngine;
    service: MetaCommentDmService;
    fetchImpl?: FetchLike;
  }) {
    this.db = deps.db;
    this.vault = deps.vault;
    this.nativeStore = deps.nativeStore;
    this.engine = deps.engine;
    this.service = deps.service;
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  public start(intervalMs = 45_000): void {
    this.dispose();
    this.timer = setInterval(() => {
      void this.scanOnce();
    }, Math.max(15_000, intervalMs));
    this.timer.unref?.();
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async scanOnce(contaIdOverride?: string): Promise<{ processed: number; recovered: number }> {
    if (this.sweeping) return { processed: 0, recovered: 0 };
    this.sweeping = true;
    try {
      const rules = this.service.listRules(contaIdOverride).filter((r) => r.ativo);
      if (rules.length === 0) return { processed: 0, recovered: 0 };

      const contaId = contaIdOverride || rules[0]?.conta_id || "principal";
      const cfg = this.service.getConnectionConfig(contaId);
      if (!contaIdOverride && cfg.reception_mode !== "polling") {
        return { processed: 0, recovered: 0 };
      }

      const creds = resolveMetaCommentCredentials(this.vault, this.nativeStore, contaId);
      if (!creds.accessToken || !creds.accountId) {
        return { processed: 0, recovered: 0 };
      }

      const mediaIds = this.resolveTargetMediaIds(contaId, rules);
      let processed = 0;
      let recovered = 0;
      const base = resolveMetaGraphApiBase();

      for (const media of mediaIds) {
        const cursorRow = this.db.connection
          .prepare("SELECT last_seen_comment_ts FROM meta_comment_sync_cursors WHERE conta_id = ? AND media_id = ? LIMIT 1;")
          .get(contaId, media.mediaId) as { last_seen_comment_ts: string | null } | undefined;
        const lastSeenMs = cursorRow?.last_seen_comment_ts ? Date.parse(cursorRow.last_seen_comment_ts) : 0;

        let nextUrl: string | null =
          `${base}/${creds.apiVersion}/${encodeURIComponent(media.mediaId)}/comments?fields=id,text,timestamp,parent_id,from{id,username}&limit=50`;
        let newestTs = cursorRow?.last_seen_comment_ts ?? null;
        let pageGuard = 0;

        while (nextUrl && pageGuard < 5) {
          pageGuard += 1;
          const res = await this.fetchImpl(nextUrl, {
            headers: { Authorization: `Bearer ${creds.accessToken}` },
          });
          if (!res.ok) break;
          const json = (await res.json()) as {
            data?: GraphCommentItem[];
            paging?: { next?: string };
          };
          const items = Array.isArray(json.data) ? json.data : [];
          for (const item of items) {
            if (!item.id || !item.text || !item.from?.id) continue;
            const tsIso = item.timestamp || new Date().toISOString();
            const tsMs = Date.parse(tsIso);
            if (Number.isFinite(tsMs) && Date.now() - tsMs > SEVEN_DAYS_MS) continue;
            if (lastSeenMs > 0 && Number.isFinite(tsMs) && tsMs <= lastSeenMs) continue;

            if (!newestTs || Date.parse(tsIso) > Date.parse(newestTs)) {
              newestTs = tsIso;
            }
            const out = await this.engine.handleIncomingComment({
              contaId,
              commentId: item.id,
              mediaId: media.mediaId,
              mediaCreatedAt: media.createdAt,
              parentId: item.parent_id ?? null,
              senderIgId: item.from.id,
              senderUsername: item.from.username ?? null,
              text: item.text,
              timestamp: tsIso,
              isLive: false,
              sourceMode: "polling",
            });
            processed += 1;
            if (out.handled) recovered += 1;
          }
          nextUrl = json.paging?.next ?? null;
        }

        if (newestTs) {
          this.db.connection
            .prepare(
              `INSERT INTO meta_comment_sync_cursors (conta_id, media_id, last_seen_comment_ts, last_cursor, atualizado_em)
               VALUES (?, ?, ?, NULL, ?)
               ON CONFLICT(conta_id, media_id) DO UPDATE SET
                 last_seen_comment_ts = excluded.last_seen_comment_ts,
                 atualizado_em = excluded.atualizado_em;`
            )
            .run(contaId, media.mediaId, newestTs, new Date().toISOString());
        }
      }
      return { processed, recovered };
    } finally {
      this.sweeping = false;
    }
  }

  private resolveTargetMediaIds(
    contaId: string,
    rules: ReturnType<MetaCommentDmService["listRules"]>
  ): Array<{ mediaId: string; createdAt: string | null }> {
    const map = new Map<string, string | null>();
    for (const r of rules) {
      for (const mid of r.target_media_ids) {
        if (mid.trim()) map.set(mid.trim(), null);
      }
    }
    if (rules.some((r) => r.post_scope !== "specific_posts")) {
      const cached = this.db.connection
        .prepare("SELECT media_id, timestamp FROM meta_posts_cache WHERE conta_id = ? OR conta_id IS NULL ORDER BY timestamp DESC LIMIT 20;")
        .all(contaId) as Array<{ media_id: string; timestamp?: string | null }>;
      for (const row of cached) {
        if (row.media_id) map.set(row.media_id, row.timestamp ?? null);
      }
    }
    return Array.from(map.entries()).map(([mediaId, createdAt]) => ({ mediaId, createdAt }));
  }
}
