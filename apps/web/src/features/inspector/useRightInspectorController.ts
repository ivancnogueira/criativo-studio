import React, { useEffect, useState } from "react";
import type {
  AgentAllowedFolder,
  AgentNotificationLevel,
  AvatarShape,
  AvatarStyle,
  BackupModelsConfig,
  CanalMemoria,
  CanalNavegadorModo,
  PermissionLevel,
} from "@criativo/contracts";
import { resolveAgentAvatarConfig } from "../../components/MascoteAvatar";
import type { CarbonSelectOption } from "../../components/ui/CarbonControls";
import { getCriativoDesktopBridge } from "../../types/desktop-bridge";
import {
  PERMISSION_RANK,
  type InspectorSubView,
  type RightInspectorPanelProps,
} from "./inspector-types";

export function useRightInspectorController(props: RightInspectorPanelProps) {
  const {
    initialSubView = "hub",
    agente,
    canal = null,
    arquivos,
    threads = [],
    skillsCount,
    routineFocusSignal = null,
    browserProfiles = [],
    onSaveAgentSettings,
    onAddMemory,
    onLoadMemories,
    onLoadChannelMemories,
  } = props;

  const [subView, setSubView] = useState<InspectorSubView>(
    routineFocusSignal?.subView ?? initialSubView
  );
  const initialCfg = (agente?.config ?? {}) as Record<string, unknown>;
  const initialVis = agente ? resolveAgentAvatarConfig(agente) : null;
  const [nomeDraft, setNomeDraft] = useState(agente?.nome ?? "");
  const [papelDraft, setPapelDraft] = useState(agente?.papel ?? "");
  const [promptDraft, setPromptDraft] = useState(
    typeof initialCfg.prompt_base === "string" ? initialCfg.prompt_base : ""
  );
  const [styleDraft, setStyleDraft] = useState<AvatarStyle>(initialVis?.style ?? "classic");
  const [variantDraft, setVariantDraft] = useState<string>(initialVis?.variant ?? "blob");
  const [imageUrlDraft, setImageUrlDraft] = useState<string | null>(initialVis?.imageUrl ?? null);
  const [shapeDraft, setShapeDraft] = useState<AvatarShape>(initialVis?.shape ?? "blob");
  const [colorDraft, setColorDraft] = useState(initialVis?.color ?? "#38bdf8");
  const [chatColorDraft, setChatColorDraft] = useState<string | null>(
    typeof initialCfg.chat_color === "string" && /^#[0-9a-fA-F]{6}$/.test(initialCfg.chat_color)
      ? initialCfg.chat_color.toUpperCase()
      : null
  );
  const [colorPickerExpanded, setColorPickerExpanded] = useState(false);
  const [avatarPickerExpanded, setAvatarPickerExpanded] = useState(true);
  const [allowedFoldersDraft, setAllowedFoldersDraft] = useState<AgentAllowedFolder[]>(
    Array.isArray(initialCfg.allowed_folders)
      ? (initialCfg.allowed_folders as AgentAllowedFolder[])
      : []
  );
  const [newFolderPath, setNewFolderPath] = useState("");
  const [newFolderMode, setNewFolderMode] = useState<"read_write" | "read">("read_write");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [autoMemoryDraft, setAutoMemoryDraft] = useState(initialCfg.auto_memory_enabled !== false);
  const [permissionDraft, setPermissionDraft] = useState<PermissionLevel>("workspace");
  const [pendingPermissionModal, setPendingPermissionModal] =
    useState<PermissionLevel | null>(null);
  const [browserProfileDraft, setBrowserProfileDraft] = useState<string>("shared");
  const [allowNewChatDraft, setAllowNewChatDraft] = useState(true);
  const [allowQuickAckDraft, setAllowQuickAckDraft] = useState(true);
  const [notificationDraft, setNotificationDraft] = useState<AgentNotificationLevel>("all");
  const [backupModelsDraft, setBackupModelsDraft] = useState<BackupModelsConfig>({
    automatic: false,
    order: [],
  });
  const [saving, setSaving] = useState(false);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memories, setMemories] = useState<
    Array<{ memoria_id: string; texto: string; criado_em: string }>
  >([]);
  const [confirmDeleteFileId, setConfirmDeleteFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [deleteFileError, setDeleteFileError] = useState<string | null>(null);

  // Estados de Configurações da Equipe (Canal)
  const [channelNomeDraft, setChannelNomeDraft] = useState(canal?.nome ?? "");
  const [channelDescDraft, setChannelDescDraft] = useState(canal?.descricao ?? "");
  const [channelInstDraft, setChannelInstDraft] = useState(canal?.instrucoes ?? "");
  const [channelMembersDraft, setChannelMembersDraft] = useState<string[]>(
    canal?.membros_agentes ?? []
  );
  const [channelLeaderDraft, setChannelLeaderDraft] = useState<string | null>(
    canal?.lider_agente_id ?? canal?.membros_agentes?.[0] ?? null
  );
  const [channelBrowserDraft, setChannelBrowserDraft] = useState<CanalNavegadorModo>(
    canal?.navegador_modo ?? "all"
  );
  const [channelKeepMemDraft, setChannelKeepMemDraft] = useState<boolean>(
    Boolean(canal?.manter_memorias)
  );
  const [channelMemories, setChannelMemories] = useState<CanalMemoria[]>([]);
  const [channelMemoryDraft, setChannelMemoryDraft] = useState("");
  const [channelAddMemberOpen, setChannelAddMemberOpen] = useState(false);
  const [channelActionBusy, setChannelActionBusy] = useState<string | null>(null);
  const [confirmClearChannelHist, setConfirmClearChannelHist] = useState(false);
  const [confirmDeleteChannelModal, setConfirmDeleteChannelModal] = useState(false);

  useEffect(() => {
    if (routineFocusSignal?.subView) {
      setSubView(routineFocusSignal.subView);
    }
  }, [routineFocusSignal?.nonce, routineFocusSignal?.subView]);

  useEffect(() => {
    if (!canal) return;
    setChannelNomeDraft(canal.nome);
    setChannelDescDraft(canal.descricao ?? "");
    setChannelInstDraft(canal.instrucoes ?? "");
    setChannelMembersDraft(canal.membros_agentes ?? []);
    setChannelLeaderDraft(canal.lider_agente_id ?? canal.membros_agentes?.[0] ?? null);
    setChannelBrowserDraft(canal.navegador_modo ?? "all");
    setChannelKeepMemDraft(Boolean(canal.manter_memorias));
    setConfirmClearChannelHist(false);
    setConfirmDeleteChannelModal(false);
    setChannelAddMemberOpen(false);
  }, [canal]);

  useEffect(() => {
    if (
      (subView === "channel_config" || subView === "channel_memories") &&
      canal &&
      onLoadChannelMemories
    ) {
      void onLoadChannelMemories(canal.canal_id).then(setChannelMemories).catch(() => {});
    }
  }, [subView, canal, onLoadChannelMemories]);

  useEffect(() => {
    if (canal && !agente) {
      setSubView((prev) =>
        prev === "config" ||
        prev === "subconversations" ||
        prev === "routines" ||
        prev === "instructions" ||
        prev === "memories" ||
        prev === "folders" ||
        prev === "advanced" ||
        prev === "backup_models"
          ? "channel_config"
          : prev
      );
    } else if (agente && !canal) {
      setSubView((prev) =>
        prev === "channel_config" || prev === "channel_memories" || prev === "channel_routines"
          ? "hub"
          : prev
      );
    }
  }, [agente, canal]);

  useEffect(() => {
    if (!agente) return;
    const cfg = (agente.config ?? {}) as Record<string, unknown>;
    const resolvedVis = resolveAgentAvatarConfig(agente);
    setNomeDraft(agente.nome);
    setPapelDraft(agente.papel);
    setPromptDraft(typeof cfg.prompt_base === "string" ? cfg.prompt_base : "");
    setStyleDraft(resolvedVis.style);
    setVariantDraft(resolvedVis.variant);
    setImageUrlDraft(resolvedVis.imageUrl ?? null);
    setShapeDraft(resolvedVis.shape);
    setColorDraft(resolvedVis.color);
    setChatColorDraft(
      typeof cfg.chat_color === "string" && /^#[0-9a-fA-F]{6}$/.test(cfg.chat_color)
        ? cfg.chat_color.toUpperCase()
        : null
    );
    setAllowedFoldersDraft(
      Array.isArray(cfg.allowed_folders) ? (cfg.allowed_folders as AgentAllowedFolder[]) : []
    );
    setAutoMemoryDraft(cfg.auto_memory_enabled !== false);

    const perm = (agente.permission_level ??
      cfg.permission_level ??
      "workspace") as PermissionLevel;
    setPermissionDraft(perm === "ask" || perm === "full" ? perm : "workspace");

    const prof = (agente.browser_profile_id ??
      (typeof cfg.browser_profile_id === "string" ? cfg.browser_profile_id : null) ??
      "shared") as string;
    setBrowserProfileDraft(prof || "shared");

    setAllowNewChatDraft(
      typeof agente.allow_new_chat === "boolean"
        ? agente.allow_new_chat
        : cfg.allow_new_chat !== false
    );
    setAllowQuickAckDraft(
      typeof agente.allow_quick_ack === "boolean"
        ? agente.allow_quick_ack
        : cfg.allow_quick_ack !== false && cfg.allow_quick_acknowledgement !== false
    );

    const notif = (agente.notification_level ??
      cfg.notification_level ??
      "all") as AgentNotificationLevel;
    setNotificationDraft(notif === "mentions" || notif === "muted" ? notif : "all");

    const rawBackup =
      agente.backup_models ??
      (cfg.backup_models as BackupModelsConfig | undefined) ?? { automatic: false, order: [] };
    setBackupModelsDraft({
      automatic: Boolean(rawBackup?.automatic),
      order: Array.isArray(rawBackup?.order) ? rawBackup.order : [],
    });
  }, [agente]);

  useEffect(() => {
    if ((subView === "config" || subView === "memories") && agente && onLoadMemories) {
      void onLoadMemories(agente.agente_id).then(setMemories).catch(() => {});
    }
  }, [subView, agente, onLoadMemories]);


  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agente) return;
    setSaving(true);
    try {
      await onSaveAgentSettings(agente.agente_id, {
        nome: nomeDraft.trim() || agente.nome,
        papel: papelDraft.trim() || agente.papel,
        prompt_base: promptDraft,
        avatar_shape: shapeDraft,
        avatar_color: colorDraft,
        avatar_style: styleDraft,
        avatar_variant: variantDraft,
        avatar_image_url: styleDraft === "image" ? imageUrlDraft : null,
        chat_color: chatColorDraft,
        allowed_folders: allowedFoldersDraft,
        auto_memory_enabled: autoMemoryDraft,
        permission_level: permissionDraft,
        browser_profile_id: browserProfileDraft === "shared" ? null : browserProfileDraft,
        allow_new_chat: allowNewChatDraft,
        allow_quick_ack: allowQuickAckDraft,
        notification_level: notificationDraft,
        backup_models: backupModelsDraft,
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePermissionPick = (nextPerm: PermissionLevel) => {
    if (PERMISSION_RANK[nextPerm] > PERMISSION_RANK[permissionDraft]) {
      setPendingPermissionModal(nextPerm);
      return;
    }
    setPermissionDraft(nextPerm);
    if (agente) {
      void onSaveAgentSettings(agente.agente_id, { permission_level: nextPerm });
    }
  };

  const handleConfirmPermission = () => {
    if (!pendingPermissionModal) return;
    const confirmed = pendingPermissionModal;
    setPermissionDraft(confirmed);
    setPendingPermissionModal(null);
    if (agente) {
      void onSaveAgentSettings(agente.agente_id, { permission_level: confirmed });
    }
  };

  const handleAddMemory = async () => {
    if (!agente || !onAddMemory || !memoryDraft.trim()) return;
    const txt = memoryDraft.trim();
    setMemoryDraft("");
    await onAddMemory(agente.agente_id, txt);
    if (onLoadMemories) {
      const updated = await onLoadMemories(agente.agente_id);
      setMemories(updated);
    }
  };

  const handleAddAllowedFolderPath = async (rawPath: string, mode: "read_write" | "read") => {
    if (!agente) return;
    const clean = rawPath.trim();
    if (!clean) return;
    setFolderError(null);
    const prev = allowedFoldersDraft;
    const next: AgentAllowedFolder[] = [
      ...prev.filter((f) => f.path.toLowerCase() !== clean.toLowerCase()),
      { path: clean, mode, added_at: new Date().toISOString() },
    ];
    try {
      await onSaveAgentSettings(agente.agente_id, { allowed_folders: next });
      setAllowedFoldersDraft(next);
      setNewFolderPath("");
    } catch (err) {
      setFolderError(
        err instanceof Error ? err.message : "Não foi possível autorizar esta pasta."
      );
    }
  };

  const handlePickNativeFolder = async () => {
    const bridge = getCriativoDesktopBridge();
    if (bridge?.pickFolder) {
      const picked = await bridge.pickFolder();
      if (!picked.canceled && picked.path) {
        await handleAddAllowedFolderPath(picked.path, newFolderMode);
        return;
      }
    }
    setSubView("folders");
  };

  const handleRemoveAllowedFolder = async (targetPath: string) => {
    if (!agente) return;
    setFolderError(null);
    const next = allowedFoldersDraft.filter((f) => f.path !== targetPath);
    try {
      await onSaveAgentSettings(agente.agente_id, { allowed_folders: next });
      setAllowedFoldersDraft(next);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Falha ao remover pasta.");
    }
  };

  const browserProfileOptions: CarbonSelectOption<string>[] = [
    {
      value: "shared",
      label: "Compartilhado (padrão)",
      description: "Usa a sessão compartilhada entre agentes",
    },
    {
      value: "agent",
      label: "Exclusivo deste agente",
      description: "Isola cookies e login exclusivamente neste agente",
    },
    ...browserProfiles
      .filter((p) => !p.compartilhado && p.perfil_id !== "shared")
      .map((p) => ({
        value: p.perfil_id,
        label: p.nome,
        description: p.proxy_url ? "Proxy vinculado" : undefined,
      })),
  ];

  // Diferenciação explícita singular/plural pedida pelo usuário
  const authorizedFoldersLabel =
    allowedFoldersDraft.length === 1 ? "Pasta Autorizada" : "Pastas Autorizadas";

  const authorizedFoldersSummary =
    allowedFoldersDraft.length === 0
      ? "Nenhuma adicionada"
      : allowedFoldersDraft.length === 1
        ? "1 pasta"
        : `${allowedFoldersDraft.length} pastas`;

  const panelTitle =
    subView === "files"
      ? `Biblioteca (${arquivos.length})`
      : subView === "config"
        ? "Configurações do agente"
        : subView === "channel_config"
          ? "Configurações da equipe"
          : subView === "channel_memories"
            ? `Memórias da equipe (${channelMemories.length})`
            : subView === "channel_routines"
              ? "Rotinas da equipe"
              : subView === "routines"
                ? "Rotinas do agente"
                : subView === "subconversations"
                  ? `Subconversas (${threads.length})`
                  : subView === "folders"
                    ? authorizedFoldersLabel
                    : subView === "instructions"
                      ? "Instruções"
                      : subView === "memories"
                        ? `Memórias (${memories.length})`
                        : subView === "advanced"
                          ? "Controle Avançado"
                          : subView === "preview"
                            ? "Preview Instagram"
                            : subView === "backup_models"
                              ? "Modelo Reserva"
                              : subView === "browser_profiles"
                                ? "Perfis de Navegador"
                                : "";

  const backTarget: InspectorSubView =
    subView === "backup_models" ||
    subView === "folders" ||
    subView === "instructions" ||
    subView === "memories" ||
    subView === "advanced"
      ? "config"
      : subView === "channel_memories" || subView === "channel_routines"
        ? "channel_config"
        : subView === "browser_profiles"
          ? "advanced"
          : "hub";

  const backupSummary = backupModelsDraft.automatic
    ? `Automático · ${backupModelsDraft.order.length} modelo(s)`
    : backupModelsDraft.order.length > 0
      ? `Perguntar antes · ${backupModelsDraft.order.length} modelo(s)`
      : "Perguntar antes";

  const assignedSkillsCount =
    skillsCount ?? agente?.skills_paths?.length ?? 0;


  return {
    subView,
    setSubView,
    nomeDraft,
    setNomeDraft,
    papelDraft,
    setPapelDraft,
    promptDraft,
    setPromptDraft,
    styleDraft,
    setStyleDraft,
    variantDraft,
    setVariantDraft,
    imageUrlDraft,
    setImageUrlDraft,
    shapeDraft,
    setShapeDraft,
    colorDraft,
    setColorDraft,
    chatColorDraft,
    setChatColorDraft,
    colorPickerExpanded,
    setColorPickerExpanded,
    avatarPickerExpanded,
    setAvatarPickerExpanded,
    allowedFoldersDraft,
    setAllowedFoldersDraft,
    newFolderPath,
    setNewFolderPath,
    newFolderMode,
    setNewFolderMode,
    folderError,
    setFolderError,
    autoMemoryDraft,
    setAutoMemoryDraft,
    permissionDraft,
    setPermissionDraft,
    pendingPermissionModal,
    setPendingPermissionModal,
    browserProfileDraft,
    setBrowserProfileDraft,
    allowNewChatDraft,
    setAllowNewChatDraft,
    allowQuickAckDraft,
    setAllowQuickAckDraft,
    notificationDraft,
    setNotificationDraft,
    backupModelsDraft,
    setBackupModelsDraft,
    saving,
    setSaving,
    confirmClearHistory,
    setConfirmClearHistory,
    clearingHistory,
    setClearingHistory,
    memoryDraft,
    setMemoryDraft,
    memories,
    setMemories,
    confirmDeleteFileId,
    setConfirmDeleteFileId,
    deletingFileId,
    setDeletingFileId,
    deleteFileError,
    setDeleteFileError,
    channelNomeDraft,
    setChannelNomeDraft,
    channelDescDraft,
    setChannelDescDraft,
    channelInstDraft,
    setChannelInstDraft,
    channelMembersDraft,
    setChannelMembersDraft,
    channelLeaderDraft,
    setChannelLeaderDraft,
    channelBrowserDraft,
    setChannelBrowserDraft,
    channelKeepMemDraft,
    setChannelKeepMemDraft,
    channelMemories,
    setChannelMemories,
    channelMemoryDraft,
    setChannelMemoryDraft,
    channelAddMemberOpen,
    setChannelAddMemberOpen,
    channelActionBusy,
    setChannelActionBusy,
    confirmClearChannelHist,
    setConfirmClearChannelHist,
    confirmDeleteChannelModal,
    setConfirmDeleteChannelModal,
    handleSaveConfig,
    handlePermissionPick,
    handleConfirmPermission,
    handleAddMemory,
    handleAddAllowedFolderPath,
    handlePickNativeFolder,
    handleRemoveAllowedFolder,
    browserProfileOptions,
    authorizedFoldersLabel,
    authorizedFoldersSummary,
    panelTitle,
    backTarget,
    backupSummary,
    assignedSkillsCount
  };
}

export type RightInspectorController = ReturnType<typeof useRightInspectorController>;
