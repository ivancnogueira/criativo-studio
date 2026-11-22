import {
  MoreVertical,
} from "lucide-react";
import { MascoteAvatar } from "../MascoteAvatar";
import {
  getAgentVisual,
  formatHour,
  stripMarkdownPreview,
  type SidebarProps,
} from "./sidebar-types-helpers";
import type { SidebarController } from "./useSidebarController";
import { SidebarAgentContextMenu } from "./SidebarAgentContextMenu";

export function SidebarPinnedTile({
  ag,
  ctrl,
  props,
}: {
  ag: SidebarProps["agentes"][number];
  ctrl: SidebarController;
  props: SidebarProps;
}) {
  const {
    selectedAgentId,
    selectedChannelId,
    onSelectAgent,
    onMutateSidebar,
    onDuplicateAgent,
    onReorderPins,
    onToggleUnreadAgent,
    onToggleMuteAgent,
    onNewSubconversation,
    onOpenAgentNewWindow,
    onEditAgent,
    onDeleteAgent,
    agentActivityByAgentId
  } = props;
  const {
    workingAgentSet,
    setSectionMenuId,
    agentMenuKey,
    setAgentMenuKey,
    setPinnedTooltip,
    setAgentMoveSubmenuOpen,
    dragPayload,
    setDragPayload,
    setDropIndicatorKey,
    hiddenSet,
    pinOrder,
    isAgentMarkedUnread
  } = ctrl;

    const vis = getAgentVisual(ag);
    const selected = selectedAgentId === ag.agente_id && !selectedChannelId;
    const isWorking = ag.status === "trabalhando" || workingAgentSet.has(ag.agente_id);
    const rowKey = `pin-${ag.agente_id}`;
    const isHidden = hiddenSet.has(ag.agente_id);
    const showMenu = agentMenuKey === rowKey;
    const unreadCount = ag.nao_lidas ?? 0;
    const markedUnread = isAgentMarkedUnread(ag);
    const canManageRow = Boolean(
      onMutateSidebar ||
        onDuplicateAgent ||
        onDeleteAgent ||
        onEditAgent ||
        onToggleUnreadAgent ||
        onToggleMuteAgent ||
        onNewSubconversation ||
        onOpenAgentNewWindow
    );

    return (
      <div
        key={rowKey}
        draggable={Boolean(onReorderPins || onMutateSidebar)}
        onDragStart={(e) => {
          e.stopPropagation();
          setDragPayload({ kind: "pin", agentId: ag.agente_id });
        }}
        onDragEnd={() => {
          setDragPayload(null);
          setDropIndicatorKey(null);
        }}
        onDragOver={(e) => {
          if (!dragPayload || dragPayload.kind !== "pin" || dragPayload.agentId === ag.agente_id) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          setDropIndicatorKey(`agent:${rowKey}`);
        }}
        onDrop={async (e) => {
          if (!dragPayload || dragPayload.kind !== "pin" || dragPayload.agentId === ag.agente_id) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          setDropIndicatorKey(null);
          const next = pinOrder.filter((id) => id !== dragPayload.agentId);
          const targetIdx = next.indexOf(ag.agente_id);
          const insertAt = targetIdx >= 0 ? targetIdx : next.length;
          next.splice(insertAt, 0, dragPayload.agentId);
          if (onReorderPins) {
            await onReorderPins(next);
          } else if (onMutateSidebar) {
            await onMutateSidebar({ op: "reorder_pins", pins: next });
          }
          setDragPayload(null);
        }}
        onContextMenu={(e) => {
          if (!canManageRow) return;
          e.preventDefault();
          setSectionMenuId(null);
          setAgentMoveSubmenuOpen(false);
          setAgentMenuKey((prev) => (prev === rowKey ? null : rowKey));
        }}
        className="group/pin relative"
      >
        <button
          type="button"
          data-testid={`pinned-agent-tile-${ag.agente_id}`}
          aria-label={ag.nome}
          onMouseEnter={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setPinnedTooltip({
              agentId: ag.agente_id,
              nome: ag.nome,
              left: rect.left + rect.width / 2,
              top: rect.top,
            });
          }}
          onMouseLeave={() =>
            setPinnedTooltip((prev) => (prev?.agentId === ag.agente_id ? null : prev))
          }
          onFocus={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setPinnedTooltip({
              agentId: ag.agente_id,
              nome: ag.nome,
              left: rect.left + rect.width / 2,
              top: rect.top,
            });
          }}
          onBlur={() =>
            setPinnedTooltip((prev) => (prev?.agentId === ag.agente_id ? null : prev))
          }
          onClick={() => {
            setPinnedTooltip(null);
            onSelectAgent(ag.agente_id);
          }}
          className={`relative h-[48px] w-[48px] rounded-2xl flex items-center justify-center transition-colors border ${
            selected
              ? "bg-[#252527] border-[#007CF7]/70 ring-1 ring-[#007CF7]/40"
              : "bg-[#202022] border-white/[0.06] hover:bg-[#2A2A2E] hover:border-white/15"
          }`}
        >
          <MascoteAvatar
            avatar={vis}
            agentKey={ag.agente_id}
            size={40}
            animated={isWorking}
            mood={
              agentActivityByAgentId?.[ag.agente_id]?.mood ??
              (isWorking ? "working" : unreadCount > 0 ? "waiting" : "idle")
            }
            activity={agentActivityByAgentId?.[ag.agente_id]?.activity ?? null}
          />
          {unreadCount > 0 ? (
            <span className="absolute -bottom-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[#74B9FF] text-[#0D0D0D] text-[10px] font-bold flex items-center justify-center ring-2 ring-[#1A1A1A]">
              {unreadCount}
            </span>
          ) : markedUnread ? (
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#74B9FF] ring-2 ring-[#1A1A1A]" />
          ) : isWorking ? (
            <span
              title="Trabalhando agora"
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#31CF76] ring-2 ring-[#1A1A1A] animate-pulse"
            />
          ) : null}
        </button>
        {showMenu && (
          <SidebarAgentContextMenu
            ag={ag}
            isPinned={true}
            isHidden={isHidden}
            alignLeft={true}
            ctrl={ctrl}
            props={props}
          />
        )}
      </div>
    );
}

export function SidebarAgentRow({
  ag,
  keyPrefix,
  showUnreadBadge = false,
  sectionContextId = null,
  isPinRow = false,
  ctrl,
  props,
}: {
  ag: SidebarProps["agentes"][number];
  keyPrefix: string;
  showUnreadBadge?: boolean;
  sectionContextId?: string | null;
  isPinRow?: boolean;
  ctrl: SidebarController;
  props: SidebarProps;
}) {
  const {
    selectedAgentId,
    selectedChannelId,
    onSelectAgent,
    routineCountsByAgent = {},
    onMutateSidebar,
    onDuplicateAgent,
    onReorderPins,
    onToggleUnreadAgent,
    onToggleMuteAgent,
    onNewSubconversation,
    onOpenAgentNewWindow,
    onEditAgent,
    onDeleteAgent,
    agentActivityByAgentId
  } = props;
  const {
    workingAgentSet,
    setSectionMenuId,
    agentMenuKey,
    setAgentMenuKey,
    setAgentMoveSubmenuOpen,
    dragPayload,
    setDragPayload,
    dropIndicatorKey,
    setDropIndicatorKey,
    effectiveMode,
    hiddenSet,
    pinOrder,
    pinSet,
    isAgentMarkedUnread
  } = ctrl;

    const vis = getAgentVisual(ag);
    const selected = selectedAgentId === ag.agente_id && !selectedChannelId;
    const isWorking = ag.status === "trabalhando" || workingAgentSet.has(ag.agente_id);
    const timeLabel = formatHour(ag.ultima_mensagem_em);
    const routineCount = routineCountsByAgent[ag.agente_id] ?? 0;
    const routineCountLabel =
      routineCount === 1 ? "1 rotina" : `${routineCount} rotinas`;
    const rowKey = `${keyPrefix}${ag.agente_id}`;
    const isPinned = pinSet.has(ag.agente_id);
    const isHidden = hiddenSet.has(ag.agente_id);
    const showMenu = agentMenuKey === rowKey;
    const showDropLine = dropIndicatorKey === `agent:${rowKey}`;
    const unreadCount = ag.nao_lidas ?? 0;
    const markedUnread = isAgentMarkedUnread(ag);
    const canManageRow = Boolean(
      onMutateSidebar ||
        onDuplicateAgent ||
        onDeleteAgent ||
        onEditAgent ||
        onToggleUnreadAgent ||
        onToggleMuteAgent ||
        onNewSubconversation ||
        onOpenAgentNewWindow
    );

    return (
      <div
        key={rowKey}
        draggable={Boolean(onMutateSidebar || onReorderPins)}
        onDragStart={(e) => {
          e.stopPropagation();
          setDragPayload(
            isPinRow ? { kind: "pin", agentId: ag.agente_id } : { kind: "agent", agentId: ag.agente_id }
          );
        }}
        onDragEnd={() => {
          setDragPayload(null);
          setDropIndicatorKey(null);
        }}
        onDragOver={(e) => {
          if (!dragPayload || dragPayload.kind === "section") return;
          if (dragPayload.kind === "pin" && !isPinRow) return;
          if (dragPayload.agentId === ag.agente_id) return;
          e.preventDefault();
          e.stopPropagation();
          setDropIndicatorKey(`agent:${rowKey}`);
        }}
        onDrop={async (e) => {
          if (!dragPayload || dragPayload.kind === "section") return;
          e.preventDefault();
          e.stopPropagation();
          setDropIndicatorKey(null);
          if (dragPayload.agentId === ag.agente_id) return;
          if (isPinRow && dragPayload.kind === "pin") {
            const next = pinOrder.filter((id) => id !== dragPayload.agentId);
            const targetIdx = next.indexOf(ag.agente_id);
            const insertAt = targetIdx >= 0 ? targetIdx : next.length;
            next.splice(insertAt, 0, dragPayload.agentId);
            if (onReorderPins) {
              await onReorderPins(next);
            } else if (onMutateSidebar) {
              await onMutateSidebar({ op: "reorder_pins", pins: next });
            }
          } else if (!isPinRow && dragPayload.kind === "agent" && onMutateSidebar) {
            await onMutateSidebar({
              op: "move_agent",
              agentId: dragPayload.agentId,
              sectionId: sectionContextId,
              beforeAgentId: ag.agente_id,
            });
          }
          setDragPayload(null);
        }}
        onContextMenu={(e) => {
          if (!canManageRow) return;
          e.preventDefault();
          setSectionMenuId(null);
          setAgentMoveSubmenuOpen(false);
          setAgentMenuKey((prev) => (prev === rowKey ? null : rowKey));
        }}
        className="group relative flex items-center"
      >
        {showDropLine && (
          <div
            data-drop-indicator="true"
            className="absolute -top-0.5 left-1 right-1 h-[2px] rounded-full bg-[#007CF7] pointer-events-none z-20"
          />
        )}
        <button
          type="button"
          onClick={() => onSelectAgent(ag.agente_id)}
          className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-colors ${
            canManageRow ? "pr-8" : ""
          } ${selected ? "bg-[#252527]" : "hover:bg-[#202022]"}`}
        >
          <div className="relative shrink-0">
            <MascoteAvatar
              avatar={vis}
              agentKey={ag.agente_id}
              size={38}
              animated={isWorking}
              mood={
                agentActivityByAgentId?.[ag.agente_id]?.mood ??
                (isWorking ? "working" : (ag.nao_lidas ?? 0) > 0 ? "waiting" : "idle")
              }
              activity={agentActivityByAgentId?.[ag.agente_id]?.activity ?? null}
            />
            {showUnreadBadge && (unreadCount > 0 || markedUnread) ? (
              unreadCount > 0 ? (
                <span className="absolute -bottom-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-[#74B9FF] text-[#0D0D0D] text-[10px] font-bold flex items-center justify-center ring-2 ring-[#1A1A1A]">
                  {unreadCount}
                </span>
              ) : (
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#74B9FF] ring-2 ring-[#1A1A1A]" />
              )
            ) : null}
            {!showUnreadBadge && isWorking && (
              <span
                title="Trabalhando agora"
                className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#31CF76] ring-2 ring-[#1A1A1A] animate-pulse"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-medium text-white truncate">
                {ag.nome}
              </span>
              {effectiveMode === "routines" ? (
                routineCount > 0 ? (
                  <span className="text-[11px] font-semibold text-[#42A0FF] bg-[#007CF7]/15 px-1.5 py-0.5 rounded-full tabular-nums shrink-0">
                    {routineCount}
                  </span>
                ) : null
              ) : (
                timeLabel && (
                  <span className="text-[11px] text-[#737378] tabular-nums shrink-0">
                    {timeLabel}
                  </span>
                )
              )}
            </div>
            <p className="text-[12px] text-[#8E8E93] truncate mt-0.5">
              {effectiveMode === "routines"
                ? routineCount > 0
                  ? routineCountLabel
                  : "Nenhuma rotina configurada"
                : stripMarkdownPreview(ag.ultima_mensagem) || ag.papel}
            </p>
          </div>
        </button>

        {canManageRow && (
          <button
            type="button"
            aria-label={`Ações para ${ag.nome}`}
            onClick={(e) => {
              e.stopPropagation();
              setSectionMenuId(null);
              setAgentMoveSubmenuOpen(false);
              setAgentMenuKey((prev) => (prev === rowKey ? null : rowKey));
            }}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 rounded-lg flex items-center justify-center text-[#8E8E93] hover:text-white hover:bg-[#303033] transition-opacity ${
              showMenu ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        )}

        {showMenu && (
          <SidebarAgentContextMenu
            ag={ag}
            isPinned={isPinned}
            isHidden={isHidden}
            ctrl={ctrl}
            props={props}
          />
        )}
      </div>
    );
}
