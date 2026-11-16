import React from "react";
import type { TarefaRegistro } from "@criativo/contracts";
import { ApprovalBridge } from "../preview/ApprovalBridge";
import { InstagramMobilePreview } from "../preview/InstagramMobilePreview";
import { QueueTimeline } from "../queue/QueueTimeline";
import { AgentStepsWaterfall, type AgentStepLog } from "../trace/AgentStepsWaterfall";

interface TasksQueuePageProps {
  tarefas: TarefaRegistro[];
  selectedTaskId: string | null;
  steps: AgentStepLog[];
  thoughtStream: string;
  onSelectTask: (tarefaId: string) => void;
  onCreateTask: (input: {
    titulo: string;
    tipo: string;
    prioridade: number;
    prompt: string;
  }) => Promise<void>;
  onRetryTask: (tarefaId: string) => void;
  onCancelTask: (tarefaId: string) => void;
  onApproveTask: (tarefaId: string) => Promise<void>;
  onRequestRevision: (tarefa: TarefaRegistro) => Promise<void>;
}

/**
 * Página dedicada 'Fila e Tarefas' acessível pela Rail lateral esquerda.
 */
export const TasksQueuePage: React.FC<TasksQueuePageProps> = ({
  tarefas,
  selectedTaskId,
  steps,
  thoughtStream,
  onSelectTask,
  onCreateTask,
  onRetryTask,
  onCancelTask,
  onApproveTask,
  onRequestRevision,
}) => {
  const selectedTask =
    tarefas.find((t) => t.tarefa_id === selectedTaskId) ??
    tarefas.find((t) => t.status === "aguardando_aprovacao") ??
    tarefas[0] ??
    null;

  return (
    <div className="flex-1 h-full bg-[#1A1A1A] overflow-y-auto p-6">
      <div className="max-w-[1360px] mx-auto space-y-5">
        <div>
          <h1 className="text-[20px] font-bold text-white">Fila FIFO &amp; Execução ao Vivo</h1>
          <p className="text-[12.5px] text-[#979797]">
            Acompanhe prioridade, pensamentos em streaming dos agentes e aprove publicações com segurança Meta API.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-7 space-y-4">
            <QueueTimeline
              tarefas={tarefas}
              selectedTaskId={selectedTask?.tarefa_id ?? null}
              onSelectTask={onSelectTask}
              onCreateTask={onCreateTask}
              onRetryTask={onRetryTask}
              onCancelTask={onCancelTask}
            />
            <AgentStepsWaterfall
              steps={steps}
              thoughtStream={thoughtStream}
              selectedTaskId={selectedTask?.tarefa_id ?? null}
            />
          </div>

          <div className="lg:col-span-5">
            <InstagramMobilePreview tarefa={selectedTask} />
            <ApprovalBridge
              tarefa={selectedTask}
              onApprove={onApproveTask}
              onRequestRevision={onRequestRevision}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
