import React from "react";
import type { SidebarSectionNode } from "@criativo/contracts";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { ChannelMascoteCluster, resolveAgentAvatarConfig } from "../MascoteAvatar";
import { stripMarkdownPreview, type SidebarProps } from "./sidebar-types-helpers";
import type { SidebarController } from "./useSidebarController";
import { SidebarAgentRow } from "./SidebarAgentItems";

function SidebarSectionNodeItem({
  sec,
  depth = 0,
  ctrl,
  props,
}: {
  sec: SidebarSectionNode;
  depth?: number;
  ctrl: SidebarController;
  props: SidebarProps;
}) {
  const {
    onMutateSidebar
  } = props;
  const {
    setCreatingSectionParentId,
    setNewSectionName,
    renamingSectionId,
    setRenamingSectionId,
    renamingSectionName,
    setRenamingSectionName,
    sectionMenuId,
    setSectionMenuId,
    setAgentMenuKey,
    dragPayload,
    setDragPayload,
    dropIndicatorKey,
    setDropIndicatorKey,
    sectionsList,
    agentAssignments,
    sortAgents,
    visibleAgents,
    orderedSections,
    handleRenameSectionSubmit
  } = ctrl;

    const childSections = orderedSections.filter((c) => c.parent_id === sec.section_id);
    const secAgents = sortAgents(
      visibleAgents.filter((a) => agentAssignments[a.agente_id] === sec.section_id)
    );
    const isCollapsed = sec.colapsada;
    const isMenuOpen = sectionMenuId === sec.section_id;
    const showDropLine = dropIndicatorKey === `sec:${sec.section_id}`;
    const isRenaming = renamingSectionId === sec.section_id;

    return (
      <div
        key={sec.section_id}
        style={{ paddingLeft: depth > 0 ? `${Math.min(2, depth) * 10}px` : undefined }}
        className="relative"
      >
        {showDropLine && (
          <div
            data-drop-indicator="true"
            className="h-[2px] w-full rounded-full bg-[#007CF7] my-0.5 pointer-events-none"
          />
        )}
        <div
          draggable={Boolean(onMutateSidebar)}
          onDragStart={(e) => {
            e.stopPropagation();
            setDragPayload({ kind: "section", sectionId: sec.section_id });
          }}
          onDragEnd={() => {
            setDragPayload(null);
            setDropIndicatorKey(null);
          }}
          onDragOver={(e) => {
            if (!dragPayload) return;
            if (dragPayload.kind === "section" && (dragPayload.sectionId === sec.section_id || sec.nivel >= 3)) {
              return;
            }
            if (dragPayload.kind === "pin") return;
            e.preventDefault();
            e.stopPropagation();
            setDropIndicatorKey(`sec:${sec.section_id}`);
          }}
          onDrop={async (e) => {
            if (!dragPayload || !onMutateSidebar) return;
            e.preventDefault();
            e.stopPropagation();
            setDropIndicatorKey(null);
            if (dragPayload.kind === "agent") {
              await onMutateSidebar({
                op: "move_agent",
                agentId: dragPayload.agentId,
                sectionId: sec.section_id,
              });
            } else if (
              dragPayload.kind === "section" &&
              dragPayload.sectionId !== sec.section_id &&
              sec.nivel < 3
            ) {
              await onMutateSidebar({
                op: "nest_section",
                sectionId: dragPayload.sectionId,
                parentId: sec.section_id,
              });
            }
            setDragPayload(null);
          }}
          className="group relative flex items-center justify-between gap-1 px-2 py-1 rounded-lg hover:bg-[#202022]"
        >
          {isRenaming ? (
            <form
              onSubmit={(e) => void handleRenameSectionSubmit(e, sec.section_id)}
              className="flex items-center gap-1 flex-1 min-w-0"
            >
              <input
                type="text"
                value={renamingSectionName}
                onChange={(e) => setRenamingSectionName(e.target.value)}
                aria-label="Novo nome do diretório"
                autoFocus
                className="flex-1 min-w-0 rounded-md bg-[#141414] border border-[#007CF7] px-2 py-0.5 text-[11.5px] text-white focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-md bg-[#007CF7] px-2 py-0.5 text-[11px] font-semibold text-white"
              >
                Salvar
              </button>
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  void onMutateSidebar?.({
                    op: "toggle_collapse",
                    sectionId: sec.section_id,
                    colapsada: !sec.colapsada,
                  })
                }
                className="flex items-center gap-1.5 min-w-0 flex-1 text-left text-[11px] font-medium text-[#979797] hover:text-white"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{sec.nome}</span>
              </button>

              {onMutateSidebar && (
                <button
                  type="button"
                  aria-label={`Ações do diretório ${sec.nome}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAgentMenuKey(null);
                    setSectionMenuId((prev) =>
                      prev === sec.section_id ? null : sec.section_id
                    );
                  }}
                  className={`h-5 w-5 rounded flex items-center justify-center text-[#7A7A80] hover:text-white hover:bg-[#303033] transition-opacity ${
                    isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  }`}
                >
                  <MoreVertical className="h-3 w-3" />
                </button>
              )}
            </>
          )}

          {isMenuOpen && onMutateSidebar && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-1 top-full mt-1 z-50 w-44 rounded-xl bg-[#242424] border border-white/10 shadow-[0_14px_35px_rgba(0,0,0,0.75)] p-1 space-y-0.5"
            >
              <button
                type="button"
                onClick={() => {
                  setSectionMenuId(null);
                  setRenamingSectionId(sec.section_id);
                  setRenamingSectionName(sec.nome);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
              >
                <Pencil className="h-3.5 w-3.5 text-[#42A0FF]" />
                <span>Renomear diretório</span>
              </button>

              {sec.nivel < 3 && sectionsList.length < 40 && (
                <button
                  type="button"
                  onClick={() => {
                    setSectionMenuId(null);
                    setCreatingSectionParentId(sec.section_id);
                    setNewSectionName("");
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
                >
                  <FolderPlus className="h-3.5 w-3.5 text-[#31CF76]" />
                  <span>Novo subdiretório</span>
                </button>
              )}

              <button
                type="button"
                onClick={async () => {
                  setSectionMenuId(null);
                  await onMutateSidebar({ op: "delete_section", sectionId: sec.section_id });
                }}
                className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#FF7675] hover:bg-[#FD2F3B]/15 flex items-center gap-2"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remover diretório</span>
              </button>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="mt-0.5 space-y-1">
            {childSections.map((child) => <SidebarSectionNodeItem key={child.section_id} sec={child} depth={depth + 1} ctrl={ctrl} props={props} />)}
            {secAgents.map((ag) => <SidebarAgentRow key={`sec-${sec.section_id}-${ag.agente_id}`} ag={ag} keyPrefix={`sec-${sec.section_id}-`} showUnreadBadge={false} sectionContextId={sec.section_id} ctrl={ctrl} props={props} />)}
          </div>
        )}
      </div>
    );
}

export function SidebarChannelsAndSections({
  ctrl,
  props,
}: {
  ctrl: SidebarController;
  props: SidebarProps;
}) {
  const {
    agentes,
    canais = [],
    selectedChannelId,
    onSelectChannel,
    onEditChannel,
    onDeleteChannel
  } = props;
  const {
    collapsedFolders,
    setSectionMenuId,
    setAgentMenuKey,
    channelMenuId,
    setChannelMenuId,
    setConfirmDeleteChannel,
    effectiveMode,
    toggleFolder,
    filteredChannels,
    hiddenExpanded,
    setHiddenExpanded,
    sectionIdsSet,
    hiddenAgents,
    folders,
    orderedSections
  } = ctrl;

  return (
    <>
        {/* Equipes (Multi-agente) — oculto em modo Rotinas */}
        {effectiveMode === "agents" && filteredChannels.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggleFolder("canais")}
              className="w-full px-2 py-1 flex items-center justify-between text-[11px] font-medium text-[#7A7A80] hover:text-white transition-colors"
            >
              <span className="flex items-center gap-1.5">
                {collapsedFolders.canais ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                Equipes
              </span>
            </button>

            {!collapsedFolders.canais && (
              <div className="mt-1 space-y-0.5">
                {filteredChannels.map((canal) => {
                  const selected = selectedChannelId === canal.canal_id;
                  const members = canal.membros_agentes.map((id) => {
                    const match = agentes.find((a) => a.agente_id === id);
                    const vis = resolveAgentAvatarConfig(match, id);
                    return { agente_id: id, ...vis };
                  });
                  const canManageChannel = Boolean(onEditChannel || onDeleteChannel);
                  const isChMenuOpen = channelMenuId === canal.canal_id;
                  return (
                    <div
                      key={canal.canal_id}
                      onContextMenu={(e) => {
                        if (!canManageChannel) return;
                        e.preventDefault();
                        setAgentMenuKey(null);
                        setSectionMenuId(null);
                        setChannelMenuId((prev) =>
                          prev === canal.canal_id ? null : canal.canal_id
                        );
                      }}
                      className="group relative flex items-center"
                    >
                      <button
                        type="button"
                        onClick={() => onSelectChannel?.(canal.canal_id)}
                        className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-colors ${
                          canManageChannel ? "pr-8" : ""
                        } ${selected ? "bg-[#252527]" : "hover:bg-[#202022]"}`}
                      >
                        <ChannelMascoteCluster members={members} size={38} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13.5px] font-medium text-white truncate">
                              {canal.nome}
                            </span>
                            <span className="text-[11px] text-[#737378] tabular-nums shrink-0">
                              {canal.membros_agentes.length} Criativos
                            </span>
                          </div>
                          <p className="text-[12px] text-[#8E8E93] truncate mt-0.5">
                            {stripMarkdownPreview(canal.ultima_mensagem) || canal.descricao || "Canal colaborativo de criação"}
                          </p>
                        </div>
                      </button>

                      {canManageChannel && (
                        <button
                          type="button"
                          aria-label={`Ações para ${canal.nome}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setAgentMenuKey(null);
                            setSectionMenuId(null);
                            setChannelMenuId((prev) =>
                              prev === canal.canal_id ? null : canal.canal_id
                            );
                          }}
                          className={`absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 rounded-lg flex items-center justify-center text-[#8E8E93] hover:text-white hover:bg-[#303033] transition-opacity ${
                            isChMenuOpen
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          }`}
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {isChMenuOpen && canManageChannel && (
                        <div
                          role="menu"
                          aria-label={`Opções de ${canal.nome}`}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-1 top-full mt-1 z-50 w-52 rounded-xl bg-[#242424] border border-white/10 shadow-[0_14px_35px_rgba(0,0,0,0.75)] p-1 space-y-0.5"
                        >
                          {onEditChannel && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setChannelMenuId(null);
                                onEditChannel(canal.canal_id);
                              }}
                              className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#DCDCDC] hover:bg-[#303033] hover:text-white flex items-center gap-2"
                            >
                              <Pencil className="h-3.5 w-3.5 text-[#42A0FF]" />
                              <span>Configurações da equipe</span>
                            </button>
                          )}
                          {onDeleteChannel && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setChannelMenuId(null);
                                setConfirmDeleteChannel(canal);
                              }}
                              className="w-full px-2.5 py-1.5 rounded-lg text-left text-[12px] text-[#FF7675] hover:bg-[#FD2F3B]/15 flex items-center gap-2"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Excluir equipe</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {/* Seções customizadas aninháveis (até 3 níveis) */}
        {orderedSections
          .filter((sec) => !sec.parent_id || !sectionIdsSet.has(sec.parent_id))
          .map((sec) => <SidebarSectionNodeItem key={sec.section_id} sec={sec} depth={0} ctrl={ctrl} props={props} />)}

        {/* Pastas de Especialistas (equipe modular + customizados) */}
        {folders.map((folder) => {
          const isCollapsed = Boolean(collapsedFolders[folder.key]);
          return (
            <div key={folder.key}>
              <button
                type="button"
                onClick={() => toggleFolder(folder.key)}
                className="w-full px-2 py-1 flex items-center justify-between text-[11px] font-medium text-[#7A7A80] hover:text-white transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {folder.label}
                </span>
              </button>

              {!isCollapsed && (
                <div className="mt-1 space-y-0.5">
                  {folder.items.map((ag) => <SidebarAgentRow key={ag.agente_id} ag={ag} keyPrefix="" ctrl={ctrl} props={props} />)}
                </div>
              )}
            </div>
          );
        })}

        {hiddenAgents.length > 0 && (
          <div className="pt-1 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={() => setHiddenExpanded((v) => !v)}
              className="w-full px-2 py-1 flex items-center justify-between text-[11px] font-medium text-[#7A7A80] hover:text-white transition-colors"
            >
              <span className="flex items-center gap-1.5">
                {hiddenExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>Ocultos ({hiddenAgents.length})</span>
              </span>
            </button>
            {hiddenExpanded && (
              <div className="mt-1 space-y-0.5">
                {hiddenAgents.map((ag) => <SidebarAgentRow key={`hidden-${ag.agente_id}`} ag={ag} keyPrefix="hidden-" ctrl={ctrl} props={props} />)}
              </div>
            )}
          </div>
        )}
    </>
  );
}
