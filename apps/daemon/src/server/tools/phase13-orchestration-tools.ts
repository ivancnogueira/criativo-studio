import type { ToolDefinition } from "@criativo/contracts";
import type { ContextResetService } from "../../chat/context-reset-service.ts";
import type { MessagePinsService } from "../../chat/message-pins-service.ts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { QueueControlsService } from "../../queue/queue-controls-service.ts";
import type { AgentTasksService } from "../../threads/agent-tasks-service.ts";
import type { AgentWaitsService } from "../../waits/agent-waits-service.ts";
import type { AgentWakeupService } from "../../waits/agent-wakeup-service.ts";
import { resolveAgentIdFromDb } from "../agent-resolver.ts";
import { readStringArg } from "./studio-tool-helpers.ts";
export const PHASE13_TOOL_NAMES = new Set([
  "start_task",
  "await_event",
  "close_wait",
  "list_waits",
  "interrupt_agent",
  "start_new_chat",
  "pin_message",
  "schedule_wakeup",
  "list_wakeups",
  "cancel_wakeup",
]);

export function isPhase13ToolName(name: string): boolean {
  return PHASE13_TOOL_NAMES.has(name);
}

export const PHASE13_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "start_task",
    description:
      "Inicia uma sub-tarefa paralela em uma nova thread isolada sem bloquear o chat principal. Disponível apenas no chat principal do agente ou em thread de rotina.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Título curto da tarefa paralela (1 a 140 caracteres)",
        },
        brief: {
          type: "string",
          description: "Briefing completo e instruções para o agente executar na sub-thread",
        },
      },
      required: ["title", "brief"],
    },
  },
  {
    name: "await_event",
    description:
      "Registra uma espera longa (>15 min) para acordar o agente automaticamente quando uma rotina futura ou webhook com waitId disparar.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Resumo do que está sendo aguardado e o que fazer quando despertar (1 a 2000 caracteres)",
        },
        routineId: {
          type: "string",
          description: "ID opcional da rotina específica vinculada a esta espera",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "close_wait",
    description: "Encerra definitivamente uma espera aberta após ela ter sido resolvida ou cancelada.",
    parameters: {
      type: "object",
      properties: {
        waitId: { type: "string", description: "ID da espera (waitId) a encerrar" },
        agentId: { type: "string", description: "ID opcional do agente dono da espera" },
      },
      required: ["waitId"],
    },
  },
  {
    name: "list_waits",
    description: "Lista todas as esperas abertas no agente informado (ou no agente atual).",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID opcional do agente alvo" },
      },
    },
  },
  {
    name: "interrupt_agent",
    description:
      "Cancela mensagens pendentes que você enviou para outro agente e interrompe o turno dele se estiver executando exclusivamente trabalho seu.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID do agente alvo (nunca você mesmo)" },
        reason: { type: "string", description: "Motivo breve exibido ao agente interrompido" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "start_new_chat",
    description:
      "Inicia um novo chat limpo para o modelo ao final do turno quando a fila estiver vazia, salvando memórias essenciais e preservando todo o histórico visual.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "pin_message",
    description:
      "Fixa ou desafixa uma mensagem importante nesta conversa. Sem quote, fixa a última mensagem do usuário no turno atual.",
    parameters: {
      type: "object",
      properties: {
        quote: {
          type: "string",
          description: "Trecho exato (1 a 500 chars) de uma mensagem anterior para localizar e fixar",
        },
        pinned: {
          type: "boolean",
          description: "true para fixar (padrão) ou false para desafixar (apenas pins do agente)",
        },
      },
    },
  },
  {
    name: "schedule_wakeup",
    description:
      "Agenda um timer persistido no SQLite (10s a 86400s, único ou recorrente até 50 ciclos) para retomar este agente automaticamente na mesma conversa/tópico (ou WhatsApp). Use sempre que precisar checar respostas, aguardar intervalos curtos (< 3 min) ou executar follow-ups cronometrados.",
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "ID ou @apelido do agente (opcional; padrão é o agente atual).",
        },
        delaySeconds: {
          type: "number",
          description: "Intervalo em segundos até o disparo (10 a 86400; padrão 60).",
        },
        recurring: {
          type: "boolean",
          description: "Se true, reagenda automaticamente a cada ciclo até maxIterations ou cancel_wakeup.",
        },
        maxIterations: {
          type: "number",
          description: "Máximo de ciclos para wakeups recorrentes (1 a 50; padrão 10 quando recorrente).",
        },
        instruction: {
          type: "string",
          description: "Instrução clara do que verificar e fazer ao despertar neste timer.",
        },
      },
      required: ["instruction"],
    },
  },
  {
    name: "list_wakeups",
    description:
      "Lista wakeups/timers agendados ou em execução do agente (ou de outro agente por ID/@apelido).",
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "ID ou @apelido do agente (opcional; padrão é o agente atual).",
        },
        includeInactive: {
          type: "boolean",
          description: "Se true, inclui também concluídos, cancelados e com falha.",
        },
      },
    },
  },
  {
    name: "cancel_wakeup",
    description:
      "Cancela um wakeup ativo previamente criado com schedule_wakeup (use ao encerrar um ciclo recorrente de checagem).",
    parameters: {
      type: "object",
      properties: {
        wakeupId: {
          type: "string",
          description: "Identificador do wakeup (ex.: 'wk_...').",
        },
        agentId: {
          type: "string",
          description: "ID ou @apelido do agente proprietário (opcional).",
        },
      },
      required: ["wakeupId"],
    },
  },
];

export interface Phase13ToolServices {
  db?: CriativoDatabase;
  tasksService?: AgentTasksService;
  waitsService?: AgentWaitsService;
  wakeupService?: AgentWakeupService;
  queueControls?: QueueControlsService;
  contextReset?: ContextResetService;
  pinsService?: MessagePinsService;
}

export interface Phase13ToolContext {
  agenteId: string;
  turnoId: string;
  callId: string;
  threadId: string | null;
  canalId: string | null;
  entregaOrigemId: string;
  pedidoTexto: string;
  isRoutine?: boolean;
  isResumingWait?: boolean;
  channelOrigin?: "web" | "whatsapp";
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
}

/**
 * Executa de maneira segura e corrigível qualquer uma das 7 ferramentas nativas da Fase 13.
 */
export async function executePhase13Tool(
  callName: string,
  args: Record<string, unknown>,
  context: Phase13ToolContext,
  services: Phase13ToolServices,
): Promise<{ handled: boolean; result?: unknown }> {
  if (!isPhase13ToolName(callName)) {
    return { handled: false };
  }

  try {
    switch (callName) {
      case "start_task": {
        if (!services.tasksService) {
          return { handled: true, result: { erro: "AgentTasksService indisponível." } };
        }
        const title = readStringArg(args, "title", "titulo") ?? "";
        const brief = readStringArg(args, "brief", "instrucao", "conteudo") ?? "";
        const result = services.tasksService.startTaskFromTool(
          {
            agenteId: context.agenteId,
            callerThreadId: context.threadId,
            callerChannelId: context.canalId,
            turnoId: context.turnoId,
            callId: context.callId,
          },
          { title, brief },
        );
        return { handled: true, result };
      }

      case "schedule_wakeup": {
        if (!services.wakeupService) {
          return { handled: true, result: { erro: "AgentWakeupService indisponível." } };
        }
        const instruction = readStringArg(args, "instruction", "instrucao", "prompt", "note") ?? "";
        const agentId = readStringArg(args, "agentId", "agenteId", "agente_id") ?? undefined;
        const delaySeconds =
          typeof args.delaySeconds === "number"
            ? args.delaySeconds
            : typeof args.delay_seconds === "number"
              ? args.delay_seconds
              : undefined;
        const recurring = typeof args.recurring === "boolean" ? args.recurring : undefined;
        const maxIterations =
          typeof args.maxIterations === "number"
            ? args.maxIterations
            : typeof args.max_iterations === "number"
              ? args.max_iterations
              : undefined;
        const result = services.wakeupService.scheduleWakeup(
          {
            agenteId: context.agenteId,
            canalId: context.canalId,
            threadId: context.threadId,
            channelOrigin: context.channelOrigin ?? "web",
            whatsappContaId: context.whatsappContaId ?? null,
            whatsappChatJid: context.whatsappChatJid ?? null,
          },
          {
            agentId,
            delaySeconds,
            recurring,
            maxIterations,
            instruction,
          },
        );
        return { handled: true, result };
      }

      case "list_wakeups": {
        if (!services.wakeupService) {
          return { handled: true, result: { erro: "AgentWakeupService indisponível." } };
        }
        const rawTargetAgent = readStringArg(args, "agentId", "agenteId", "agente_id") ?? context.agenteId;
        const targetAgent =
          (services.db ? resolveAgentIdFromDb(services.db, rawTargetAgent) : null) ?? rawTargetAgent;
        const items = services.wakeupService.listWakeups(
          targetAgent,
          Boolean(args.includeInactive),
        );
        return {
          handled: true,
          result: {
            agentId: targetAgent,
            total: items.length,
            wakeups: items,
          },
        };
      }

      case "cancel_wakeup": {
        if (!services.wakeupService) {
          return { handled: true, result: { erro: "AgentWakeupService indisponível." } };
        }
        const wakeupId = readStringArg(args, "wakeupId", "wakeup_id", "id") ?? "";
        const agentId = readStringArg(args, "agentId", "agenteId", "agente_id") ?? undefined;
        const result = services.wakeupService.cancelWakeup(wakeupId, agentId);
        return { handled: true, result };
      }

      case "await_event": {
        if (!services.waitsService) {
          return { handled: true, result: { erro: "AgentWaitsService indisponível." } };
        }
        const note = readStringArg(args, "note", "nota") ?? "";
        const routineId = readStringArg(args, "routineId", "rotinaId", "rotina_id") ?? undefined;
        const result = services.waitsService.openWaitFromTool(
          {
            agenteId: context.agenteId,
            entregaOrigemId: context.entregaOrigemId,
            pedidoTexto: context.pedidoTexto,
            callerThreadId: context.threadId,
            callerIsRoutine: Boolean(context.isRoutine),
            isResumingWait: context.isResumingWait,
          },
          { note, routineId },
        );
        return { handled: true, result };
      }

      case "close_wait": {
        if (!services.waitsService) {
          return { handled: true, result: { erro: "AgentWaitsService indisponível." } };
        }
        const waitId = readStringArg(args, "waitId", "esperaId", "espera_id") ?? "";
        const agentId = readStringArg(args, "agentId", "agenteId", "agente_id") ?? undefined;
        if (!waitId) {
          return { handled: true, result: { erro: "Informe 'waitId' para encerrar a espera." } };
        }
        const result = services.waitsService.closeWait(waitId, agentId);
        return { handled: true, result };
      }

      case "list_waits": {
        if (!services.waitsService) {
          return { handled: true, result: { erro: "AgentWaitsService indisponível." } };
        }
        const targetAgent =
          readStringArg(args, "agentId", "agenteId", "agente_id") ?? context.agenteId;
        const result = services.waitsService.listWaitsFromTool(targetAgent);
        return { handled: true, result };
      }

      case "interrupt_agent": {
        if (!services.queueControls) {
          return { handled: true, result: { erro: "QueueControlsService indisponível." } };
        }
        const rawTargetAgent = readStringArg(args, "agentId", "agenteId", "agente_id") ?? "";
        const targetAgent =
          (services.db && rawTargetAgent ? resolveAgentIdFromDb(services.db, rawTargetAgent) : null) ??
          rawTargetAgent;
        const reason = readStringArg(args, "reason", "motivo") ?? undefined;
        if (!targetAgent) {
          return { handled: true, result: { erro: "Informe 'agentId' do agente alvo." } };
        }
        const result = services.queueControls.interruptAgentFromTool(
          context.agenteId,
          targetAgent,
          reason,
        );
        return { handled: true, result };
      }

      case "start_new_chat": {
        if (!services.contextReset) {
          return { handled: true, result: { erro: "ContextResetService indisponível." } };
        }
        const result = services.contextReset.requestNewChat({
          agenteId: context.agenteId,
          threadId: context.threadId,
        });
        return { handled: true, result };
      }

      case "pin_message": {
        if (!services.pinsService) {
          return { handled: true, result: { erro: "MessagePinsService indisponível." } };
        }
        const quote = readStringArg(args, "quote", "trecho") ?? undefined;
        const pinned = typeof args.pinned === "boolean" ? args.pinned : true;
        const result = services.pinsService.pinFromTool({
          agenteId: context.agenteId,
          threadId: context.threadId ?? `main:${context.agenteId}`,
          currentTurnId: context.turnoId,
          quote,
          pinned,
        });
        return { handled: true, result };
      }

      default:
        return { handled: false };
    }
  } catch (err) {
    return {
      handled: true,
      result: {
        ok: false,
        erro: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function readAgentContextCutoffAt(db: CriativoDatabase, agenteId: string): string | null {
  const row = db.connection
    .prepare("SELECT config_json FROM projecao_agentes WHERE agente_id = ?;")
    .get(agenteId) as { config_json: string } | undefined;
  if (!row) return null;
  try {
    const cfg = JSON.parse(row.config_json) as { context_cutoff_at?: unknown };
    return typeof cfg.context_cutoff_at === "string" && cfg.context_cutoff_at.length > 0
      ? cfg.context_cutoff_at
      : null;
  } catch {
    return null;
  }
}

export function buildPhase13SystemGuidance(options?: {
  allowStartTask?: boolean;
  wokenWaitsBlock?: string | null;
}): string {
  const parts: string[] = [
    "## Sub-tarefas, Wakeups/Timers, Esperas, Fila & Contexto (Ferramentas Nativas)",
    "- Use `start_task(title, brief)` quando uma solicitação envolver uma entrega pesada paralela ou múltiplos eixos que possam rodar sem travar o chat principal.",
    "- Use `schedule_wakeup(delaySeconds, instruction, recurring?, maxIterations?)` (10s–86400s), `list_wakeups()` e `cancel_wakeup(wakeupId)` para timers curtos (< 3 min), checagens periódicas de resposta ou retomadas automáticas na mesma conversa/tópico. PROIBIDO afirmar que agendou timer/checagem sem ter executado `schedule_wakeup` com sucesso (`ok: true`).",
    "- Use `await_event(note, routineId?)` para processos externos longos (>15 min) ligados a uma rotina/webhook e `close_wait(waitId)` / `list_waits()` quando concluir.",
    "- Use `pin_message(quote?, pinned?)` para fixar decisões-chave desta conversa, e `start_new_chat()` quando a conversa mudar totalmente de tópico e precisar renovar o contexto.",
  ];
  if (options?.wokenWaitsBlock) {
    parts.push("", options.wokenWaitsBlock);
  }
  return parts.join("\n");
}
