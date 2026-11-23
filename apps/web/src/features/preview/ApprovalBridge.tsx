import { useState } from "react";
import type { TarefaRegistro } from "@criativo/contracts";
import { Check, RefreshCw } from "lucide-react";

interface ApprovalBridgeProps {
  tarefa: TarefaRegistro | null;
  onApprove: (tarefaId: string) => Promise<void>;
  onRequestRevision: (tarefa: TarefaRegistro) => Promise<void>;
}

export function ApprovalBridge({
  tarefa,
  onApprove,
  onRequestRevision,
}: ApprovalBridgeProps) {
  const [loading, setLoading] = useState(false);

  if (!tarefa || tarefa.status === "concluido" || tarefa.status === "cancelado") {
    return null;
  }

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove(tarefa.tarefa_id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-[#212121] p-3">
      <button
        type="button"
        disabled={loading}
        onClick={handleApprove}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-[#31CF76] px-4 py-2.5 text-[13px] font-semibold text-[#0D0D0D] shadow-lg transition hover:brightness-105 disabled:opacity-50"
      >
        <Check className="h-4 w-4" />
        {loading ? "Publicando na Meta API..." : "✓ Aprovar e Publicar Agora"}
      </button>

      <button
        type="button"
        disabled={loading}
        onClick={() => void onRequestRevision(tarefa)}
        className="flex w-full items-center justify-center gap-1.5 rounded-full border border-white/10 bg-[#1A1A1A] px-3 py-2 text-[12px] font-medium text-[#DCDCDC] transition hover:bg-[#2A2A2A]"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Solicitar Ajuste aos Criativos
      </button>
    </div>
  );
}
