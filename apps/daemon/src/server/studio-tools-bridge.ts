/**
 * Ponte unificada de ferramentas nativas e contexto vivo do Studio.
 * Barrel fino preservando 100% dos exports publicos apos modularizacao em server/tools/.
 */

export {
  isRoutineToolName,
  ROUTINE_AGENT_TOOLS_SCHEMA,
} from "../routines/routine-agent-tools.ts";
export {
  isWorkflowToolName,
  WORKFLOW_TOOL_DEFINITIONS,
  WORKFLOW_TOOL_NAMES,
} from "../workflows/workflow-tools.ts";
export {
  fetchMetaAccountAndMediaInsights,
  resolveMetaCredentials,
  validateMetaIntegration,
  type MetaCredentialsResolved,
  type MetaInsightsQueryInput,
  type MetaInsightsReport,
  type MetaValidationReport,
} from "../engine/tools/meta-insights.ts";

export { resolveSafeStudioMediaPath } from "./tools/studio-tool-helpers.ts";
export {
  INSTAGRAM_TOOL_NAMES,
  isAgentAuthorizedForStudioTool,
  isUpgradeUnlocked,
  resolveNativeAppConnectionsStore,
  UPGRADE_PACKAGE_SLUGS,
  WHATSAPP_TOOL_NAMES,
} from "./tools/studio-tool-auth.ts";
export {
  scanWorkspaceMediaFiles,
  selectBalancedVisualAssets,
  syncWorkspaceFilesToDatabase,
  type LabeledVisualAsset,
  type ScannedWorkspaceFile,
} from "./tools/studio-media-scanner.ts";
export { buildStudioLiveContext } from "./tools/studio-context-builder.ts";
export {
  isPhase10ExtensionTool,
  PHASE10_TOOL_DEFINITIONS,
  PHASE10_TOOL_NAMES,
  type StudioExtensionToolDeps,
} from "./tools/phase10-tools-schema.ts";
export {
  executeChatWorkflowTool,
  executeStudioExtensionTool,
  executeStudioRoutineTool,
  getChatWorkflowToolCatalog,
} from "./tools/phase10-tools-exec.ts";
export {
  buildPhase13SystemGuidance,
  executePhase13Tool,
  isPhase13ToolName,
  PHASE13_TOOL_NAMES,
  PHASE13_TOOLS_SCHEMA,
  readAgentContextCutoffAt,
  type Phase13ToolContext,
  type Phase13ToolServices,
} from "./tools/phase13-orchestration-tools.ts";
export {
  isPhase14ToolName,
  PHASE14_TOOL_NAMES,
  PHASE14_TOOLS_SCHEMA,
  type Phase14ToolContext,
  type Phase14ToolServices,
} from "./tools/phase14-tools-schema.ts";
export { executePhase14ToolCall } from "./tools/phase14-ui-vault-exec.ts";
export {
  assertAgentPermissionForPath,
  isPathInsideAllowedFolders,
  normalizeAllowedFolders,
  PermissionEscalationRequiredError,
  readAgentGovernance,
  sanitizeAllowedFoldersList,
  validateAllowedFolderPath,
  type AgentGovernanceState,
} from "./tools/phase15-governance.ts";
export {
  BROWSER_DIRECT_ALIASES,
  BROWSER_TARGET_SCHEMA,
  HIDDEN_CATALOG_TOOL_NAMES,
  isPhase15ToolName,
  normalizeBrowserTargetInput,
  PHASE15_TOOL_NAMES,
  PHASE15_TOOLS_SCHEMA,
  type Phase15ToolContext,
  type Phase15ToolServices,
} from "./tools/phase15-tools-schema.ts";
export { executePhase15ChatTool, executePhase15ToolCall } from "./tools/phase15-tools-exec.ts";
export {
  DEFAULT_CORE_EXPOSED_TOOLS,
  LAZY_META_TOOL_NAMES,
  LAZY_META_TOOLS_SCHEMA,
  LazyToolRouter,
  type IndexedToolSummary,
} from "../engine/tools/lazy-tool-router.ts";
