import { MascoteAvatar } from "../MascoteAvatar";
import { getAgentVisual, type SidebarProps } from "./sidebar-types-helpers";
import type { SidebarController } from "./useSidebarController";

export function SidebarModals({
  ctrl,
  props,
}: {
  ctrl: SidebarController;
  props: SidebarProps;
}) {
  const {
    agentes,
    deletedNativeAgents = [],
    onRestoreDeletedAgent,
    onRestoreAllDeletedAgents,
    onDeleteAgent,
    onDeleteChannel
  } = props;
  const {
    confirmDeleteChannel,
    setConfirmDeleteChannel,
    deletingChannelId,
    setDeletingChannelId,
    confirmDeleteAgent,
    setConfirmDeleteAgent,
    deletingAgentId,
    setDeletingAgentId,
    restoreModalOpen,
    setRestoreModalOpen,
    restoringAgentId,
    setRestoringAgentId
  } = ctrl;

  return (
    <>
      {confirmDeleteAgent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar exclusão de Criativo"
          data-testid="confirm-delete-agent-modal"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-4 shadow-2xl">
            <div className="space-y-1.5">
              <h3 className="text-[15px] font-semibold text-white">
                Excluir Criativo {confirmDeleteAgent.nome}?
              </h3>
              <p className="text-[12.5px] text-[#A0A0A8] leading-relaxed">
                Este Criativo será removido da barra lateral e suas conversas locais ficarão arquivadas. Criativos padrão do sistema podem ser restaurados a qualquer momento em Configurações.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteAgent(null)}
                disabled={deletingAgentId !== null}
                className="rounded-lg bg-[#2A2A2E] hover:bg-[#34343A] px-3.5 py-1.5 text-[12px] font-medium text-[#E0E0E4]"
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="confirm-delete-agent-submit"
                disabled={deletingAgentId !== null}
                onClick={async () => {
                  const target = confirmDeleteAgent;
                  if (!target || !onDeleteAgent) return;
                  setDeletingAgentId(target.agente_id);
                  try {
                    await onDeleteAgent(target.agente_id);
                    setConfirmDeleteAgent(null);
                  } finally {
                    setDeletingAgentId(null);
                  }
                }}
                className="rounded-lg bg-[#FD2F3B] hover:bg-[#E12530] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                {deletingAgentId === confirmDeleteAgent.agente_id ? "Excluindo..." : "Excluir Criativo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Restaurar Criativos padrão excluídos"
          data-testid="restore-deleted-agents-modal"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-white">
                Restaurar Criativos excluídos ({deletedNativeAgents.length})
              </h3>
              <button
                type="button"
                onClick={() => setRestoreModalOpen(false)}
                className="text-[#979797] hover:text-white text-[13px]"
              >
                Fechar
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {deletedNativeAgents.map((item) => (
                <div
                  key={item.agente_id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-[#18181A] border border-white/[0.06] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-white truncate">
                      {item.nome}
                    </div>
                    <div className="text-[11px] text-[#8E8E93] truncate">{item.papel}</div>
                  </div>
                  {onRestoreDeletedAgent && (
                    <button
                      type="button"
                      disabled={restoringAgentId === item.agente_id}
                      onClick={async () => {
                        setRestoringAgentId(item.agente_id);
                        try {
                          await onRestoreDeletedAgent(item.agente_id);
                          if (deletedNativeAgents.length <= 1) {
                            setRestoreModalOpen(false);
                          }
                        } finally {
                          setRestoringAgentId(null);
                        }
                      }}
                      className="rounded-lg bg-[#007CF7] hover:bg-[#198BFF] px-3 py-1 text-[11.5px] font-semibold text-white shrink-0 disabled:opacity-50"
                    >
                      {restoringAgentId === item.agente_id ? "Restaurando..." : "Restaurar"}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRestoreModalOpen(false)}
                className="rounded-lg bg-[#2A2A2E] hover:bg-[#34343A] px-3.5 py-1.5 text-[12px] text-[#E0E0E4]"
              >
                Fechar
              </button>
              {onRestoreAllDeletedAgents && deletedNativeAgents.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    await onRestoreAllDeletedAgents();
                    setRestoreModalOpen(false);
                  }}
                  className="rounded-lg bg-[#31CF76] hover:bg-[#28B867] px-3.5 py-1.5 text-[12px] font-semibold text-[#0E0E10]"
                >
                  Restaurar todos
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {confirmDeleteChannel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar exclusão de equipe"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-4 shadow-2xl">
            <div className="space-y-1.5">
              <h3 className="text-[15px] font-semibold text-white">
                Excluir equipe {confirmDeleteChannel.nome}?
              </h3>
              <p className="text-[12.5px] text-[#A0A0A8] leading-relaxed">
                O canal, o histórico de mensagens, memórias e rotinas exclusivas desta equipe serão removidos. Os Criativos continuam disponíveis individualmente.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteChannel(null)}
                disabled={deletingChannelId !== null}
                className="rounded-lg bg-[#2A2A2E] hover:bg-[#34343A] px-3.5 py-1.5 text-[12px] font-medium text-[#E0E0E4]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingChannelId !== null}
                onClick={async () => {
                  const target = confirmDeleteChannel;
                  if (!target || !onDeleteChannel) return;
                  setDeletingChannelId(target.canal_id);
                  try {
                    await onDeleteChannel(target.canal_id);
                    setConfirmDeleteChannel(null);
                  } finally {
                    setDeletingChannelId(null);
                  }
                }}
                className="rounded-lg bg-[#FD2F3B] hover:bg-[#E12530] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                {deletingChannelId === confirmDeleteChannel.canal_id ? "Excluindo..." : "Excluir equipe"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
