import { Check, Loader2, X } from "lucide-react";
import { computeBubbleColors, splitMarkdownIntoBubbleChunks } from "./chat-bubble-theme";
import { MascoteAvatar, resolveAgentAvatarConfig } from "../../components/MascoteAvatar";
import { AppBrandIcon } from "../../components/ui/CarbonControls";
import {
  BrowserSecretCard,
  BrowserTakeoverCard,
  CaptureScreenConsentCard,
} from "../browser/BrowserTakeoverModal";
import { UsageLimitAskCard } from "../inspector/BackupModelsEditor";
import { McpSignInChatCard } from "./McpSignInChatCard";
import {
  formatElapsedClock,
  renderFormattedMarkdownText,
  renderInlineMarkdown,
  splitMarkdownBlocks,
} from "./chat-markdown-renderer";
import type { AgentConversationViewProps } from "./chat-types";
import type { ChatConversationController } from "./useChatConversationController";

export function ChatLiveActivityAndCards({
  ctrl,
  props,
}: {
  ctrl: ChatConversationController;
  props: AgentConversationViewProps;
}) {
  const {
    mode,
    agente,
    allAgentes = [],
    pendingMcpSignIn,
    suggestedApps = [],
    onAuthenticateMcp,
    onOpenStoreApp,
    onRetryMcpContinue,
    liveRun,
    showAgentSteps = true,
    solidBubbles = true,
    takeoverSession = null,
    secretRequest = null,
    captureRequest = null,
    onOpenTakeover,
    onCancelTakeover,
    onSubmitSecret,
    onAuthorizeScreenCapture,
    onDeclineScreenCapture,
    onResolveUsageLimit,
  } = props;

  const {
    isWorking,
    agentAvatar,
    liveMood,
    liveActivity,
    currentModel,
    elapsedSec,
    titleName,
    effectiveUsageLimitAsk,
    setDismissedUsageAskIds,
  } = ctrl;

  return (
    <>
        {/* Cartão inline OAuth MCP e sugestões de apps da Loja */}
        {pendingMcpSignIn && onAuthenticateMcp && (
          <McpSignInChatCard
            mcpId={pendingMcpSignIn.mcpId}
            nome={pendingMcpSignIn.nome}
            appSlug={pendingMcpSignIn.appSlug}
            status={pendingMcpSignIn.status}
            errorMessage={pendingMcpSignIn.errorMessage}
            onAuthenticate={onAuthenticateMcp}
            onOpenAppPage={onOpenStoreApp}
            onRetryContinue={onRetryMcpContinue}
          />
        )}

        {suggestedApps.length > 0 && (
          <div className="space-y-2 max-w-[820px]">
            {suggestedApps.map((app) => (
              <div
                key={app.slug}
                className="flex items-center justify-between gap-3 rounded-[12px] border border-[#2A2A2A] bg-[#212121] p-3.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <AppBrandIcon slug={app.slug} name={app.name} size={32} />
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#F0F0F0] truncate">
                      {app.name}
                    </p>
                    <p className="text-[12px] text-[#979797] truncate">{app.tagline}</p>
                  </div>
                </div>
                {onOpenStoreApp && (
                  <button
                    type="button"
                    onClick={() => onOpenStoreApp(app.slug)}
                    className="shrink-0 rounded-full border border-[#2A2A2A] bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-[#42A0FF] hover:bg-[#2A2A2A]"
                  >
                    Abrir página
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Feedback ao vivo estilo Criativo Studio enquanto o agente executa */}
        {isWorking && (() => {
          const liveSenderAgent =
            mode === "channel" && liveRun?.agenteId
              ? allAgentes.find((a) => a.agente_id === liveRun.agenteId) ?? null
              : null;
          const liveMascotAvatar = liveSenderAgent
            ? resolveAgentAvatarConfig(liveSenderAgent, liveSenderAgent.agente_id)
            : agentAvatar;
          const activeImageStep = liveRun?.steps.find(
            (st) => st.ferramenta?.includes("generate_image") && st.status === "executando"
          );
          const previewAspectClass =
            activeImageStep?.formato === "9:16"
              ? "aspect-[9/16] max-w-[210px]"
              : activeImageStep?.formato === "1:1"
                ? "aspect-square max-w-[260px]"
                : activeImageStep?.formato === "16:9"
                  ? "aspect-video max-w-[340px]"
                  : "aspect-[3/4] max-w-[250px]";
          return (
          <div className="flex gap-3 max-w-[820px] mr-auto pt-1" role="status" aria-live="polite">
            <div className="pt-0.5 shrink-0 flex flex-col items-center">
              <div className="flex items-center gap-1 mb-1">
                <span className="h-1 w-1 rounded-full bg-[#A855F7] animate-bounce [animation-delay:-0.25s]" />
                <span className="h-1 w-1 rounded-full bg-[#A855F7] animate-bounce [animation-delay:-0.12s]" />
                <span className="h-1 w-1 rounded-full bg-[#A855F7] animate-bounce" />
              </div>
              <MascoteAvatar
                avatar={liveMascotAvatar}
                agentKey={liveSenderAgent?.agente_id ?? agente?.agente_id}
                size={44}
                animated
                mood="working"
                activity={liveActivity}
              />
            </div>

            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="flex items-center gap-2.5 text-[12.5px]">
                <span className="text-[#DCDCDC] font-medium truncate">
                  {liveRun?.statusText ||
                    (mode === "channel"
                      ? `Coordenando ${liveSenderAgent?.nome ?? "equipe"}...`
                      : `Executando ${currentModel}...`)}
                </span>
                <span className="text-[11.5px] text-[#7A7A7A] tabular-nums shrink-0">
                  {formatElapsedClock(elapsedSec)}
                </span>
              </div>

              {activeImageStep && (
                <div
                  data-testid="image-generating-preview"
                  className={`studio-image-generating-card w-full ${previewAspectClass} flex flex-col items-center justify-end p-4`}
                >
                  <div className="relative z-10 w-full rounded-xl bg-[#141414]/80 backdrop-blur-md border border-white/10 px-3 py-2 text-center space-y-1">
                    <div className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white">
                      <Loader2 className="h-3.5 w-3.5 text-[#42A0FF] animate-spin" />
                      <span>Gerando imagem{activeImageStep.formato ? ` (${activeImageStep.formato})` : ""}...</span>
                    </div>
                    <p className="text-[11px] text-[#979797] truncate">
                      {activeImageStep.titulo || "Compondo iluminação e referências"}
                    </p>
                  </div>
                </div>
              )}

              {showAgentSteps && liveRun && liveRun.steps.length > 0 && (
                <div className="rounded-xl bg-[#212121] border border-white/[0.06] px-3 py-2 space-y-1.5">
                  {liveRun.steps.map((st) => (
                    <div
                      key={st.id}
                      className="flex items-center justify-between gap-2 text-[11.5px] text-[#DCDCDC]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {st.status === "executando" ? (
                          <Loader2 className="h-3 w-3 text-[#42A0FF] animate-spin shrink-0" />
                        ) : st.status === "erro" ? (
                          <X className="h-3 w-3 text-[#FF7675] shrink-0" />
                        ) : (
                          <Check className="h-3 w-3 text-[#31CF76] shrink-0" />
                        )}
                        <span className="truncate">{st.titulo}</span>
                      </div>
                      {st.duracao_ms ? (
                        <span className="text-[10.5px] text-[#6A6A6A] shrink-0 tabular-nums">
                          {st.duracao_ms}ms
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {liveRun && liveRun.streamingText.trim().length > 0 && (() => {
                const liveAgentColor = (
                  agente?.config as Record<string, unknown> | undefined
                )?.chat_color as string | null | undefined;
                const livePalette = computeBubbleColors(liveAgentColor, "#212121");
                return (
                <div className="space-y-1.5 text-[13.5px] leading-relaxed text-[#DCDCDC]">
                  {splitMarkdownBlocks(liveRun.streamingText).map((block, bIdx) =>
                    block.type === "table" && block.headers && block.rows ? (
                      <div key={bIdx} className="overflow-x-auto rounded-xl border border-[#303030] bg-[#141414]">
                        <table className="w-full text-left border-collapse text-[12.5px]">
                          <thead>
                            <tr className="border-b border-[#303030] bg-[#1A1A1A] text-[#A1A1A1]">
                              {block.headers.map((h, hIdx) => (
                                <th key={hIdx} className="px-3.5 py-2 font-medium">
                                  {renderInlineMarkdown(h)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#303030]/70 text-[#F5F5F5]">
                            {block.rows.map((row, rIdx) => (
                              <tr key={rIdx}>
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx} className="px-3.5 py-2 align-top">
                                    {renderInlineMarkdown(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : solidBubbles ? (
                      splitMarkdownIntoBubbleChunks(block.content).map((chunk, cIdx) => (
                        <div
                          key={`${bIdx}-${cIdx}`}
                          style={{
                            backgroundColor: livePalette.backgroundColor,
                            color: livePalette.textColor,
                            borderColor: livePalette.borderColor,
                          }}
                          className="w-fit max-w-full rounded-[18px] border px-4 py-2.5 shadow-sm"
                        >
                          {renderFormattedMarkdownText(chunk, livePalette)}
                        </div>
                      ))
                    ) : (
                      <div key={bIdx}>{renderFormattedMarkdownText(block.content)}</div>
                    )
                  )}
                </div>
                );
              })()}
            </div>
          </div>
          );
        })()}

        {takeoverSession && (
          <div className="max-w-[820px] mr-auto">
            <BrowserTakeoverCard
              takeoverId={takeoverSession.takeoverId}
              tabId={takeoverSession.tabId}
              reason={takeoverSession.reason}
              url={takeoverSession.url}
              title={takeoverSession.title}
              previewDataUrl={takeoverSession.previewDataUrl}
              onAssume={(tId) => onOpenTakeover?.(tId)}
              onCancel={async (tId) => {
                await onCancelTakeover?.(tId);
              }}
            />
          </div>
        )}

        {secretRequest && (
          <div className="max-w-[820px] mr-auto">
            <BrowserSecretCard
              request={secretRequest}
              onSubmitSecret={async (tId, payload) => {
                await onSubmitSecret?.(tId, payload);
              }}
              onAssumeManually={onOpenTakeover ? (tId) => onOpenTakeover(tId) : undefined}
            />
          </div>
        )}

        {captureRequest && (
          <div className="max-w-[820px] mr-auto">
            <CaptureScreenConsentCard
              captureId={captureRequest.captureId}
              agentName={titleName}
              purpose={captureRequest.purpose}
              targetHint={captureRequest.targetHint}
              onAuthorizeCapture={async (cId, payload) => {
                await onAuthorizeScreenCapture?.(cId, payload);
              }}
              onDeclineCapture={async (cId, reason) => {
                await onDeclineScreenCapture?.(cId, reason);
              }}
            />
          </div>
        )}

        {effectiveUsageLimitAsk && (
          <div className="max-w-[820px] mr-auto">
            <UsageLimitAskCard
              ask={effectiveUsageLimitAsk}
              onResolve={async (payload) => {
                setDismissedUsageAskIds((prev) =>
                  prev.includes(payload.askId) ? prev : [...prev, payload.askId]
                );
                await onResolveUsageLimit?.(payload);
              }}
            />
          </div>
        )}
    </>
  );
}
