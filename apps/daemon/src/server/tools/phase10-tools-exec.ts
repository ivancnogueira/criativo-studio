import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@criativo/contracts";
import {
  executeRoutineToolCall,
  type RoutineToolExecutionContext,
  type RoutineToolsDeps,
} from "../../routines/routine-agent-tools.ts";
import type { WorkflowEngine } from "../../workflows/workflow-engine.ts";
import type { WorkflowStore } from "../../workflows/workflow-store.ts";
import {
  executeWorkflowToolCall,
  WORKFLOW_TOOL_DEFINITIONS,
} from "../../workflows/workflow-tools.ts";
import type { WebSocketHub } from "../websocket-hub.ts";
import { executePhase10CreativeMetaTool } from "./phase10-creative-meta-exec.ts";
import { executePhase10MessagingMcpSkillTool } from "./phase10-messaging-skills-exec.ts";
import type { StudioExtensionToolDeps } from "./phase10-tools-schema.ts";
import {
  INSTAGRAM_TOOL_NAMES,
  isAgentAuthorizedForStudioTool,
  resolveNativeAppConnectionsStore,
} from "./studio-tool-auth.ts";
export async function executeStudioExtensionTool(
  toolName: string,
  args: Record<string, unknown>,
  deps: StudioExtensionToolDeps
): Promise<unknown> {
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();
  const nativeStore = resolveNativeAppConnectionsStore(deps);

  if (
    !isAgentAuthorizedForStudioTool(toolName, deps.agenteId, {
      ...deps,
      nativeStore: nativeStore ?? undefined,
    })
  ) {
    const appLabel = INSTAGRAM_TOOL_NAMES.has(toolName) ? "Instagram / Meta" : "WhatsApp Studio";
    throw new Error(
      `Acesso bloqueado: o agente '${deps.agenteId ?? "atual"}' não tem permissão ao aplicativo nativo '${appLabel}' na Loja.`
    );
  }

  const msgRes = await executePhase10MessagingMcpSkillTool(toolName, args, deps, { workspaceRoot });
  if (msgRes.handled) {
    return msgRes.result;
  }

  return await executePhase10CreativeMetaTool(toolName, args, deps, {
    workspaceRoot,
    nativeStore,
  });
}

export async function executeStudioRoutineTool(
  toolName: string,
  args: Record<string, unknown>,
  options: {
    agenteId: string;
    turnOrigin?: RoutineToolExecutionContext["turnOrigin"];
    execucaoId?: string | null;
    routineToolsDeps?: RoutineToolsDeps;
    flags?: RoutineToolExecutionContext["flags"];
  }
): Promise<unknown> {
  if (!options.routineToolsDeps) {
    throw new Error("Serviço de rotinas e webhooks ainda não inicializado neste daemon.");
  }
  const ctx: RoutineToolExecutionContext = {
    agenteId: options.agenteId,
    turnOrigin: options.turnOrigin ?? "human",
    execucaoId: options.execucaoId ?? null,
    flags: options.flags ?? { noUpdateCalled: false, failureReason: null },
  };
  return await executeRoutineToolCall(
    {
      id: `studio-rot-${randomUUID().slice(0, 8)}`,
      name: toolName,
      arguments: args,
    },
    ctx,
    options.routineToolsDeps
  );
}

export function getChatWorkflowToolCatalog(): ToolDefinition[] {
  return WORKFLOW_TOOL_DEFINITIONS;
}

export async function executeChatWorkflowTool(
  toolName: string,
  args: Record<string, unknown>,
  options: {
    store?: WorkflowStore;
    engine?: WorkflowEngine;
    wsHub?: WebSocketHub;
    agenteId?: string;
    requestSeed?: string;
  }
): Promise<unknown> {
  if (!options.store || !options.engine) {
    throw new Error("Serviço de workflows em grafo ainda não inicializado neste daemon.");
  }
  return await executeWorkflowToolCall(toolName, args, {
    store: options.store,
    engine: options.engine,
    wsHub: options.wsHub,
    agenteId: options.agenteId,
    requestSeed: options.requestSeed,
  });
}
