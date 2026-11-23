import React from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  FolderPlus,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Smartphone,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import { MascoteAvatar } from "./MascoteAvatar";
import { UpdateNotificationBanner } from "../features/updates/UpdateNotificationBanner";
import { getAgentVisual, type SidebarProps } from "./sidebar/sidebar-types-helpers";
import { useSidebarController } from "./sidebar/useSidebarController";
import { SidebarPinnedTile, SidebarAgentRow } from "./sidebar/SidebarAgentItems";
import { SidebarChannelsAndSections } from "./sidebar/SidebarChannelsAndSections";
import { SidebarModals } from "./sidebar/SidebarModals";
import { useI18n } from "../i18n/I18nContext";

export type { SidebarProps };

/**
 * Barra lateral Carbon Dark (`~265px`) com busca, pastas colapsáveis, Canais em Equipe,
 * badges #74B9FF em Não lidas e card inferior 'Criativo no WhatsApp'.
 */
export const Sidebar: React.FC<SidebarProps> = (props) => {
  const { t } = useI18n();
  const ctrl = useSidebarController(props);
  const {
    agentes,
    deletedNativeAgents = [],
    selectedAgentId,
    onSelectAgent,
    onCreateAgent,
    onCreateChannel,
    whatsappStatus = "desconectado",
    onOpenWhatsAppModal,
    showModeTabs = true,
    onMutateSidebar,
    onRestoreDeletedAgent,
    onRestoreAllDeletedAgents,
    updateStatus,
    onApplyUpdate,
    onOpenUpdateSettings,
    widthPx,
    agentActivityByAgentId,
    onDismissSetupAssistant,
    onDismissVpsAssistant
  } = props;
  const {
    search,
    setSearch,
    menuOpen,
    setMenuOpen,
    dismissWhatsAppCard,
    setDismissWhatsAppCard,
    creatingSectionParentId,
    setCreatingSectionParentId,
    newSectionName,
    setNewSectionName,
    setRestoreModalOpen,
    effectiveMode,
    setMode,
    sectionsList,
    pinnedAgents,
    unreadAgents,
    setupAssistantAgent,
    vpsAssistantAgent,
    handleCreateSectionSubmit,
    pinnedTooltip,
    pinnedTooltipRef,
    pinnedTooltipPos
  } = ctrl;

  const permanentAgentsCount = agentes.filter(
    (a) => a.agente_id !== "assistente_setup" && a.agente_id !== "assistente_servidor_vps"
  ).length;

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
            placeholder={t("sidebar.searchAgents")}
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
                <span>{t("sidebar.newAgent")}</span>
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
                <span>{t("sidebar.newTeam")}</span>
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
                  ? "bg-[#2A2A2A] text-[#F0F0F0] border-[var(--studio-accent,#B9FC01)]"
                  : "text-[#979797] hover:text-white border-transparent"
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              <span>{t("sidebar.agentsTab")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveMode === "routines"}
              onClick={() => setMode("routines")}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition-colors border-b-2 ${
                effectiveMode === "routines"
                  ? "bg-[#2A2A2A] text-[#F0F0F0] border-[var(--studio-accent,#B9FC01)]"
                  : "text-[#979797] hover:text-white border-transparent"
              }`}
            >
              <Workflow className="h-3.5 w-3.5" />
              <span>{t("sidebar.routinesTab")}</span>
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

        {vpsAssistantAgent && (
          <div
            data-vps-assistant-card="true"
            className={`rounded-xl border p-2 transition-colors ${
              selectedAgentId === vpsAssistantAgent.agente_id
                ? "border-[#2EC4B6]/65 bg-[#2EC4B6]/15"
                : "border-[#2EC4B6]/35 bg-[#1B2524] hover:border-[#2EC4B6]/55"
            }`}
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#2EC4B6]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#5EEAD4]">
                <Sparkles className="h-2.5 w-2.5" />
                VPS
              </span>
              {onDismissVpsAssistant && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDismissVpsAssistant();
                  }}
                  className="text-[10.5px] text-[#979797] hover:text-white underline underline-offset-2"
                >
                  Concluir e ocultar
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => onSelectAgent(vpsAssistantAgent.agente_id)}
              className="w-full flex items-center gap-2.5 px-1.5 py-1 rounded-lg text-left"
            >
              <MascoteAvatar
                avatar={getAgentVisual(vpsAssistantAgent)}
                agentKey={vpsAssistantAgent.agente_id}
                size={32}
                animated={vpsAssistantAgent.status === "trabalhando"}
                mood={
                  agentActivityByAgentId?.[vpsAssistantAgent.agente_id]?.mood ??
                  (vpsAssistantAgent.status === "trabalhando" ? "working" : "idle")
                }
                activity={agentActivityByAgentId?.[vpsAssistantAgent.agente_id]?.activity ?? null}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-white truncate">
                  {vpsAssistantAgent.nome}
                </div>
                <p className="text-[11px] text-[#A7F3D0] truncate">
                  Instalação e pareamento de servidor Linux/VPS
                </p>
              </div>
            </button>
          </div>
        )}

        {creatingSectionParentId !== undefined && onMutateSidebar && (
          <form
            onSubmit={(e) => void handleCreateSectionSubmit(e)}
            className="rounded-xl border border-[var(--studio-accent,#B9FC01)]/50 bg-[#141414] p-2 space-y-2"
          >
            <div className="text-[11px] font-semibold text-[var(--studio-accent-text,#B9FC01)]">
              {creatingSectionParentId ? "Novo subdiretório" : "Novo diretório"}
            </div>
            <input
              type="text"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="Nome do diretório"
              aria-label="Nome do novo diretório"
              autoFocus
              className="w-full rounded-lg border border-white/10 bg-[#212121] px-2.5 py-1.5 text-[12px] text-white placeholder-[#6A6A6A] focus:border-[var(--studio-accent,#B9FC01)] focus:outline-none"
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
                className="rounded-lg bg-[var(--studio-accent,#B9FC01)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--studio-text-on-accent,#0D0D0D)] disabled:opacity-40"
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
              {pinnedAgents.map((ag) => <SidebarPinnedTile key={`pin-${ag.agente_id}`} ag={ag} ctrl={ctrl} props={props} />)}
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
              {unreadAgents.map((ag) => <SidebarAgentRow key={`unread-${ag.agente_id}`} ag={ag} keyPrefix="unread-" showUnreadBadge={true} ctrl={ctrl} props={props} />)}
            </div>
          </div>
        )}
        <SidebarChannelsAndSections ctrl={ctrl} props={props} />
      </div>


      <UpdateNotificationBanner
        status={updateStatus ?? null}
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

      <SidebarModals ctrl={ctrl} props={props} />

      {pinnedTooltip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={pinnedTooltipRef}
            role="tooltip"
            style={{
              position: "fixed",
              left: pinnedTooltipPos?.left ?? Math.max(10, pinnedTooltip.left - 60),
              top: pinnedTooltipPos?.top ?? Math.max(10, pinnedTooltip.top - 8),
              transform: "translateY(-100%)",
              zIndex: 9999,
            }}
            className="pointer-events-none whitespace-nowrap rounded-lg bg-[#101012] border border-white/10 px-2.5 py-1 text-[11.5px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.75)]"
          >
            {pinnedTooltip.nome}
          </div>,
          document.body
        )}
    </aside>
  );
};
