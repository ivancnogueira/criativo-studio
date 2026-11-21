import React, { useMemo, useState } from "react";
import type {
  AgenteRegistro,
  AvatarShape,
  CanalEquipe,
  DeletedNativeAgentInfo,
  SidebarLayoutMutation,
  SidebarLayoutSnapshot,
  SidebarSectionNode,
  StatusMensageria,
  UpdateStatusSnapshot,
} from "@criativo/contracts";
import {
  Bell,
  BellOff,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FolderPlus,
  GitFork,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Smartphone,
  Sparkles,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import {
  ChannelMascoteCluster,
  MascoteAvatar,
  resolveAgentAvatarConfig,
  type AvatarTaskContext,
  type MascotEyeMood,
} from "./MascoteAvatar";
import { UpdateNotificationBanner } from "../features/updates/UpdateNotificationBanner";

export interface SidebarProps {
  agentes: Array<
    AgenteRegistro & {
      nao_lidas?: number;
      ultima_mensagem?: string | null;
      ultima_mensagem_em?: string | null;
    }
  >;
  canais?: CanalEquipe[];
  deletedNativeAgents?: DeletedNativeAgentInfo[];
  selectedAgentId: string | null;
  selectedChannelId?: string | null;
  onSelectAgent: (agenteId: string) => void;
  onSelectChannel?: (canalId: string) => void;
  onChangeModel?: (agenteId: string, modelo: string) => void;
  onCreateAgent?: () => void;
  onCreateChannel?: () => void;
  whatsappStatus?: StatusMensageria;
  onOpenWhatsAppModal?: () => void;
  viewMode?: "agents" | "routines";
  onChangeViewMode?: (mode: "agents" | "routines") => void;
  showModeTabs?: boolean;
  routineCountsByAgent?: Record<string, number>;
  // Fase 15 — Diretórios aninhados, Fixados, Ocultos, D&D e Duplicação
  sidebarLayout?: SidebarLayoutSnapshot | null;
  sortMode?: "custom" | "alphabetical" | "recent";
  onMutateSidebar?: (mutation: SidebarLayoutMutation) => Promise<void> | void;
  onDuplicateAgent?: (agentId: string) => Promise<void> | void;
  onReorderPins?: (pins: string[]) => Promise<void> | void;
  onRestoreDeletedAgent?: (agentId: string) => Promise<void> | void;
  onRestoreAllDeletedAgents?: () => Promise<void> | void;
  onToggleUnreadAgent?: (agentId: string, markUnread: boolean) => Promise<void> | void;
  onToggleMuteAgent?: (agentId: string, nextLevel: "all" | "muted") => Promise<void> | void;
  onNewSubconversation?: (agentId: string) => Promise<void> | void;
  onOpenAgentNewWindow?: (agentId: string) => Promise<void> | void;
  onEditAgent?: (agentId: string) => void;
  onDeleteAgent?: (agentId: string) => Promise<void> | void;
  updateStatus?: UpdateStatusSnapshot | null;
  onApplyUpdate?: () => void;
  onOpenUpdateSettings?: () => void;
  widthPx?: number;
  workingAgentIds?: Set<string> | ReadonlyArray<string>;
  agentActivityByAgentId?: Record<
    string,
    { mood?: MascotEyeMood; activity?: AvatarTaskContext | null }
  >;
  onDismissSetupAssistant?: () => Promise<void> | void;
}

function getAgentVisual(ag: AgenteRegistro) {
  return resolveAgentAvatarConfig(ag);
}

function formatHour(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function stripMarkdownPreview(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|\s)_([^_]+)_(\s|$)/g, "$1$2$3")
    .replace(/^>\s?/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Barra lateral Carbon Dark (`~265px`) com busca, pastas colapsáveis, Canais em Equipe,
 * badges #74B9FF em Não lidas e card inferior 'Criativo no WhatsApp'.
 */
export const Sidebar: React.FC<SidebarProps> = ({
  agentes,
  canais = [],
  deletedNativeAgents = [],
  selectedAgentId,
  selectedChannelId = null,
  onSelectAgent,
  onSelectChannel,
  onCreateAgent,
  onCreateChannel,
  whatsappStatus = "desconectado",
  onOpenWhatsAppModal,
  viewMode,
  onChangeViewMode,
  showModeTabs = true,
  routineCountsByAgent = {},
  sidebarLayout = null,
  sortMode = "custom",
  onMutateSidebar,
  onDuplicateAgent,
  onReorderPins,
  onRestoreDeletedAgent,
  onRestoreAllDeletedAgents,
  onToggleUnreadAgent,
  onToggleMuteAgent,
  onNewSubconversation,
  onOpenAgentNewWindow,
  onEditAgent,
  onDeleteAgent,
  updateStatus = null,
  onApplyUpdate,
  onOpenUpdateSettings,
  widthPx,
  workingAgentIds,
  agentActivityByAgentId,
  onDismissSetupAssistant,
}) => {
  const workingAgentSet = useMemo(() => new Set(workingAgentIds ?? []), [workingAgentIds]);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dismissWhatsAppCard, setDismissWhatsAppCard] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [internalViewMode, setInternalViewMode] = useState<"agents" | "routines">("agents");
  const [creatingSectionParentId, setCreatingSectionParentId] = useState<string | null | undefined>(
    undefined
  );
  const [newSectionName, setNewSectionName] = useState("");
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renamingSectionName, setRenamingSectionName] = useState("");
  const [sectionMenuId, setSectionMenuId] = useState<string | null>(null);
  const [agentMenuKey, setAgentMenuKey] = useState<string | null>(null);
  const [agentMoveSubmenuOpen, setAgentMoveSubmenuOpen] = useState(false);
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  const [confirmDeleteAgent, setConfirmDeleteAgent] = useState<AgenteRegistro | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoringAgentId, setRestoringAgentId] = useState<string | null>(null);
  const [dragPayload, setDragPayload] = useState<
    | { kind: "agent"; agentId: string }
    | { kind: "pin"; agentId: string }
    | { kind: "section"; sectionId: string }
    | null
  >(null);
  const [dropIndicatorKey, setDropIndicatorKey] = useState<string | null>(null);
  const effectiveMode = showModeTabs ? (viewMode ?? internalViewMode) : "agents";
  const setMode = (nextMode: "agents" | "routines") => {
    setInternalViewMode(nextMode);
    onChangeViewMode?.(nextMode);
  };

  const toggleFolder = (key: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const filteredAgents = useMemo(() => {
    const unlocked = agentes.filter(
      (a) => (a.config as Record<string, unknown>)?.upgrade_desbloqueado !== false
    );
    const q = search.trim().toLowerCase();
    if (!q) return unlocked;
    return unlocked.filter(
      (a) =>
        a.nome.toLowerCase().includes(q) ||
        a.papel.toLowerCase().includes(q) ||
        a.modelo_padrao.toLowerCase().includes(q)
    );
  }, [agentes, search]);

  const filteredChannels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return canais;
    return canais.filter(
      (c) =>
        c.nome.toLowerCase().includes(q) ||
        c.descricao.toLowerCase().includes(q)
    );
  }, [canais, search]);

  const hiddenSet = useMemo(
    () => new Set(sidebarLayout?.hiddenAgentIds ?? []),
    [sidebarLayout?.hiddenAgentIds]
  );

  const pinOrder = useMemo(() => sidebarLayout?.pins ?? [], [sidebarLayout?.pins]);
  const pinSet = useMemo(() => new Set(pinOrder), [pinOrder]);
  const sectionsList = useMemo(
    () => sidebarLayout?.sections ?? [],
    [sidebarLayout?.sections]
  );
  const sectionIdsSet = useMemo(
    () => new Set(sectionsList.map((s) => s.section_id)),
    [sectionsList]
  );
  const agentAssignments = useMemo(
    () => sidebarLayout?.agentAssignments ?? {},
    [sidebarLayout?.agentAssignments]
  );

  const sortAgents = (items: SidebarProps["agentes"]) => {
    const copy = [...items];
    if (sortMode === "alphabetical") {
      return copy.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    }
    if (sortMode === "recent") {
      return copy.sort((a, b) => {
        const ta = a.ultima_mensagem_em ? Date.parse(a.ultima_mensagem_em) : 0;
        const tb = b.ultima_mensagem_em ? Date.parse(b.ultima_mensagem_em) : 0;
        if (tb !== ta) return tb - ta;
        return a.nome.localeCompare(b.nome, "pt-BR");
      });
    }
    const order = sidebarLayout?.agentOrder ?? [];
    if (order.length === 0) return copy;
    const rank = new Map(order.map((id, idx) => [id, idx]));
    return copy.sort((a, b) => {
      const ra = rank.get(a.agente_id);
      const rb = rank.get(b.agente_id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return 0;
    });
  };

  const visibleAgents = useMemo(
    () => filteredAgents.filter((a) => !hiddenSet.has(a.agente_id)),
    [filteredAgents, hiddenSet]
  );

  const hiddenAgents = useMemo(
    () => filteredAgents.filter((a) => hiddenSet.has(a.agente_id)),
    [filteredAgents, hiddenSet]
  );

  const pinnedAgents = useMemo(() => {
    const byId = new Map(visibleAgents.map((a) => [a.agente_id, a]));
    return pinOrder
      .map((id) => byId.get(id))
      .filter((a): a is SidebarProps["agentes"][number] => Boolean(a));
  }, [pinOrder, visibleAgents]);

  const isAgentMarkedUnread = (ag: SidebarProps["agentes"][number]) =>
    (ag.nao_lidas ?? 0) > 0 ||
    Boolean((ag.config as Record<string, unknown> | undefined)?.marked_unread);

  const unreadAgents = useMemo(
    () => visibleAgents.filter((a) => isAgentMarkedUnread(a)),
    [visibleAgents]
  );

  const setupAssistantAgent = useMemo(
    () => visibleAgents.find((a) => a.agente_id === "assistente_setup") ?? null,
    [visibleAgents]
  );

  const folders = useMemo(() => {
    const unassigned = visibleAgents.filter((a) => {
      if (a.agente_id === "assistente_setup") return false;
      const secId = agentAssignments[a.agente_id];
      const inCustomSection = Boolean(secId && sectionIdsSet.has(secId));
      return !inCustomSection && !pinSet.has(a.agente_id);
    });
    const sorted = sortAgents(unassigned);
    const groups = [
      {
        key: "conteudo",
        label: "Conteúdo Base",
        items: sorted.filter(
          (a) => a.frente === "conteudo" || (a.config as Record<string, unknown>)?.frente === "conteudo"
        ),
      },
      {
        key: "bonus",
        label: "Agentes Bônus",
        items: sorted.filter(
          (a) => a.frente === "bonus" || (a.config as Record<string, unknown>)?.frente === "bonus"
        ),
      },
      {
        key: "video",
        label: "Estúdio de Vídeo",
        items: sorted.filter(
          (a) => a.frente === "video" || (a.config as Record<string, unknown>)?.frente === "video"
        ),
      },
      {
        key: "custom",
        label: "Customizados",
        items: sorted.filter(
          (a) =>
            a.frente === "custom" ||
            (a.config as Record<string, unknown>)?.customizado === true ||
            (a.config as Record<string, unknown>)?.frente === "custom"
        ),
      },
    ];
    return groups.filter((g) => g.items.length > 0);
  }, [visibleAgents, agentAssignments, sectionIdsSet, pinSet, sortMode, sidebarLayout?.agentOrder]);

  const orderedSections = useMemo(() => {
    const order = sidebarLayout?.order ?? [];
    const rank = new Map(order.map((id, idx) => [id, idx]));
    return [...sectionsList].sort((a, b) => {
      const ra = rank.get(a.section_id);
      const rb = rank.get(b.section_id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (a.ordem !== b.ordem) return a.ordem - b.ordem;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
  }, [sectionsList, sidebarLayout?.order]);

  const handleCreateSectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nome = newSectionName.trim();
    if (!nome || !onMutateSidebar) return;
    await onMutateSidebar({
      op: "create_section",
      nome,
      parentId: creatingSectionParentId ?? null,
    });
    setCreatingSectionParentId(undefined);
    setNewSectionName("");
  };

  const handleRenameSectionSubmit = async (e: React.FormEvent, sectionId: string) => {
    e.preventDefault();
    const nome = renamingSectionName.trim();
    if (!nome || !onMutateSidebar) return;
    await onMutateSidebar({ op: "rename_section", sectionId, nome });
    setRenamingSectionId(null);
    setRenamingSectionName("");
  };

  const renderAgentContextMenu = (
    ag: SidebarProps["agentes"][number],
    isPinned: boolean,
    isHidden: boolean,
    alignLeft = false
  ) => {
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
            <span>{isMuted ? "Ativar alertas" : "Silenciar agente"}</span>
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
            <span>Editar agente</span>
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
            <span>Duplicar agente</span>
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
            <span>{isHidden ? "Reexibir agente" : "Ocultar agente"}</span>
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
              <span>Excluir agente</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderPinnedTile = (ag: SidebarProps["agentes"][number]) => {
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
          title={ag.nome}
          aria-label={ag.nome}
          onClick={() => onSelectAgent(ag.agente_id)}
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
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-40 whitespace-nowrap rounded-lg bg-[#101012] border border-white/10 px-2 py-1 text-[11px] font-medium text-white shadow-lg opacity-0 group-hover/pin:opacity-100 group-focus-within/pin:opacity-100 transition-opacity"
        >
          {ag.nome}
        </span>
        {showMenu && renderAgentContextMenu(ag, true, isHidden, true)}
      </div>
    );
  };

  const renderAgentRow = (
    ag: SidebarProps["agentes"][number],
    keyPrefix: string,
    showUnreadBadge = false,
    sectionContextId: string | null = null,
    isPinRow = false
  ) => {
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

        {showMenu && renderAgentContextMenu(ag, isPinned, isHidden)}
      </div>
    );
  };

  const renderSectionTree = (sec: SidebarSectionNode, depth = 0): React.ReactNode => {
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
            {childSections.map((child) => renderSectionTree(child, depth + 1))}
            {secAgents.map((ag) => renderAgentRow(ag, `sec-${sec.section_id}-`, false, sec.section_id))}
          </div>
        )}
      </div>
    );
  };

  const permanentAgentsCount = agentes.filter((a) => a.agente_id !== "assistente_setup").length;

  return (
    <aside
      aria-label={`Roster (${permanentAgentsCount} Agentes)`}
      style={widthPx ? { width: `${widthPx}px` } : { width: "276px" }}
      className="shrink-0 bg-[#1A1A1A] border-r border-white/[0.06] flex flex-col h-full overflow-hidden select-none"
    >
      {/* Cabeçalho: Busca + botão '+' */}
      <div className="p-2.5 flex items-center gap-2 relative">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 text-[#6A6A6A] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="sidebar-search-agents"
            name="sidebar_search"
            aria-label="Buscar agentes e canais"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar"
            className="w-full h-[32px] rounded-xl bg-[#242424] border border-white/[0.05] pl-8 pr-3 text-[12.5px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-white/20"
          />
        </div>

        <button
          type="button"
          onClick={() =>
            onCreateChannel || onCreateAgent || onMutateSidebar
              ? setMenuOpen((o) => !o)
              : undefined
          }
          title="Novo agente, equipe ou diretório"
          aria-label="Criar novo agente, equipe ou diretório"
          className="h-[32px] w-[32px] rounded-xl flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#242424] transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div className="absolute right-2.5 top-12 z-40 w-56 rounded-xl bg-[#242424] border border-white/10 shadow-[0_14px_35px_rgba(0,0,0,0.65)] p-1">
            {onCreateAgent && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onCreateAgent();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] text-white hover:bg-white/[0.06] text-left"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#38bdf8]" />
                <span>Novo agente IA</span>
              </button>
            )}
            {onCreateChannel && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onCreateChannel();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] text-white hover:bg-white/[0.06] text-left"
              >
                <Users className="h-3.5 w-3.5 text-[#31cf76]" />
                <span>Nova equipe</span>
              </button>
            )}
            {onMutateSidebar && (
              <button
                type="button"
                disabled={sectionsList.length >= 40}
                onClick={() => {
                  setMenuOpen(false);
                  setCreatingSectionParentId(null);
                  setNewSectionName("");
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] text-white hover:bg-white/[0.06] disabled:opacity-40 text-left"
              >
                <FolderPlus className="h-3.5 w-3.5 text-[#31cf76]" />
                <span>Novo diretório</span>
              </button>
            )}
            {deletedNativeAgents.length > 0 && (onRestoreDeletedAgent || onRestoreAllDeletedAgents) && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setRestoreModalOpen(true);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] text-[#74B9FF] hover:bg-white/[0.06] text-left border-t border-white/[0.06] mt-0.5 pt-2"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                <span>Restaurar agentes excluídos ({deletedNativeAgents.length})</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Switch Agentes | Rotinas */}
      {showModeTabs && (
        <div className="px-2.5 pb-2">
          <div
            role="tablist"
            aria-label="Alternar entre agentes e rotinas"
            className="p-1 rounded-xl bg-[#141414] border border-white/[0.06] grid grid-cols-2 gap-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={effectiveMode === "agents"}
              onClick={() => setMode("agents")}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition-colors border-b-2 ${
                effectiveMode === "agents"
                  ? "bg-[#2A2A2A] text-[#F0F0F0] border-[#007CF7]"
                  : "text-[#979797] hover:text-white border-transparent"
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              <span>Agentes</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveMode === "routines"}
              onClick={() => setMode("routines")}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition-colors border-b-2 ${
                effectiveMode === "routines"
                  ? "bg-[#2A2A2A] text-[#F0F0F0] border-[#007CF7]"
                  : "text-[#979797] hover:text-white border-transparent"
              }`}
            >
              <Workflow className="h-3.5 w-3.5" />
              <span>Rotinas</span>
            </button>
          </div>
        </div>
      )}

      {/* Lista rolável por seções e pastas */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
        {setupAssistantAgent && (
          <div
            data-setup-assistant-card="true"
            className={`rounded-xl border p-2 transition-colors ${
              selectedAgentId === setupAssistantAgent.agente_id
                ? "border-[#42A0FF]/60 bg-[#007CF7]/15"
                : "border-[#42A0FF]/30 bg-[#1F242D] hover:border-[#42A0FF]/50"
            }`}
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#42A0FF]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#74B9FF]">
                <Sparkles className="h-2.5 w-2.5" />
                Setup
              </span>
              {onDismissSetupAssistant && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDismissSetupAssistant();
                  }}
                  className="text-[10.5px] text-[#979797] hover:text-white underline underline-offset-2"
                >
                  Concluir e ocultar
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => onSelectAgent(setupAssistantAgent.agente_id)}
              className="w-full flex items-center gap-2.5 px-1.5 py-1 rounded-lg text-left"
            >
              <MascoteAvatar
                avatar={getAgentVisual(setupAssistantAgent)}
                agentKey={setupAssistantAgent.agente_id}
                size={32}
                animated={setupAssistantAgent.status === "trabalhando"}
                mood={
                  agentActivityByAgentId?.[setupAssistantAgent.agente_id]?.mood ??
                  (setupAssistantAgent.status === "trabalhando" ? "working" : "idle")
                }
                activity={agentActivityByAgentId?.[setupAssistantAgent.agente_id]?.activity ?? null}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-white truncate">
                  {setupAssistantAgent.nome}
                </div>
                <p className="text-[11px] text-[#B8D4F5] truncate">
                  Finalize perfil, fotos e Instagram por aqui
                </p>
              </div>
            </button>
          </div>
        )}

        {creatingSectionParentId !== undefined && onMutateSidebar && (
          <form
            onSubmit={(e) => void handleCreateSectionSubmit(e)}
            className="rounded-xl border border-[#007CF7]/50 bg-[#141414] p-2 space-y-2"
          >
            <div className="text-[11px] font-semibold text-[#42A0FF]">
              {creatingSectionParentId ? "Novo subdiretório" : "Novo diretório"}
            </div>
            <input
              type="text"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="Nome do diretório"
              aria-label="Nome do novo diretório"
              autoFocus
              className="w-full rounded-lg border border-white/10 bg-[#212121] px-2.5 py-1.5 text-[12px] text-white placeholder-[#6A6A6A] focus:border-[#007CF7] focus:outline-none"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setCreatingSectionParentId(undefined);
                  setNewSectionName("");
                }}
                className="rounded-lg px-2 py-1 text-[11.5px] text-[#979797] hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!newSectionName.trim()}
                className="rounded-lg bg-[#007CF7] px-2.5 py-1 text-[11.5px] font-semibold text-white disabled:opacity-40"
              >
                {creatingSectionParentId ? "Criar subdiretório" : "Criar diretório"}
              </button>
            </div>
          </form>
        )}

        {pinnedAgents.length > 0 && (
          <div>
            <div className="px-2 pb-1.5 flex items-center justify-between text-[11px] font-medium text-[#7A7A80]">
              <span className="flex items-center gap-1.5">
                <Pin className="h-3 w-3 text-[#42A0FF]" />
                Fixados
              </span>
              <span>{pinnedAgents.length}</span>
            </div>
            <div
              data-testid="sidebar-pinned-strip"
              className="flex flex-wrap items-center gap-2 px-1.5 py-1"
            >
              {pinnedAgents.map((ag) => renderPinnedTile(ag))}
            </div>
          </div>
        )}

        {effectiveMode === "agents" && unreadAgents.length > 0 && (
          <div>
            <div className="px-2 pb-1 flex items-center justify-between text-[11px] font-medium text-[#7A7A80]">
              <span>Não lidas</span>
              <span>{unreadAgents.length}</span>
            </div>
            <div className="space-y-0.5">
              {unreadAgents.map((ag) => renderAgentRow(ag, "unread-", true))}
            </div>
          </div>
        )}

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
                  return (
                    <button
                      key={canal.canal_id}
                      type="button"
                      onClick={() => onSelectChannel?.(canal.canal_id)}
                      className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-colors ${
                        selected ? "bg-[#252527]" : "hover:bg-[#202022]"
                      }`}
                    >
                      <ChannelMascoteCluster members={members} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13.5px] font-medium text-white truncate">
                            {canal.nome}
                          </span>
                          <span className="text-[11px] text-[#737378] tabular-nums shrink-0">
                            {canal.membros_agentes.length} agentes
                          </span>
                        </div>
                        <p className="text-[12px] text-[#8E8E93] truncate mt-0.5">
                          {stripMarkdownPreview(canal.ultima_mensagem) || canal.descricao}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Seções customizadas aninháveis (até 3 níveis) */}
        {orderedSections
          .filter((sec) => !sec.parent_id || !sectionIdsSet.has(sec.parent_id))
          .map((sec) => renderSectionTree(sec, 0))}

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
                  {folder.items.map((ag) => renderAgentRow(ag, ""))}
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
                {hiddenAgents.map((ag) => renderAgentRow(ag, "hidden-"))}
              </div>
            )}
          </div>
        )}
      </div>

      <UpdateNotificationBanner
        status={updateStatus}
        onApplyUpdate={onApplyUpdate}
        onOpenDetails={onOpenUpdateSettings}
      />

      {/* Card fixo inferior de conexão rápida ao WhatsApp no celular */}
      {!dismissWhatsAppCard && (
        <div className="p-2.5 border-t border-white/[0.06]">
          <div className="relative rounded-xl bg-[#212121] border border-white/[0.07] p-3">
            <button
              type="button"
              onClick={() => setDismissWhatsAppCard(true)}
              aria-label="Fechar aviso WhatsApp"
              className="absolute top-2 right-2 text-[#6A6A6A] hover:text-white text-[12px] leading-none"
            >
              ×
            </button>
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-white mb-1">
              <Smartphone className="h-3.5 w-3.5 text-[#31CF76]" />
              <span>Criativo no WhatsApp</span>
            </div>
            <p className="text-[11px] text-[#979797] leading-snug mb-2.5">
              {whatsappStatus === "conectado"
                ? "Conectado ao celular. Aprove artes e peça Reels por áudio."
                : "Pareie seu WhatsApp via QR para enviar áudios e aprovar posts."}
            </p>
            <button
              type="button"
              onClick={onOpenWhatsAppModal}
              className="w-full rounded-lg bg-[#2A2A2A] hover:bg-[#333336] text-white py-1.5 text-[11.5px] font-medium transition-colors"
            >
              {whatsappStatus === "conectado" ? "Gerenciar Pareamento" : "Conectar Agora"}
            </button>
          </div>
        </div>
      )}

      {confirmDeleteAgent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar exclusão de agente"
          data-testid="confirm-delete-agent-modal"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-4 shadow-2xl">
            <div className="space-y-1.5">
              <h3 className="text-[15px] font-semibold text-white">
                Excluir agente {confirmDeleteAgent.nome}?
              </h3>
              <p className="text-[12.5px] text-[#A0A0A8] leading-relaxed">
                Este agente será removido da barra lateral e suas conversas locais ficarão arquivadas. Agentes padrão do sistema podem ser restaurados a qualquer momento em Configurações.
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
                {deletingAgentId === confirmDeleteAgent.agente_id ? "Excluindo..." : "Excluir agente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Restaurar agentes padrão excluídos"
          data-testid="restore-deleted-agents-modal"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#212121] border border-white/10 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-white">
                Restaurar agentes excluídos ({deletedNativeAgents.length})
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
    </aside>
  );
};
