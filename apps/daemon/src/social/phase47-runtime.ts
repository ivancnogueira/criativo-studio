import type { CriativoDatabase } from "../database/client.ts";
import type { CrmService } from "../crm/crm-service.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { NativeAppConnectionsStore } from "../marketplace/native-app-connections-store.ts";
import type { ShowcaseSiteService } from "../server/showcase-service.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { WorkflowEngine } from "../workflows/workflow-engine.ts";
import { createCommentDmCrmHandoffAdapter, type CreativeAgentReplyExecutor } from "./comment-dm-crm-handoff.ts";
import { DeliverablePublisherService } from "./deliverable-publisher-service.ts";
import { MetaCommentDmClient } from "./meta-comment-dm-client.ts";
import { MetaCommentDmEngine } from "./meta-comment-dm-engine.ts";
import { MetaCommentPollingWorker } from "./meta-comment-polling-worker.ts";
import { MetaCommentDmService } from "./meta-comment-dm-service.ts";
import { MetaRelayClient } from "./meta-relay-client.ts";

export interface Phase47RuntimeHandle {
  client: MetaCommentDmClient;
  engine: MetaCommentDmEngine;
  service: MetaCommentDmService;
  pollingWorker: MetaCommentPollingWorker;
  relayClient: MetaRelayClient;
  deliverablePublisher: DeliverablePublisherService;
  start: () => void;
  dispose: () => void;
}

/**
 * Coordenador único do ciclo de vida da Fase 47 (Automação Comentário -> Direct).
 */
export function createPhase47Runtime(deps: {
  db: CriativoDatabase;
  vault?: VaultService;
  nativeStore?: NativeAppConnectionsStore;
  wsHub?: WebSocketHub;
  workspaceRoot: string;
  showcaseService?: ShowcaseSiteService;
  crmService?: CrmService;
  workflowEngine?: WorkflowEngine;
  agentExecutor?: CreativeAgentReplyExecutor;
  fetchImpl?: FetchLike;
}): Phase47RuntimeHandle {
  const client = new MetaCommentDmClient({
    vault: deps.vault,
    nativeStore: deps.nativeStore,
    fetchImpl: deps.fetchImpl,
  });

  const deliverablePublisher = new DeliverablePublisherService({
    db: deps.db,
    vault: deps.vault,
    showcaseService: deps.showcaseService,
    workspaceRoot: deps.workspaceRoot,
    fetchImpl: deps.fetchImpl,
  });

  const crmHooks = deps.crmService
    ? createCommentDmCrmHandoffAdapter({
        crmService: deps.crmService,
        workflowEngine: deps.workflowEngine,
        client,
        agentExecutor: deps.agentExecutor,
      })
    : undefined;

  const engine = new MetaCommentDmEngine({
    db: deps.db,
    client,
    wsHub: deps.wsHub,
    deliverableHooks: {
      resolveSafeDeliverableUrl: (input) => deliverablePublisher.resolveSafeDeliverableUrl(input),
    },
    crmHooks,
  });

  const service = new MetaCommentDmService({
    db: deps.db,
    engine,
    wsHub: deps.wsHub,
  });

  const pollingWorker = new MetaCommentPollingWorker({
    db: deps.db,
    vault: deps.vault,
    nativeStore: deps.nativeStore,
    engine,
    service,
    fetchImpl: deps.fetchImpl,
  });

  const relayClient = new MetaRelayClient({
    vault: deps.vault,
    nativeStore: deps.nativeStore,
    engine,
    service,
    fetchImpl: deps.fetchImpl,
  });

  return {
    client,
    engine,
    service,
    pollingWorker,
    relayClient,
    deliverablePublisher,
    start: () => {
      service.startDelayScheduler();
      pollingWorker.start();
      relayClient.start();
    },
    dispose: () => {
      service.dispose();
      pollingWorker.dispose();
      relayClient.dispose();
    },
  };
}
