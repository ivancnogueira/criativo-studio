import React from "react";
import type {
  AvatarShape,
  AvatarStyle,
  StatusMensageria,
  StudioNotificationItem,
} from "@criativo/contracts";
import {
  ChevronLeft,
  ChevronRight,
  GitFork,
  KeyRound,
  Maximize2,
  Minimize2,
  PanelLeft,
  Plus,
  Smartphone,
  X,
} from "lucide-react";
import {
  MascoteAvatar,
  type AvatarTaskContext,
  type MascotEyeMood,
} from "./MascoteAvatar";
import { NotificationCenterPopover } from "./NotificationCenterPopover";

export interface StudioTabItem {
  id: string;
  titulo: string;
  kind?: "agent" | "topic";
  closable?: boolean;
  working?: boolean;
  style?: AvatarStyle;
  shape?: AvatarShape;
  variant?: string;
  color?: string;
  imageUrl?: string | null;
  activity?: AvatarTaskContext | null;
  mood?: MascotEyeMood;
}

interface DynamicIslandProps {
  wsConnected: boolean;
  runningCount: number;
  pendingCount: number;
  awaitingApprovalCount: number;
  whatsappStatus: StatusMensageria;
  onOpenWhatsAppModal: () => void;
  onOpenVaultModal: () => void;
  // Extensões visuais estilo barra superior + abas criativo
  tabs?: StudioTabItem[];
  activeTabId?: string | null;
  onSelectTab?: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  onNewTab?: () => void;
  onNewTopic?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  headerRightContent?: React.ReactNode;
  notifications?: StudioNotificationItem[];
  onMarkAllNotificationsRead?: () => void;
  onClearNotifications?: () => void;
  onSelectNotification?: (item: StudioNotificationItem) => void;
}

/**
 * Barra superior com navegação em abas e Dynamic Island central preta (#000000) do Criativo Studio.
 */
export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  wsConnected,
  runningCount,
  pendingCount,
  awaitingApprovalCount,
  whatsappStatus,
  onOpenWhatsAppModal,
  onOpenVaultModal,
  tabs = [],
  activeTabId = null,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onNewTopic,
  onToggleSidebar,
  focusMode = false,
  onToggleFocusMode,
  onNavigateBack,
  onNavigateForward,
  headerRightContent,
  notifications = [],
  onMarkAllNotificationsRead,
  onClearNotifications,
  onSelectNotification,
}) => {
  const islandText = !wsConnected
    ? "Reconectando..."
    : runningCount > 0
      ? `Produzindo agora · ${runningCount} ativo(s)`
      : awaitingApprovalCount > 0
        ? `${awaitingApprovalCount} aguardando aprovação`
        : pendingCount > 0
          ? `${pendingCount} na fila FIFO`
          : "Pronto";

  return (
    <header className="relative h-[42px] shrink-0 bg-[#0D0D0D] border-b border-white/[0.06] flex items-center justify-between px-2.5 gap-2 select-none">
      {/* Esquerda: controles de navegação + abas Carbon Dark */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-0.5 text-[#979797] shrink-0 pr-1">
          <button
            type="button"
            onClick={onNavigateBack}
            aria-label="Aba anterior"
            className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-[#212121] hover:text-white transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNavigateForward}
            aria-label="Próxima aba"
            className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-[#212121] hover:text-white transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              title="Alternar barra lateral"
              aria-label="Alternar barra lateral"
              className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-[#212121] hover:text-white transition-colors"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          )}
          {onToggleFocusMode && (
            <button
              type="button"
              onClick={onToggleFocusMode}
              title={focusMode ? "Sair do Modo Foco (Ctrl+\\)" : "Modo Foco (Ctrl+\\)"}
              aria-label="Alternar modo foco"
              className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${
                focusMode
                  ? "bg-[#007CF7]/20 text-[#42A0FF]"
                  : "hover:bg-[#212121] hover:text-white"
              }`}
            >
              {focusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 min-w-0">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`group flex items-center gap-1.5 h-[30px] pl-2.5 pr-1.5 rounded-lg text-[12px] max-w-[190px] transition-colors shrink-0 ${
                  active
                    ? "bg-[#1A1A1A] text-white border border-white/10"
                    : "text-[#979797] hover:bg-[#1A1A1A]/60 hover:text-[#DCDCDC]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectTab?.(tab.id)}
                  className="flex items-center gap-1.5 min-w-0 text-left"
                >
                  {tab.kind === "topic" ? (
                    <GitFork
                      className={`h-3.5 w-3.5 shrink-0 ${
                        tab.working ? "text-[#31CF76] animate-pulse" : "text-[#979797]"
                      }`}
                    />
                  ) : (
                    <MascoteAvatar
                      style={tab.style ?? "classic"}
                      shape={tab.shape ?? "blob"}
                      variant={tab.variant}
                      color={tab.color ?? "#38bdf8"}
                      imageUrl={tab.imageUrl}
                      size={16}
                      animated={Boolean(tab.working)}
                      mood={tab.mood ?? (tab.working ? "working" : "idle")}
                      activity={tab.activity ?? null}
                    />
                  )}
                  <span className="truncate font-medium">{tab.titulo}</span>
                </button>
                {onCloseTab && (tab.kind === "topic" || tab.closable === true) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    aria-label={`Fechar aba ${tab.titulo}`}
                    className="h-4 w-4 rounded flex items-center justify-center text-[#6A6A6A] hover:text-white hover:bg-white/10 opacity-75 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {(onNewTopic || onNewTab) && (
            <button
              type="button"
              onClick={onNewTopic ?? onNewTab}
              title="Nova Subconversa"
              aria-label="Nova Subconversa"
              className="h-7 w-7 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#212121] hover:text-white transition-colors shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Centro: Barra de Pulso #000000 do Criativo Studio */}
      <div
        aria-label="Barra de Pulso"
        className="hidden md:flex items-center gap-2.5 h-[30px] px-3.5 rounded-full bg-[#000000] border border-white/10 shadow-[0_6px_20px_rgba(0,0,0,0.65)] shrink-0"
        title={wsConnected ? "Daemon Live" : "Reconectando"}
      >
        <MascoteAvatar
          shape="hex"
          color={runningCount > 0 ? "#31cf76" : "#8b5cf6"}
          size={16}
          animated={runningCount > 0}
        />
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            wsConnected ? "bg-[#31CF76]" : "bg-[#FF9412] animate-pulse"
          }`}
          aria-label={wsConnected ? "Daemon Live" : "Reconectando"}
        />
        <span className="text-[11.5px] font-medium text-[#DCDCDC] whitespace-nowrap">
          {islandText}
        </span>
        {headerRightContent}
      </div>

      {/* Direita: Atalhos rápidos WhatsApp & Cofre */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onOpenWhatsAppModal}
          className={`inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-full text-[11.5px] font-medium border transition-colors ${
            whatsappStatus === "conectado"
              ? "bg-[#31CF76]/10 border-[#31CF76]/30 text-[#31CF76]"
              : "bg-[#212121] border-white/10 text-[#DCDCDC] hover:bg-[#2A2A2A]"
          }`}
        >
          <Smartphone className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {whatsappStatus === "conectado"
              ? "WhatsApp Conectado"
              : whatsappStatus === "aguardando_qrcode"
                ? "QR Pendente"
                : "WhatsApp"}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenVaultModal}
          title="Cofre AES-256-GCM e Chaves"
          className="inline-flex items-center gap-1 h-[28px] px-2.5 rounded-full bg-[#212121] hover:bg-[#2A2A2A] border border-white/10 text-[11.5px] font-medium text-[#DCDCDC] transition-colors"
        >
          <KeyRound className="h-3 w-3 text-[#42A0FF]" />
          <span className="hidden lg:inline">Cofre</span>
        </button>

        <NotificationCenterPopover
          items={notifications}
          onMarkAllRead={() => onMarkAllNotificationsRead?.()}
          onClearAll={() => onClearNotifications?.()}
          onSelectNotification={onSelectNotification}
        />

        {/* Indicador acessível silencioso para leitores de tela / testes SSR */}
        <span className="sr-only">{wsConnected ? "Daemon Live" : "Reconectando"}</span>
      </div>
    </header>
  );
};
