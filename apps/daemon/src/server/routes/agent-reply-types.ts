import type {
  AnexoChat,
  PassoChat,
  MensagemChat,
  ProviderName,
  ToolDefinition,
  UsageLimitAskPayload,
} from "@criativo/contracts";
import type { LabeledVisualAsset } from "../studio-tools-bridge.ts";
import type { LazyToolRouter } from "../../engine/tools/lazy-tool-router.ts";
import type { StudioRoutesDeps } from "./route-helpers.ts";
import type { ChatProgressReport } from "./agent-enrichment-helpers.ts";

export interface AgentReplyTarget {
  agente_id: string;
  nome: string;
  papel: string;
  modelo_padrao: string;
  config_json: string;
  backup_models_json?: string | null;
}

export interface AgentReplyOptions {
  isHandoff?: boolean;
  originalUserPrompt?: string;
  threadId?: string | null;
  turnoId?: string;
  signal?: AbortSignal;
  wokenWaitsBlock?: string | null;
  entregaOrigemId?: string;
  isRoutine?: boolean;
  overrideModel?: string;
  overrideAccountId?: string | null;
  channelOrigin?: "web" | "whatsapp";
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
}

export interface PreparedAgentReplySetup {
  turnStartedIso: string;
  workspaceRoot: string;
  config: Record<string, unknown>;
  onboarding: ReturnType<StudioRoutesDeps["providerConnection"]["getOnboardingState"]>;
  skillSlug: string;
  intentSourcePrompt: string;
  greetingOrCapability: boolean;
  loadedSkill: { tokensEst: number } | null;
  metaValidationSummary: Awaited<ReturnType<typeof import("../studio-tools-bridge.ts").validateMetaIntegration>> | null;
  graphVersion: string;
  promptBase: string;
  availableChatTools: ToolDefinition[];
  lazyToolRouter?: LazyToolRouter;
  studioToolsPromptGuidance: string;
  turnAcpMcpServers: ReturnType<StudioRoutesDeps["providerConnection"]["buildCombinedAcpMcpServers"]>;
  turnCliMcpConfig: ReturnType<StudioRoutesDeps["providerConnection"]["buildClaudeMcpConfig"]>;
  governance: ReturnType<typeof import("../studio-tools-bridge.ts").readAgentGovernance>;
  initialModel: string;
  providerName: ProviderName;
  agService: ReturnType<StudioRoutesDeps["providerConnection"]["getAntigravityService"]>;
  statusList: Awaited<ReturnType<StudioRoutesDeps["providerConnection"]["getProvidersStatus"]>>;
  agSnapshot: Awaited<ReturnType<ReturnType<StudioRoutesDeps["providerConnection"]["getAntigravityService"]>["getLiveSnapshot"]>>;
  opencodeStatus: Awaited<ReturnType<StudioRoutesDeps["providerConnection"]["getProvidersStatus"]>>[number] | undefined;
  hasAntigravityAccount: boolean;
  hasClaudeOAuthAccount: boolean;
  hasOpenAIOAuthAccount: boolean;
  steps: PassoChat[];
  turnId: string;
  assertNotAborted: () => void;
  sessionId: string;
}

export interface AgentVisualPreparationResult {
  tarefaCriadaId: string | null;
  anexosGerados: AnexoChat[];
  labeledVisualAssets: LabeledVisualAsset[];
  resolvedImageDiskPaths: string[];
}

export interface ModelAttemptExecState {
  lastExecutionError: string | null;
  lastErrorRetryable: boolean;
  hadConnectedRoute: boolean;
}

export interface ModelAttemptContext {
  deps: StudioRoutesDeps;
  agente: AgentReplyTarget;
  userPrompt: string;
  anexos: AnexoChat[];
  history: MensagemChat[];
  onProgress?: (evt: ChatProgressReport) => void;
  options?: AgentReplyOptions;
  setup: PreparedAgentReplySetup;
  visual: AgentVisualPreparationResult;
  execState: ModelAttemptExecState;
  targetModel: string;
  targetProvider: ProviderName;
  preferredAccId: string | null;
  targetProvStatus: PreparedAgentReplySetup["statusList"][number] | undefined;
  targetVaultOrLocal: boolean;
  targetOpenCode: boolean;
  targetAntigravity: boolean;
  handoffNote?: string | null;
}
