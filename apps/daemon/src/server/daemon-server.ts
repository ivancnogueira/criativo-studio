import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  WhatsAppArchiveService,
  WhatsAppMediaService,
  WhatsAppOrchestrator,
  WhatsAppSenderRules,
  WhatsAppSessionManager,
  type AuthorizedWhatsAppMessageEvent,
  type WhatsAppApprovalNotifier,
  type SocketFactory,
} from "@criativo/whatsapp";
import {
  CriativoStudioMcpBridge,
  INTERNAL_MCP_ROUTE_PATH,
} from "../mcp/studio-mcp-bridge.ts";
import { ControlSocketServer } from "./control-socket.ts";
import { tryHandleRoutineRoute } from "./routine-routes.ts";
import { executeAgentConversationTurn, tryHandleStudioRoute } from "./studio-routes.ts";
import { tryHandlePhase15Route } from "./phase15-routes.ts";
import { readJsonBody, readRawBody, sendJson, type DaemonRuntime, type DaemonServerOptions } from "./daemon-http-utils.ts";
import { tryServeWebStatic } from "./static-assets-handler.ts";
import { tryHandleDaemonCoreRoute } from "./daemon-core-routes.ts";
import { createDaemonInfraServices } from "./daemon-infra-services.ts";
import { createDaemonRuntimeServices } from "./daemon-runtime-services.ts";
import { createWhatsAppAuthorizedTurnHandler } from "./daemon-whatsapp-handler.ts";
import { createDaemonLaneScheduler } from "./daemon-lane-scheduler.ts";
import { mapErrorToCatalog } from "./error-catalog-mapper.ts";
import { reconcileAgentsDefaultModels } from "../providers/default-model-resolver.ts";

export {
  type TaskExecutorHook,
  type DaemonServerOptions,
  type DaemonRuntime,
  resolveDefaultWorkspaceRoot,
} from "./daemon-http-utils.ts";

export async function createDaemonServer(
  options: DaemonServerOptions = {}
): Promise<DaemonRuntime> {
  let activeServerPort = 0;
  let whatsappAuthorizedTurnHandler:
    | ((event: AuthorizedWhatsAppMessageEvent) => Promise<boolean | void>)
    | null = null;
  let scheduleLaneDrainImpl: ((agenteId: string, threadId: string | null) => void) | null = null;
  let laneBusyCheck: (() => boolean) | null = null;
  let agentBusyCheck: ((agId: string) => { busy: boolean; policy: "queue" | "steer" }) | null = null;

  const infra = await createDaemonInfraServices(options, {
    getActivePort: () => activeServerPort,
    isAuthorizedWhatsAppTurn: async (event) => {
      if (!whatsappAuthorizedTurnHandler) return false;
      return await whatsappAuthorizedTurnHandler(event);
    },
    onScheduleLaneDrain: (agenteId, threadId) => {
      scheduleLaneDrainImpl?.(agenteId, threadId);
    },
  });

  const rt = await createDaemonRuntimeServices(options, infra, {
    isInteractiveSlotBusy: () => laneBusyCheck?.() ?? false,
    isAgentBusy: (agId) => agentBusyCheck?.(agId) ?? { busy: false, policy: "queue" },
  });

  const laneScheduler = createDaemonLaneScheduler(options, infra, rt);
  scheduleLaneDrainImpl = laneScheduler.scheduleLaneDrain;
  laneBusyCheck = laneScheduler.isInteractiveSlotBusy;
  agentBusyCheck = laneScheduler.isAgentBusy;
  whatsappAuthorizedTurnHandler = createWhatsAppAuthorizedTurnHandler(infra, rt);

  const {
    studioPaths,
    resolvedWorkspaceRoot,
    db,
    eventRetention,
    structuredLogger,
    recoveryReport,
    queue,
    vault,
    wsHub,
    licenseService,
    localServerManager,
    remoteClaimService,
    remoteOAuthBridge,
    serverProxyRouter,
    autoUpdateService,
    configuredAccessToken,
    isAuthorizedByAccessToken,
    providers,
    providerConnection,
    customEndpoints,
    localProviderDetector,
    mediaCatalog,
    mcpGateway,
    skillsManager,
    catalogService,
    githubImporter,
    transcription,
    whatsappArchiveService,
    whatsappManager,
    whatsappOrchestrator,
    whatsapp,
    approvalNotifier,
    memoryManager,
    handoffBus,
    apiKeysBridge,
    ephemeralSharedDbPath,
    sharedTables,
    skillLearning,
    historySearch,
    libraryFolders,
    visualPreview,
    uiBlockRegistry,
    browserService,
    screenCapture,
    showcaseService,
    backupResolver,
    connectorsWebhook,
    runner,
    threadStore,
    waitStore,
    tasksService,
    waitsService,
    wakeupService,
    backgroundJobService,
    queueControls,
    pinsService,
    contextReset,
    phase13Bundle,
  } = infra;

  const {
    cron,
    routineStore,
    routineFlowStore,
    workflowStore,
    telegramBot,
    messagingService,
    loginVault,
    passwordManagerRegistry,
    browserAutofillService,
    telemetryService,
    teamService,
    instanceTransferService,
    crmService,
    voiceHostService,
    cuaClient,
    themePaletteFiles,
    agentTemplatePublisher,
    resourceMonitor,
    workflowEngine,
    workflowTriggers,
    routineResultDispatcher,
    routineExecutionService,
    routineTimer,
    routineWebhookService,
    routineFlowsEngine,
    routineToolsDeps,
    memoryReview,
    cacheExpiryCompaction,
    metaFirstCommentService,
    phase47Runtime,
    phase14Services,
    studioMcpBridge,
  } = rt;

  const { processNextQueuedTask, drainAllPendingLanes } = laneScheduler;
  let workerTimer: NodeJS.Timeout | null = null;

  const httpServer = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type,Authorization,X-Criativo-Server-Id,X-Criativo-Mcp-Token,X-Criativo-Synced-License",
        });
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (path === INTERNAL_MCP_ROUTE_PATH) {
        await studioMcpBridge.handleHttpRequest(req, res, path, method, url, readJsonBody);
        return;
      }

      const hasValidServerToken = Boolean(
        configuredAccessToken && isAuthorizedByAccessToken(req, url),
      );

      if (
        configuredAccessToken &&
        !(method === "GET" && (path === "/health" || path === "/api/health" || path === "/api/rotinas/feed.ics")) &&
        path !== "/api/instagram/webhook" &&
        path.startsWith("/api/") &&
        !hasValidServerToken
      ) {
        sendJson(res, 401, { erro: "Token de acesso do servidor ausente ou inválido." });
        return;
      }

      if (hasValidServerToken) {
        const syncedHeader = req.headers["x-criativo-synced-license"];
        const encodedCert = Array.isArray(syncedHeader) ? syncedHeader[0] : syncedHeader;
        if (typeof encodedCert === "string" && encodedCert.trim()) {
          licenseService.importPeerSyncedCertificateBase64(encodedCert.trim());
        }
      }

      const isLicenseExemptRoute =
        hasValidServerToken ||
        (method === "GET" && (path === "/health" || path === "/api/health" || path === "/api/rotinas/feed.ics")) ||
        path === "/api/instagram/webhook" ||
        path.startsWith("/api/studio/license/") ||
        (method === "GET" && !path.startsWith("/api/") && path !== "/ws");

      if (!isLicenseExemptRoute && path.startsWith("/api/")) {
        const opCheck = licenseService.assertOperational();
        if (!opCheck.ok) {
          sendJson(res, 402, {
            error: "license_required",
            erro: opCheck.status.message ?? "Licença ativa necessária para operar o CriativoOS.",
            status: opCheck.status,
          });
          return;
        }
      }

      if (serverProxyRouter && (await serverProxyRouter.tryProxyHttpRequest(req, res, url, method))) {
        return;
      }

      if (
        await tryHandleRoutineRoute(req, res, path, method, url, {
          db,
          routineStore,
          flowStore: routineFlowStore,
          timer: routineTimer,
          resultDispatcher: routineResultDispatcher,
          executionService: routineExecutionService,
          webhookService: routineWebhookService,
          flowsEngine: routineFlowsEngine,
          wsHub,
          sendJson,
          readJsonBody,
        })
      ) {
        return;
      }

      const studioDepsForRequest = {
        db,
        structuredLogger,
        queue,
        vault,
        providers,
        providerConnection,
        wsHub,
        sendJson,
        readJsonBody,
        workspaceRoot: resolvedWorkspaceRoot,
        productRoot: studioPaths.productRoot,
        mcpGateway,
        catalogService,
        githubImporter,
        skillsManager,
        whatsappManager,
        whatsappOrchestrator,
        routineToolsDeps,
        workflowStore,
        workflowEngine,
        workflowTriggers,
        telegramBot,
        readRawBody,
        phase13: phase13Bundle,
        sharedTables,
        memoryManager,
        memoryReview,
        skillLearning,
        historySearch,
        libraryFolders,
        handoffBus,
        visualPreview,
        uiBlockRegistry,
        apiKeysBridge,
        phase14: phase14Services,
        browserService,
        screenCapture,
        showcaseService,
        connectorsWebhook,
        transcription,
        backupResolver,
        licenseService,
        localServerManager,
        remoteClaimService,
        remoteOAuthBridge,
        autoUpdateService,
        customEndpoints,
        localProviderDetector,
        mediaCatalog,
        messagingService,
        loginVault,
        passwordManagerRegistry,
        browserAutofillService,
        telemetryService,
        teamService,
        instanceTransferService,
        crmService,
        voiceHostService,
        cuaClient,
        themePaletteFiles,
        agentTemplatePublisher,
        resourceMonitor,
        metaFirstCommentService,
        phase47: phase47Runtime,
        fetchImpl: options.fetchImpl,
      };

      if (
        await tryHandlePhase15Route(req, res, path, method, url, {
          db,
          wsHub,
          workspaceRoot: resolvedWorkspaceRoot,
          providers,
          providerConnection,
          browserService,
          screenCapture,
          showcaseService,
          connectorsWebhook,
          transcription,
          backupResolver,
          studioRoutesDeps: studioDepsForRequest,
          sendJson,
          readJsonBody,
          readRawBody,
        })
      ) {
        return;
      }

      if (await tryHandleStudioRoute(req, res, path, method, url, studioDepsForRequest)) {
        return;
      }

      if (
        await tryHandleDaemonCoreRoute(req, res, path, method, url, {
          db,
          wsHub,
          queue,
          vault,
          cron,
          whatsapp,
          waitStore,
          waitsService,
          recoveryReport,
        })
      ) {
        return;
      }

      if (
        method === "GET" &&
        (path === "/showcase" || path.startsWith("/showcase/")) &&
        showcaseService.tryServePublicRoute(path, res)
      ) {
        return;
      }

      if (method === "GET" && tryServeWebStatic(path, res, studioPaths.webDistDir, studioPaths.productRoot)) {
        return;
      }

      sendJson(res, 404, { erro: `Rota não encontrada: ${method} ${path}` });
    } catch (error) {
      const mapped = mapErrorToCatalog(error);
      structuredLogger.error(mapped.domain, mapped.rawSummary ?? mapped.userMessage, {
        code: mapped.code,
        traceId: mapped.traceId,
        metadata: { method: req.method ?? "GET", url: req.url ?? "/" },
      });
      const statusCode =
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      sendJson(res, statusCode, {
        erro: mapped.userMessage,
        errorCode: mapped.code,
        title: mapped.title,
        suggestedAction: mapped.suggestedAction,
        traceId: mapped.traceId,
        detalhe: mapped.rawSummary,
      });
    }
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    if (configuredAccessToken && !isAuthorizedByAccessToken(req, reqUrl)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    if (serverProxyRouter && reqUrl.pathname === "/ws") {
      const targetSid = reqUrl.searchParams.get("serverId")?.trim();
      if (targetSid && targetSid !== "primary") {
        void serverProxyRouter.tryProxyWebSocketUpgrade(req, socket, head, reqUrl);
        return;
      }
    }
    const handled = wsHub.handleUpgrade(req, socket, "/ws");
    if (!handled) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  });

  const listenHost = options.host ?? process.env.HOST ?? "127.0.0.1";
  const listenPort = options.port ?? Number(process.env.PORT ?? 3000);

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(listenPort, listenHost, () => {
      httpServer.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = httpServer.address();
  const resolvedPort = typeof address === "object" && address ? address.port : listenPort;
  activeServerPort = resolvedPort;
  studioMcpBridge.setPort(resolvedPort);
  routineStore.setPublicBaseUrl(`http://${listenHost}:${resolvedPort}`);

  const resolvedControlSocketPath =
    options.controlSocketPath === null
      ? null
      : (options.controlSocketPath ?? process.env.CRIATIVO_SOCKET_PATH ?? null);

  let controlSocket: ControlSocketServer | null = null;
  if (resolvedControlSocketPath) {
    controlSocket = new ControlSocketServer({
      socketPath: resolvedControlSocketPath,
      db,
      queue,
      getWhatsAppStatus: () => whatsapp.getStatus(),
      onRestartRequested: () => {
        console.info("[Criativo Daemon] Reinicialização solicitada via Control Socket.");
      },
    });
    await controlSocket.listen();
  }

  if (options.autoStartLoops !== false) {
    licenseService.startHeartbeatTimer();
    cron.start(options.cronIntervalMs ?? 60_000);
    await routineExecutionService.skipMissed();
    routineTimer.arm();
    wakeupService.start();
    metaFirstCommentService.start();
    phase47Runtime.start();
    await routineFlowsEngine.sweep();
    whatsappArchiveService.startPeriodicCleanup();
    workerTimer = setInterval(() => {
      void drainAllPendingLanes();
    }, options.workerPollMs ?? 500);
    workerTimer.unref?.();

    const skipBgAutoInstall =
      process.env.NODE_ENV === "test" ||
      process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1" ||
      process.env.CRIATIVO_DISABLE_AUTO_INSTALL === "1" ||
      process.execArgv.includes("--test") ||
      process.argv.includes("--test");
    if (!skipBgAutoInstall) {
      autoUpdateService.startPeriodicCheck();
      void providerConnection
        .getProvidersStatus(false)
        .then((list) => {
          const rec = reconcileAgentsDefaultModels(db, list);
          if (rec.updatedIds.length > 0) {
            wsHub.broadcast("sidebar:updated", { revision: Date.now() });
          }
        })
        .catch(() => null);
      void providerConnection
        .ensureOpenCodeRuntimeInBackground()
        .then(async (res) => {
          if (res.installed && res.connected) {
            wsHub.broadcast("provider:updated", {
              provedor: "opencode",
              conectado: true,
              modo: "cli",
            });
            const list = await providerConnection.getProvidersStatus(false).catch(() => []);
            const rec = reconcileAgentsDefaultModels(db, list);
            if (rec.updatedIds.length > 0) {
              wsHub.broadcast("sidebar:updated", { revision: Date.now() });
            }
          }
        })
        .catch((err) => {
          console.warn("[Daemon] Auto-instalação em background do OpenCode ignorada:", err);
        });
      void providerConnection
        .ensureAntigravityRuntimeInBackground()
        .then(async (res) => {
          if (res.installed && res.available) {
            const list = await providerConnection.getProvidersStatus(false).catch(() => []);
            const geminiStatus = list.find((p) => p.provedor === "gemini");
            wsHub.broadcast("provider:updated", {
              provedor: "gemini",
              conectado: geminiStatus?.conectado ?? false,
              modo: geminiStatus?.modo_conexao ?? "nenhum",
            });
            const rec = reconcileAgentsDefaultModels(db, list);
            if (rec.updatedIds.length > 0) {
              wsHub.broadcast("sidebar:updated", { revision: Date.now() });
            }
          }
        })
        .catch((err) => {
          console.warn("[Daemon] Auto-instalação em background do Antigravity CLI ignorada:", err);
        });
      void providerConnection
        .checkAndUpdateManagedRuntimesInBackground()
        .then(async (res) => {
          if (res.updated.length > 0) {
            const list = await providerConnection.getProvidersStatus(true).catch(() => []);
            const folderToProvider: Record<string, string> = {
              antigravity: "gemini",
              opencode: "opencode",
              codex: "openai",
              claude: "claude",
            };
            for (const folder of res.updated) {
              const provId = folderToProvider[folder];
              const st = list.find((p) => p.provedor === provId);
              if (st) {
                wsHub.broadcast("provider:updated", {
                  provedor: st.provedor,
                  conectado: st.conectado,
                  modo: st.modo_conexao,
                });
              }
            }
            const rec = reconcileAgentsDefaultModels(db, list);
            if (rec.updatedIds.length > 0) {
              wsHub.broadcast("sidebar:updated", { revision: Date.now() });
            }
          }
        })
        .catch((err) => {
          console.warn("[Daemon] Verificação periódica de atualização de CLIs ignorada:", err);
        });
    }
  }

  const shouldAutoBootWhatsApp =
    options.autoBootWhatsApp ?? options.autoStartLoops !== false;
  if (shouldAutoBootWhatsApp) {
    void whatsappManager.bootSavedAccounts().catch((err) => {
      console.warn("[Daemon] Falha no auto-boot WhatsApp:", err);
    });
  }

  return {
    httpServer,
    wsHub,
    controlSocket,
    db,
    paths: studioPaths,
    queue,
    vault,
    licenseService,
    localServerManager,
    remoteClaimService,
    autoUpdateService,
    cron,
    routineStore,
    routineFlowStore,
    routineTimer,
    routineResultDispatcher,
    routineExecutionService,
    routineWebhookService,
    routineFlowsEngine,
    workflowStore,
    workflowEngine,
    workflowTriggers,
    telegramBot,
    providers,
    providerConnection,
    runner,
    mcpGateway,
    studioMcpBridge,
    catalogService,
    githubImporter,
    skillsManager,
    whatsappManager,
    whatsappOrchestrator,
    whatsapp,
    approvalNotifier,
    threadStore,
    tasksService,
    waitsService,
    wakeupService,
    backgroundJobService,
    queueControls,
    pinsService,
    contextReset,
    sharedTables,
    memoryManager,
    memoryReview,
    skillLearning,
    historySearch,
    libraryFolders,
    handoffBus,
    visualPreview,
    uiBlockRegistry,
    apiKeysBridge,
    browserService,
    screenCapture,
    showcaseService,
    connectorsWebhook,
    port: resolvedPort,
    async close(): Promise<void> {
      autoUpdateService.stopPeriodicCheck();
      licenseService.stopHeartbeatTimer();
      remoteOAuthBridge?.closeAll();
      if (localServerManager) {
        await localServerManager.stopAll();
      }
      cron.stop();
      routineTimer.dispose();
      eventRetention.dispose();
      wakeupService.dispose();
      backgroundJobService.dispose();
      memoryReview.dispose();
      cacheExpiryCompaction.dispose();
      metaFirstCommentService.dispose();
      phase47Runtime.dispose();
      uiBlockRegistry.dispose();
      screenCapture.dispose();
      telegramBot.stopPolling();
      voiceHostService.dispose();
      themePaletteFiles.dispose();
      await browserService.closeAll();
      await workflowEngine.dispose();
      whatsappArchiveService.stopPeriodicCleanup();
      whatsappOrchestrator.stop();
      if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
      }
      if (controlSocket) {
        await controlSocket.close();
      }
      await whatsappManager.shutdownAll();
      await mcpGateway.close();
      await sharedTables.close();
      if (ephemeralSharedDbPath) {
        for (const suffix of ["", "-wal", "-shm"]) {
          try {
            rmSync(`${ephemeralSharedDbPath}${suffix}`, { force: true });
          } catch {
            // ignora falha de limpeza efêmera
          }
        }
      }
      providerConnection.close();
      wsHub.closeAll();
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolveClose) => {
        httpServer.close(() => resolveClose());
      });
      db.close();
    },
  };
}

const isEntryPoint =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]) &&
  !/local-child-entry\.(ts|js)$/i.test(process.argv[1]) &&
  process.env.CRIATIVO_LOCAL_CHILD !== "1";

if (isEntryPoint) {
  process.on("unhandledRejection", (reason) => {
    console.error("[Criativo Daemon] unhandledRejection capturada:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[Criativo Daemon] uncaughtException capturada:", err);
  });

  createDaemonServer()
    .then((runtime) => {
      console.info(
        `[Criativo Daemon] Servidor HTTP + WebSocket ativo em http://127.0.0.1:${runtime.port}`
      );
    })
    .catch((err) => {
      console.error("[Criativo Daemon] Falha crítica ao iniciar:", err);
      process.exit(1);
    });
}
