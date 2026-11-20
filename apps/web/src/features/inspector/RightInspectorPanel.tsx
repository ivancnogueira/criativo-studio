import React, { useEffect, useState } from "react";
import type {
  AgentNotificationLevel,
  AgenteRegistro,
  ArquivoStudio,
  AvatarShape,
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
  ArrowLeft,
  AudioLines,
  Brain,
  CalendarClock,
  ChevronRight,
  FolderOpen,
  Globe,
  Layers,
  Monitor,
  MousePointerClick,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { MascoteAppearancePicker } from "../../components/MascoteAvatar";
import { CarbonSelect, type CarbonSelectOption } from "../../components/ui/CarbonControls";
import { ServerBrowserProfilesPanel } from "../browser/ServerBrowserProfilesPanel";
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
  | "browser_profiles";

export interface RightInspectorPanelProps {
  open: boolean;
  widthPx?: number;
  initialSubView?: InspectorSubView;
  agente: AgenteRegistro | null;
  arquivos: ArquivoStudio[];
  canais?: CanalEquipe[];
  routineCount?: number;
  routineFocusSignal?: {
    subView?: "routines";
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
    description: "Restrito a recursos/, saidas/, previas/ e dados do agente",
  },
  {
    value: "ask",
    label: "Perguntar fora do workspace",
    description: "Solicita aprovação explícita antes de gravar ou publicar fora do padrão",
  },
  {
    value: "full",
    label: "Acesso total",
    description: "Permite operar todo o workspace do projeto sem barreira extra",
  },
];

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  open,
  widthPx,
  initialSubView = "hub",
  agente,
  arquivos,
  canais = [],
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
    routineFocusSignal?.subView === "routines" ? "routines" : initialSubView
  );
  const [nomeDraft, setNomeDraft] = useState(agente?.nome ?? "");
  const [promptDraft, setPromptDraft] = useState("");
  const [shapeDraft, setShapeDraft] = useState<AvatarShape>("blob");
  const [colorDraft, setColorDraft] = useState("#38bdf8");
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
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memories, setMemories] = useState<
    Array<{ memoria_id: string; texto: string; criado_em: string }>
  >([]);
  const [confirmDeleteFileId, setConfirmDeleteFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [deleteFileError, setDeleteFileError] = useState<string | null>(null);

  useEffect(() => {
    if (routineFocusSignal?.subView === "routines") {
      setSubView("routines");
    }
  }, [routineFocusSignal?.nonce, routineFocusSignal?.subView]);

  useEffect(() => {
    if (!agente) return;
    const cfg = (agente.config ?? {}) as Record<string, unknown>;
    setNomeDraft(agente.nome);
    setPromptDraft(typeof cfg.prompt_base === "string" ? cfg.prompt_base : "");
    setShapeDraft(
      (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : "blob") as AvatarShape
    );
    setColorDraft(typeof cfg.avatar_color === "string" ? cfg.avatar_color : "#38bdf8");

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
    if (subView === "config" && agente && onLoadMemories) {
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
        prompt_base: promptDraft,
        avatar_shape: shapeDraft,
        avatar_color: colorDraft,
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

  const panelTitle =
    subView === "files"
      ? `Arquivos (${arquivos.length})`
      : subView === "config"
        ? "Configurações do agente"
        : subView === "routines"
          ? "Rotinas do agente"
          : subView === "preview"
            ? "Preview Instagram"
            : subView === "backup_models"
              ? "Backup Models"
              : subView === "browser_profiles"
                ? "Perfis de Navegador"
                : "";

  const backTarget: InspectorSubView =
    subView === "backup_models" || subView === "browser_profiles" ? "config" : "hub";

  const backupSummary = backupModelsDraft.automatic
    ? `Automático · ${backupModelsDraft.order.length} modelo(s)`
    : backupModelsDraft.order.length > 0
      ? `Perguntar antes · ${backupModelsDraft.order.length} modelo(s)`
      : "Perguntar antes";

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
                <span>Abrir Arquivos ({arquivos.length})</span>
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

        {subView === "files" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-white">
                ImagePaths &amp; Mídias
              </span>
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
            onBackToHub={() => setSubView("hub")}
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

        {subView === "config" && agente && (
          <div className="space-y-5">
            <form onSubmit={handleSaveConfig} className="space-y-3.5">
              <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3">
                <MascoteAppearancePicker
                  color={colorDraft}
                  shape={shapeDraft}
                  onChangeColor={setColorDraft}
                  onChangeShape={setShapeDraft}
                />
              </div>

              <div>
                <label
                  htmlFor="inspector-agent-name"
                  className="block text-[11.5px] text-[#979797] mb-1"
                >
                  Nome do agente
                </label>
                <input
                  id="inspector-agent-name"
                  name="inspector_agent_name"
                  aria-label="Nome do agente"
                  type="text"
                  value={nomeDraft}
                  onChange={(e) => setNomeDraft(e.target.value)}
                  className="w-full rounded-xl bg-[#212121] border border-white/10 px-3 py-2 text-[12.5px] text-white focus:outline-none focus:border-white/30"
                />
              </div>

              <div>
                <label
                  htmlFor="inspector-agent-prompt"
                  className="block text-[11.5px] text-[#979797] mb-1"
                >
                  Instruções permanentes
                </label>
                <textarea
                  id="inspector-agent-prompt"
                  name="inspector_agent_prompt"
                  aria-label="Instruções do agente"
                  rows={4}
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  className="w-full rounded-xl bg-[#212121] border border-white/10 px-3 py-2 text-[12px] text-white focus:outline-none focus:border-white/30"
                />
              </div>

              {/* Governança & Navegador (Fase 15) */}
              <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-[16px] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#F0F0F0]">
                    <ShieldCheck size={14} className="text-[#42A0FF]" />
                    <span>Governança &amp; Navegador</span>
                  </span>
                  {activeBrowserTabsCount > 0 && (
                    <span className="rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[11px] font-semibold text-[#31CF76]">
                      {activeBrowserTabsCount} aba(s)
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  <span className="block text-[12px] text-[#979797]">Nível de acesso</span>
                  <CarbonSelect
                    ariaLabel="Nível de acesso do agente"
                    value={permissionDraft}
                    options={PERMISSION_OPTIONS}
                    onChange={handlePermissionPick}
                  />
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

                {/* Switches governança */}
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

                {/* Linha Configurar backup models */}
                <button
                  type="button"
                  onClick={() => setSubView("backup_models")}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#1A1A1A] px-3 py-2 text-left transition hover:bg-[#242424]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Layers size={14} className="shrink-0 text-[#42A0FF]" />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-[#F0F0F0]">
                        Configurar backup models
                      </p>
                      <p className="truncate text-[11px] text-[#979797]">{backupSummary}</p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="shrink-0 text-[#979797]" />
                </button>

                {/* Notificações segmentadas */}
                <div className="space-y-1">
                  <span className="block text-[12px] text-[#979797]">Nível de notificação</span>
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
                </div>

                {/* Ações rápidas navegador/teach */}
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
                        <span>
                          Inspecionar log gravado ({userBrowsingStepsCount})
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3 space-y-2 text-[11.5px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#8E8E93]">Modelo ativo</span>
                  <span className="text-white font-mono text-[11px] truncate max-w-[165px]">
                    {agente.modelo_padrao}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#8E8E93]">Habilidade (SKILL.md)</span>
                  <span className="text-[#31CF76] font-mono text-[11px]">
                    {String((agente.config as Record<string, unknown>)?.skill_slug ?? agente.agente_id)}
                  </span>
                </div>
                {Array.isArray((agente.config as Record<string, unknown>)?.ferramentas) && (
                  <div className="pt-1 border-t border-white/[0.05]">
                    <span className="text-[#8E8E93] block mb-1">Ferramentas nativas</span>
                    <div className="flex flex-wrap gap-1">
                      {((agente.config as Record<string, unknown>).ferramentas as string[]).map(
                        (tool) => (
                          <span
                            key={tool}
                            className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[#DCDCDC] font-mono text-[10px]"
                          >
                            {tool}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="studio-btn-primary flex-1 py-2 text-[12.5px]"
                >
                  {saving ? "Aplicando..." : "Aplicar configurações"}
                </button>
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
                    className="studio-btn-secondary px-3 py-2 text-[12px]"
                  >
                    Restaurar padrão
                  </button>
                )}
              </div>
            </form>

            <div className="pt-4 border-t border-white/[0.06] space-y-2.5">
              <div className="text-[12px] font-semibold text-white flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5 text-[#38bdf8]" />
                <span>Memória Persistente ({memories.length})</span>
              </div>
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
                  Fixar memória
                </button>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {memories.map((m) => (
                  <div
                    key={m.memoria_id}
                    className="rounded-lg bg-[#212121] border border-white/[0.05] px-2.5 py-2 text-[11.5px] text-[#DCDCDC]"
                  >
                    {m.texto}
                  </div>
                ))}
              </div>
            </div>
          </div>
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
                  Acesso ampliado permite editar pastas fora do workspace do agente.
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
