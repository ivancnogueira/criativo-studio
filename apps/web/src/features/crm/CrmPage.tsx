import React, { useEffect, useState } from "react";
import type { CrmContact, CrmProposal, CrmStage } from "@criativo/contracts";
import { Briefcase, Check, Plus, X } from "lucide-react";
import { CarbonSelect, type CarbonSelectOption } from "../../components/ui/CarbonControls";
import { daemonApi } from "../../services/websocket-client";

const STAGE_OPTIONS: CarbonSelectOption[] = [
  { value: "lead", label: "Lead" },
  { value: "qualificado", label: "Qualificado" },
  { value: "proposta", label: "Proposta" },
  { value: "negociacao", label: "Negociação" },
  { value: "ganho", label: "Ganho" },
  { value: "perdido", label: "Perdido" },
];

export const CrmPage: React.FC<{
  initialEnabled?: boolean;
  onEnabledChanged?: (enabled: boolean) => void;
}> = ({ initialEnabled = false, onEnabledChanged }) => {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [proposals, setProposals] = useState<CrmProposal[]>([]);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [stage, setStage] = useState<CrmStage>("lead");

  const reload = async () => {
    try {
      const [{ enabled: isEn, contacts: list }, propsList] = await Promise.all([
        daemonApi.listCrmContacts(),
        daemonApi.listCrmProposals(),
      ]);
      setEnabled(isEn);
      setContacts(list);
      setProposals(propsList);
    } catch {
      // ignora em SSR/offline
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const handleToggle = async () => {
    const next = await daemonApi.toggleCrm(!enabled);
    setEnabled(next);
    onEnabledChanged?.(next);
    await reload();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await daemonApi.createCrmContact({ name: name.trim(), company: company.trim() || null, stage });
    setName("");
    setCompany("");
    await reload();
  };

  const pendingProposals = proposals.filter((p) => p.status === "pending");

  return (
    <section
      aria-label="CRM Leve Opcional"
      data-testid="crm-page"
      className="flex-1 h-full overflow-y-auto bg-[#1A1A1A] text-white p-6 space-y-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
        <div className="flex items-center gap-2.5">
          <Briefcase className="h-5 w-5 text-[#31CF76]" />
          <div>
            <h1 className="text-[20px] font-semibold">CRM Leve & Funil</h1>
            <p className="text-[12px] text-[#979797]">
              Módulo opcional para acompanhar leads dos canais; Criativos apenas propõem alterações via `crm_propose`.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleToggle()}
          className={`rounded-xl px-4 py-2 text-[12.5px] font-semibold ${
            enabled
              ? "bg-[#31CF76]/20 text-[#31CF76] border border-[#31CF76]/40"
              : "bg-[#2A2A2E] text-white border border-white/10"
          }`}
        >
          {enabled ? "CRM Ativado" : "Ativar módulo CRM"}
        </button>
      </header>

      {pendingProposals.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-[13px] font-semibold text-[#FF9412]">
            Propostas de Criativos aguardando aprovação ({pendingProposals.length})
          </h2>
          {pendingProposals.map((p) => (
            <div
              key={p.proposalId}
              className="rounded-xl bg-[#212121] border border-[#FF9412]/30 p-3.5 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-white">{p.summary}</div>
                <div className="text-[11px] font-mono text-[#979797]">
                  Agente: {p.agenteId} · {p.operation} · {JSON.stringify(p.diffJson)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    void daemonApi.decideCrmProposal(p.proposalId, false).then(() => reload())
                  }
                  className="inline-flex items-center gap-1 rounded-lg bg-[#2A2A2A] px-3 py-1.5 text-[12px] text-white"
                >
                  <X className="h-3.5 w-3.5" /> Rejeitar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void daemonApi.decideCrmProposal(p.proposalId, true).then(() => reload())
                  }
                  className="inline-flex items-center gap-1 rounded-lg bg-[#31CF76] px-3 py-1.5 text-[12px] font-semibold text-[#141414]"
                >
                  <Check className="h-3.5 w-3.5" /> Aprovar proposta
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {enabled && (
        <>
          <form
            onSubmit={handleCreate}
            className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 grid grid-cols-1 md:grid-cols-4 gap-2.5"
          >
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do lead / contato"
              className="rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12px] text-white"
            />
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Empresa opcional"
              className="rounded-xl bg-[#141414] border border-white/10 px-3 py-2 text-[12px] text-white"
            />
            <CarbonSelect
              ariaLabel="Estágio inicial no funil"
              value={stage}
              options={STAGE_OPTIONS}
              onChange={(v) => setStage(v as CrmStage)}
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-2 text-[12.5px] font-semibold text-[#141414]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Adicionar contato</span>
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {contacts.map((c) => (
              <div
                key={c.contactId}
                className="rounded-xl bg-[#212121] border border-white/[0.06] p-3.5 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-white truncate">{c.name}</span>
                  <span className="rounded-full bg-[#42A0FF]/15 px-2 py-0.5 text-[10.5px] text-[#74B9FF]">
                    {c.stage}
                  </span>
                </div>
                {c.company && <div className="text-[12px] text-[#979797]">{c.company}</div>}
                {c.email && <div className="text-[11px] font-mono text-[#78787D]">{c.email}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
};
