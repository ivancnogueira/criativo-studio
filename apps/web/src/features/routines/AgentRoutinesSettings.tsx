import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Play,
  Trash2,
} from "lucide-react";
import { daemonApi } from "../../services/websocket-client";
import type { AgentRoutinesSettingsProps } from "./routine-settings-types";
import { useAgentRoutinesController } from "./useAgentRoutinesController";
import { RoutineListView, RoutineRunsHistoryPanel } from "./RoutineListAndHistory";
import { RoutineTriggerConfigFields } from "./RoutineTriggerConfigFields";
import { RoutinePoliciesAndDestinationFields } from "./RoutinePoliciesAndDestinationFields";

export const AgentRoutinesSettings: React.FC<AgentRoutinesSettingsProps> = (props) => {
  const ctrl = useAgentRoutinesController(props);
  const {
    onRoutinesChanged
  } = props;
  const {
    mode,
    setMode,
    draft,
    setDraft,
    saving,
    testingNow,
    setTestingNow,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    unsavedConfirmOpen,
    setUnsavedConfirmOpen,
    errorMsg,
    setErrorMsg,
    statusBanner,
    setStatusBanner,
    isDirty,
    reloadRoutines,
    loadRoutineHistory,
    handleSave,
    handleBackFromEditor
  } = ctrl;

  if (mode === "list") {
    return <RoutineListView ctrl={ctrl} props={props} />;
  }

  return (
    <div className="w-full min-w-0 space-y-4 text-[#F0F0F0]">
      {/* Cabeçalho do Editor */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleBackFromEditor}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#DCDCDC] hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Voltar à lista</span>
        </button>

        {draft.rotina_id && (
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#FD2F3B] hover:underline"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Excluir rotina</span>
          </button>
        )}
      </div>

      {unsavedConfirmOpen && (
        <div className="rounded-xl bg-[#212121] border border-[#FF9412]/50 p-4 space-y-3">
          <div className="flex items-center gap-2 text-[#FF9412]">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-[14px] font-semibold">Há alterações não salvas</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setUnsavedConfirmOpen(false);
                setMode("list");
              }}
              className="rounded-xl bg-[#FD2F3B] px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              Descartar alterações
            </button>
            <button
              type="button"
              onClick={() => setUnsavedConfirmOpen(false)}
              className="rounded-xl bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
            >
              Continuar editando
            </button>
          </div>
        </div>
      )}

      {confirmDeleteOpen && draft.rotina_id && (
        <div className="rounded-xl bg-[#212121] border border-[#FD2F3B]/50 p-4 space-y-3">
          <p className="text-[14px] font-normal text-[#DCDCDC]">
            Excluir esta rotina removerá também sua agenda e webhook dedicado.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!draft.rotina_id) return;
                await daemonApi.deleteRoutine(draft.rotina_id);
                setConfirmDeleteOpen(false);
                await reloadRoutines();
                onRoutinesChanged?.();
                setMode("list");
              }}
              className="rounded-xl bg-[#FD2F3B] px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              Confirmar exclusão
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(false)}
              className="rounded-xl bg-[#2A2A2A] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0]"
            >
              Manter rotina
            </button>
          </div>
        </div>
      )}

      {/* Barra de Ações */}
      <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={draft.ativa}
          onClick={() => setDraft((d) => ({ ...d, ativa: !d.ativa }))}
          className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#F0F0F0]"
        >
          <span
            className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              draft.ativa ? "bg-[#31CF76]" : "bg-[#2A2A2A]"
            }`}
          >
            <span
              className={`h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                draft.ativa ? "translate-x-4" : "translate-x-1"
              }`}
            />
          </span>
          <span>{draft.ativa ? "Rotina ativa" : "Rotina pausada"}</span>
        </button>

        <div className="flex items-center gap-2">
          {draft.rotina_id && !isDirty && (
            <button
              type="button"
              disabled={testingNow}
              onClick={async () => {
                if (!draft.rotina_id) return;
                setTestingNow(true);
                setErrorMsg(null);
                try {
                  await daemonApi.testRoutine(draft.rotina_id);
                  setStatusBanner("Execução de teste colocada na fila.");
                  await loadRoutineHistory(draft.rotina_id);
                } catch (err) {
                  setErrorMsg(err instanceof Error ? err.message : "Erro ao testar rotina.");
                } finally {
                  setTestingNow(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#2A2A2A] hover:bg-[#333336] px-3 py-1.5 text-[14px] font-semibold text-[#F0F0F0]"
            >
              <Play className="h-3.5 w-3.5 text-[#31CF76]" />
              <span>{testingNow ? "Enfileirando..." : "Testar rotina"}</span>
            </button>
          )}

          <button
            type="button"
            disabled={saving || (Boolean(draft.rotina_id) && !isDirty)}
            onClick={() => void handleSave()}
            className="rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-1.5 text-[14px] font-semibold text-[#141414] disabled:opacity-45"
          >
            {saving ? "Salvando..." : "Salvar rotina"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl bg-[#FD2F3B]/10 border border-[#FD2F3B]/40 p-3 text-[12px] text-[#FD2F3B]">
          {errorMsg}
        </div>
      )}
      {statusBanner && (
        <div className="rounded-xl bg-[#31CF76]/10 border border-[#31CF76]/40 p-3 text-[12px] text-[#31CF76]">
          {statusBanner}
        </div>
      )}

      {/* Nome da rotina */}
      <div className="space-y-1">
        <label
          htmlFor="routine-name-input"
          className="block text-[12px] font-semibold text-[#DCDCDC]"
        >
          Nome da rotina
        </label>
        <input
          id="routine-name-input"
          type="text"
          value={draft.nome}
          onChange={(e) => setDraft((d) => ({ ...d, nome: e.target.value }))}
          placeholder="Ex.: Resumo diário de engajamento"
          className="w-full rounded-xl bg-[#212121] border border-white/10 focus:border-[#007CF7] px-3 py-2 text-[14px] font-normal text-[#F0F0F0] focus:outline-none"
        />
      </div>

      <RoutineTriggerConfigFields ctrl={ctrl} props={props} />
      <RoutinePoliciesAndDestinationFields ctrl={ctrl} props={props} />
      <RoutineRunsHistoryPanel ctrl={ctrl} props={props} />
    </div>
  );
};
