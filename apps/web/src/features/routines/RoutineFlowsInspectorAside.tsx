import {
  Link2,
  Trash2,
  X,
} from "lucide-react";
import {
  daemonApi,
} from "../../services/websocket-client";
import { stepBadgeMeta } from "./routine-flows-helpers";
import type { RoutineFlowsController } from "./useRoutineFlowsController";

export function RoutineFlowsInspectorAside({ ctrl }: { ctrl: RoutineFlowsController }) {
  const { agente, onOpenRoutineSettings, onOpenAgentChat, selectedItem, setSelectedItem, edgeInstructionDraft, setEdgeInstructionDraft, savingInstruction, setSavingInstruction, loadCanvas, ownerId, activeRun, selectedLink } = ctrl;
  return (
    <>
        {/* Inspetor Lateral do Canvas */}
        {selectedItem && (
          <aside className="w-[300px] shrink-0 bg-[#1A1A1A] border-l border-white/[0.06] p-4 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-[#F0F0F0]">
                {selectedItem.kind === "link"
                  ? "Conexão do Fluxo"
                  : selectedItem.kind === "routine"
                    ? "Detalhes da Rotina"
                    : "Agente no Fluxo"}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                aria-label="Fechar detalhes"
                className="text-[#979797] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedItem.kind === "link" && selectedLink && (
              <div className="space-y-3">
                <p className="text-[12px] text-[#979797]">
                  <Link2 className="inline h-3.5 w-3.5 mr-1 text-[#31CF76]" />
                  {selectedLink.from_agent_id} → {selectedLink.to_agent_id}
                </p>
                <textarea
                  rows={4}
                  value={edgeInstructionDraft}
                  onChange={(e) => setEdgeInstructionDraft(e.target.value)}
                  placeholder="Instrução específica para este passo..."
                  className="w-full rounded-xl bg-[#212121] border border-white/10 focus:border-[#007CF7] p-2.5 text-[12px] text-[#F0F0F0] focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={savingInstruction}
                    onClick={async () => {
                      setSavingInstruction(true);
                      try {
                        await daemonApi.updateRoutineFlowLink(
                          selectedLink.link_id,
                          edgeInstructionDraft
                        );
                        await loadCanvas(ownerId);
                      } finally {
                        setSavingInstruction(false);
                      }
                    }}
                    className="rounded-xl bg-[#F0F0F0] px-3 py-1.5 text-[12px] font-semibold text-[#141414]"
                  >
                    Salvar instrução
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await daemonApi.deleteRoutineFlowLink(selectedLink.link_id, ownerId);
                      setSelectedItem(null);
                      await loadCanvas(ownerId);
                    }}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#FD2F3B]/15 px-3 py-1.5 text-[12px] font-semibold text-[#FD2F3B]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Remover conexão</span>
                  </button>
                </div>
              </div>
            )}

            {selectedItem.kind === "routine" && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => onOpenRoutineSettings(selectedItem.id)}
                  className="w-full rounded-xl bg-[#212121] hover:bg-[#2A2A2A] border border-white/[0.08] py-2 text-[14px] font-semibold text-[#F0F0F0]"
                >
                  Configurar rotina
                </button>
              </div>
            )}

            {selectedItem.kind === "agent" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => onOpenAgentChat(selectedItem.id)}
                  className="w-full rounded-xl bg-[#212121] hover:bg-[#2A2A2A] border border-white/[0.08] py-2 text-[14px] font-semibold text-[#42A0FF]"
                >
                  Abrir chat
                </button>
                {selectedItem.id !== ownerId && (
                  <button
                    type="button"
                    onClick={async () => {
                      await daemonApi.deleteRoutineFlowPosition(
                        ownerId,
                        `agent:${selectedItem.id}`
                      );
                      setSelectedItem(null);
                      await loadCanvas(ownerId);
                    }}
                    className="w-full rounded-xl bg-[#FD2F3B]/15 py-2 text-[12px] font-semibold text-[#FD2F3B]"
                  >
                    Remover agente do fluxo
                  </button>
                )}
              </div>
            )}

            {activeRun && (
              <div className="pt-3 border-t border-white/[0.06] space-y-2">
                <h3 className="text-[12px] font-semibold text-[#979797]">
                  Linha do tempo da execução
                </h3>
                {activeRun.steps.map((st) => {
                  const stBadge = stepBadgeMeta(st.status);
                  return (
                    <div
                      key={st.step_id}
                      className="rounded-xl bg-[#212121] border border-white/[0.06] p-2.5 space-y-1 text-[12px]"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-[#F0F0F0]">{st.agente_id}</span>
                        <span className={`rounded-full px-2 py-0.5 ${stBadge.classes}`}>
                          {stBadge.label}
                        </span>
                      </div>
                      {st.output && <p className="text-[#DCDCDC] line-clamp-3">{st.output}</p>}
                      {st.erro && <p className="text-[#FD2F3B]">{st.erro}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
    </>
  );
}
