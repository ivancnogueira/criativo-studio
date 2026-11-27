import type { ToolDefinition } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { BackgroundJobService } from "../../waits/background-job-service.ts";
import { resolveAgentIdFromDb } from "../agent-resolver.ts";
import { readStringArg } from "./studio-tool-helpers.ts";

export const BACKGROUND_JOB_TOOL_NAMES = new Set([
  "start_background_job",
  "list_background_jobs",
  "get_background_job",
  "cancel_background_job",
]);

export function isBackgroundJobToolName(name: string): boolean {
  return BACKGROUND_JOB_TOOL_NAMES.has(name);
}

export const BACKGROUND_JOB_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "start_background_job",
    description:
      "Inicia um processo ou comando pesado em segundo plano gerenciado pelo daemon do CriativoOS (compatível com Windows, macOS e Linux). Você pode encerrar o turno após disparar: o daemon monitora o processo e acorda este agente automaticamente nesta conversa assim que o job terminar, falhar ou atingir timeout.",
    parameters: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description: "Nome curto descrevendo o trabalho (ex.: 'Render FFmpeg VSL').",
        },
        onCompleteInstruction: {
          type: "string",
          description:
            "Instrução exata do que fazer quando este job terminar e o CriativoOS acordar você nesta conversa.",
        },
        command: {
          type: "string",
          description:
            "Linha de comando shell executada via PowerShell (Windows) ou /bin/sh (macOS/Linux). Informe 'command' ou 'executable'.",
        },
        executable: {
          type: "string",
          description:
            "Binário direto sem shell (ex.: 'ffmpeg', 'node', 'python3'). Preferível com 'args' quando houver caminhos com espaços.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Argumentos para 'executable'.",
        },
        cwd: {
          type: "string",
          description: "Diretório de trabalho opcional (padrão: raiz do workspace).",
        },
        timeoutSeconds: {
          type: "number",
          description: "Timeout máximo em segundos (5 a 14400; padrão 3600).",
        },
        notifyOnComplete: {
          type: "boolean",
          description:
            "Se true (padrão), acorda automaticamente este agente na mesma conversa ao terminar.",
        },
      },
      required: ["label", "onCompleteInstruction"],
    },
  },
  {
    name: "list_background_jobs",
    description:
      "Lista os background jobs em execução ou concluídos recentemente do agente no CriativoOS.",
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "ID ou @apelido do agente (opcional; padrão é o agente atual).",
        },
        includeCompleted: {
          type: "boolean",
          description: "Se true (padrão), inclui também jobs concluídos, com falha ou cancelados.",
        },
      },
    },
  },
  {
    name: "get_background_job",
    description:
      "Consulta status, duração, código de saída, resumo do resultado e últimas linhas de stdout/stderr de um background job pelo jobId.",
    parameters: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Identificador do job (ex.: 'bg_...').",
        },
        agentId: {
          type: "string",
          description: "ID ou @apelido do agente proprietário (opcional).",
        },
      },
      required: ["jobId"],
    },
  },
  {
    name: "cancel_background_job",
    description:
      "Encerra a árvore de processo de um background job em andamento de forma segura (Windows/macOS/Linux).",
    parameters: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "Identificador do job (ex.: 'bg_...').",
        },
        agentId: {
          type: "string",
          description: "ID ou @apelido do agente proprietário (opcional).",
        },
      },
      required: ["jobId"],
    },
  },
];

export async function executeBackgroundJobTool(
  callName: string,
  args: Record<string, unknown>,
  context: {
    agenteId: string;
    threadId: string | null;
    canalId: string | null;
    channelOrigin?: "web" | "whatsapp";
    whatsappContaId?: string | null;
    whatsappChatJid?: string | null;
  },
  services: {
    db?: CriativoDatabase;
    backgroundJobService?: BackgroundJobService;
    workspaceRoot?: string;
  }
): Promise<{ handled: boolean; result: unknown }> {
  const service = services.backgroundJobService;
  if (!service) {
    return {
      handled: true,
      result: { ok: false, erro: "BackgroundJobService indisponível." },
    };
  }

  switch (callName) {
    case "start_background_job": {
      const label = readStringArg(args, "label", "titulo", "name") ?? "";
      const onCompleteInstruction =
        readStringArg(
          args,
          "onCompleteInstruction",
          "on_complete_instruction",
          "instruction",
          "instrucao"
        ) ?? "";
      const command = readStringArg(args, "command", "comando", "cmd") ?? undefined;
      const executable = readStringArg(args, "executable", "bin") ?? undefined;
      const rawArgs = Array.isArray(args.args) ? args.args.map((a) => String(a)) : undefined;
      const cwd = readStringArg(args, "cwd", "dir") ?? undefined;
      const timeoutSeconds =
        typeof args.timeoutSeconds === "number"
          ? args.timeoutSeconds
          : typeof args.timeout_seconds === "number"
            ? args.timeout_seconds
            : undefined;
      const notifyOnComplete =
        typeof args.notifyOnComplete === "boolean"
          ? args.notifyOnComplete
          : typeof args.notify_on_complete === "boolean"
            ? args.notify_on_complete
            : true;

      const snap = service.startCommandJob(
        {
          agenteId: context.agenteId,
          canalId: context.canalId,
          threadId: context.threadId,
          channelOrigin: context.channelOrigin ?? "web",
          whatsappContaId: context.whatsappContaId ?? null,
          whatsappChatJid: context.whatsappChatJid ?? null,
          workspaceRoot: services.workspaceRoot,
        },
        {
          label,
          command,
          executable,
          args: rawArgs,
          cwd,
          onCompleteInstruction,
          timeoutSeconds,
          notifyOnComplete,
        }
      );

      return {
        handled: true,
        result: {
          ok: true,
          jobId: snap.jobId,
          status: snap.status,
          pid: snap.pid,
          logPath: snap.logPath,
          notifyOnComplete: snap.notifyOnComplete,
          mensagem:
            "Background job iniciado no CriativoOS. Você pode encerrar o turno; o daemon acordará você nesta conversa assim que finalizar.",
        },
      };
    }

    case "list_background_jobs": {
      const rawAgent = readStringArg(args, "agentId", "agenteId", "agente_id") ?? context.agenteId;
      const canonical =
        (services.db ? resolveAgentIdFromDb(services.db, rawAgent) : null) ?? rawAgent;
      const includeCompleted =
        typeof args.includeCompleted === "boolean"
          ? args.includeCompleted
          : typeof args.include_completed === "boolean"
            ? args.include_completed
            : true;
      const jobs = service.listJobs(canonical, includeCompleted);
      return {
        handled: true,
        result: {
          ok: true,
          agentId: canonical,
          total: jobs.length,
          jobs,
        },
      };
    }

    case "get_background_job": {
      const jobId = readStringArg(args, "jobId", "job_id", "id") ?? "";
      const agentId = readStringArg(args, "agentId", "agenteId", "agente_id") ?? undefined;
      if (!jobId) {
        return {
          handled: true,
          result: { ok: false, erro: "Informe 'jobId' em get_background_job." },
        };
      }
      const job = service.getJob(jobId, agentId);
      if (!job) {
        return {
          handled: true,
          result: { ok: false, erro: `Background job '${jobId}' não encontrado.` },
        };
      }
      return { handled: true, result: { ok: true, job } };
    }

    case "cancel_background_job": {
      const jobId = readStringArg(args, "jobId", "job_id", "id") ?? "";
      const agentId = readStringArg(args, "agentId", "agenteId", "agente_id") ?? undefined;
      if (!jobId) {
        return {
          handled: true,
          result: { ok: false, erro: "Informe 'jobId' em cancel_background_job." },
        };
      }
      return {
        handled: true,
        result: service.cancelJob(jobId, agentId),
      };
    }

    default:
      return { handled: false, result: undefined };
  }
}
