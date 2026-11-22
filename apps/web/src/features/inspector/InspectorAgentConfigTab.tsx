import {
  Activity,
  Bell,
  Blocks,
  Brain,
  CalendarClock,
  ChevronRight,
  Cpu,
  Database,
  Download,
  FileText,
  FolderOpen,
  GitFork,
  Palette,
  Plus,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Sliders,
} from "lucide-react";
import { MascoteAppearancePicker, MascoteAvatar } from "../../components/MascoteAvatar";
import { StudioColorPicker } from "../../components/StudioColorPicker";
import { CarbonSelect } from "../../components/ui/CarbonControls";
import { PERMISSION_OPTIONS, formatTotalBytes } from "./inspector-types";
import type { RightInspectorPanelProps } from "./inspector-types";
import type { RightInspectorController } from "./useRightInspectorController";
import { InspectorMcpConsentCard } from "./InspectorMcpConsentCard";

export function InspectorAgentConfigTab({
  ctrl,
  props,
}: {
  ctrl: RightInspectorController;
  props: RightInspectorPanelProps;
}) {
  const {
    agente,
    arquivos,
    threads = [],
    tablesCount = 0,
    routineCount = 0,
    onOpenUsagePage,
    onOpenStorePage,
    onOpenTablesModal,
    onSaveAgentSettings,
  } = props;
  const {
    subView,
    setSubView,
    nomeDraft,
    setNomeDraft,
    papelDraft,
    setPapelDraft,
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
    permissionDraft,
    notificationDraft,
    setNotificationDraft,
    saving,
    memories,
    handleSaveConfig,
    handlePermissionPick,
    handlePickNativeFolder,
    exportingTemplate,
    templateExportInfo,
    templateExportError,
    handleExportAgentTemplate,
    authorizedFoldersLabel,
    authorizedFoldersSummary,
    backupSummary,
    assignedSkillsCount,
  } = ctrl;

  return (
    <>
        {subView === "config" && agente && (
          <div className="space-y-3">
          <form onSubmit={handleSaveConfig} className="space-y-4">
            {/* Cartão de Identidade do Especialista */}
            <div className="rounded-xl bg-[#212121] border border-white/[0.06] p-3 space-y-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  title="Alterar avatar"
                  aria-expanded={avatarPickerExpanded}
                  onClick={() => setAvatarPickerExpanded((v) => !v)}
                  className="shrink-0 rounded-xl p-1 hover:bg-white/[0.06] transition-colors"
                >
                  <MascoteAvatar
                    style={styleDraft}
                    variant={variantDraft}
                    shape={shapeDraft}
                    color={colorDraft}
                    imageUrl={styleDraft === "image" ? imageUrlDraft : null}
                    size={52}
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

              <button
                type="button"
                aria-expanded={avatarPickerExpanded}
                onClick={() => setAvatarPickerExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-2 rounded-lg bg-[#181818] hover:bg-[#1E1E1E] border border-white/[0.06] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#DCDCDC] transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-[#42A0FF]" />
                  <span>Personalizar avatar</span>
                </span>
                <ChevronRight
                  className={`h-3.5 w-3.5 text-[#787878] transition-transform ${
                    avatarPickerExpanded ? "rotate-90" : ""
                  }`}
                />
              </button>

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
                    <div className="px-3.5 pb-3 pt-2 bg-[#181818] border-t border-white/[0.05] space-y-2.5">
                      <StudioColorPicker
                        value={chatColorDraft ?? "#166534"}
                        onChange={(hex) => {
                          setChatColorDraft(hex);
                          void onSaveAgentSettings(agente.agente_id, { chat_color: hex });
                        }}
                        allowDefaultReset
                        isDefaultSelected={!chatColorDraft}
                        onResetDefault={() => {
                          setChatColorDraft(null);
                          void onSaveAgentSettings(agente.agente_id, { chat_color: null });
                        }}
                        ariaLabelPrefix="Cor dos balões do agente"
                      />
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

              <InspectorMcpConsentCard agenteId={agente.agente_id} />

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

          <div className="rounded-xl bg-[#212121] border border-white/[0.08] p-3 space-y-2">
            <button
              type="button"
              data-testid="export-agent-template-btn"
              disabled={exportingTemplate}
              onClick={() => void handleExportAgentTemplate()}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#181818] hover:bg-[#2A2A2A] border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#F0F0F0] transition-colors disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 text-[#42A0FF]" />
              <span>
                {exportingTemplate ? "Exportando template..." : "Exportar template (.json)"}
              </span>
            </button>
            {templateExportInfo && (
              <p
                data-testid="export-agent-template-feedback"
                className="text-[11px] font-mono text-[#31CF76] break-all"
              >
                {templateExportInfo.fileName} · v{templateExportInfo.version} · sha256:
                {templateExportInfo.sha256Prefix}
              </p>
            )}
            {templateExportError && (
              <p className="text-[11px] text-[#FD2F3B] leading-snug">
                {templateExportError}
              </p>
            )}
          </div>
          </div>
        )}
    </>
  );
}
