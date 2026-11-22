import React from "react";
import {
  ArrowLeft,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { AgentRoutinesSettings } from "../routines/AgentRoutinesSettings";
import { InspectorHubAndToolsTabs } from "./InspectorHubAndToolsTabs";
import { InspectorAgentExtraTabs } from "./InspectorAgentExtraTabs";
import { InspectorAgentConfigTab } from "./InspectorAgentConfigTab";
import { InspectorChannelConfigTab } from "./InspectorChannelConfigTab";
import type { InspectorSubView, RightInspectorPanelProps } from "./inspector-types";
import { useRightInspectorController } from "./useRightInspectorController";

export type { InspectorSubView, RightInspectorPanelProps };

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = (props) => {
  const ctrl = useRightInspectorController(props);
  const {
    open,
    widthPx,
    agente,
    canal = null,
    canais = [],
    routineFocusSignal = null,
    onClose,
    onOpenRoutineThread,
    onRoutinesChanged,
    onAddChannelMemory,
    onDeleteChannelMemory,
  } = props;

  const {
    subView,
    setSubView,
    backTarget,
    panelTitle,
    channelMemories,
    setChannelMemories,
    channelMemoryDraft,
    setChannelMemoryDraft,
    pendingPermissionModal,
    setPendingPermissionModal,
    handleConfirmPermission,
  } = ctrl;

  if (!open) return null;

  return (
    <aside
      aria-label={canal && !agente ? "Inspetor contextual da equipe" : "Inspetor contextual do agente"}
      style={widthPx ? { width: `${widthPx}px` } : { width: "330px" }}
      className="relative shrink-0 bg-[#1A1A1A] border-l border-white/[0.06] flex flex-col h-full overflow-hidden"
    >
      <div className="h-[48px] shrink-0 px-3.5 flex items-center justify-between gap-2 border-b border-white/[0.06]">
        {subView === "hub" ? (
          <span className="text-[12px] font-medium text-[#787878]">
            {canal && !agente ? "Painel da equipe" : "Painel do agente"}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setSubView(backTarget)}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#DCDCDC] hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{panelTitle}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar inspetor lateral"
          className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#242424] ml-auto"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 min-w-0">
        <InspectorHubAndToolsTabs ctrl={ctrl} props={props} />
        <InspectorAgentExtraTabs ctrl={ctrl} props={props} />
        <InspectorAgentConfigTab ctrl={ctrl} props={props} />
        {subView === "channel_routines" && canal && (
          <AgentRoutinesSettings
            ownerKind="canal"
            ownerId={canal.canal_id}
            ownerName={canal.nome}
            canais={canais}
            initialSelectedRoutineId={routineFocusSignal?.rotinaId ?? null}
            onBackToHub={() => setSubView("channel_config")}
            onOpenThreadOrChat={onOpenRoutineThread}
            onRoutinesChanged={onRoutinesChanged}
          />
        )}

        {subView === "channel_memories" && canal && (
          <div className="space-y-4">
            <p className="rounded-xl bg-[#212121] border border-white/[0.06] p-3 text-[11.5px] text-[#979797] leading-relaxed">
              Memórias salvas aqui pertencem exclusivamente à equipe <strong className="text-white">{canal.nome}</strong>. Outras conversas individuais dos agentes não as enxergam.
            </p>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={channelMemoryDraft}
                onChange={(e) => setChannelMemoryDraft(e.target.value)}
                placeholder="Ex.: Aprovar copy antes de gerar arte..."
                aria-label="Adicionar memória da equipe"
                className="flex-1 rounded-xl bg-[#212121] border border-white/10 px-3 py-1.5 text-[12px] text-white placeholder-[#6A6A6A] focus:outline-none"
              />
              <button
                type="button"
                disabled={!channelMemoryDraft.trim() || !onAddChannelMemory}
                onClick={async () => {
                  if (!onAddChannelMemory || !channelMemoryDraft.trim()) return;
                  const txt = channelMemoryDraft.trim();
                  setChannelMemoryDraft("");
                  const next = await onAddChannelMemory(canal.canal_id, txt);
                  setChannelMemories(next);
                }}
                className="rounded-xl bg-[#2A2A2A] hover:bg-[#333336] disabled:opacity-40 px-3 py-1.5 text-[12px] font-medium text-white"
              >
                Fixar
              </button>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {channelMemories.length === 0 ? (
                <p className="rounded-xl border border-white/[0.06] bg-[#212121] p-3.5 text-[11.5px] text-[#8E8E93]">
                  Nenhuma memória salva para esta equipe ainda.
                </p>
              ) : (
                channelMemories.map((m) => (
                  <div
                    key={m.memoria_id}
                    className="flex items-start justify-between gap-2 rounded-lg bg-[#212121] border border-white/[0.05] px-3 py-2 text-[11.5px] text-[#DCDCDC]"
                  >
                    <span className="min-w-0 flex-1 break-words">{m.texto}</span>
                    {onDeleteChannelMemory && (
                      <button
                        type="button"
                        aria-label="Remover memória da equipe"
                        onClick={async () => {
                          await onDeleteChannelMemory(canal.canal_id, m.memoria_id);
                          setChannelMemories((prev) =>
                            prev.filter((item) => item.memoria_id !== m.memoria_id)
                          );
                        }}
                        className="text-[#787878] hover:text-[#FF7675] shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        <InspectorChannelConfigTab ctrl={ctrl} props={props} />
      </div>

      {/* Modal de confirmação explícita ao ampliar permission_level */}
      {pendingPermissionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-[16px]">
          <div className="w-full max-w-[420px] space-y-[16px] rounded-xl border border-[#FF9412]/40 bg-[#212121] p-[20px] shadow-2xl">
            <div className="flex items-start gap-[12px]">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FF9412]/15 text-[#FF9412]">
                <ShieldAlert size={18} />
              </div>
              <div className="space-y-1">
                <h4 className="text-[14px] font-semibold text-[#F0F0F0]">
                  Ampliar permissões de {agente?.nome ?? "agente"}?
                </h4>
                <p className="text-[12px] text-[#979797]">
                  Acesso ampliado permite editar pastas fora das restrições padrão do agente.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-[8px]">
              <button
                type="button"
                onClick={() => setPendingPermissionModal(null)}
                className="rounded-lg bg-[#2A2A2A] px-3 py-2 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#333333]"
              >
                Manter restrição
              </button>
              <button
                type="button"
                onClick={handleConfirmPermission}
                className="rounded-lg bg-[#F0F0F0] px-4 py-2 text-[12px] font-semibold text-[#141414] hover:bg-white"
              >
                Conceder acesso
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
