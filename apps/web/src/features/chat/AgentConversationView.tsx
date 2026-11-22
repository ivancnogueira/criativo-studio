import React from "react";
import { ChevronUp } from "lucide-react";
import { ChannelMascoteCluster, MascoteAvatar } from "../../components/MascoteAvatar";
import { ModelProviderPopover } from "../../components/ModelProviderPopover";
import { SideQuestionPanel } from "./SideQuestionPanel";
import { ThreadTabsBar } from "./ThreadTabsBar";
import { ChatHeaderBar } from "./ChatHeaderBar";
import { ChatMessageItem } from "./ChatMessageItem";
import { ChatLiveActivityAndCards } from "./ChatLiveActivityAndCards";
import { ChatComposerBar } from "./ChatComposerBar";
import { useChatConversationController } from "./useChatConversationController";
import type { AgentConversationViewProps } from "./chat-types";

export {
  McpSignInChatCard,
  type McpSignInCardState,
  type MarketplaceAppSuggestionItem,
  type McpSignInChatCardProps,
} from "./McpSignInChatCard";
export type { ChatLiveRunState, AgentConversationViewProps } from "./chat-types";

/**
 * Tela de Conversa rica por Agente ou Canal em Equipe com fidelidade visual ao criativo.
 */
export const AgentConversationView: React.FC<AgentConversationViewProps> = (props) => {
  const ctrl = useChatConversationController(props);
  const {
    mode,
    agente,
    mensagens,
    provedores,
    onUpdateModelAndEffort,
    onOpenConnectors,
    threads = [],
    activeThread = null,
    onSelectThread,
    onCreateQuickThread,
    onDismissThreadTab,
    hideInlineThreadTabs = false,
    pagination,
    onLoadOlderMessages,
    onJumpToLatest,
    onAskSideQuestion,
    compactActions = false,
  } = props;

  const {
    messagesScrollRef,
    messagesEndRef,
    prevScrollHeightRef,
    channelMembers,
    agentAvatar,
    isWorking,
    liveMood,
    liveActivity,
    titleName,
    popoverOpen,
    setPopoverOpen,
    currentModel,
    currentEffort,
    sidePanelOpen,
    setSidePanelOpen,
  } = ctrl;

  return (
    <div
      data-compact-actions={compactActions ? "true" : "false"}
      className="flex-1 min-w-0 h-full bg-[#1A1A1A] flex overflow-hidden"
    >
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {!hideInlineThreadTabs && mode === "agent" && onSelectThread && onCreateQuickThread && (
          <ThreadTabsBar
            threads={threads}
            activeThreadId={activeThread?.thread_id ?? null}
            onSelectThread={onSelectThread}
            onStartNewTaskTab={onCreateQuickThread}
            onDismissThreadTab={onDismissThreadTab}
          />
        )}

        <ChatHeaderBar ctrl={ctrl} props={props} />

        {/* Área de mensagens rolável */}
        <div
          ref={messagesScrollRef}
          className="relative flex-1 overflow-y-auto px-5 py-5 space-y-5"
        >
          {pagination?.has_older && onLoadOlderMessages && (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={pagination.loading_older}
                onClick={async () => {
                  if (messagesScrollRef.current) {
                    prevScrollHeightRef.current = messagesScrollRef.current.scrollHeight;
                  }
                  await onLoadOlderMessages();
                }}
                className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-[#212121] px-4 py-1 text-[12px] font-semibold text-[#DCDCDC] transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              >
                <ChevronUp className="h-3.5 w-3.5" />
                <span>
                  {pagination.loading_older ? "Carregando anteriores..." : "Carregar anteriores"}
                </span>
              </button>
            </div>
          )}

          {mensagens.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
              {mode === "channel" ? (
                <ChannelMascoteCluster members={channelMembers} size={64} />
              ) : (
                <MascoteAvatar
                  avatar={agentAvatar}
                  agentKey={agente?.agente_id}
                  size={68}
                  animated={isWorking}
                  trackCursor
                  mood={liveMood}
                  activity={liveActivity}
                />
              )}
              <h3 className="text-[17px] font-semibold text-white mt-4">{titleName}</h3>
              <p className="text-[12.5px] text-[#979797] mt-1">
                {mode === "channel"
                  ? "Envie um briefing para coordenar todos os especialistas deste canal simultaneamente."
                  : `${agente?.papel}. Envie um tema ou anexe referências ImagePaths em + abaixo.`}
              </p>
            </div>
          ) : (
            mensagens.map((msg) => (
              <ChatMessageItem key={msg.mensagem_id} msg={msg} ctrl={ctrl} props={props} />
            ))
          )}

          <ChatLiveActivityAndCards ctrl={ctrl} props={props} />

          <div ref={messagesEndRef} />

          {pagination?.has_newer && onJumpToLatest && (
            <div className="sticky bottom-2 flex justify-center pointer-events-none">
              <button
                type="button"
                onClick={() => void onJumpToLatest()}
                className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[#007CF7] bg-[#212121] px-4 py-1 text-[12px] font-semibold text-white shadow-lg hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              >
                <span>Voltar ao fim</span>
              </button>
            </div>
          )}
        </div>

        <ChatComposerBar ctrl={ctrl} props={props} />

        {mode === "agent" && (
          <ModelProviderPopover
            open={popoverOpen}
            onClose={() => setPopoverOpen(false)}
            provedores={provedores}
            selectedModel={currentModel}
            selectedEffort={currentEffort}
            onSelectModelAndEffort={(m, eff) => {
              void onUpdateModelAndEffort(m, eff);
            }}
            onOpenConnectors={onOpenConnectors}
          />
        )}
      </div>

      {mode === "agent" && onAskSideQuestion && (
        <SideQuestionPanel
          open={sidePanelOpen}
          agenteNome={titleName}
          agenteAvatar={agentAvatar}
          threadId={activeThread?.thread_id ?? null}
          onAsk={onAskSideQuestion}
          onClose={() => setSidePanelOpen(false)}
        />
      )}
    </div>
  );
};
