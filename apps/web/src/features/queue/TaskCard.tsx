import { useState } from "react";
import type { StatusTarefa, TarefaRegistro } from "@criativo/contracts";
import { AlertCircle, CheckCircle2, Clock, Loader2, RotateCcw, Trash2 } from "lucide-react";

interface TaskCardProps {
  tarefa: TarefaRegistro;
  isSelected: boolean;
  onSelect: (tarefaId: string) => void;
  onRetry: (tarefaId: string) => void;
  onCancel: (tarefaId: string) => void;
}

const STATUS_BADGE: Record<StatusTarefa, { label: string; classes: string }> = {
  pendente: {
    label: "Pendente",
    classes: "border-white/10 bg-white/[0.04] text-[#979797]",
  },
  executando: {
    label: "Executando",
    classes: "border-[#42A0FF]/40 bg-[#42A0FF]/15 text-[#42A0FF]",
  },
  aguardando_aprovacao: {
    label: "Aguardando Aprovação",
    classes: "border-[#FF9412]/40 bg-[#FF9412]/15 text-[#FF9412]",
  },
  concluido: {
    label: "Concluído",
    classes: "border-[#31CF76]/40 bg-[#31CF76]/15 text-[#31CF76]",
  },
  falha: {
    label: "Falha",
    classes: "border-[#FD2F3B]/40 bg-[#FD2F3B]/15 text-[#FF6069]",
  },
  cancelado: {
    label: "Cancelado",
    classes: "border-white/10 bg-white/[0.03] text-[#6A6A6A]",
  },
};

export function TaskCard({
  tarefa,
  isSelected,
  onSelect,
  onRetry,
  onCancel,
}: TaskCardProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const badge = STATUS_BADGE[tarefa.status];

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        isSelected
          ? "border-[#42A0FF] bg-[#2A2A2A]"
          : "border-white/[0.07] bg-[#1A1A1A] hover:border-white/20"
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(tarefa.tarefa_id)}
        className="w-full text-left"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-[#141414] border border-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-[#979797]">
              P{tarefa.prioridade} • {tarefa.tipo}
            </span>
            <span className="rounded bg-[#141414] border border-white/[0.06] px-1.5 py-0.5 text-[11px] uppercase text-[#979797]">
              {tarefa.canal_origem}
            </span>
          </div>

          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.classes}`}
          >
            {tarefa.status === "executando" && <Loader2 className="h-3 w-3 animate-spin" />}
            {tarefa.status === "concluido" && <CheckCircle2 className="h-3 w-3" />}
            {tarefa.status === "pendente" && <Clock className="h-3 w-3" />}
            {tarefa.status === "falha" && <AlertCircle className="h-3 w-3" />}
            {badge.label}
          </span>
        </div>

        <h3 className="mt-2 text-sm font-semibold text-white">{tarefa.titulo}</h3>

        {tarefa.agente_id && (
          <p className="mt-1 text-xs text-[#979797]">
            Especialista: <span className="text-[#DCDCDC]">{tarefa.agente_id}</span>
          </p>
        )}
      </button>

      {tarefa.status === "falha" && (
        <div className="mt-2 rounded-lg border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 p-2 text-xs text-[#FF6069]">
          <p>
            Falha na execução do Criativo [{tarefa.agente_id ?? "Especialista"}].{" "}
            {tarefa.erro_detalhes ?? "Erro inesperado no processamento."}
          </p>
          <button
            type="button"
            onClick={() => onRetry(tarefa.tarefa_id)}
            className="mt-1.5 inline-flex items-center gap-1 rounded bg-[#FD2F3B] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            <RotateCcw className="h-3 w-3" />
            Tentar Novamente
          </button>
        </div>
      )}

      {(tarefa.status === "pendente" || tarefa.status === "executando") && (
        <div className="mt-2 flex items-center justify-end gap-2">
          {!confirmCancel ? (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="inline-flex items-center gap-1 text-xs text-[#979797] hover:text-[#FF6069]"
            >
              <Trash2 className="h-3 w-3" />
              Cancelar
            </button>
          ) : (
            <div className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#FD2F3B]/40 bg-[#141414] p-2 text-xs">
              <span className="text-[#FF6069]">
                Tem certeza que deseja cancelar esta tarefa em andamento?
              </span>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmCancel(false);
                    onCancel(tarefa.tarefa_id);
                  }}
                  className="rounded bg-[#FD2F3B] px-2 py-0.5 text-white"
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="rounded border border-white/10 px-2 py-0.5 text-[#979797]"
                >
                  Voltar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
