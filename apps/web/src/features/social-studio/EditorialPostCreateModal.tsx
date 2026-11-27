import React from "react";
import type {
  AgenteRegistro,
  EditorialPostFormato,
  EditorialPostStatus,
  MetaTrialGraduationStrategy,
} from "@criativo/contracts";
import { Loader2, X } from "lucide-react";
import { CarbonSelect } from "../../components/ui/CarbonControls";
import { MetaTrialReelControlCard } from "./MetaTrialReelControlCard";

export interface EditorialPostCreateModalProps {
  open: boolean;
  creating: boolean;
  titulo: string;
  formato: EditorialPostFormato;
  status: EditorialPostStatus;
  pilar: string;
  dataAgendada: string;
  agenteId: string;
  legenda: string;
  agentes: AgenteRegistro[];
  trialReelEnabled?: boolean;
  trialStrategy?: MetaTrialGraduationStrategy;
  onChangeTrialReelEnabled?: (enabled: boolean) => void;
  onChangeTrialStrategy?: (strategy: MetaTrialGraduationStrategy) => void;
  onClose: () => void;
  onChangeTitulo: (v: string) => void;
  onChangeFormato: (v: EditorialPostFormato) => void;
  onChangeStatus: (v: EditorialPostStatus) => void;
  onChangePilar: (v: string) => void;
  onChangeData: (v: string) => void;
  onChangeAgenteId: (v: string) => void;
  onChangeLegenda: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const EditorialPostCreateModal: React.FC<EditorialPostCreateModalProps> = ({
  open,
  creating,
  titulo,
  formato,
  status,
  pilar,
  dataAgendada,
  agenteId,
  legenda,
  agentes,
  trialReelEnabled = false,
  trialStrategy = "SS_PERFORMANCE",
  onChangeTrialReelEnabled,
  onChangeTrialStrategy,
  onClose,
  onChangeTitulo,
  onChangeFormato,
  onChangeStatus,
  onChangePilar,
  onChangeData,
  onChangeAgenteId,
  onChangeLegenda,
  onSubmit,
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nova pauta editorial"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg space-y-4 rounded-2xl border border-white/10 bg-[#141414] p-5 text-[#F0F0F0] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <h3 className="text-base font-semibold text-white">Nova Pauta Editorial</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#979797] hover:bg-[#212121] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#DCDCDC]">Título da pauta</label>
            <input
              type="text"
              required
              value={titulo}
              onChange={(e) => onChangeTitulo(e.target.value)}
              placeholder="Ex.: Carrossel 5 erros que reduzem salvamentos em [@SEU_PERFIL]"
              className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-2 text-xs text-white focus:border-[#42A0FF] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#DCDCDC]">Formato</label>
              <CarbonSelect<EditorialPostFormato>
                ariaLabel="Formato da pauta"
                value={formato}
                onChange={onChangeFormato}
                options={[
                  { value: "carrossel", label: "Carrossel (4:5)" },
                  { value: "feed_4_5", label: "Feed 4:5 (Único)" },
                  { value: "reels", label: "Reels (9:16)" },
                  { value: "story", label: "Story (9:16)" },
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#DCDCDC]">Status</label>
              <CarbonSelect<EditorialPostStatus>
                ariaLabel="Status da pauta"
                value={status}
                onChange={onChangeStatus}
                options={[
                  { value: "ideia", label: "Ideia" },
                  { value: "rascunho", label: "Rascunho" },
                  { value: "aprovacao", label: "Aprovação" },
                  { value: "agendado", label: "Agendado" },
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#DCDCDC]">Data prevista</label>
              <input
                type="date"
                value={dataAgendada}
                onChange={(e) => onChangeData(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] px-2.5 py-2 text-xs text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#DCDCDC]">Pilar editorial</label>
              <input
                type="text"
                value={pilar}
                onChange={(e) => onChangePilar(e.target.value)}
                placeholder="Autoridade, Bastidores, Oferta..."
                className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#DCDCDC]">Criativo responsável</label>
              <CarbonSelect
                ariaLabel="Criativo responsável pela pauta"
                value={agenteId}
                onChange={onChangeAgenteId}
                options={agentes.map((ag) => ({
                  value: ag.agente_id,
                  label: ag.nome,
                }))}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#DCDCDC]">Rascunho de legenda / briefing</label>
            <textarea
              rows={3}
              value={legenda}
              onChange={(e) => onChangeLegenda(e.target.value)}
              placeholder="Ideia central, CTA e observações para [NOME_DA_MARCA]..."
              className="w-full rounded-xl border border-white/10 bg-[#0D0D0D] p-3 text-xs text-white"
            />
          </div>

          {formato === "reels" && onChangeTrialReelEnabled && onChangeTrialStrategy && (
            <MetaTrialReelControlCard
              visible={true}
              enabled={trialReelEnabled}
              strategy={trialStrategy}
              onChangeEnabled={onChangeTrialReelEnabled}
              onChangeStrategy={onChangeTrialStrategy}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-[#212121] px-4 py-2 text-xs font-medium text-[#DCDCDC]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#31CF76] px-4 py-2 text-xs font-semibold text-[#0D0D0D] hover:bg-[#3CE084] disabled:opacity-50"
          >
            {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Salvar pauta</span>
          </button>
        </div>
      </form>
    </div>
  );
};
