import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgenteRegistro,
  CanalEquipe,
  SidebarSectionNode,
} from "@criativo/contracts";
import type { SidebarProps } from "./sidebar-types-helpers";

export function useSidebarController(props: SidebarProps) {
  const {
    agentes,
    canais = [],
    sidebarLayout,
    sortMode = "custom",
    onMutateSidebar,
    viewMode,
    showModeTabs = true,
    onChangeViewMode,
    workingAgentIds,
  } = props;

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
  const [channelMenuId, setChannelMenuId] = useState<string | null>(null);
  const [confirmDeleteChannel, setConfirmDeleteChannel] = useState<CanalEquipe | null>(null);
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null);
  const [pinnedTooltip, setPinnedTooltip] = useState<{
    agentId: string;
    nome: string;
    left: number;
    top: number;
  } | null>(null);
  const pinnedTooltipRef = useRef<HTMLDivElement | null>(null);
  const [pinnedTooltipPos, setPinnedTooltipPos] = useState<{ left: number; top: number } | null>(
    null
  );

  useEffect(() => {
    if (!pinnedTooltip || typeof window === "undefined") {
      setPinnedTooltipPos(null);
      return;
    }
    const el = pinnedTooltipRef.current;
    const width = el ? el.offsetWidth : Math.min(240, pinnedTooltip.nome.length * 7 + 20);
    const clampedLeft = Math.max(
      10,
      Math.min(window.innerWidth - width - 10, pinnedTooltip.left - width / 2)
    );
    setPinnedTooltipPos({
      left: clampedLeft,
      top: Math.max(10, pinnedTooltip.top - 8),
    });
  }, [pinnedTooltip]);
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

  const vpsAssistantAgent = useMemo(
    () => visibleAgents.find((a) => a.agente_id === "assistente_servidor_vps") ?? null,
    [visibleAgents]
  );

  const folders = useMemo(() => {
    const unassigned = visibleAgents.filter((a) => {
      if (a.agente_id === "assistente_setup" || a.agente_id === "assistente_servidor_vps") return false;
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


  return {
    workingAgentSet,
    search,
    setSearch,
    menuOpen,
    setMenuOpen,
    dismissWhatsAppCard,
    setDismissWhatsAppCard,
    collapsedFolders,
    setCollapsedFolders,
    internalViewMode,
    setInternalViewMode,
    creatingSectionParentId,
    setCreatingSectionParentId,
    newSectionName,
    setNewSectionName,
    renamingSectionId,
    setRenamingSectionId,
    renamingSectionName,
    setRenamingSectionName,
    sectionMenuId,
    setSectionMenuId,
    agentMenuKey,
    setAgentMenuKey,
    channelMenuId,
    setChannelMenuId,
    confirmDeleteChannel,
    setConfirmDeleteChannel,
    deletingChannelId,
    setDeletingChannelId,
    pinnedTooltip,
    setPinnedTooltip,
    pinnedTooltipRef,
    pinnedTooltipPos,
    setPinnedTooltipPos,
    agentMoveSubmenuOpen,
    setAgentMoveSubmenuOpen,
    hiddenExpanded,
    setHiddenExpanded,
    confirmDeleteAgent,
    setConfirmDeleteAgent,
    deletingAgentId,
    setDeletingAgentId,
    restoreModalOpen,
    setRestoreModalOpen,
    restoringAgentId,
    setRestoringAgentId,
    dragPayload,
    setDragPayload,
    dropIndicatorKey,
    setDropIndicatorKey,
    effectiveMode,
    setMode,
    toggleFolder,
    filteredAgents,
    filteredChannels,
    hiddenSet,
    pinOrder,
    pinSet,
    sectionsList,
    sectionIdsSet,
    agentAssignments,
    sortAgents,
    visibleAgents,
    hiddenAgents,
    pinnedAgents,
    isAgentMarkedUnread,
    unreadAgents,
    setupAssistantAgent,
    vpsAssistantAgent,
    folders,
    orderedSections,
    handleCreateSectionSubmit,
    handleRenameSectionSubmit
  };
}

export type SidebarController = ReturnType<typeof useSidebarController>;
