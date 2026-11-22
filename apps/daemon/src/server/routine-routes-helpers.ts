import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";
import type {
  EventFilter,
  RoutineOwnerKind,
  RoutineResultDestination,
} from "@criativo/contracts";
import {
  isEventFilter,
  isRoutineResultDestination,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import {
  RoutineFlowStore,
  RoutineFlowStoreError,
} from "../routines/routine-flow-store.ts";
import type {
  RoutineFlowsEngine,
} from "../routines/routine-flows-engine.ts";
import type {
  RoutineExecutionService,
} from "../routines/routine-execution-service.ts";
import type {
  RoutineResultDispatcher,
} from "../routines/routine-result-dispatcher.ts";
import {
  RoutineStore,
  RoutineStoreError,
} from "../routines/routine-store.ts";
import type {
  RoutineTimer,
} from "../routines/routine-timer.ts";
import type {
  WebhookRoutineService,
} from "../routines/webhook-routine-service.ts";
import type {
  WebSocketHub,
} from "./websocket-hub.ts";

export interface RoutineRoutesDeps {
  db: CriativoDatabase;
  routineStore: RoutineStore;
  flowStore: RoutineFlowStore;
  timer: RoutineTimer;
  resultDispatcher: RoutineResultDispatcher;
  executionService: RoutineExecutionService;
  webhookService: WebhookRoutineService;
  flowsEngine: RoutineFlowsEngine;
  wsHub: WebSocketHub;
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  readJsonBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
}

export function normalizeOwnerKind(raw: unknown): RoutineOwnerKind {
  if (raw === "canal" || raw === "channel") return "canal";
  return "agente";
}

export function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
}

export function parseBooleanQuery(raw: string | null): boolean {
  return raw === "true" || raw === "1" || raw === "sim";
}

export function sanitizeFilters(raw: unknown): EventFilter[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isEventFilter);
}

export function parseOptionalDestination(raw: unknown): RoutineResultDestination | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (isRoutineResultDestination(raw)) return raw;
  return undefined;
}

export function buildErrorResponse(res: ServerResponse, sendJson: RoutineRoutesDeps["sendJson"], error: unknown): void {
  if (error instanceof RoutineStoreError || error instanceof RoutineFlowStoreError) {
    sendJson(res, error.statusCode, { erro: error.message, code: error.code });
    return;
  }
  const msg = error instanceof Error ? error.message : String(error);
  sendJson(res, 400, { erro: msg });
}

