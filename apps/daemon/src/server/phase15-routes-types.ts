/**
 * Sub-router HTTP REST da Fase 15:
 * Navegador Chromium CDP, Perfis/Proxies, BrowserTakeover, submit_secret, BrowserTeachBar,
 * Mídia (read_video / capture_screen), Duplicação & Failover de Agentes, Sidebar,
 * Configurações & Armazenamento, Conectores (Slack/Discord/GitHub) e Showcase Local.
 */
import { randomUUID } from "node:crypto";
import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import {
  BackupModelsResolver,
} from "../engine/runner/backup-models-resolver.ts";
import type {
  BrowserAutomationService,
} from "../engine/tools/browser-automation.ts";
import type {
  HumanCdpInputEvent,
} from "../engine/tools/browser-cdp-session.ts";
import type {
  ScreenCaptureBridge,
} from "../engine/tools/screen-capture-bridge.ts";
import type {
  ProviderRegistry,
} from "../engine/providers/provider-registry.ts";
import type {
  ProviderConnectionService,
} from "../providers/provider-connection-service.ts";
import {
  TranscriptionService,
} from "../voice/transcription-service.ts";
import type {
  ConnectorsWebhookService,
} from "./connectors-webhook-service.ts";
import type {
  ShowcaseSiteService,
} from "./showcase-service.ts";
import {
  type StudioRoutesDeps,
} from "./studio-routes.ts";
import type {
  WebSocketHub,
} from "./websocket-hub.ts";

export interface Phase15RouteContext {
  db: CriativoDatabase;
  wsHub: WebSocketHub;
  workspaceRoot: string;
  providers: ProviderRegistry;
  providerConnection: ProviderConnectionService;
  browserService: BrowserAutomationService;
  screenCapture: ScreenCaptureBridge;
  showcaseService: ShowcaseSiteService;
  connectorsWebhook: ConnectorsWebhookService;
  transcription?: TranscriptionService;
  backupResolver?: BackupModelsResolver;
  studioRoutesDeps: StudioRoutesDeps;
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  readJsonBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  readRawBody: (req: IncomingMessage) => Promise<Buffer>;
}

export const ALLOWED_HUMAN_INPUT_TYPES = new Set<HumanCdpInputEvent["type"]>([
  "mousePressed",
  "mouseReleased",
  "mouseMoved",
  "wheel",
  "keyDown",
  "keyUp",
  "insertText",
]);

export function mapHttpErrorStatus(err: unknown): number {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes("não encontrado") || msg.includes("não encontrada")) return 404;
  if (
    msg.includes("recusado") ||
    msg.includes("negado") ||
    msg.includes("bloqueado") ||
    msg.includes("proibido") ||
    msg.includes("exige confirmação")
  ) {
    return 403;
  }
  return 400;
}

