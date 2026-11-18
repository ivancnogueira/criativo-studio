import React from "react";
import type { WorkflowVersionRecord } from "@criativo/contracts";
import { History, Lock, RotateCcw } from "lucide-react";

const VERSION_LABELS: Record<WorkflowVersionRecord["kind"], string> = {
  auto: "Automática",
  run: "Pré-execução",
  restore: "Restauração",
};

export interface WorkflowVersionBarProps {
  previewVersion: WorkflowVersionRecord | null;
  restoring?: boolean;
  onExitPreview: () => void;
  onRestoreVersion: (versionId: string) => void;
}

export const WorkflowVersionBar: React.FC<WorkflowVersionBarProps> = ({
  previewVersion,
  restoring = false,
  onExitPreview,
  onRestoreVersion,
}) => {
  if (!previewVersion) return null;

  return (
    <div className="pointer-events-auto flex h-10 items-center gap-2 rounded-xl border border-white/[0.12] bg-[#212121] px-4 py-2 shadow-2xl">
      <History className="h-4 w-4 text-[#42A0FF]" />
      <span className="text-[14px] font-semibold text-white">Versão salva</span>
      <span className="text-[12px] font-normal text-[#979797]">
        {VERSION_LABELS[previewVersion.kind]} · rev. #{previewVersion.revisao_grafo} ·{" "}
        {new Date(previewVersion.criado_em).toLocaleString("pt-BR")}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-[#242424] px-2 py-0.5 text-[12px] font-normal text-[#979797]">
        <Lock className="h-3 w-3" />
        <span>Somente leitura</span>
      </span>

      <div className="ml-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onExitPreview}
          className="rounded-lg bg-[#2A2A2A] px-3 py-1 text-[12px] font-semibold text-white hover:bg-[#333335]"
        >
          Voltar ao atual
        </button>
        <button
          type="button"
          disabled={restoring}
          onClick={() => onRestoreVersion(previewVersion.version_id)}
          className="flex items-center gap-1 rounded-lg bg-[#F0F0F0] px-3 py-1 text-[12px] font-semibold text-[#141414] hover:bg-white disabled:opacity-60"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>{restoring ? "Restaurando versão..." : "Restaurar versão"}</span>
        </button>
      </div>
    </div>
  );
};
