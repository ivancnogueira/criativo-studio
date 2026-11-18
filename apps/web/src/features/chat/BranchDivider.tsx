import React from "react";
import type { AgenteThreadBranch } from "@criativo/contracts";
import { GitBranch } from "lucide-react";

export interface BranchDividerProps {
  branch: AgenteThreadBranch;
  onNavigateToOrigin?: (branch: AgenteThreadBranch) => void;
}

/**
 * Separador visual exibido logo após as mensagens herdadas de uma conversa ramificada (`branch`).
 */
export const BranchDivider: React.FC<BranchDividerProps> = ({
  branch,
  onNavigateToOrigin,
}) => {
  return (
    <div className="my-4 flex items-center gap-4">
      <div className="h-px flex-1 bg-white/[0.06]" />
      <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-[#1A1A1A] px-4 py-1">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-[#42A0FF]" />
        {branch.origem_excluida ? (
          <span className="text-[12px] font-normal text-[#979797]">
            Ramificado de conversa removida
          </span>
        ) : onNavigateToOrigin ? (
          <button
            type="button"
            onClick={() => onNavigateToOrigin(branch)}
            className="text-[12px] font-semibold text-[#42A0FF] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          >
            Ramificado de {branch.origem_titulo ?? "Conversa principal"}
          </button>
        ) : (
          <span className="text-[12px] font-semibold text-[#42A0FF]">
            Ramificado de {branch.origem_titulo ?? "Conversa principal"}
          </span>
        )}
      </div>
      <div className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
};
