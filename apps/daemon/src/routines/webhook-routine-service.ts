import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type {
  AgentRoutine,
  EventEnvelope,
  EventFilter,
  RoutineWebhookConfig,
  WebhookTestResult,
} from "@criativo/contracts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { RoutineExecutionService } from "./routine-execution-service.ts";
import type { RoutineStore } from "./routine-store.ts";
import {
  extractWebhookHeaders,
  matchesWebhookFilters,
  verifyWebhookHmacSignature,
  wrapExternalEventInstruction,
} from "./webhook-verifier.ts";

export interface WebhookRoutineServiceOptions {
  routineStore: RoutineStore;
  vault: VaultService;
  executionService: RoutineExecutionService;
  wsHub: WebSocketHub;
}

export function vaultKeyForRoutineWebhook(rotinaId: string): string {
  return `webhook_rotina_${rotinaId}`;
}

/**
 * Gerencia provisionamento de URL/secrets cifrados no Cofre AES-256-GCM,
 * validação criptográfica de webhooks recebidos e teste local assinado.
 */
export class WebhookRoutineService {
  private readonly routineStore: RoutineStore;
  private readonly vault: VaultService;
  private readonly executionService: RoutineExecutionService;
  private readonly wsHub: WebSocketHub;

  constructor(options: WebhookRoutineServiceOptions) {
    this.routineStore = options.routineStore;
    this.vault = options.vault;
    this.executionService = options.executionService;
    this.wsHub = options.wsHub;
  }

  public generateHmacSecret(): string {
    return `whsec_${randomBytes(32).toString("hex")}`;
  }

  public generateRouteToken(): string {
    return randomBytes(24).toString("base64url");
  }

  public provisionWebhook(
    routine: AgentRoutine,
    cfg: { event_type?: string | null; filters?: EventFilter[] } = {}
  ): { webhook: RoutineWebhookConfig; secretOnce: string | null } {
    const existing = this.routineStore.getWebhookByRoutine(routine.rotina_id);
    const keyName = existing?.vault_secret_key ?? vaultKeyForRoutineWebhook(routine.rotina_id);
    const hasSecret = Boolean(this.vault.getSecret(keyName));

    let secretOnce: string | null = null;
    if (!hasSecret) {
      secretOnce = this.generateHmacSecret();
      this.vault.setSecret(keyName, secretOnce);
    }

    const saved = this.routineStore.upsertWebhook({
      rotina_id: routine.rotina_id,
      owner_kind: routine.owner_kind,
      owner_id: routine.owner_id,
      route_token: existing?.route_token ?? this.generateRouteToken(),
      event_type:
        cfg.event_type !== undefined ? cfg.event_type : existing?.event_type ?? null,
      filters: cfg.filters !== undefined ? cfg.filters : existing?.filters ?? [],
      vault_secret_key: keyName,
    });

    return {
      webhook: {
        webhook_id: saved.webhook_id,
        route_token: saved.route_token,
        url: saved.url,
        event_type: saved.event_type,
        filters: saved.filters,
        ultimo_disparo_em: saved.ultimo_disparo_em,
      },
      secretOnce,
    };
  }

  public rotateSecret(rotinaId: string): { secret: string; webhook: RoutineWebhookConfig } {
    const existing = this.routineStore.getWebhookByRoutine(rotinaId);
    if (!existing) {
      throw new Error(`Webhook da rotina '${rotinaId}' não encontrado.`);
    }

    const nextSecret = this.generateHmacSecret();
    this.vault.setSecret(existing.vault_secret_key, nextSecret);

    return {
      secret: nextSecret,
      webhook: {
        webhook_id: existing.webhook_id,
        route_token: existing.route_token,
        url: existing.url,
        event_type: existing.event_type,
        filters: existing.filters,
        ultimo_disparo_em: existing.ultimo_disparo_em,
      },
    };
  }

  public setCustomSecret(rotinaId: string, secret: string): RoutineWebhookConfig {
    const clean = secret.trim();
    if (clean.length < 8) {
      throw new Error("O segredo HMAC deve conter ao menos 8 caracteres.");
    }
    const existing = this.routineStore.getWebhookByRoutine(rotinaId);
    if (!existing) {
      throw new Error(`Webhook da rotina '${rotinaId}' não encontrado.`);
    }
    this.vault.setSecret(existing.vault_secret_key, clean);

    return {
      webhook_id: existing.webhook_id,
      route_token: existing.route_token,
      url: existing.url,
      event_type: existing.event_type,
      filters: existing.filters,
      ultimo_disparo_em: existing.ultimo_disparo_em,
    };
  }

  public removeWebhook(rotinaId: string): void {
    const existing = this.routineStore.getWebhookByRoutine(rotinaId);
    const keyName = existing?.vault_secret_key ?? vaultKeyForRoutineWebhook(rotinaId);
    this.vault.deleteSecret(keyName);
    this.routineStore.deleteWebhookByRoutine(rotinaId);
  }

  public async processIncomingWebhook(params: {
    routeToken: string;
    headers: IncomingHttpHeaders;
    rawBody: Buffer;
    nowMs?: number;
  }): Promise<{
    httpStatus: number;
    body: Record<string, unknown>;
  }> {
    const webhook = this.routineStore.getWebhookByToken(params.routeToken);
    if (!webhook) {
      return {
        httpStatus: 404,
        body: { erro: "Webhook não encontrado." },
      };
    }

    const routine = this.routineStore.getById(webhook.rotina_id);
    if (!routine) {
      return {
        httpStatus: 404,
        body: { erro: "Rotina associada ao webhook não encontrada." },
      };
    }

    const secret = this.vault.getSecret(webhook.vault_secret_key);
    if (!secret) {
      return {
        httpStatus: 401,
        body: { erro: "Segredo de verificação HMAC não configurado no Cofre." },
      };
    }

    const extracted = extractWebhookHeaders(params.headers);
    if (!extracted) {
      return {
        httpStatus: 401,
        body: {
          erro: "Cabeçalhos de autenticação HMAC ausentes (X-Criativo-* ou Standard Webhooks).",
        },
      };
    }

    const rawBodyUtf8 = params.rawBody.toString("utf8");
    const sigCheck = verifyWebhookHmacSignature({
      secret,
      timestamp: extracted.timestamp,
      deliveryId: extracted.deliveryId,
      rawBodyUtf8,
      signatureHeader: extracted.signature,
      scheme: extracted.scheme,
      nowMs: params.nowMs,
    });

    if (!sigCheck.ok) {
      return {
        httpStatus: 401,
        body: { erro: sigCheck.error ?? "Assinatura HMAC inválida." },
      };
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBodyUtf8);
    } catch {
      return {
        httpStatus: 400,
        body: { erro: "Corpo JSON inválido no webhook." },
      };
    }

    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return {
        httpStatus: 400,
        body: { erro: "O corpo do webhook deve ser um objeto JSON válido." },
      };
    }

    const record = parsedBody as Record<string, unknown>;
    const eventType =
      typeof record.type === "string" && record.type.trim().length > 0
        ? record.type.trim()
        : "event";
    const occurredAt =
      typeof record.occurredAt === "string"
        ? record.occurredAt
        : typeof record.occurred_at === "string"
          ? record.occurred_at
          : null;
    const payloadData =
      "data" in record && record.data !== undefined ? record.data : record;

    // Deduplicação na janela de 7 dias
    this.routineStore.pruneExpiredReceipts(7);
    if (
      this.routineStore.hasWebhookReceipt(
        routine.owner_kind,
        routine.rotina_id,
        extracted.deliveryId
      )
    ) {
      return {
        httpStatus: 200,
        body: {
          status: "duplicate",
          delivery_id: extracted.deliveryId,
        },
      };
    }

    if (!routine.ativa) {
      const receipt = this.routineStore.recordWebhookReceipt({
        rotina_id: routine.rotina_id,
        owner_kind: routine.owner_kind,
        delivery_id: extracted.deliveryId,
        event_type: eventType,
        status: "ignored",
        reason: "inactive",
        execucao_id: null,
      });

      this.wsHub.broadcast("routine:webhook_received", {
        rotina_id: routine.rotina_id,
        recibo_id: receipt.recibo_id,
        status: "ignored",
        reason: "inactive",
      });

      return {
        httpStatus: 200,
        body: {
          status: "ignored",
          reason: "inactive",
          recibo_id: receipt.recibo_id,
        },
      };
    }

    const filterCheck = matchesWebhookFilters(
      payloadData,
      eventType,
      webhook.event_type,
      webhook.filters
    );

    if (!filterCheck.matched) {
      const receipt = this.routineStore.recordWebhookReceipt({
        rotina_id: routine.rotina_id,
        owner_kind: routine.owner_kind,
        delivery_id: extracted.deliveryId,
        event_type: eventType,
        status: "ignored",
        reason: filterCheck.reason,
        execucao_id: null,
      });

      this.wsHub.broadcast("routine:webhook_received", {
        rotina_id: routine.rotina_id,
        recibo_id: receipt.recibo_id,
        status: "ignored",
        reason: filterCheck.reason,
      });

      return {
        httpStatus: 200,
        body: {
          status: "ignored",
          reason: filterCheck.reason,
          recibo_id: receipt.recibo_id,
        },
      };
    }

    const receivedAt = new Date().toISOString();
    const envelope: EventEnvelope = {
      version: 1,
      id: extracted.deliveryId,
      routineId: routine.rotina_id,
      type: eventType,
      occurredAt,
      receivedAt,
      data: payloadData,
    };

    const wrappedPrompt = wrapExternalEventInstruction(routine.instrucao, envelope);
    const exec = this.executionService.enqueueManualRun({
      rotinaId: routine.rotina_id,
      runSource: "webhook",
      instrucaoOverride: wrappedPrompt,
      scheduledFor: receivedAt,
    });

    const receipt = this.routineStore.recordWebhookReceipt({
      rotina_id: routine.rotina_id,
      owner_kind: routine.owner_kind,
      delivery_id: extracted.deliveryId,
      event_type: eventType,
      status: "started",
      reason: null,
      execucao_id: exec.execucao_id,
      recebido_em: receivedAt,
    });

    this.routineStore.touchWebhookLastTrigger(routine.rotina_id, receivedAt);

    this.wsHub.broadcast("routine:webhook_received", {
      rotina_id: routine.rotina_id,
      recibo_id: receipt.recibo_id,
      status: "started",
      reason: null,
    });

    return {
      httpStatus: 202,
      body: {
        status: "accepted",
        execucao_id: exec.execucao_id,
        recibo_id: receipt.recibo_id,
      },
    };
  }

  public async sendTestWebhook(
    rotinaId: string,
    customPayload?: { type?: string; data?: unknown }
  ): Promise<WebhookTestResult> {
    const webhook = this.routineStore.getWebhookByRoutine(rotinaId);
    if (!webhook) {
      throw new Error(`Webhook da rotina '${rotinaId}' não encontrado.`);
    }
    const secret = this.vault.getSecret(webhook.vault_secret_key);
    if (!secret) {
      throw new Error("Segredo HMAC não encontrado no Cofre para disparar o teste.");
    }

    const eventType = customPayload?.type ?? webhook.event_type ?? "teste.simulado";
    const bodyObj = {
      type: eventType,
      occurredAt: new Date().toISOString(),
      data: customPayload?.data ?? { origem: "teste_cockpit", rotina_id: rotinaId },
    };
    const rawBody = Buffer.from(JSON.stringify(bodyObj), "utf8");
    const ts = String(Math.floor(Date.now() / 1000));
    const deliveryId = `test-${randomUUID()}`;
    const signatureHex = createHmac("sha256", secret)
      .update(`${ts}.${deliveryId}.${rawBody.toString("utf8")}`, "utf8")
      .digest("hex");

    const result = await this.processIncomingWebhook({
      routeToken: webhook.route_token,
      headers: {
        "x-criativo-timestamp": ts,
        "x-criativo-delivery-id": deliveryId,
        "x-criativo-signature": `sha256=${signatureHex}`,
      },
      rawBody,
    });

    return {
      ok: result.httpStatus === 202,
      http_status: result.httpStatus,
      status:
        result.httpStatus === 202
          ? "accepted"
          : result.body.status === "duplicate"
            ? "duplicate"
            : result.body.status === "ignored"
              ? "ignored"
              : "rejected",
      reason:
        typeof result.body.reason === "string"
          ? result.body.reason
          : typeof result.body.erro === "string"
            ? result.body.erro
            : null,
      execucao_id:
        typeof result.body.execucao_id === "string" ? result.body.execucao_id : null,
      recibo_id:
        typeof result.body.recibo_id === "string" ? result.body.recibo_id : null,
    };
  }
}
