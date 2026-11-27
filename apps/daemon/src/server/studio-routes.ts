import type { IncomingMessage, ServerResponse } from "node:http";
import { selectBalancedVisualAssets, type LabeledVisualAsset } from "./studio-tools-bridge.ts";
import { tryHandleWhatsAppMcpStoreRoute } from "./routes-whatsapp-mcp-store.ts";
import { tryHandleThreadsRoute } from "./threads-routes.ts";
import type { StudioRouteContext, StudioRoutesDeps } from "./routes/route-helpers.ts";
import { tryHandleLicenseAndUpdatesRoutes } from "./routes/license-updates-routes.ts";
import { tryHandleServersRoutes } from "./routes/servers-routes.ts";
import { tryHandleSkillsBrandConnectorsRoutes } from "./routes/skills-brand-connectors-routes.ts";
import { tryHandleProvidersRoutes } from "./routes/providers-routes.ts";
import { tryHandleAgentsCrudRoutes } from "./routes/agents-crud-routes.ts";
import { tryHandleAgentsLifecycleRoutes } from "./routes/agents-lifecycle-routes.ts";
import { tryHandleAgentsMemoryRoutes } from "./routes/agents-memory-routes.ts";
import { tryHandleAgentMessagesRoutes } from "./routes/agent-messages-routes.ts";
import { tryHandleChannelsCrudRoutes } from "./routes/channels-crud-routes.ts";
import { tryHandleChannelsMessagesRoutes } from "./routes/channels-messages-routes.ts";
import { tryHandleWorkflowsWebhooksAndRunsRoutes } from "./routes/workflows-webhooks-runs-routes.ts";
import { tryHandleWorkflowsProRoutes } from "./routes/workflows-pro-routes.ts";
import { tryHandleWorkflowsCrudRoutes } from "./routes/workflows-crud-routes.ts";
import { tryHandleFilesRoutes } from "./routes/files-routes.ts";
import { tryHandlePhase14Routes } from "./routes/phase14-routes.ts";
import { tryHandleCustomProvidersRoutes } from "./routes/custom-providers-routes.ts";
import { tryHandleSocialStudioRoutes } from "./social-studio-routes.ts";
import { tryHandleMessagingAndVaultRoutes } from "./routes/messaging-vault-routes.ts";
import { tryHandlePhase35GovernanceRoutes } from "./routes/phase35-governance-routes.ts";
import { tryHandleTeamAndAuditRoutes } from "./routes/team-routes.ts";
import { tryHandleServersTransferRoutes } from "./routes/servers-transfer-routes.ts";
import { tryHandleCrmRoutes } from "./routes/crm-routes.ts";
import { tryHandleVoiceHostRoutes } from "./routes/voice-host-routes.ts";
import { tryHandlePhase37EcosystemRoutes } from "./routes/phase37-ecosystem-routes.ts";
import { tryHandleDiagnosticsSearchRoutes } from "./routes/diagnostics-search-routes.ts";

export { selectBalancedVisualAssets, type LabeledVisualAsset };
export type { StudioRoutesDeps } from "./routes/route-helpers.ts";
export {
  type ParsedTextToolCall,
  compactRecentHistory,
  parseWorkflowTextToolCalls,
  extractMentionedAgentIds,
  extractExplicitAgentHandoffTags,
  isGreetingOrCapabilityQuestion,
  hasExplicitVisualGenerationIntent,
} from "./routes/chat-routing-helpers.ts";
export {
  generateAgentChatReply,
  executeAgentConversationTurn,
} from "./routes/agent-reply-runner.ts";

export async function tryHandleStudioRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  url: URL,
  deps: StudioRoutesDeps
): Promise<boolean> {
  if (await tryHandleWhatsAppMcpStoreRoute(req, res, path, method, url, deps)) {
    return true;
  }
  if (
    deps.phase13 &&
    (await tryHandleThreadsRoute(req, res, path, method, url, {
      ...deps,
      ...deps.phase13,
    }))
  ) {
    return true;
  }

  const { db, wsHub } = deps;
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();

  const ctx: StudioRouteContext = {
    req,
    res,
    path,
    method,
    url,
    deps,
    db,
    wsHub,
    workspaceRoot,
  };

  const handlers: Array<(c: StudioRouteContext) => Promise<boolean>> = [
    tryHandleLicenseAndUpdatesRoutes,
    tryHandleServersRoutes,
    tryHandleSkillsBrandConnectorsRoutes,
    tryHandleProvidersRoutes,
    tryHandleAgentsCrudRoutes,
    tryHandleAgentsLifecycleRoutes,
    tryHandleAgentsMemoryRoutes,
    tryHandleAgentMessagesRoutes,
    tryHandleChannelsCrudRoutes,
    tryHandleChannelsMessagesRoutes,
    tryHandleWorkflowsWebhooksAndRunsRoutes,
    tryHandleWorkflowsProRoutes,
    tryHandleWorkflowsCrudRoutes,
    tryHandleFilesRoutes,
    tryHandlePhase14Routes,
    tryHandleCustomProvidersRoutes,
    tryHandleSocialStudioRoutes,
    tryHandleMessagingAndVaultRoutes,
    tryHandlePhase35GovernanceRoutes,
    tryHandleTeamAndAuditRoutes,
    tryHandleServersTransferRoutes,
    tryHandleCrmRoutes,
    tryHandleVoiceHostRoutes,
    tryHandlePhase37EcosystemRoutes,
    tryHandleDiagnosticsSearchRoutes,
  ];

  for (const handler of handlers) {
    if (await handler(ctx)) {
      return true;
    }
  }

  return false;
}
