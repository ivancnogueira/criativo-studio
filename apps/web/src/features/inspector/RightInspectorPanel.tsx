import React, { useEffect, useState } from "react";
import type {
  AgentAllowedFolder,
  AgentNotificationLevel,
  AgenteRegistro,
  AgenteThreadRegistro,
  ArquivoStudio,
  AvatarShape,
  AvatarStyle,
  BackupModelsConfig,
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  CanalEquipe,
  NivelEsforco,
  PermissionLevel,
  ProvedorStatusInfo,
  TarefaRegistro,
} from "@criativo/contracts";
import {
  Activity,
  ArrowLeft,
  AudioLines,
  Bell,
  Blocks,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  Cpu,
  Database,
  FileText,
  FolderOpen,
  GitFork,
  Layers,
  Monitor,
  MousePointerClick,
  Palette,
  Plus,
  Puzzle,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  MascoteAppearancePicker,
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import { CarbonSelect, type CarbonSelectOption } from "../../components/ui/CarbonControls";
import { getCriativoDesktopBridge } from "../../types/desktop-bridge";
import { ServerBrowserProfilesPanel } from "../browser/ServerBrowserProfilesPanel";
import { AGENT_CHAT_COLOR_SWATCHES } from "../chat/chat-bubble-theme";
import { ApprovalBridge } from "../preview/ApprovalBridge";
import { InstagramMobilePreview } from "../preview/InstagramMobilePreview";
import { AgentRoutinesSettings } from "../routines/AgentRoutinesSettings";
import { BackupModelsEditor } from "./BackupModelsEditor";

export type InspectorSubView =
  | "hub"
  | "config"
  | "preview"
  | "files"
  | "routines"
  | "backup_models"
  | "browser_profiles"
  | "subconversations"
  | "folders"
  | "instructions"
  | "memories"
  | "advanced";

export interface RightInspectorPanelProps {
  open: boolean;
  widthPx?: number;
  initialSubView?: InspectorSubView;
  agente: AgenteRegistro | null;
  arquivos: ArquivoStudio[];
  canais?: CanalEquipe[];
  threads?: AgenteThreadRegistro[];
  activeThreadId?: string | null;
  skillsCount?: number;
  tablesCount?: number;
  routineCount?: number;
  routineFocusSignal?: {
    subView?: InspectorSubView;
    rotinaId?: string | null;
    nonce: number;
  } | null;
  previewTarefa: TarefaRegistro | null;
  provedores?: ProvedorStatusInfo[];
  browserProfiles?: BrowserProfileInfo[];
  browserProxies?: BrowserProxyConfig[];
  activeBrowserTabsCount?: number;
  userBrowsingStepsCount?: number;
  onClose: () => void;
  onOpenFilesPage: () => void;
  onOpenUsagePage?: () => void;
  onOpenStorePage?: () => void;
  onOpenTablesModal?: () => void;
  onSelectThread?: (threadId: string | null) => void;
  onCreateSubconversation?: () => void;
  onClearChatHistory?: (agenteId: string) => Promise<void>;
  onDeleteFile?: (arquivoId: string) => Promise<void>;
  onOpenWhatsAppModal: () => void;
  onOpenRoutineThread?: (canalId: string) => void;
  onRoutinesChanged?: () => void;
  onSaveAgentSettings: (
    agenteId: string,
    patch: {
      nome?: string;
      papel?: string;
      prompt_base?: string;
      avatar_shape?: AvatarShape;
      avatar_color?: string;
      avatar_style?: AvatarStyle;
      avatar_variant?: string;
      avatar_image_url?: string | null;
      chat_color?: string | null;
      allowed_folders?: AgentAllowedFolder[];
      auto_memory_enabled?: boolean;
      effort?: NivelEsforco;
      backup_models?: BackupModelsConfig;
      permission_level?: PermissionLevel;
      allow_new_chat?: boolean;
      allow_quick_ack?: boolean;
      browser_profile_id?: string | null;
      notification_level?: AgentNotificationLevel;
    }
  ) => Promise<void>;
  onRestoreAgentDefaults?: (agenteId: string) => Promise<void>;
  onAddMemory?: (agenteId: string, texto: string) => Promise<void>;
  onLoadMemories?: (
    agenteId: string
  ) => Promise<Array<{ memoria_id: string; texto: string; criado_em: string }>>;
  onApproveTask: (tarefaId: string) => Promise<void>;
  onRequestRevision: (tarefa: TarefaRegistro) => Promise<void>;
  onCreateBrowserProfile?: (input: { nome: string; cor_hex?: string }) => Promise<void>;
  onUpdateBrowserProfile?: (
    perfilId: string,
    patch: { nome?: string; cor_hex?: string; proxy_json?: BrowserProfileProxyPayload | null }
  ) => Promise<void>;
  onClearBrowserProfile?: (perfilId: string) => Promise<void>;
  onDeleteBrowserProfile?: (perfilId: string) => Promise<void>;
  onSaveBrowserProxy?: (input: {
    nome: string;
    servidor: string;
    usuario?: string | null;
    senha?: string | null;
  }) => Promise<BrowserProxyConfig>;
  onDeleteBrowserProxy?: (proxyId: string) => Promise<void>;
  onOpenAgentBrowserTakeover?: (agenteId: string) => void | Promise<void>;
  onInspectAgentBrowsingLog?: (agenteId: string) => void | Promise<void>;
}

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  workspace: 0,
  ask: 1,
  full: 2,
};

const PERMISSION_OPTIONS: readonly CarbonSelectOption<PermissionLevel>[] = [
  {
    value: "workspace",
    label: "Apenas workspace",
    description: "Restrito a recursos/, saidas/, previas/ e Pastas Autorizadas",
  },
  {
    value: "ask",
    label: "Perguntar fora do workspace",
    description: "Solicita aprovação antes de gravar fora das pastas padrão",
  },
  {
    value: "full",
    label: "Acesso completo",
    description: "Permite operar todo o workspace do projeto sem barreira extra",
  },
];

const FOLDER_MODE_OPTIONS: readonly CarbonSelectOption<"read_write" | "read">[] = [
  {
    value: "read_write",
    label: "Leitura e escrita",
    description: "Agente pode ler e criar/editar arquivos dentro desta pasta",
  },
  {
    value: "read",
    label: "Somente leitura",
    description: "Agente apenas consulta arquivos desta pasta",
  },
];

function formatTotalBytes(arquivos: ArquivoStudio[]): string {
  const bytes = arquivos.reduce((acc, a) => acc + (a.tamanho_bytes ?? 0), 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  open,
  widthPx,
  initialSubView = "hub",
  agente,
  arquivos,
  canais = [],
  threads = [],
  activeThreadId = null,
  skillsCount,
  tablesCount = 0,
  routineCount = 0,
  routineFocusSignal = null,
  previewTarefa,
  provedores = [],
  browserProfiles = [],
  browserProxies = [],
  activeBrowserTabsCount = 0,
  userBrowsingStepsCount = 0,
  onClose,
  onOpenFilesPage,
  onOpenUsagePage,
  onOpenStorePage,
  onOpenTablesModal,
  onSelectThread,
  onCreateSubconversation,
  onClearChatHistory,
  onDeleteFile,
  onOpenWhatsAppModal,
  onOpenRoutineThread,
  onRoutinesChanged,
  onSaveAgentSettings,
  onRestoreAgentDefaults,
  onAddMemory,
  onLoadMemories,
  onApproveTask,
  onRequestRevision,
  onCreateBrowserProfile,
  onUpdateBrowserProfile,
  onClearBrowserProfile,
  onDeleteBrowserProfile,
  onSaveBrowserProxy,
  onDeleteBrowserProxy,
  onOpenAgentBrowserTakeover,
  onInspectAgentBrowsingLog,
}) => {
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
  const [avatarPickerExpanded, setAvatarPickerExpanded] = useState(false);
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

  useEffect(() => {
    if (routineFocusSignal?.subView) {
      setSubView(routineFocusSignal.subView);
    }
  }, [routineFocusSignal?.nonce, routineFocusSignal?.subView]);

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

  if (!open) return null;

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

  return (
    <aside
      aria-label="Inspetor contextual do agente"
      style={widthPx ? { width: `${widthPx}px` } : { width: "330px" }}
      className="relative shrink-0 bg-[#1A1A1A] border-l border-white/[0.06] flex flex-col h-full overflow-hidden"
    >
      <div className="h-[48px] shrink-0 px-3.5 flex items-center justify-between gap-2 border-b border-white/[0.06]">
        {subView === "hub" ? (
          <span className="text-[12px] font-medium text-[#787878]">Painel do agente</span>
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
        {subView === "hub" && (
          <div className="h-full flex flex-col justify-between gap-4">
            <div className="my-auto space-y-2.5 py-4">
              <button
                type="button"
                onClick={() => setSubView("files")}
                className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
              >
                <FolderOpen className="h-4 w-4 text-[#979797]" />
                <span>Abrir Biblioteca ({arquivos.length})</span>
              </button>

              <button
                type="button"
                disabled={!agente}
                onClick={() => setSubView("subconversations")}
                className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors disabled:opacity-40"
              >
                <GitFork className="h-4 w-4 text-[#42A0FF]" />
                <span>
                  {threads.length > 0 ? `Subconversas (${threads.length})` : "Subconversas"}
                </span>
              </button>

              <button
                type="button"
                disabled={!agente}
                onClick={() => setSubView("config")}
                className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors disabled:opacity-40"
              >
                <Settings className="h-4 w-4 text-[#979797]" />
                <span>Abrir Configurações do agente</span>
              </button>

              <button
                type="button"
                disabled={!agente}
                onClick={() => setSubView("routines")}
                className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors disabled:opacity-40"
              >
                <CalendarClock className="h-4 w-4 text-[#42A0FF]" />
                <span>
                  {routineCount > 0 ? `Gerenciar rotinas (${routineCount})` : "Gerenciar rotinas"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSubView("preview")}
                className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
              >
                <Smartphone className="h-4 w-4 text-[#42A0FF]" />
                <span>Abrir Preview Instagram</span>
              </button>

              <button
                type="button"
                onClick={onOpenWhatsAppModal}
                className="w-full flex items-center gap-3 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.07] px-4 py-3 text-[13px] font-medium text-white transition-colors"
              >
                <AudioLines className="h-4 w-4 text-[#31CF76]" />
                <span>Abrir Voz &amp; WhatsApp</span>
              </button>
            </div>

            {previewTarefa && (
              <div className="pt-3 border-t border-white/[0.06]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11.5px] font-medium text-[#979797] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#31CF76]" />
                    Pronto para aprovação
                  </span>
                  <button
                    type="button"
                    onClick={() => setSubView("preview")}
                    className="text-[11px] text-[#42A0FF] hover:underline"
                  >
                    Expandir
                  </button>
                </div>
                <ApprovalBridge
                  tarefa={previewTarefa}
                  onApprove={onApproveTask}
                  onRequestRevision={onRequestRevision}
                />
              </div>
            )}
          </div>
        )}

        {subView === "preview" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#979797] flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5 text-[#42A0FF]" />
                Vitrine Mobile Instagram
              </span>
            </div>
            <InstagramMobilePreview tarefa={previewTarefa} />
            <ApprovalBridge
              tarefa={previewTarefa}
              onApprove={onApproveTask}
              onRequestRevision={onRequestRevision}
            />
          </div>
        )}

        {subView === "subconversations" && agente && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-white">Subconversas ativas</span>
              {onCreateSubconversation && (
                <button
                  type="button"
                  onClick={onCreateSubconversation}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#007CF7] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#1688FA]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Nova Subconversa</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => onSelectThread?.(null)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                activeThreadId === null
                  ? "border-[#007CF7] bg-[#007CF7]/15 text-white"
                  : "border-white/[0.06] bg-[#212121] text-[#DCDCDC] hover:bg-[#262626]"
              }`}
            >
              <div className="text-[12.5px] font-semibold">Conversa principal</div>
              <div className="text-[11px] text-[#8E8E93]">Fluxo direto com {agente.nome}</div>
            </button>

            {threads.length === 0 ? (
              <p className="rounded-xl border border-white/[0.06] bg-[#212121] p-4 text-[12px] text-[#979797]">
                Nenhuma subconversa aberta ainda. Clique em <strong>Nova Subconversa</strong> para trabalhar em paralelo sem misturar o chat principal.
              </p>
            ) : (
              <div className="space-y-1.5">
                {threads.map((th) => {
                  const active = activeThreadId === th.thread_id;
                  return (
                    <button
                      key={th.thread_id}
                      type="button"
                      onClick={() => onSelectThread?.(th.thread_id)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "border-[#007CF7] bg-[#007CF7]/15 text-white"
                          : "border-white/[0.06] bg-[#212121] text-[#DCDCDC] hover:bg-[#262626]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12.5px] font-semibold">{th.titulo}</span>
                        <span className="text-[10.5px] text-[#8E8E93] shrink-0">{th.estado}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {subView === "files" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-white">Biblioteca &amp; Mídias</span>
              <button
                type="button"
                onClick={onOpenFilesPage}
                className="text-[11.5px] text-[#42A0FF] hover:underline"
              >
                Ver galeria completa
              </button>
            </div>
            {deleteFileError && (
              <div className="rounded-lg border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-2.5 py-1.5 text-[11.5px] text-[#FF7675]">
                {deleteFileError}
              </div>
            )}
            {arquivos.length === 0 ? (
              <p className="text-[12px] text-[#979797] rounded-xl bg-[#212121] p-4 border border-white/[0.06]">
                Nenhum arquivo enviado ainda. Use o botão <strong>+</strong> no chat para subir
                referências faciais ou logos.
              </p>
            ) : (
              <div className="space-y-2">
                {arquivos.slice(0, 12).map((arq) => (
                  <div
                    key={arq.arquivo_id}
                    className="flex items-center gap-2 rounded-xl bg-[#212121] hover:bg-[#262626] border border-white/[0.06] p-2.5 transition-colors"
                  >
                    <a
                      href={arq.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2.5 min-w-0 flex-1"
                    >
                      {arq.mime_type.startsWith("image/") ? (
                        <img
                          src={arq.url}
                          alt={arq.nome_original}
                          className="h-10 w-10 rounded-lg object-cover bg-[#101010] shrink-0"
                        />
                      ) : (
                        <FolderOpen className="h-5 w-5 text-[#42A0FF] shrink-0 ml-1" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-white truncate">
                          {arq.nome_original}
                        </p>
                        <p className="text-[10.5px] text-[#6A6A6A] truncate">
                          {arq.tipo_uso} · {(arq.tamanho_bytes / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </a>

                    {onDeleteFile && (
                      confirmDeleteFileId === arq.arquivo_id ? (
                        <div className="flex items-center gap-1 shrink-0 rounded-lg bg-[#141414] border border-[#FD2F3B]/40 px-1.5 py-1 text-[10.5px]">
                          <span className="text-[#FF7675] font-medium">Excluir?</span>
                          <button
                            type="button"
                            disabled={deletingFileId === arq.arquivo_id}
                            onClick={async () => {
                              setDeletingFileId(arq.arquivo_id);
                              setDeleteFileError(null);
                              try {
                                await onDeleteFile(arq.arquivo_id);
                                setConfirmDeleteFileId(null);
                              } catch (err) {
                                setDeleteFileError(
                                  err instanceof Error ? err.message : "Erro ao excluir arquivo."
                                );
                              } finally {
                                setDeletingFileId(null);
                              }
                            }}
                            className="rounded px-1.5 py-0.5 bg-[#FD2F3B] text-white font-semibold hover:bg-[#e12732]"
                          >
                            Sim
                          </button>
                          <button
                            type="button"
                            disabled={deletingFileId === arq.arquivo_id}
                            onClick={() => setConfirmDeleteFileId(null)}
                            className="rounded px-1.5 py-0.5 bg-[#2A2A2A] text-[#DCDCDC] hover:bg-[#333336]"
                          >
                            Não
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          title="Excluir arquivo"
                          aria-label={`Excluir ${arq.nome_original}`}
                          onClick={() => {
                            setDeleteFileError(null);
                            setConfirmDeleteFileId(arq.arquivo_id);
                          }}
                          className="shrink-0 rounded-lg p-1.5 text-[#979797] hover:bg-[#FD2F3B]/15 hover:text-[#FF7675] transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subView === "routines" && agente && (
          <AgentRoutinesSettings
            ownerKind="agente"
            ownerId={agente.agente_id}
            ownerName={agente.nome}
            canais={canais}
            initialSelectedRoutineId={routineFocusSignal?.rotinaId ?? null}
            onBackToHub={() => setSubView("config")}
            onOpenThreadOrChat={onOpenRoutineThread}
            onRoutinesChanged={onRoutinesChanged}
          />
        )}

        {subView === "backup_models" && agente && (
          <BackupModelsEditor
            primaryModel={agente.modelo_padrao}
            config={backupModelsDraft}
            provedores={provedores}
            onChange={(nextCfg) => {
              setBackupModelsDraft(nextCfg);
              void onSaveAgentSettings(agente.agente_id, { backup_models: nextCfg });
            }}
          />
        )}

        {subView === "browser_profiles" && (
          <ServerBrowserProfilesPanel
            profiles={browserProfiles}
            proxies={browserProxies}
            onCreateProfile={async (input) => {
              if (onCreateBrowserProfile) await onCreateBrowserProfile(input);
            }}
            onUpdateProfile={async (perfilId, patch) => {
              if (onUpdateBrowserProfile) await onUpdateBrowserProfile(perfilId, patch);
            }}
            onClearProfile={async (perfilId) => {
              if (onClearBrowserProfile) await onClearBrowserProfile(perfilId);
            }}
            onDeleteProfile={async (perfilId) => {
              if (onDeleteBrowserProfile) await onDeleteBrowserProfile(perfilId);
            }}
            onSaveProxy={async (input) => {
              if (onSaveBrowserProxy) return await onSaveBrowserProxy(input);
              throw new Error("Serviço de proxy não conectado.");
            }}
            onDeleteProxy={async (proxyId) => {
              if (onDeleteBrowserProxy) await onDeleteBrowserProxy(proxyId);
            }}
          />
        )}

        {subView === "instructions" && agente && (
          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div>
              <label
                htmlFor="inspector-agent-prompt"
                className="block text-[12px] font-semibold text-[#E5E5E5] mb-1.5"
              >
                Instruções permanentes
              </label>
              <textarea
                id="inspector-agent-prompt"
                name="inspector_agent_prompt"
                aria-label="Instruções do agente"
                rows={10}
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                className="w-full rounded-xl bg-[#212121] border border-white/10 px-3 py-2.5 text-[12.5px] text-white focus:outline-none focus:border-white/30"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="studio-btn-primary w-full py-2 text-[12.5px]"
            >
              {saving ? "Salvando..." : "Salvar instruções"}
            </button>
          </form>
        )}

        {subView === "memories" && agente && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[#212121] border border-white/[0.06] px-3.5 py-3">
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-white">
                  Memória automática deste agente
                </div>
                <div className="text-[11px] text-[#8E8E93]">
                  Extrai aprendizados relevantes em segundo plano após as conversas.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoMemoryDraft}
                aria-label="Memória automática deste agente"
                onClick={() => {
                  const next = !autoMemoryDraft;
                  setAutoMemoryDraft(next);
                  void onSaveAgentSettings(agente.agente_id, { auto_memory_enabled: next });
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  autoMemoryDraft ? "bg-[#007CF7]" : "bg-[#2A2A2A]"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    autoMemoryDraft ? "translate-x-4.5" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex gap-1.5">
                <input
                  id="inspector-new-memory"
                  name="new_memory"
                  aria-label="Adicionar memória permanente do agente"
                  type="text"
                  value={memoryDraft}
                  onChange={(e) => setMemoryDraft(e.target.value)}
                  placeholder="Ex.: Tom direto sem emojis..."
                  className="flex-1 rounded-xl bg-[#212121] border border-white/10 px-3 py-1.5 text-[12px] text-white placeholder-[#6A6A6A] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleAddMemory()}
                  className="rounded-xl bg-[#2A2A2A] hover:bg-[#333336] px-3 py-1.5 text-[12px] font-medium text-white"
                >
                  Fixar
                </button>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {memories.length === 0 ? (
                  <p className="rounded-xl border border-white/[0.06] bg-[#212121] p-3.5 text-[11.5px] text-[#8E8E93]">
                    Nenhuma memória salva para este especialista ainda.
                  </p>
                ) : (
                  memories.map((m) => (
                    <div
                      key={m.memoria_id}
                      className="rounded-lg bg-[#212121] border border-white/[0.05] px-3 py-2 text-[11.5px] text-[#DCDCDC]"
                    >
                      {m.texto}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {subView === "folders" && agente && (
          <div className="space-y-4">
            <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3.5 space-y-3">
              <div>
                <div className="text-[12.5px] font-semibold text-white">{authorizedFoldersLabel}</div>
                <p className="text-[11px] text-[#8E8E93] mt-0.5">
                  Conceda acesso a diretórios específicos do seu computador fora do workspace padrão do estúdio.
                </p>
              </div>

              <div className="space-y-2">
                <CarbonSelect
                  ariaLabel="Modo de acesso da pasta"
                  value={newFolderMode}
                  options={FOLDER_MODE_OPTIONS}
                  onChange={(val) => setNewFolderMode(val)}
                />

                {getCriativoDesktopBridge()?.pickFolder && (
                  <button
                    type="button"
                    onClick={() => void handlePickNativeFolder()}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#007CF7] hover:bg-[#1688FA] px-3 py-2 text-[12px] font-semibold text-white transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>Escolher pasta do computador</span>
                  </button>
                )}

                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newFolderPath}
                    onChange={(e) => setNewFolderPath(e.target.value)}
                    placeholder="Ex.: D:\Clientes\MarcaX"
                    aria-label="Caminho da pasta autorizada"
                    className="flex-1 min-w-0 rounded-xl bg-[#141414] border border-white/10 px-3 py-1.5 text-[12px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-white/30"
                  />
                  <button
                    type="button"
                    disabled={!newFolderPath.trim()}
                    onClick={() => void handleAddAllowedFolderPath(newFolderPath, newFolderMode)}
                    className="rounded-xl bg-[#2A2A2A] hover:bg-[#343438] disabled:opacity-40 px-3 py-1.5 text-[12px] font-semibold text-white shrink-0"
                  >
                    Adicionar
                  </button>
                </div>
              </div>

              {folderError && (
                <div className="rounded-lg border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-2.5 py-2 text-[11.5px] text-[#FF7675]">
                  {folderError}
                </div>
              )}
            </div>

            {allowedFoldersDraft.length === 0 ? (
              <p className="rounded-xl border border-white/[0.06] bg-[#212121] p-3.5 text-[11.5px] text-[#8E8E93]">
                Nenhuma pasta adicional liberada. O agente opera apenas no workspace do estúdio.
              </p>
            ) : (
              <div className="space-y-1.5">
                {allowedFoldersDraft.map((folder) => (
                  <div
                    key={folder.path}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#212121] px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-mono text-white truncate" title={folder.path}>
                        {folder.path}
                      </p>
                      <span className="inline-block mt-0.5 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-[#A8A8A8]">
                        {folder.mode === "read" ? "Somente leitura" : "Leitura e escrita"}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remover pasta ${folder.path}`}
                      onClick={() => void handleRemoveAllowedFolder(folder.path)}
                      className="rounded-lg p-1.5 text-[#979797] hover:bg-[#FD2F3B]/15 hover:text-[#FF7675]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subView === "advanced" && agente && (
          <div className="space-y-4">
            <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#F0F0F0]">
                  <ShieldCheck size={14} className="text-[#42A0FF]" />
                  <span>Navegador &amp; Sessões</span>
                </span>
                {activeBrowserTabsCount > 0 && (
                  <span className="rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[11px] font-semibold text-[#31CF76]">
                    {activeBrowserTabsCount} aba(s)
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-[#979797]">Perfil de navegador</span>
                  <button
                    type="button"
                    onClick={() => setSubView("browser_profiles")}
                    className="text-[12px] font-semibold text-[#42A0FF] hover:underline"
                  >
                    Gerenciar perfis de navegador
                  </button>
                </div>
                <CarbonSelect
                  ariaLabel="Perfil de navegador do agente"
                  value={browserProfileDraft}
                  options={browserProfileOptions}
                  onChange={(nextVal) => {
                    setBrowserProfileDraft(nextVal);
                    void onSaveAgentSettings(agente.agente_id, {
                      browser_profile_id: nextVal === "shared" ? null : nextVal,
                    });
                  }}
                />
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#F0F0F0]">
                    Permitir iniciar novo chat
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={allowNewChatDraft}
                    aria-label="Permitir iniciar novo chat"
                    onClick={() => {
                      const next = !allowNewChatDraft;
                      setAllowNewChatDraft(next);
                      void onSaveAgentSettings(agente.agente_id, { allow_new_chat: next });
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      allowNewChatDraft ? "bg-[#007CF7]" : "bg-[#2A2A2A]"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        allowNewChatDraft ? "translate-x-4.5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#F0F0F0]">
                    Mostrar plano antes de tarefas longas
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={allowQuickAckDraft}
                    aria-label="Mostrar plano antes de tarefas longas"
                    onClick={() => {
                      const next = !allowQuickAckDraft;
                      setAllowQuickAckDraft(next);
                      void onSaveAgentSettings(agente.agente_id, { allow_quick_ack: next });
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      allowQuickAckDraft ? "bg-[#007CF7]" : "bg-[#2A2A2A]"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        allowQuickAckDraft ? "translate-x-4.5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {(onOpenAgentBrowserTakeover || onInspectAgentBrowsingLog) && (
                <div className="grid grid-cols-1 gap-1.5 pt-1">
                  {onOpenAgentBrowserTakeover && (
                    <button
                      type="button"
                      onClick={() => void onOpenAgentBrowserTakeover(agente.agente_id)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                    >
                      <Monitor size={13} className="text-[#42A0FF]" />
                      <span>Assumir navegador</span>
                    </button>
                  )}
                  {onInspectAgentBrowsingLog && (
                    <button
                      type="button"
                      onClick={() => void onInspectAgentBrowsingLog(agente.agente_id)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#F0F0F0] hover:bg-[#2A2A2A]"
                    >
                      <MousePointerClick size={13} className="text-[#31CF76]" />
                      <span>Inspecionar log gravado ({userBrowsingStepsCount})</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3.5 space-y-2.5">
              <div className="text-[11.5px] font-semibold text-[#979797]">Manutenção</div>

              {onRestoreAgentDefaults && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await onRestoreAgentDefaults(agente.agente_id);
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="w-full rounded-xl bg-[#2A2A2A] hover:bg-[#333338] px-3 py-2 text-[12px] font-semibold text-white transition-colors"
                >
                  Restaurar padrão do especialista
                </button>
              )}

              {onClearChatHistory && (
                confirmClearHistory ? (
                  <div className="rounded-xl border border-[#FD2F3B]/40 bg-[#141414] p-3 space-y-2">
                    <p className="text-[11.5px] text-[#FF7675] font-medium">
                      Apagar todas as mensagens da conversa principal com {agente.nome}?
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={clearingHistory}
                        onClick={() => setConfirmClearHistory(false)}
                        className="rounded-lg bg-[#2A2A2A] px-2.5 py-1 text-[11.5px] text-[#DCDCDC] hover:bg-[#343438]"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={clearingHistory}
                        onClick={async () => {
                          setClearingHistory(true);
                          try {
                            await onClearChatHistory(agente.agente_id);
                            setConfirmClearHistory(false);
                          } finally {
                            setClearingHistory(false);
                          }
                        }}
                        className="rounded-lg bg-[#FD2F3B] px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-[#e12732]"
                      >
                        {clearingHistory ? "Apagando..." : "Confirmar exclusão"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearHistory(true)}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#FD2F3B]/30 bg-[#FD2F3B]/10 hover:bg-[#FD2F3B]/20 px-3 py-2 text-[12px] font-semibold text-[#FF7675] transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Apagar histórico do chat</span>
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {subView === "config" && agente && (
          <form onSubmit={handleSaveConfig} className="space-y-4">
            {/* Cartão de Identidade do Especialista */}
            <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3 space-y-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  title="Alterar avatar"
                  onClick={() => setAvatarPickerExpanded((v) => !v)}
                  className="shrink-0 rounded-xl p-1 hover:bg-white/[0.06] transition-colors"
                >
                  <MascoteAvatar
                    style={styleDraft}
                    variant={variantDraft}
                    shape={shapeDraft}
                    color={colorDraft}
                    imageUrl={styleDraft === "image" ? imageUrlDraft : null}
                    size={42}
                  />
                </button>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <input
                    id="inspector-agent-name"
                    name="inspector_agent_name"
                    aria-label="Nome do agente"
                    type="text"
                    value={nomeDraft}
                    onChange={(e) => setNomeDraft(e.target.value)}
                    className="w-full rounded-lg bg-[#141414] border border-white/10 px-2.5 py-1 text-[12.5px] font-semibold text-white focus:outline-none focus:border-white/30"
                  />
                  <input
                    aria-label="Título ou papel do agente"
                    type="text"
                    value={papelDraft}
                    onChange={(e) => setPapelDraft(e.target.value)}
                    className="w-full rounded-lg bg-[#141414] border border-white/[0.07] px-2.5 py-1 text-[11px] text-[#A8A8A8] focus:outline-none focus:border-white/25"
                  />
                </div>
              </div>

              {avatarPickerExpanded && (
                <div className="pt-2 border-t border-white/[0.06]">
                  <MascoteAppearancePicker
                    compact
                    showLivePreview
                    color={colorDraft}
                    shape={shapeDraft}
                    style={styleDraft}
                    variant={variantDraft}
                    imageUrl={imageUrlDraft}
                    agentName={nomeDraft}
                    onChangeColor={setColorDraft}
                    onChangeShape={setShapeDraft}
                    onChangeStyle={setStyleDraft}
                    onChangeVariant={setVariantDraft}
                    onChangeImageUrl={setImageUrlDraft}
                  />
                </div>
              )}
            </div>

            {/* Grupo 1: Motor IA */}
            <div className="space-y-1.5">
              <div className="px-1 text-[11.5px] font-medium text-[#8E8E93]">Motor IA</div>
              <div className="rounded-xl bg-[#212121] border border-white/[0.06] divide-y divide-white/[0.05] overflow-hidden">
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="flex items-center gap-2 text-white font-medium shrink-0">
                    <Cpu className="h-4 w-4 text-[#979797]" />
                    <span>Modelo</span>
                  </span>
                  <span className="text-[11.5px] text-[#A8A8A8] truncate">
                    {agente.modelo_padrao} ·{" "}
                    {String((agente.config as Record<string, unknown>)?.effort ?? "alto")}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setSubView("backup_models")}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium shrink-0">
                    <RefreshCw className="h-4 w-4 text-[#979797]" />
                    <span>Modelo Reserva</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-[#A8A8A8] min-w-0">
                    <span className="truncate">{backupSummary}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6A6A6A]" />
                  </span>
                </button>

                <div>
                  <button
                    type="button"
                    onClick={() => setColorPickerExpanded((v) => !v)}
                    className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                  >
                    <span className="flex items-center gap-2 text-white font-medium shrink-0">
                      <Palette className="h-4 w-4 text-[#979797]" />
                      <span>Cor dos balões</span>
                    </span>
                    <span className="flex items-center gap-2 text-[11.5px] text-[#A8A8A8]">
                      <span className="font-mono">{chatColorDraft ?? "Padrão"}</span>
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-white/20"
                        style={{ backgroundColor: chatColorDraft ?? "#212121" }}
                      />
                      <ChevronRight
                        className={`h-3.5 w-3.5 text-[#6A6A6A] transition-transform ${
                          colorPickerExpanded ? "rotate-90" : ""
                        }`}
                      />
                    </span>
                  </button>

                  {colorPickerExpanded && (
                    <div className="px-3.5 pb-3 pt-1.5 bg-[#181818] border-t border-white/[0.05] space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {AGENT_CHAT_COLOR_SWATCHES.map((sw) => {
                          const selected = chatColorDraft?.toUpperCase() === sw.hex.toUpperCase();
                          return (
                            <button
                              key={sw.hex}
                              type="button"
                              title={sw.label}
                              aria-label={`Cor dos balões ${sw.label}`}
                              onClick={() => {
                                setChatColorDraft(sw.hex);
                                void onSaveAgentSettings(agente.agente_id, { chat_color: sw.hex });
                              }}
                              style={{ backgroundColor: sw.hex }}
                              className={`h-6 w-6 rounded-full border border-white/20 flex items-center justify-center transition-transform ${
                                selected ? "ring-2 ring-white scale-110" : "opacity-85 hover:opacity-100"
                              }`}
                            >
                              {selected && <Check className="h-3 w-3 text-white drop-shadow" />}
                            </button>
                          );
                        })}

                        <input
                          type="color"
                          aria-label="Cor personalizada dos balões do agente"
                          value={chatColorDraft ?? "#166534"}
                          onChange={(e) => {
                            const hex = e.target.value.toUpperCase();
                            setChatColorDraft(hex);
                            void onSaveAgentSettings(agente.agente_id, { chat_color: hex });
                          }}
                          className="h-6 w-6 rounded border-0 bg-transparent cursor-pointer"
                        />

                        {chatColorDraft && (
                          <button
                            type="button"
                            onClick={() => {
                              setChatColorDraft(null);
                              void onSaveAgentSettings(agente.agente_id, { chat_color: null });
                            }}
                            className="ml-auto text-[11px] text-[#979797] hover:text-white underline"
                          >
                            Resetar
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Grupo 2: Conhecimento */}
            <div className="space-y-1.5">
              <div className="px-1 text-[11.5px] font-medium text-[#8E8E93]">Conhecimento</div>
              <div className="rounded-xl bg-[#212121] border border-white/[0.06] divide-y divide-white/[0.05] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSubView("instructions")}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <FileText className="h-4 w-4 text-[#979797]" />
                    <span>Instruções</span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                </button>

                <button
                  type="button"
                  onClick={() => setSubView("memories")}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <Brain className="h-4 w-4 text-[#979797]" />
                    <span>Memórias</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-[#A8A8A8]">
                    <span>
                      {memories.length === 1 ? "1 salva" : `${memories.length} salvas`}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenStorePage?.()}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <Puzzle className="h-4 w-4 text-[#979797]" />
                    <span>Especialidades</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-[#A8A8A8]">
                    <span>
                      {assignedSkillsCount === 1
                        ? "1 atribuída"
                        : `${assignedSkillsCount} atribuídas`}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSubView("files")}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <FolderOpen className="h-4 w-4 text-[#979797]" />
                    <span>Biblioteca</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-[#A8A8A8]">
                    <span>{formatTotalBytes(arquivos)}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenTablesModal?.()}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <Database className="h-4 w-4 text-[#979797]" />
                    <span>Tabelas</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-[#A8A8A8]">
                    <span>
                      {tablesCount === 1 ? "1 tabela" : `${tablesCount} tabelas`}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                  </span>
                </button>
              </div>
            </div>

            {/* Grupo 3: Operações */}
            <div className="space-y-1.5">
              <div className="px-1 text-[11.5px] font-medium text-[#8E8E93]">Operações</div>
              <div className="rounded-xl bg-[#212121] border border-white/[0.06] divide-y divide-white/[0.05] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSubView("routines")}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <CalendarClock className="h-4 w-4 text-[#979797]" />
                    <span>Rotinas</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-[#A8A8A8]">
                    <span>
                      {routineCount === 1
                        ? "1 configurada"
                        : `${routineCount} configuradas`}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSubView("subconversations")}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <GitFork className="h-4 w-4 text-[#979797]" />
                    <span>Subconversas</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-[#A8A8A8]">
                    <span>{threads.length}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenUsagePage?.()}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <Activity className="h-4 w-4 text-[#979797]" />
                    <span>Consumo</span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                </button>

                <button
                  type="button"
                  onClick={() => onOpenStorePage?.()}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <Blocks className="h-4 w-4 text-[#979797]" />
                    <span>Apps</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-[#A8A8A8]">
                    <span>Catálogo &amp; MCP</span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                  </span>
                </button>
              </div>
            </div>

            {/* Grupo 4: Controle */}
            <div className="space-y-2">
              <div className="px-1 text-[11.5px] font-medium text-[#8E8E93]">Controle</div>
              <div className="rounded-xl bg-[#212121] border border-white/[0.06] divide-y divide-white/[0.05]">
                <div className="p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-[12.5px] font-medium text-white">
                    <ShieldCheck className="h-4 w-4 text-[#979797]" />
                    <span>Permissões</span>
                  </div>
                  <CarbonSelect
                    ariaLabel="Nível de acesso do agente"
                    value={permissionDraft}
                    options={PERMISSION_OPTIONS}
                    onChange={handlePermissionPick}
                  />
                </div>

                <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors">
                  <button
                    type="button"
                    onClick={() => setSubView("folders")}
                    className="flex items-center gap-2 text-white font-medium min-w-0 flex-1 text-left"
                  >
                    <FolderOpen className="h-4 w-4 text-[#979797] shrink-0" />
                    <span className="truncate">{authorizedFoldersLabel}</span>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0 text-[11.5px] text-[#A8A8A8]">
                    <button
                      type="button"
                      onClick={() => setSubView("folders")}
                      className="hover:text-white"
                    >
                      {authorizedFoldersSummary}
                    </button>
                    <button
                      type="button"
                      title="Autorizar pasta do computador"
                      aria-label="Adicionar pasta autorizada"
                      onClick={() => void handlePickNativeFolder()}
                      className="h-6 w-6 rounded-lg flex items-center justify-center text-[#DCDCDC] hover:bg-white/10 hover:text-white"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Abrir lista de pastas autorizadas"
                      onClick={() => setSubView("folders")}
                      className="text-[#6A6A6A] hover:text-white"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSubView("advanced")}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-[12.5px] hover:bg-[#262626] transition-colors"
                >
                  <span className="flex items-center gap-2 text-white font-medium">
                    <Sliders className="h-4 w-4 text-[#979797]" />
                    <span>Avançado</span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-[#6A6A6A]" />
                </button>
              </div>

              {/* Alertas por agente */}
              <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[12.5px] font-medium text-white">
                    <Bell className="h-4 w-4 text-[#979797]" />
                    <span>Alertas</span>
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#141414] p-1">
                  {(
                    [
                      { id: "all", label: "Todas" },
                      { id: "mentions", label: "Menções" },
                      { id: "muted", label: "Silenciado" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setNotificationDraft(opt.id);
                        void onSaveAgentSettings(agente.agente_id, {
                          notification_level: opt.id,
                        });
                      }}
                      className={`rounded-md py-1 text-[11px] font-semibold transition ${
                        notificationDraft === opt.id
                          ? "bg-[#2A2A2A] text-[#F0F0F0]"
                          : "text-[#979797] hover:text-[#F0F0F0]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[#787878] leading-snug">
                  Esta escolha vale só para você neste servidor. Se o servidor estiver silenciado, este agente também fica em silêncio.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="studio-btn-primary w-full py-2 text-[12.5px]"
            >
              {saving ? "Aplicando..." : "Salvar identidade do agente"}
            </button>
          </form>
        )}
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
