import React, { useState } from "react";
import type { CrmProposal } from "@criativo/contracts";
import { Briefcase, Check, X } from "lucide-react";

export const CrmProposalCard: React.FC<{
  proposal: CrmProposal;
  onDecide: (proposalId: string, approved: boolean) => Promise<void>;
}> = ({ proposal, onDecide }) => {
  const [busy, setBusy] = useState(false);

  const handle = async (approved: boolean) => {
    setBusy(true);
    try {
      await onDecide(proposal.proposalId, approved);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="crm-proposal-card"
      className="rounded-xl border border-white/[0.08] bg-[#212121] p-3.5 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
          <Briefcase className="h-4 w-4 text-[#31CF76]" />
          <span>Proposta de CRM (`crm_propose`)</span>
        </div>
        <span className="rounded-full bg-[#FF9412]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#FF9412]">
          {proposal.status}
        </span>
      </div>
      <p className="text-[12.5px] text-[#DCDCDC]">{proposal.summary}</p>
      <pre className="rounded-lg bg-[#141414] p-2 text-[11px] font-mono text-[#979797] overflow-x-auto">
        {JSON.stringify(proposal.diffJson, null, 2)}
      </pre>
      {proposal.status === "pending" && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handle(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-[#31CF76] px-3 py-1.5 text-[12px] font-semibold text-[#141414]"
          >
            <Check className="h-3.5 w-3.5" /> Confirmar CRM
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handle(false)}
            className="inline-flex items-center gap-1 rounded-lg bg-[#2A2A2A] px-3 py-1.5 text-[12px] text-white"
          >
            <X className="h-3.5 w-3.5" /> Rejeitar
          </button>
        </div>
      )}
    </div>
  );
};
