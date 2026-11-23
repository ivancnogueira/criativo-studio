import {
  Bell,
  BellOff,
  ChevronRight,
  CircleDot,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FolderPlus,
  GitFork,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import type { SidebarProps } from "./sidebar-types-helpers";
import type { SidebarController } from "./useSidebarController";

export function SidebarAgentContextMenu({
  ag,
  isPinned,
  isHidden,
  alignLeft = false,
  ctrl,
  props,
}: {
  ag: SidebarProps["agentes"][number];
  isPinned: boolean;
  isHidden: boolean;
  alignLeft?: boolean;
  ctrl: SidebarController;
  props: SidebarProps;
}) {
  const {
    onMutateSidebar,
    onDuplicateAgent,
    onToggleUnreadAgent,
    onToggleMuteAgent,
    onNewSubconversation,
    onOpenAgentNewWindow,
    onEditAgent,
    onDeleteAgent
  } = props;
  const {
    setAgentMenuKey,
    agentMoveSubmenuOpen,
    setAgentMoveSubmenuOpen,
    setConfirmDeleteAgent,
    isAgentMarkedUnread,
    orderedSections
  } = ctrl;

    const markedUnread = isAgentMarkedUnread(ag);
    const currentNotificationLevel =
      ((ag.config as Record<string, unknown> | undefined)?.notification_level as
        | "all"
        | "mentions_only"
        | "muted"
        | undefined) ?? "all";
    const isMuted = currentNotificationLevel === "muted";

    return (
      <div
        role="menu"
        aria-label={`Opções de ${ag.nome}`}
        onClick={(e) => e.stopPropagation()}
        className={`absolute ${alignLeft ? "left-0" : "right-1"} top-full mt-1 z-50 w-56 rounded-xl bg-[#242424] border border-white/10 shadow-[0_14px_35px_rgba(0,0,0,0.75)] p-1 space-y-0.5`}
      >
        {onMutateSidebar && (
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setAgentMenuKey(null);
              await onMutateSidebar({
                op: "set_pin",
                agentId: ag.agente_id,
                pinned: !isPinned,
              });
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
          >
            {isPinned ? (
              <PinOff className="h-3.5 w-3.5 text-[#42A0FF]" />
            ) : (
              <Pin className="h-3.5 w-3.5 text-[#42A0FF]" />
            )}
            <span>{isPinned ? "Desafixar" : "Fixar"}</span>
          </button>
        )}

        {onToggleUnreadAgent && (
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setAgentMenuKey(null);
              await onToggleUnreadAgent(ag.agente_id, !markedUnread);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
          >
            <CircleDot className="h-3.5 w-3.5 text-[#74B9FF]" />
            <span>{markedUnread ? "Marcar como lido" : "Marcar como não lido"}</span>
          </button>
        )}

        {onToggleMuteAgent && (
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setAgentMenuKey(null);
              await onToggleMuteAgent(ag.agente_id, isMuted ? "all" : "muted");
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
          >
            {isMuted ? (
              <Bell className="h-3.5 w-3.5 text-[#31CF76]" />
            ) : (
              <BellOff className="h-3.5 w-3.5 text-[#979797]" />
            )}
            <span>{isMuted ? "Ativar alertas" : "Silenciar Criativo"}</span>
          </button>
        )}

        {onNewSubconversation && (
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setAgentMenuKey(null);
              await onNewSubconversation(ag.agente_id);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
          >
            <GitFork className="h-3.5 w-3.5 text-[#42A0FF]" />
            <span>Nova Subconversa</span>
          </button>
        )}

        {onOpenAgentNewWindow && (
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setAgentMenuKey(null);
              await onOpenAgentNewWindow(ag.agente_id);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
          >
            <ExternalLink className="h-3.5 w-3.5 text-[#979797]" />
            <span>Abrir em nova janela</span>
          </button>
        )}

        {onMutateSidebar && (
          <div>
            <button
              type="button"
              role="menuitem"
              onClick={() => setAgentMoveSubmenuOpen((v) => !v)}
              className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <FolderPlus className="h-3.5 w-3.5 text-[#979797]" />
                <span>Mover para</span>
              </span>
              <ChevronRight
                className={`h-3 w-3 transition-transform ${agentMoveSubmenuOpen ? "rotate-90" : ""}`}
              />
            </button>
            {agentMoveSubmenuOpen && (
              <div className="mt-0.5 pl-3 space-y-0.5 max-h-36 overflow-y-auto">
                <button
                  type="button"
                  onClick={async () => {
                    setAgentMenuKey(null);
                    setAgentMoveSubmenuOpen(false);
                    await onMutateSidebar({
                      op: "move_agent",
                      agentId: ag.agente_id,
                      sectionId: null,
                    });
                  }}
                  className="w-full px-2 py-1 rounded-md text-left text-[11.5px] text-[#979797] hover:bg-[#303033] hover:text-white truncate"
                >
                  Sem diretório (padrão)
                </button>
                {orderedSections.map((sec) => (
                  <button
                    key={sec.section_id}
                    type="button"
                    onClick={async () => {
                      setAgentMenuKey(null);
                      setAgentMoveSubmenuOpen(false);
                      await onMutateSidebar({
                        op: "move_agent",
                        agentId: ag.agente_id,
                        sectionId: sec.section_id,
                      });
                    }}
                    className="w-full px-2 py-1 rounded-md text-left text-[11.5px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white truncate"
                    style={{ paddingLeft: `${Math.max(0, sec.nivel - 1) * 10 + 8}px` }}
                  >
                    {sec.nome}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {onEditAgent && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAgentMenuKey(null);
              onEditAgent(ag.agente_id);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
          >
            <Pencil className="h-3.5 w-3.5 text-[#979797]" />
            <span>Editar Criativo</span>
          </button>
        )}

        {onDuplicateAgent && (
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setAgentMenuKey(null);
              await onDuplicateAgent(ag.agente_id);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
          >
            <Copy className="h-3.5 w-3.5 text-[#31CF76]" />
            <span>Duplicar Criativo</span>
          </button>
        )}

        {onMutateSidebar && (
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setAgentMenuKey(null);
              await onMutateSidebar({
                op: "set_hidden",
                agentId: ag.agente_id,
                hidden: !isHidden,
              });
            }}
            className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
          >
            {isHidden ? (
              <Eye className="h-3.5 w-3.5 text-[#31CF76]" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-[#979797]" />
            )}
            <span>{isHidden ? "Reexibir Criativo" : "Ocultar Criativo"}</span>
          </button>
        )}

        {onDeleteAgent && (
          <div className="border-t border-white/[0.06] pt-0.5 mt-0.5">
            <button
              type="button"
              role="menuitem"
              data-testid="context-delete-agent"
              onClick={() => {
                setAgentMenuKey(null);
                setAgentMoveSubmenuOpen(false);
                setConfirmDeleteAgent(ag);
              }}
              className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#FF7675] hover:bg-[#FD2F3B]/15 flex items-center gap-2"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Excluir Criativo</span>
            </button>
          </div>
        )}
      </div>
    );
}
