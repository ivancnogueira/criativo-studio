import {
  ChevronDown,
  Database,
  MessageCircleQuestion,
  PanelRight,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-react";
import { ChannelMascoteCluster, MascoteAvatar } from "../../components/MascoteAvatar";
import { ProviderLogo } from "../../components/ProviderLogo";
import { PinnedMessagesPopover } from "./PinnedMessagesPopover";
import { EFFORT_LABELS, type AgentConversationViewProps } from "./chat-types";
import type { ChatConversationController } from "./useChatConversationController";

export function ChatHeaderBar({
  ctrl,
  props,
}: {
  ctrl: ChatConversationController;
  props: AgentConversationViewProps;
}) {
  const {
    mode,
    agente,
    canal,
    mensagens,
    inspectorOpen,
    onToggleInspector,
    onOpenChannelSettings,
    activeThread = null,
    onJumpToMessage,
    pins = [],
    onTogglePinMessage,
    onAskSideQuestion,
    onStartNewChat,
    onOpenSharedTables,
    compactActions = false,
    onClearHistory,
  } = props;

  const {
    channelMembers,
    agentAvatar,
    liveMood,
    liveActivity,
    isWorking,
    titleName,
    setPopoverOpen,
    currentProvider,
    currentModel,
    currentEffort,
    currentThreadId,
    setSidePanelOpen,
    sidePanelOpen,
    allowNewChat,
    confirmClearHistory,
    setConfirmClearHistory,
    clearingHistory,
    setClearingHistory,
  } = ctrl;

  return (
        <div className="h-[48px] shrink-0 border-b border-white/[0.06] px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {mode === "channel" ? (
              <ChannelMascoteCluster members={channelMembers} size={34} />
            ) : (
              <MascoteAvatar
                avatar={agentAvatar}
                agentKey={agente?.agente_id}
                size={36}
                mood={liveMood}
                activity={liveActivity}
                animated={isWorking}
              />
            )}
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">
                {activeThread ? `${titleName} · ${activeThread.titulo}` : titleName}
              </div>
              <div className="text-[11px] text-[#6A6A6A] truncate">
                {mode === "channel"
                  ? canal?.descricao?.trim() ||
                    `${canal?.membros_agentes.length ?? 0} agentes coordenados`
                  : agente?.papel}
              </div>
            </div>
          </div>

          {/* Botão central de Modelo + Esforço: exibido apenas em conversa individual (em equipes cada agente usa seu próprio provedor/modelo) */}
          {mode === "agent" && (
            <button
              type="button"
              onClick={() => setPopoverOpen(true)}
              aria-label="Trocar provedor, modelo e esforço"
              className="inline-flex items-center gap-2 rounded-full bg-[#212121] hover:bg-[#2A2A2A] border border-white/10 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors shrink-0"
            >
              <ProviderLogo provider={currentProvider} size={14} />
              <span className="max-w-[150px] truncate">{currentModel}</span>
              <span className="text-[#6A6A6A]">·</span>
              <span className="text-[#979797]">{EFFORT_LABELS[currentEffort]}</span>
              <ChevronDown className="h-3.5 w-3.5 text-[#979797]" />
            </button>
          )}

          <div className={`flex items-center shrink-0 ${compactActions ? "gap-1" : "gap-2"}`}>
            {mode === "channel" && onOpenChannelSettings && (
              <button
                type="button"
                onClick={onOpenChannelSettings}
                aria-label="Configurações da equipe"
                title="Configurações da equipe"
                className={`inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-[#212121] font-semibold text-[#DCDCDC] transition hover:bg-[#242424] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] ${
                  compactActions ? "h-7 px-2 text-[11px]" : "h-8 px-2.5 text-[12px]"
                }`}
              >
                <Settings className="h-3.5 w-3.5 text-[#979797]" />
                <span>Configurações</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenSharedTables?.()}
              aria-label="Abrir tabelas SQL compartilhadas"
              title="Tabelas SQL"
              className={`inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#212121] font-semibold text-[#DCDCDC] transition hover:bg-[#242424] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] ${
                compactActions ? "h-7 px-1.5 text-[11px]" : "h-8 px-2 text-[12px]"
              }`}
            >
              <Database className="h-3.5 w-3.5 text-[#42A0FF]" />
              <span>Tabelas SQL</span>
            </button>

            {mode === "agent" && onTogglePinMessage && onJumpToMessage && (
              <PinnedMessagesPopover
                pins={pins}
                currentThreadId={currentThreadId}
                onJumpToPin={async (pin) => {
                  await onJumpToMessage(pin.thread_id, pin.mensagem_id);
                }}
                onUnpin={async (pin) => {
                  await onTogglePinMessage(
                    {
                      mensagem_id: pin.mensagem_id,
                      canal_id: pin.thread_id,
                      agente_id: agente?.agente_id ?? null,
                      autor: pin.autor,
                      conteudo_markdown: pin.conteudo_resumo,
                      anexos: [],
                      steps: [],
                      thread_id: pin.thread_id,
                      lida: true,
                      criado_em: pin.criado_em,
                    },
                    false
                  );
                }}
              />
            )}

            {mode === "agent" && onAskSideQuestion && (
              <button
                type="button"
                onClick={() => setSidePanelOpen((s) => !s)}
                className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] ${
                  sidePanelOpen
                    ? "border-[#007CF7] bg-[#2A2A2A] text-white"
                    : "border-white/[0.06] bg-[#212121] text-[#DCDCDC] hover:bg-[#242424] hover:text-white"
                }`}
              >
                <MessageCircleQuestion className="h-3.5 w-3.5" />
                <span>Perguntar ao lado</span>
              </button>
            )}

            {mode === "agent" && !activeThread && allowNewChat && onStartNewChat && (
              <button
                type="button"
                onClick={() => void onStartNewChat()}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.06] bg-[#212121] px-2 text-[12px] font-semibold text-[#DCDCDC] transition hover:bg-[#242424] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reiniciar contexto</span>
              </button>
            )}

            {onClearHistory && !activeThread && mensagens.length > 0 && (
              confirmClearHistory ? (
                <div className="inline-flex items-center gap-1 rounded-lg border border-[#FD2F3B]/40 bg-[#141414] px-2 py-1 text-[11px]">
                  <span className="text-[#FF7675] font-medium">Apagar histórico?</span>
                  <button
                    type="button"
                    disabled={clearingHistory}
                    onClick={async () => {
                      setClearingHistory(true);
                      try {
                        await onClearHistory();
                        setConfirmClearHistory(false);
                      } finally {
                        setClearingHistory(false);
                      }
                    }}
                    className="rounded px-1.5 py-0.5 bg-[#FD2F3B] text-white font-semibold hover:bg-[#e12732]"
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    disabled={clearingHistory}
                    onClick={() => setConfirmClearHistory(false)}
                    className="rounded px-1.5 py-0.5 bg-[#2A2A2A] text-[#DCDCDC] hover:bg-[#333336]"
                  >
                    Não
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  title="Apagar histórico do chat"
                  aria-label="Apagar histórico do chat"
                  onClick={() => setConfirmClearHistory(true)}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-[#979797] hover:bg-[#FD2F3B]/15 hover:text-[#FF7675] transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )
            )}

            <button
              type="button"
              onClick={onToggleInspector}
              title={inspectorOpen ? "Recolher painel direito" : "Abrir inspetor lateral"}
              aria-label="Alternar inspetor lateral"
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                inspectorOpen
                  ? "bg-[#2A2A2A] text-white"
                  : "text-[#979797] hover:bg-[#212121] hover:text-white"
              }`}
            >
              <PanelRight className="h-4 w-4" />
            </button>
          </div>
        </div>
  );
}
