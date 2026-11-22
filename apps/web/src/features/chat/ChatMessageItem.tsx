import React from "react";
import type { MensagemChat, UiBlockSubmitPayload } from "@criativo/contracts";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerUpLeft,
  GitBranch,
  MoreHorizontal,
  Pin,
  PinOff,
  Smartphone,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  computeBubbleColors,
  splitMarkdownIntoBubbleChunks,
} from "./chat-bubble-theme";
import {
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";
import { AcknowledgeRequestCard } from "./AcknowledgeRequestCard";
import { ApiKeyRequestCard } from "./ApiKeyRequestCard";
import { BranchDivider } from "./BranchDivider";
import { ChatVisualReply } from "./ChatVisualReply";
import { CodePreview } from "./CodePreview";
import { ConversationQuestionPrompt } from "./ConversationQuestionPrompt";
import { MermaidDiagram } from "./MarkdownMathMermaidPreview";
import { SkillSuggestionChatCard } from "./SkillSuggestionChatCard";
import { UiBlockPrompt } from "./UiBlockPrompt";
import { ChatMessageAttachments } from "./ChatMessageAttachments";
import {
  renderFormattedMarkdownText,
  renderInlineMarkdown,
  splitMarkdownBlocks,
  toCsv,
} from "./chat-markdown-renderer";
import type { AgentConversationViewProps } from "./chat-types";
import type { ChatConversationController } from "./useChatConversationController";

export function ChatMessageItem({
  msg,
  ctrl,
  props,
}: {
  msg: MensagemChat;
  ctrl: ChatConversationController;
  props: AgentConversationViewProps;
}) {
  const {
    mode,
    agente,
    allAgentes = [],
    onSendMessage,
    activeThread = null,
    highlightedMessageId = null,
    onNavigateBranchOrigin,
    pins = [],
    onBranchFromMessage,
    onTogglePinMessage,
    onSubmitUiBlock,
    onSaveSkillSuggestion,
    onDismissSkillSuggestion,
    onOpenFilePreview,
    onOpenImageLightbox,
    showAgentSteps = true,
    solidBubbles = true,
  } = props;

  const {
    pageContext,
    setPageContext,
    agentAvatar,
    operatorPalette,
    expandedSteps,
    setExpandedSteps,
    copiedId,
    handleCopy,
    setDraft,
    openMessageMenuId,
    setOpenMessageMenuId,
  } = ctrl;

            if (msg.item_type === "context_reset") {
              return (
                <div
                  key={msg.mensagem_id}
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className="my-4 flex items-center gap-4 max-w-[820px] mx-auto"
                >
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="rounded-full border border-white/[0.06] bg-[#212121] px-4 py-1 text-[12px] font-normal text-[#979797]">
                    {msg.conteudo_markdown?.trim() ||
                      "Novo chat iniciado — contexto do modelo reiniciado · histórico visual preservado"}
                  </span>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                </div>
              );
            }

            if (msg.item_type === "memory-changes") {
              const count = msg.memory_changes?.length ?? 0;
              const summaryText =
                msg.conteudo_markdown?.trim() ||
                (count > 0
                  ? `${count} memória(s) revisada(s) automaticamente em segundo plano`
                  : "Memórias revisadas automaticamente");
              return (
                <div
                  key={msg.mensagem_id}
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className="my-2 flex items-center gap-2 max-w-[820px] mr-auto px-2 text-[12px] font-normal text-[#979797]"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#42A0FF] shrink-0" />
                  <span className="truncate">{summaryText}</span>
                </div>
              );
            }

            if (msg.item_type?.startsWith("visual-reply:") && msg.visual_page) {
              return (
                <div
                  key={msg.mensagem_id}
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className="max-w-[820px] mr-auto w-full"
                >
                  <ChatVisualReply
                    agenteId={msg.agente_id ?? agente?.agente_id ?? "estrategista"}
                    visualMeta={msg.visual_page}
                    onSendMessageFromPage={(text) => {
                      void onSendMessage(text, [], pageContext);
                    }}
                    onUpdatePageContext={(ctxText) => setPageContext(ctxText || null)}
                    onOpenImageLightbox={onOpenImageLightbox}
                  />
                </div>
              );
            }

            if (msg.item_type === "ui-block" && msg.ui_block) {
              const handleCardSubmit = async (payload: UiBlockSubmitPayload) => {
                await onSubmitUiBlock?.(payload);
              };
              return (
                <div
                  key={msg.mensagem_id}
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className="max-w-[820px] mr-auto w-full"
                >
                  {msg.ui_block.tipo_ferramenta === "ask_user" && (
                    <ConversationQuestionPrompt bloco={msg.ui_block} onSubmit={handleCardSubmit} />
                  )}
                  {msg.ui_block.tipo_ferramenta === "ask_ui" && (
                    <UiBlockPrompt bloco={msg.ui_block} onSubmit={handleCardSubmit} />
                  )}
                  {msg.ui_block.tipo_ferramenta === "acknowledge_request" && (
                    <AcknowledgeRequestCard bloco={msg.ui_block} onSubmit={handleCardSubmit} />
                  )}
                  {msg.ui_block.tipo_ferramenta === "request_api_key" && (
                    <ApiKeyRequestCard bloco={msg.ui_block} onSubmit={handleCardSubmit} />
                  )}
                </div>
              );
            }

            if (msg.item_type?.startsWith("skill-suggestion:") && msg.skill_sugestao) {
              return (
                <div
                  key={msg.mensagem_id}
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className="max-w-[820px] mr-auto w-full"
                >
                  <SkillSuggestionChatCard
                    sugestao={msg.skill_sugestao}
                    onSave={onSaveSkillSuggestion}
                    onDismiss={onDismissSkillSuggestion}
                  />
                </div>
              );
            }

            const isUser = msg.autor === "usuario";
            const blocks = splitMarkdownBlocks(msg.conteudo_markdown);
            const senderAgentForMsg =
              !isUser && mode === "channel" && msg.agente_id
                ? allAgentes.find((a) => a.agente_id === msg.agente_id)
                : !isUser
                  ? agente
                  : undefined;
            const customAgentChatColor = (
              senderAgentForMsg?.config as Record<string, unknown> | undefined
            )?.chat_color as string | null | undefined;
            const agentBubblePalette = computeBubbleColors(customAgentChatColor, "#212121");
            const isHighlighted = highlightedMessageId === msg.mensagem_id;
            const isPinned = pins.some((p) => p.mensagem_id === msg.mensagem_id);
            const isWhatsAppMsg =
              (msg.metadados as Record<string, unknown> | undefined)?.origem === "whatsapp";
            const isBranchCutoff =
              Boolean(activeThread?.branch) &&
              activeThread?.branch?.ate_mensagem_id === msg.mensagem_id;

            return (
              <React.Fragment key={msg.mensagem_id}>
                <div
                  id={`msg-anchor-${msg.mensagem_id}`}
                  className={`group relative flex gap-3 max-w-[820px] rounded-2xl p-1 transition ${
                    isUser ? "ml-auto justify-end" : "mr-auto"
                  } ${isHighlighted ? "ring-2 ring-[#007CF7] bg-[#007CF7]/10" : ""}`}
                >
                {!isUser && (() => {
                  const senderAgent =
                    mode === "channel" && msg.agente_id
                      ? allAgentes.find((a) => a.agente_id === msg.agente_id)
                      : undefined;
                  const msgAvatar = senderAgent
                    ? resolveAgentAvatarConfig(senderAgent, msg.agente_id ?? undefined)
                    : agentAvatar;
                  return (
                    <div className="pt-1 shrink-0">
                      <MascoteAvatar
                        avatar={msgAvatar}
                        agentKey={msg.agente_id ?? agente?.agente_id}
                        size={38}
                      />
                    </div>
                  );
                })()}

                <div
                  className={`min-w-0 ${
                    isUser
                      ? "flex flex-col items-end max-w-[78%]"
                      : "flex-1 space-y-3"
                  }`}
                >
                  <div
                    style={
                      isUser
                        ? {
                            backgroundColor: operatorPalette.backgroundColor,
                            color: operatorPalette.textColor,
                            borderColor: operatorPalette.borderColor,
                          }
                        : undefined
                    }
                    className={`min-w-0 w-full ${
                      isUser
                        ? "border rounded-[18px] px-4 py-2.5 shadow-sm"
                        : "space-y-2.5"
                    }`}
                  >
                  {isUser && isWhatsAppMsg && (
                    <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#31CF76]">
                      <Smartphone className="h-2.5 w-2.5" />
                      <span>WhatsApp</span>
                    </div>
                  )}
                  {!isUser && msg.autor_nome && (
                    <div className="text-[11.5px] font-semibold text-[#979797] flex items-center gap-2">
                      <span>{msg.autor_nome}</span>
                      {isWhatsAppMsg && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#31CF76]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#31CF76]">
                          <Smartphone className="h-2.5 w-2.5" />
                          <span>WhatsApp</span>
                        </span>
                      )}
                      <span className="text-[#6A6A6A] font-normal">
                        {new Date(msg.criado_em).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  )}

                  {/* Passos de execução colapsáveis */}
                  {!isUser && showAgentSteps && msg.steps && msg.steps.length > 0 && (
                    <div className="rounded-xl bg-[#212121] border border-white/[0.06] overflow-hidden">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSteps((prev) => ({
                            ...prev,
                            [msg.mensagem_id]: !prev[msg.mensagem_id],
                          }))
                        }
                        className="w-full px-3 py-2 flex items-center justify-between text-[11.5px] text-[#979797] hover:text-white"
                      >
                        <span className="flex items-center gap-1.5">
                          <Wrench className="h-3.5 w-3.5 text-[#31CF76]" />
                          <span>{msg.steps.length} etapa(s) de ferramenta executada(s)</span>
                        </span>
                        {expandedSteps[msg.mensagem_id] ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>

                      {expandedSteps[msg.mensagem_id] && (
                        <div className="px-3 pb-2.5 pt-1 border-t border-white/[0.05] space-y-1.5">
                          {msg.steps.map((st) => (
                            <div
                              key={st.id}
                              className="flex items-start justify-between gap-2 text-[11.5px] text-[#DCDCDC]"
                            >
                              <div className="min-w-0">
                                <span className="font-terminal text-[#42A0FF] mr-1.5">
                                  [{st.ferramenta}]
                                </span>
                                <span>{st.titulo}</span>
                              </div>
                              <span className="text-[10.5px] text-[#6A6A6A] shrink-0">
                                {st.duracao_ms ? `${st.duracao_ms}ms` : "ok"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Blocos de texto, códigos e tabelas Markdown com formatação inline */}
                  <div
                    className={`text-[13.5px] leading-relaxed ${
                      isUser
                        ? "space-y-2"
                        : solidBubbles
                          ? "space-y-1.5"
                          : "space-y-3 text-[#DCDCDC]"
                    }`}
                  >
                    {blocks.map((block, bIdx) => {
                      if (block.type === "code") {
                        if (block.language?.toLowerCase() === "mermaid") {
                          return <MermaidDiagram key={bIdx} chart={block.content} />;
                        }
                        return (
                          <CodePreview
                            key={bIdx}
                            code={block.content}
                            language={block.language}
                          />
                        );
                      }

                      if (block.type === "table" && block.headers && block.rows) {
                        const mdKey = `${msg.mensagem_id}-md-${bIdx}`;
                        const csvKey = `${msg.mensagem_id}-csv-${bIdx}`;
                        return (
                          <div key={bIdx} className="space-y-2">
                            <div className="overflow-x-auto rounded-xl border border-[#303030] bg-[#141414]">
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
                                    <tr key={rIdx} className="hover:bg-white/[0.03]">
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
                            <div className="flex items-center justify-center gap-4 text-[11.5px] text-[#979797]">
                              <button
                                type="button"
                                onClick={() => handleCopy(mdKey, block.content)}
                                className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
                              >
                                {copiedId === mdKey ? (
                                  <Check className="h-3.5 w-3.5 text-[#31CF76]" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                                <span>Copiar como Markdown</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopy(csvKey, toCsv(block.headers ?? [], block.rows ?? []))
                                }
                                className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
                              >
                                {copiedId === csvKey ? (
                                  <Check className="h-3.5 w-3.5 text-[#31CF76]" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                                <span>Copiar como CSV</span>
                              </button>
                            </div>
                          </div>
                        );
                      }

                      if (isUser) {
                        return (
                          <div key={bIdx}>
                            {renderFormattedMarkdownText(block.content, operatorPalette)}
                          </div>
                        );
                      }

                      if (!solidBubbles) {
                        return <div key={bIdx}>{renderFormattedMarkdownText(block.content)}</div>;
                      }

                      const chunks = splitMarkdownIntoBubbleChunks(block.content);
                      return chunks.map((chunk, cIdx) => (
                        <div
                          key={`${bIdx}-${cIdx}`}
                          data-testid="agent-reply-bubble"
                          style={{
                            backgroundColor: agentBubblePalette.backgroundColor,
                            color: agentBubblePalette.textColor,
                            borderColor: agentBubblePalette.borderColor,
                          }}
                          className="w-fit max-w-full rounded-[18px] border px-4 py-2.5 shadow-sm"
                        >
                          {renderFormattedMarkdownText(chunk, agentBubblePalette)}
                        </div>
                      ));
                    })}
                  </div>


                  {/* Previews inline de Anexos (ImagePaths, PNGs gerados, MP4, Documentos) */}
                  {msg.anexos && msg.anexos.length > 0 && (
                    <ChatMessageAttachments
                      anexos={msg.anexos}
                      onOpenImageLightbox={onOpenImageLightbox}
                      onOpenFilePreview={onOpenFilePreview}
                    />
                  )}

                  {mode === "agent" && msg.status !== "streaming" && (
                    <div className="mt-2 flex items-center gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      {onBranchFromMessage && (
                        <button
                          type="button"
                          onClick={() => void onBranchFromMessage(msg.mensagem_id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#212121] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white"
                        >
                          <GitBranch className="h-3 w-3" />
                          <span>Ramificar conversa</span>
                        </button>
                      )}

                      {onTogglePinMessage && (
                        <button
                          type="button"
                          onClick={() => void onTogglePinMessage(msg, !isPinned)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#212121] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white"
                        >
                          {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                          <span>{isPinned ? "Desafixar mensagem" : "Fixar mensagem"}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => void handleCopy(msg.mensagem_id, msg.conteudo_markdown)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#212121] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copiar texto</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setDraft((prev) =>
                            `> ${msg.conteudo_markdown.slice(0, 120).replace(/\n/g, " ")}\n\n${prev}`
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-[#212121] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] hover:text-white"
                      >
                        <CornerUpLeft className="h-3 w-3" />
                        <span>Responder mensagem</span>
                      </button>

                      <button
                        type="button"
                        aria-label="Mais ações"
                        onClick={() =>
                          setOpenMessageMenuId((cur) =>
                            cur === msg.mensagem_id ? null : msg.mensagem_id
                          )
                        }
                        className="rounded-lg bg-[#212121] p-1 text-[#979797] hover:text-white"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                      {openMessageMenuId === msg.mensagem_id && (
                        <span className="text-[12px] font-normal text-[#979797]">
                          {isPinned ? "Fixada" : ""}
                        </span>
                      )}
                    </div>
                  )}
                  </div>

                  {isUser && msg.reacao_emoji && (
                    <span
                      data-testid={`reaction-pill-${msg.mensagem_id}`}
                      aria-label={`Reação do agente: ${msg.reacao_emoji}`}
                      className="mt-1 bg-[#242424] border border-white/12 px-2 py-1 rounded-full text-[12px] leading-none select-none"
                    >
                      {msg.reacao_emoji}
                    </span>
                  )}
                </div>
              </div>
              {isBranchCutoff && activeThread?.branch && (
                <BranchDivider
                  branch={activeThread.branch}
                  onNavigateToOrigin={onNavigateBranchOrigin}
                />
              )}
              </React.Fragment>
  );
}
