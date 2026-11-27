import { randomUUID } from "node:crypto";
import {
  resolveMetaGraphApiBase,
  type MetaMediaAuditAction,
  type MetaMediaAuditLogRecord,
  type MetaMediaAuditOutcome,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import { resolveMetaCredentials } from "../engine/tools/meta-insights.ts";
import type { NativeAppConnectionsStore } from "../marketplace/native-app-connections-store.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { VaultService } from "../vault/vault-service.ts";

export interface MetaMediaDeletionInput {
  mediaId: string;
  approvedByHuman: boolean;
  confirmText: string;
  actorLabel?: string;
  reason?: string;
  contaId?: string | null;
  removeFromLocalCacheOnUnsupported?: boolean;
}

export interface MetaMediaDeletionResult {
  ok: boolean;
  deleted_remote: boolean;
  removed_local_cache: boolean;
  media_id: string;
  audit_id: string;
  limitation_code?: "META_DELETE_UNSUPPORTED" | "META_API_ERROR" | "CONFIRMATION_REQUIRED";
  message: string;
}

interface AuditRow {
  audit_id: string;
  media_id: string;
  editorial_post_id: string | null;
  conta_id: string | null;
  action: MetaMediaAuditAction;
  actor_label: string;
  confirmed_by_human: number;
  http_status: number | null;
  graph_error_code: string | null;
  outcome: MetaMediaAuditOutcome;
  reason: string;
  detail_json: string;
  criado_em: string;
}

const VALID_AUDIT_ACTIONS = new Set<MetaMediaAuditAction>([
  "publish",
  "trial_reel",
  "first_comment",
  "delete_media",
  "cache_remove",
]);

function mapAuditRow(row: AuditRow): MetaMediaAuditLogRecord {
  return {
    audit_id: row.audit_id,
    media_id: row.media_id,
    editorial_post_id: row.editorial_post_id ?? null,
    conta_id: row.conta_id ?? null,
    action: row.action,
    actor_label: row.actor_label,
    confirmed_by_human: Number(row.confirmed_by_human) === 1,
    http_status: row.http_status ?? null,
    graph_error_code: row.graph_error_code ?? null,
    outcome: row.outcome,
    reason: row.reason ?? "",
    detail_json: row.detail_json ?? "{}",
    criado_em: row.criado_em,
  };
}

function isMetaDeleteUnsupportedError(
  errorPayload: { message?: string; code?: number; error_subcode?: number } | undefined
): boolean {
  const code = errorPayload?.code;
  const subcode = errorPayload?.error_subcode;
  const msg = (errorPayload?.message ?? "").toLowerCase();
  return (
    subcode === 2207085 ||
    code === 10 ||
    code === 200 ||
    msg.includes("unsupported delete request") ||
    msg.includes("does not support")
  );
}

export interface MetaMediaDeletionServiceDeps {
  db: CriativoDatabase;
  vault?: VaultService;
  nativeStore?: NativeAppConnectionsStore;
  wsHub?: WebSocketHub;
  fetchImpl?: FetchLike;
}

/**
 * Serviço de exclusão controlada de mídia publicada na Meta Graph API v27.0
 * com dupla confirmação humana obrigatória e trilha de auditoria sanitizada.
 */
export class MetaMediaDeletionService {
  private readonly db: CriativoDatabase;
  private readonly vault?: VaultService;
  private readonly nativeStore?: NativeAppConnectionsStore;
  private readonly wsHub?: WebSocketHub;
  private readonly fetchImpl?: FetchLike;

  constructor(deps: MetaMediaDeletionServiceDeps) {
    this.db = deps.db;
    this.vault = deps.vault;
    this.nativeStore = deps.nativeStore;
    this.wsHub = deps.wsHub;
    this.fetchImpl = deps.fetchImpl;
  }

  private redactTokens(text: string, token?: string | null): string {
    let clean = text
      .replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]");
    if (token && token.trim().length > 0) {
      clean = clean.split(token.trim()).join("[REDACTED]");
    }
    return clean;
  }

  public recordAudit(input: {
    mediaId: string;
    editorialPostId?: string | null;
    contaId?: string | null;
    action: MetaMediaAuditAction;
    actorLabel: string;
    confirmedByHuman: boolean;
    httpStatus?: number | null;
    graphErrorCode?: string | null;
    outcome: MetaMediaAuditOutcome;
    reason: string;
    detail?: Record<string, unknown>;
    tokenToRedact?: string | null;
  }): string {
    const auditId = `aud-${randomUUID().slice(0, 12)}`;
    const agora = new Date().toISOString();
    const safeReason = this.redactTokens(input.reason, input.tokenToRedact);
    const safeDetailJson = this.redactTokens(
      JSON.stringify(input.detail ?? {}),
      input.tokenToRedact
    );

    this.db.connection
      .prepare(
        `INSERT INTO meta_media_audit_logs (
          audit_id, media_id, editorial_post_id, conta_id, action, actor_label,
          confirmed_by_human, http_status, graph_error_code, outcome, reason, detail_json, criado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        auditId,
        input.mediaId,
        input.editorialPostId ?? null,
        input.contaId ?? null,
        input.action,
        input.actorLabel,
        input.confirmedByHuman ? 1 : 0,
        input.httpStatus ?? null,
        input.graphErrorCode ?? null,
        input.outcome,
        safeReason,
        safeDetailJson,
        agora
      );

    const payloadJson = this.redactTokens(
      JSON.stringify({
        audit_id: auditId,
        media_id: input.mediaId,
        action: input.action,
        actor_label: input.actorLabel,
        confirmed_by_human: input.confirmedByHuman,
        http_status: input.httpStatus ?? null,
        graph_error_code: input.graphErrorCode ?? null,
        outcome: input.outcome,
        reason: safeReason,
      }),
      input.tokenToRedact
    );

    this.db.connection
      .prepare(
        `INSERT INTO eventos_orquestracao (
          evento_id, comando_id, tipo_agregado, agregado_id, tipo_evento, ocorrido_em, payload_json
        ) VALUES (?, ?, 'meta_media', ?, 'meta.media_audit', ?, ?);`
      )
      .run(`evt-${randomUUID().slice(0, 12)}`, auditId, input.mediaId, agora, payloadJson);

    this.wsHub?.broadcast("meta:media_audit_updated", {
      audit_id: auditId,
      media_id: input.mediaId,
      action: input.action,
      outcome: input.outcome,
    });

    return auditId;
  }

  public listAuditLogs(filters?: {
    mediaId?: string;
    action?: string;
    limit?: number;
  }): MetaMediaAuditLogRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters?.mediaId?.trim()) {
      clauses.push("media_id = ?");
      params.push(filters.mediaId.trim());
    }
    if (filters?.action && VALID_AUDIT_ACTIONS.has(filters.action as MetaMediaAuditAction)) {
      clauses.push("action = ?");
      params.push(filters.action);
    }

    const limit =
      typeof filters?.limit === "number" && Number.isFinite(filters.limit)
        ? Math.max(1, Math.min(200, Math.round(filters.limit)))
        : 50;
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM meta_media_audit_logs ${where} ORDER BY criado_em DESC LIMIT ?;`
      )
      .all(...params, limit) as unknown as AuditRow[];

    return rows.map(mapAuditRow);
  }

  public async deletePublishedMedia(
    input: MetaMediaDeletionInput
  ): Promise<MetaMediaDeletionResult> {
    const mediaId = String(input.mediaId ?? "").trim();
    if (!mediaId) {
      throw new Error("Parâmetro 'media_id' é obrigatório para excluir mídia publicada.");
    }

    const actorLabel = input.actorLabel?.trim() || "operador_cockpit";
    const confirmTrimmed = String(input.confirmText ?? "").trim();
    const doubleConfirmed =
      input.approvedByHuman === true &&
      (confirmTrimmed === mediaId || confirmTrimmed.toUpperCase() === "EXCLUIR");

    if (!doubleConfirmed) {
      this.recordAudit({
        mediaId,
        contaId: input.contaId ?? null,
        action: "delete_media",
        actorLabel,
        confirmedByHuman: false,
        outcome: "blocked",
        reason: input.reason?.trim()
          ? `Bloqueado sem dupla confirmação (${input.reason.trim()})`
          : "Exclusão bloqueada por ausência de dupla confirmação humana.",
        detail: { approved_by_human: input.approvedByHuman === true },
      });
      throw new Error(
        "BLOQUEIO DE SEGURANÇA: Exclusão de mídia Meta exige approved_by_human=true e confirmação explícita com o media_id ou 'EXCLUIR'."
      );
    }

    const creds = resolveMetaCredentials(this.vault, this.nativeStore, input.contaId);
    if (!creds.accessToken) {
      this.recordAudit({
        mediaId,
        contaId: input.contaId ?? null,
        action: "delete_media",
        actorLabel,
        confirmedByHuman: true,
        graphErrorCode: "CRV-META-001",
        outcome: "failed",
        reason: "Credenciais Meta ausentes no Cofre AES-256-GCM.",
      });
      throw new Error("CRV-META-001: Credenciais Meta ausentes no Cofre AES-256-GCM.");
    }

    const editorialRow = this.db.connection
      .prepare("SELECT id FROM calendario_editorial_posts WHERE meta_media_id = ? LIMIT 1;")
      .get(mediaId) as { id?: string } | undefined;
    const editorialPostId = editorialRow?.id ?? null;

    const fetchFn = this.fetchImpl ?? fetch;
    const graphBase = resolveMetaGraphApiBase();
    const deleteUrl = `${graphBase}/${encodeURIComponent(mediaId)}?access_token=${encodeURIComponent(creds.accessToken)}`;

    try {
      const res = await fetchFn(deleteUrl, { method: "DELETE" });
      const rawText = await res.text();
      let parsed: {
        success?: boolean;
        error?: { message?: string; code?: number; error_subcode?: number };
      } = {};
      try {
        parsed = rawText ? (JSON.parse(rawText) as typeof parsed) : {};
      } catch {
        parsed = {};
      }

      if (res.ok && parsed.success !== false) {
        const agora = new Date().toISOString();
        this.db.runInTransaction(() => {
          this.db.connection
            .prepare("DELETE FROM meta_posts_cache WHERE media_id = ?;")
            .run(mediaId);
          this.db.connection
            .prepare(
              "UPDATE calendario_editorial_posts SET meta_media_id = NULL, atualizado_em = ? WHERE meta_media_id = ?;"
            )
            .run(agora, mediaId);
          this.db.connection
            .prepare(
              "UPDATE meta_first_comments_queue SET status = 'cancelled', atualizado_em = ? WHERE media_id = ? AND status IN ('pending_approval', 'scheduled');"
            )
            .run(agora, mediaId);
        });

        const auditId = this.recordAudit({
          mediaId,
          editorialPostId,
          contaId: input.contaId ?? null,
          action: "delete_media",
          actorLabel,
          confirmedByHuman: true,
          httpStatus: res.status,
          outcome: "deleted_remote",
          reason: input.reason?.trim() || "Mídia excluída na Meta Graph API e cache local limpo.",
          detail: { removed_local_cache: true, editorial_post_id: editorialPostId },
          tokenToRedact: creds.accessToken,
        });

        return {
          ok: true,
          deleted_remote: true,
          removed_local_cache: true,
          media_id: mediaId,
          audit_id: auditId,
          message: "Mídia excluída com sucesso na Meta Graph API e removida do cache local.",
        };
      }

      const graphCode =
        parsed.error?.error_subcode !== undefined
          ? `${parsed.error.code ?? "err"}:${parsed.error.error_subcode}`
          : parsed.error?.code !== undefined
            ? String(parsed.error.code)
            : null;

      if (isMetaDeleteUnsupportedError(parsed.error)) {
        const removeLocal = input.removeFromLocalCacheOnUnsupported === true;
        if (removeLocal) {
          this.db.connection
            .prepare("DELETE FROM meta_posts_cache WHERE media_id = ?;")
            .run(mediaId);
        }
        const safeApiMsg = this.redactTokens(
          parsed.error?.message ?? `HTTP ${res.status}`,
          creds.accessToken
        );
        const auditId = this.recordAudit({
          mediaId,
          editorialPostId,
          contaId: input.contaId ?? null,
          action: "delete_media",
          actorLabel,
          confirmedByHuman: true,
          httpStatus: res.status,
          graphErrorCode: graphCode,
          outcome: "unsupported_by_meta_api",
          reason: `Limitação Meta API (${graphCode ?? res.status}): ${safeApiMsg}`,
          detail: { removed_local_cache: removeLocal },
          tokenToRedact: creds.accessToken,
        });

        return {
          ok: false,
          deleted_remote: false,
          removed_local_cache: removeLocal,
          media_id: mediaId,
          audit_id: auditId,
          limitation_code: "META_DELETE_UNSUPPORTED",
          message:
            "A Meta Graph API v27.0 não permitiu excluir esta mídia remotamente (restrição de permissão ou Instagram Login). Exclua diretamente no aplicativo Instagram ou no Meta Business Suite.",
        };
      }

      const errReason = this.redactTokens(
        parsed.error?.message ?? `Erro ao excluir mídia na Meta API: HTTP ${res.status}`,
        creds.accessToken
      );
      const auditId = this.recordAudit({
        mediaId,
        editorialPostId,
        contaId: input.contaId ?? null,
        action: "delete_media",
        actorLabel,
        confirmedByHuman: true,
        httpStatus: res.status,
        graphErrorCode: graphCode,
        outcome: "failed",
        reason: errReason,
        detail: { http_status: res.status },
        tokenToRedact: creds.accessToken,
      });

      return {
        ok: false,
        deleted_remote: false,
        removed_local_cache: false,
        media_id: mediaId,
        audit_id: auditId,
        limitation_code: "META_API_ERROR",
        message: errReason,
      };
    } catch (err) {
      const errReason = this.redactTokens(
        err instanceof Error ? err.message : "Erro de rede ao excluir mídia na Meta API.",
        creds.accessToken
      );
      const auditId = this.recordAudit({
        mediaId,
        editorialPostId,
        contaId: input.contaId ?? null,
        action: "delete_media",
        actorLabel,
        confirmedByHuman: true,
        outcome: "failed",
        reason: errReason,
        tokenToRedact: creds.accessToken,
      });

      return {
        ok: false,
        deleted_remote: false,
        removed_local_cache: false,
        media_id: mediaId,
        audit_id: auditId,
        limitation_code: "META_API_ERROR",
        message: errReason,
      };
    }
  }
}
