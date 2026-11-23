import {
  ArrowLeft,
  CircleCheck,
  Clock3,
  MessageSquare,
  Plus,
  RefreshCw,
  Webhook,
} from "lucide-react";
import { daemonApi } from "../../services/websocket-client";
import {
  formatRelativeExecutionLabel,
  formatScheduleSummaryPt,
} from "./routine-schedule-format";
import {
  isPastOnceRoutine,
  type AgentRoutinesSettingsProps,
} from "./routine-settings-types";
import type { AgentRoutinesController } from "./useAgentRoutinesController";

export function RoutineListView({
  ctrl,
  props,
}: {
  ctrl: AgentRoutinesController;
  props: AgentRoutinesSettingsProps;
}) {
  const {
    ownerName,
    onBackToHub
  } = props;
  const {
    routines,
    loadingList,
    errorMsg,
    openEditorForRoutine,
    openNewRoutineEditor,
    handleToggleActiveInList
  } = ctrl;

  return (
      <div className="w-full min-w-0 space-y-4 text-[#F0F0F0]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {onBackToHub && (
              <button
                type="button"
                onClick={onBackToHub}
                className="inline-flex items-center gap-1 text-[12px] text-[#979797] hover:text-white mb-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Voltar ao painel</span>
              </button>
            )}
            <h2 className="text-[20px] font-semibold text-[#F0F0F0] truncate">
              Rotinas do Criativo
            </h2>
            <p className="text-[12px] font-normal text-[#979797] truncate">{ownerName}</p>
          </div>

          <button
            type="button"
            onClick={openNewRoutineEditor}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#F0F0F0] hover:bg-white px-3 py-2 text-[14px] font-semibold text-[#141414] shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Criar rotina</span>
          </button>
        </div>

        {errorMsg && (
          <div className="rounded-xl bg-[#FD2F3B]/10 border border-[#FD2F3B]/40 p-3 text-[12px] text-[#FD2F3B]">
            {errorMsg}
          </div>
        )}

        {loadingList ? (
          <div className="space-y-2">
            <div className="h-20 rounded-xl bg-[#212121] animate-pulse" />
            <div className="h-20 rounded-xl bg-[#212121] animate-pulse" />
          </div>
        ) : routines.length === 0 ? (
          <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-6 text-center space-y-3">
            <Clock3 className="h-6 w-6 text-[#979797] mx-auto" />
            <p className="text-[14px] font-normal text-[#DCDCDC]">
              Este proprietário ainda não possui rotinas configuradas.
            </p>
            <button
              type="button"
              onClick={openNewRoutineEditor}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#F0F0F0] hover:bg-white px-4 py-2 text-[14px] font-semibold text-[#141414]"
            >
              <Plus className="h-4 w-4" />
              <span>Criar rotina</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {routines.map((r) => {
              const completedOnce = isPastOnceRoutine(r);
              return (
                <div
                  key={r.rotina_id}
                  className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 flex items-center justify-between gap-3"
                >
                  <button
                    type="button"
                    onClick={() => openEditorForRoutine(r)}
                    className="min-w-0 flex-1 text-left space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      {completedOnce ? (
                        <CircleCheck className="h-4 w-4 shrink-0 text-[#31CF76]" />
                      ) : r.trigger_kind === "webhook" ? (
                        <Webhook className="h-4 w-4 shrink-0 text-[#42A0FF]" />
                      ) : (
                        <Clock3 className="h-4 w-4 shrink-0 text-[#979797]" />
                      )}
                      <span className="text-[14px] font-semibold text-[#F0F0F0] truncate">
                        {r.nome}
                      </span>
                    </div>
                    <p className="text-[12px] font-normal text-[#979797] truncate">
                      {formatScheduleSummaryPt(r.schedule, r.timezone, r.trigger_kind)}
                    </p>
                  </button>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.ativa}
                    aria-label={r.ativa ? `Pausar ${r.nome}` : `Ativar ${r.nome}`}
                    title={
                      completedOnce
                        ? "Edite a data para o futuro antes de reativar esta rotina única"
                        : undefined
                    }
                    onClick={() => void handleToggleActiveInList(r)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      r.ativa ? "bg-[#31CF76]" : "bg-[#2A2A2A]"
                    }`}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                        r.ativa ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
  );
}

export function RoutineRunsHistoryPanel({
  ctrl,
  props,
}: {
  ctrl: AgentRoutinesController;
  props: AgentRoutinesSettingsProps;
}) {
  const {
    ownerId,
    onOpenThreadOrChat
  } = props;
  const {
    draft,
    runs,
    loadRoutineHistory,
    deliveryByExecId
  } = ctrl;

  return (
    <>
      {draft.rotina_id && (
        <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-[#F0F0F0]">
              Histórico de execuções ({runs.length})
            </h3>
            <button
              type="button"
              onClick={() => draft.rotina_id && void loadRoutineHistory(draft.rotina_id)}
              aria-label="Atualizar histórico"
              className="text-[#979797] hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          {runs.length === 0 ? (
            <p className="text-[12px] text-[#979797]">Nenhuma execução registrada ainda.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {runs.map((run) => {
                const deliv = deliveryByExecId.get(run.execucao_id);
                const missed = run.missed_count ?? 0;
                return (
                  <div
                    key={run.execucao_id}
                    className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 space-y-1.5 text-[12px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#979797]">
                        {formatRelativeExecutionLabel(run.scheduled_for)}
                      </span>
                      <span
                        className={`font-semibold ${
                          run.status === "succeeded"
                            ? "text-[#31CF76]"
                            : run.status === "failed"
                              ? "text-[#FD2F3B]"
                              : run.status === "running"
                                ? "text-[#42A0FF]"
                                : "text-[#FF9412]"
                        }`}
                      >
                        {run.status}
                      </span>
                    </div>

                    {run.silenciada && (
                      <p className="text-[#979797]">Silenciada (sem novidades)</p>
                    )}

                    {missed >= 1 && (
                      <p className="text-[#FF9412]">
                        {missed} ocorrências perdidas enquanto offline
                      </p>
                    )}

                    {run.erro && <p className="text-[#FD2F3B]">{run.erro}</p>}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {onOpenThreadOrChat && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenThreadOrChat(
                              run.thread_id ||
                                (draft.runIn === "side_thread"
                                  ? `rotina:${run.rotina_id}`
                                  : `agente:${ownerId}`)
                            )
                          }
                          className="inline-flex items-center gap-1 text-[#42A0FF] hover:underline"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          <span>Abrir conversa</span>
                        </button>
                      )}

                      {deliv && (deliv.status === "failed" || deliv.status === "pending") && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!draft.rotina_id) return;
                            await daemonApi.resendRoutineDelivery(
                              draft.rotina_id,
                              run.execucao_id
                            );
                            await loadRoutineHistory(draft.rotina_id);
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-[#2A2A2A] px-2 py-0.5 text-[#F0F0F0] hover:bg-[#333336]"
                        >
                          <RefreshCw className="h-3 w-3" />
                          <span>Reenviar entrega</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
