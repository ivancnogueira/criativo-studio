import {
  Check,
  FileText,
  Loader2,
  Mic,
  Plus,
  Radio,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { ComposerAutocomplete } from "./ComposerAutocomplete";
import { OpenWaitsCard } from "./OpenWaitsCard";
import { QueuePanel } from "./QueuePanel";
import type { AgentConversationViewProps } from "./chat-types";
import type { ChatConversationController } from "./useChatConversationController";

export function ChatComposerBar({
  ctrl,
  props,
}: {
  ctrl: ChatConversationController;
  props: AgentConversationViewProps;
}) {
  const {
    mode,
    sending,
    onOpenConnectors,
    onJumpToMessage,
    esperas = [],
    filaSnapshot = null,
    editingQueueItem = null,
    onCloseWait,
    onBeginEditQueueItem,
    onDiscardEditQueueItem,
    onCancelOrDeleteQueueItem,
    onReorderQueue,
    onSteerQueueItem,
    onMoveQueueItemToTask,
    onInterruptTurn,
    onAskSideQuestion,
    sendShortcut = "enter",
    liveVoiceEnabled = false,
    liveVoiceActive = false,
    onToggleLiveVoice,
  } = props;

  const {
    draft,
    setDraft,
    pendingAttachments,
    setPendingAttachments,
    pageContext,
    setPageContext,
    uploading,
    plusMenuOpen,
    setPlusMenuOpen,
    setSidePanelOpen,
    editError,
    setEditError,
    savingEdit,
    listeningVoice,
    setCursorPos,
    autocompleteIndex,
    setAutocompleteIndex,
    setDismissedTriggerKey,
    recordingSeconds,
    recordingLevel,
    transcribingVoice,
    voiceError,
    setVoiceError,
    pendingFailedAudio,
    setPendingFailedAudio,
    textareaRef,
    fileInputRef,
    isWorking,
    currentThreadId,
    titleName,
    handlePickFiles,
    handleSend,
    triggerKey,
    activeTrigger,
    autocompleteItems,
    applyComposerItem,
    formatRecordingTimer,
    stopRecordingAndTranscribe,
    cancelVoiceRecording,
    handleAttachFailedAudio,
    handleVoiceDictation,
  } = ctrl;

  return (
      <div className="px-5 pb-4 pt-2 shrink-0">
        <div className="max-w-[820px] mx-auto">
          {mode === "agent" && onCloseWait && (
            <OpenWaitsCard
              esperas={esperas}
              onViewOriginPedido={(w) => {
                if (onJumpToMessage && w.entrega_origem_id) {
                  void onJumpToMessage(currentThreadId, w.entrega_origem_id);
                }
              }}
              onCloseWait={onCloseWait}
            />
          )}

          {mode === "agent" &&
            filaSnapshot &&
            filaSnapshot.entregas.length > 0 &&
            onBeginEditQueueItem &&
            onCancelOrDeleteQueueItem &&
            onReorderQueue &&
            onSteerQueueItem &&
            onMoveQueueItemToTask && (
              <QueuePanel
                entregas={filaSnapshot.entregas}
                suportaSteerNativo={filaSnapshot.suporta_steer_nativo}
                onBeginEdit={onBeginEditQueueItem}
                onCancelOrDelete={onCancelOrDeleteQueueItem}
                onReorder={onReorderQueue}
                onSteer={onSteerQueueItem}
                onMoveToTask={onMoveQueueItemToTask}
              />
            )}

          {!editingQueueItem && editError && (
            <div className="mb-2 flex items-start justify-between gap-2 rounded-xl border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 px-3 py-2 text-[12px] text-[#FF8A91]">
              <span>{editError}</span>
              <button
                type="button"
                aria-label="Dispensar erro de upload"
                onClick={() => setEditError(null)}
                className="shrink-0 font-bold text-[#FF8A91] hover:text-white"
              >
                ×
              </button>
            </div>
          )}
          {editingQueueItem && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#007CF7]/40 bg-[#242424] px-4 py-2">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-[#42A0FF]">
                  Editando mensagem na fila (travada contra consumo automático)
                </div>
                {editError && (
                  <div className="text-[12px] font-normal text-[#FD2F3B]">{editError}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {onDiscardEditQueueItem && (
                  <button
                    type="button"
                    disabled={savingEdit}
                    onClick={async () => {
                      setEditError(null);
                      await onDiscardEditQueueItem(editingQueueItem.entrega_id);
                      setDraft("");
                      setPendingAttachments([]);
                    }}
                    className="rounded-lg border border-white/[0.06] bg-[#141414] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A]"
                  >
                    Descartar edição
                  </button>
                )}
                <button
                  type="button"
                  disabled={savingEdit || !draft.trim()}
                  onClick={() => void handleSend()}
                  className="rounded-lg bg-[#F0F0F0] px-3 py-1 text-[12px] font-semibold text-[#141414] hover:bg-white disabled:opacity-40"
                >
                  {savingEdit ? "Aplicando edição..." : "Aplicar edição"}
                </button>
              </div>
            </div>
          )}
          {pageContext && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-[#242424] border border-white/12 px-3 py-1.5 text-[12px]">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="h-3.5 w-3.5 text-[#42A0FF] shrink-0" />
                <span className="font-semibold text-white shrink-0">
                  Contexto ativo da página
                </span>
                <span className="text-[#DCDCDC] truncate">{pageContext}</span>
              </div>
              <button
                type="button"
                onClick={() => setPageContext(null)}
                aria-label="Remover contexto da página"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-[#979797] hover:text-white shrink-0"
              >
                <X className="h-3.5 w-3.5" />
                <span>Limpar contexto</span>
              </button>
            </div>
          )}
        </div>

        <div className="max-w-[820px] mx-auto">
          <ComposerAutocomplete
            trigger={activeTrigger}
            items={autocompleteItems}
            selectedIndex={autocompleteIndex}
            onHoverIndex={setAutocompleteIndex}
            onSelect={applyComposerItem}
          />
        </div>

        <div className="max-w-[820px] mx-auto rounded-[22px] bg-[#212121] border border-white/10 px-3 py-2 shadow-lg">
          {listeningVoice && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-[#FD2F3B]/35 bg-[#FD2F3B]/10 px-3 py-2 text-[12px]">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FD2F3B] animate-pulse shrink-0" />
                <span className="font-semibold text-[#F8FAFC]">Gravando áudio</span>
                <span className="font-mono text-[11.5px] text-[#FCA5A5] tabular-nums">
                  {formatRecordingTimer(recordingSeconds)}
                </span>
                <div
                  className="flex items-end gap-0.5 h-4 ml-1"
                  aria-hidden="true"
                >
                  {[20, 40, 60, 80, 100].map((bar) => (
                    <span
                      key={bar}
                      style={{
                        height: `${Math.max(25, recordingLevel >= bar ? 100 : Math.max(25, Math.round(recordingLevel * 0.9)))}%`,
                      }}
                      className={`w-1 rounded-full transition-all ${
                        recordingLevel >= bar - 15 ? "bg-[#FD2F3B]" : "bg-[#FD2F3B]/35"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={cancelVoiceRecording}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#1B1B1E] px-2.5 py-1 text-[11.5px] font-medium text-[#DCDCDC] hover:bg-[#2A2A2E]"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Cancelar</span>
                </button>
                <button
                  type="button"
                  onClick={stopRecordingAndTranscribe}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#F0F0F0] px-2.5 py-1 text-[11.5px] font-semibold text-[#141414] hover:bg-white"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Finalizar e transcrever</span>
                </button>
              </div>
            </div>
          )}

          {transcribingVoice && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-[#42A0FF]/35 bg-[#42A0FF]/10 px-3 py-2 text-[12px] text-[#E0F2FE]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#42A0FF]" />
              <span>Transcrevendo áudio...</span>
            </div>
          )}

          {voiceError && (
            <div className="mb-2 rounded-xl border border-[#FD2F3B]/35 bg-[#FD2F3B]/10 px-3 py-2 text-[12px] text-[#FECACA]">
              <div className="flex items-start justify-between gap-2">
                <span>{voiceError}</span>
                <button
                  type="button"
                  onClick={() => {
                    setVoiceError(null);
                    setPendingFailedAudio(null);
                  }}
                  aria-label="Fechar aviso de microfone"
                  className="text-[#FCA5A5] hover:text-white shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {(pendingFailedAudio || onOpenConnectors) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {pendingFailedAudio && (
                    <button
                      type="button"
                      onClick={() => void handleAttachFailedAudio()}
                      disabled={uploading}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#1B1B1E] px-2.5 py-1 text-[11.5px] font-semibold text-[#F4F4F5] hover:bg-[#27272B]"
                    >
                      Anexar áudio gravado no chat
                    </button>
                  )}
                  {onOpenConnectors && (
                    <button
                      type="button"
                      onClick={() => {
                        setVoiceError(null);
                        onOpenConnectors();
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#42A0FF]/40 bg-[#42A0FF]/15 px-2.5 py-1 text-[11.5px] font-semibold text-[#93C5FD] hover:bg-[#42A0FF]/25"
                    >
                      Configurar chave em Conexões
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pb-2 mb-2 border-b border-white/[0.06]">
              {pendingAttachments.map((att, idx) => (
                <div
                  key={`${att.caminho_relativo}-${idx}`}
                  className="flex items-center gap-2 rounded-lg bg-[#2A2A2A] border border-white/10 px-2.5 py-1 text-[11.5px] text-white"
                >
                  {att.mime_type.startsWith("image/") ? (
                    <img
                      src={att.url}
                      alt={att.nome}
                      className="h-5 w-5 rounded object-cover"
                    />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-[#42A0FF]" />
                  )}
                  <span className="max-w-[140px] truncate">{att.nome}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingAttachments((prev) => prev.filter((_, pIdx) => pIdx !== idx))
                    }
                    aria-label={`Remover anexo ${att.nome}`}
                    className="text-[#979797] hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              id="composer-imagepaths-input"
              name="composer_attachments"
              aria-label="Anexar imagens ou referências ImagePaths"
              type="file"
              multiple
              accept="image/*,video/mp4,.pdf,.csv,.txt,.srt"
              className="hidden"
              onChange={(e) => {
                void handlePickFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <div className="relative shrink-0">
              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  if (mode === "agent" && onAskSideQuestion) {
                    setPlusMenuOpen((prev) => !prev);
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                title="Anexar foto, logo ou referência facial (ImagePaths)"
                aria-label="Anexar referência ImagePaths"
                className="h-9 w-9 rounded-full flex items-center justify-center text-[#979797] hover:text-white hover:bg-[#2A2A2A] transition-colors shrink-0"
              >
                <Plus className="h-4 w-4" />
              </button>

              {plusMenuOpen && (
                <div className="absolute bottom-full left-0 z-40 mb-2 w-48 rounded-xl border border-white/[0.06] bg-[#141414] p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="block w-full rounded-lg px-2 py-2 text-left text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#242424]"
                  >
                    Anexar arquivo
                  </button>
                  {onAskSideQuestion && (
                    <button
                      type="button"
                      onClick={() => {
                        setPlusMenuOpen(false);
                        setSidePanelOpen(true);
                      }}
                      className="block w-full rounded-lg px-2 py-2 text-left text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#242424]"
                    >
                      Perguntar ao lado
                    </button>
                  )}
                </div>
              )}
            </div>

            <textarea
              ref={textareaRef}
              id="composer-message-input"
              name="composer_message"
              aria-label={`Mensagem para ${titleName}`}
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setCursorPos(e.target.selectionStart ?? e.target.value.length);
              }}
              onClick={(e) => {
                setCursorPos(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
              }}
              onKeyUp={(e) => {
                setCursorPos(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
              }}
              onKeyDown={(e) => {
                if (activeTrigger && autocompleteItems.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setAutocompleteIndex((idx) => (idx + 1) % autocompleteItems.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setAutocompleteIndex(
                      (idx) => (idx - 1 + autocompleteItems.length) % autocompleteItems.length
                    );
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    const picked = autocompleteItems[autocompleteIndex] ?? autocompleteItems[0];
                    if (picked) {
                      applyComposerItem(picked);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    if (triggerKey) {
                      setDismissedTriggerKey(triggerKey);
                    }
                    return;
                  }
                }

                if (sendShortcut === "mod_enter") {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void handleSend();
                  }
                } else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                uploading
                  ? "Enviando arquivo..."
                  : transcribingVoice
                    ? "Transcrevendo áudio..."
                    : sendShortcut === "mod_enter"
                      ? `Mensagem para ${titleName} (/ comandos · @ menções · Ctrl/⌘+Enter)`
                      : `Mensagem para ${titleName} (/ comandos · @ menções)`
              }
              className="flex-1 bg-transparent py-2 text-[13.5px] text-white placeholder-[#6A6A6A] focus:outline-none resize-none max-h-32"
            />

            {liveVoiceEnabled && onToggleLiveVoice && (
              <button
                type="button"
                onClick={onToggleLiveVoice}
                aria-label={liveVoiceActive ? "Encerrar voz contínua" : "Iniciar voz contínua"}
                title={liveVoiceActive ? "Encerrar voz contínua" : "Iniciar voz contínua"}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition shrink-0 ${
                  liveVoiceActive
                    ? "border-[#007CF7] bg-[#007CF7]/20 text-[#42A0FF]"
                    : "border-white/[0.08] bg-[#141414] text-[#DCDCDC] hover:bg-[#242424]"
                }`}
              >
                <Radio className="h-3.5 w-3.5" />
                <span>{liveVoiceActive ? "Encerrar voz contínua" : "Iniciar voz contínua"}</span>
              </button>
            )}

            <button
              type="button"
              disabled={transcribingVoice}
              onClick={() => void handleVoiceDictation()}
              title={listeningVoice ? "Finalizar gravação e transcrever" : "Gravar pedido por voz"}
              aria-label={
                listeningVoice ? "Finalizar gravação de áudio" : "Gravar ou ditar pedido por voz"
              }
              className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors shrink-0 disabled:opacity-40 ${
                listeningVoice
                  ? "bg-[#FD2F3B]/20 text-[#FD2F3B] ring-1 ring-[#FD2F3B]/50"
                  : "text-[#979797] hover:text-white hover:bg-[#2A2A2A]"
              }`}
            >
              {transcribingVoice ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#42A0FF]" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>

            {isWorking && onInterruptTurn && mode === "agent" && (
              <button
                type="button"
                onClick={() => void onInterruptTurn()}
                aria-label="Interromper turno"
                className="inline-flex h-9 items-center gap-1 rounded-full border border-[#FD2F3B]/60 bg-[#FD2F3B]/15 px-3 text-[12px] font-semibold text-[#FD2F3B] transition hover:bg-[#FD2F3B]/25 shrink-0"
              >
                <Square className="h-3 w-3 fill-current" />
                <span>Interromper turno</span>
              </button>
            )}

            <button
              type="button"
              disabled={
                (mode === "channel" && sending) ||
                uploading ||
                (!draft.trim() && pendingAttachments.length === 0)
              }
              onClick={() => void handleSend()}
              aria-label="Enviar mensagem"
              className="h-9 w-9 rounded-full bg-[#F0F0F0] hover:bg-white disabled:opacity-40 text-[#141414] flex items-center justify-center transition-colors shrink-0"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
  );
}
