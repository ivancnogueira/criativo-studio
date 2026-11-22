/**
 * Barrel de transporte HTTP/WebSocket e cliente API do Daemon.
 * Mantem 100% de retrocompatibilidade para imports existentes em `apps/web/src/`.
 */

export {
  ACTIVE_SERVER_STORAGE_KEY,
  DaemonHttpError,
  getActiveServerId,
  resolveActiveServerUrl,
  setActiveServerId,
  setOnLicenseRequiredHandler,
  subscribeActiveServerChanges,
  WorkflowRevisionConflictError,
} from "./http-client";
export { WebSocketClient } from "./ws-transport";

import { agentsChatApi } from "./api/agents-chat-api";
import { browserApi } from "./api/browser-api";
import { filesTablesApi } from "./api/files-browser-whatsapp-api";
import { marketplaceApi } from "./api/marketplace-api";
import { phase33Api } from "./api/phase33-api";
import { phase34Api } from "./api/phase34-api";
import { phase35Api } from "./api/phase35-api";
import { phase36Api } from "./api/phase36-api";
import { phase37Api } from "./api/phase37-api";
import { providersMcpApi } from "./api/providers-mcp-api";
import { serversLicenseApi } from "./api/servers-license-api";
import { socialStudioApi } from "./api/social-studio-api";
import { threadsQueueUiApi } from "./api/threads-queue-api";
import { whatsappApi } from "./api/whatsapp-api";
import { workflowsRoutinesApi } from "./api/workflows-routines-api";

export const daemonApi = {
  ...agentsChatApi,
  ...threadsQueueUiApi,
  ...workflowsRoutinesApi,
  ...providersMcpApi,
  ...marketplaceApi,
  ...filesTablesApi,
  ...browserApi,
  ...whatsappApi,
  ...serversLicenseApi,
  ...socialStudioApi,
  ...phase33Api,
  ...phase34Api,
  ...phase35Api,
  ...phase36Api,
  ...phase37Api,
};
