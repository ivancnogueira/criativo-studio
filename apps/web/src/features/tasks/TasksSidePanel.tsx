import React, { useEffect, useRef, useState } from "react";
import type {
  AgenteRegistro,
  AgenteThreadRegistro,
  AnexoChat,
  AvatarShape,
  FilaChatSnapshot,
  MensagemChat,
  PaginaConversaThread,
  TarefaRegistro,
} from "@criativo/contracts";
import {
  Archive,
  ArchiveRestore,
  ChevronUp,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Square,
  X,
} from "lucide-react";
import { getDefaultMascotForAgent, MascoteAvatar } from "../../components/MascoteAvatar";
import { ApprovalBridge } from "../preview/ApprovalBridge";
import { InstagramMobilePreview } from "../preview/InstagramMobilePreview";
import { AgentStepsWaterfall, type AgentStepLog } from "../trace/AgentStepsWaterfall";
import { QueuePanel } from "../chat/QueuePanel";

export interface TasksSidePanelProps {
  open: boolean;
  thread: AgenteThreadRegistro | null;
  tarefa: TarefaRegistro | null;
  agente: AgenteRegistro | null;
  pagina: PaginaConversaThread | null;
  queueSnapshot?: FilaChatSnapshot | null;
  steps?: AgentStepLog[];
  thoughtStream?: string;
  loading?: boolean;
  onClose: () => void;
  onOpenInChat: (thread: AgenteThreadRegistro) => void;
  onToggleArchive: (thread: AgenteThreadRegistro) => Promise<void>;
  onRenameThread?: (threadId: string, titulo: string) => Promise<void>;
  onLoadOlder?: (threadId: string, cursor: string) => Promise<void>;
  onSendMessage: (threadId: string, conteudo: string, anexos: AnexoChat[]) => Promise<void>;
  onStopThread?: (threadId: string) => Promise<void>;
  onUploadFile?: (file: File) => Promise<AnexoChat>;
  onApproveTask?: (tarefaId: string) => Promise<void>;
  onRequestRevision?: (tarefa: TarefaRegistro) => Promise<void>;
  onRetryTask?: (tarefaId: string) => void;
  onQueueSteer?: (entregaId: string) => Promise<void>;
  onQueueCancel?: (entregaId: string) => Promise<void>;
  onQueueReorder?: (ids: string[]) => Promise<void>;
  onQueueMoveToTask?: (entregaId: string) => Promise<void>;
}

/**
 * Painel lateral direito redimensionável da tarefa paralela (`320px..720px`, padrão `420px`)
 * com histórico paginado, prévia Meta/Instagram, fila local da thread, botão `Abrir no Chat` e composer completo.
 */
export const TasksSidePanel: React.FC<TasksSidePanelProps> = ({
  open,
  thread,
  tarefa,
  agente,
  pagina,
  queueSnapshot,
  steps = [],
  thoughtStream = "",
  loading = false,
  onClose,
  onOpenInChat,
  onToggleArchive,
  onRenameThread,
  onLoadOlder,
  onSendMessage,
  onStopThread,
  onUploadFile,
  onApproveTask,
  onRequestRevision,
  onRetryTask,
  onQueueSteer,
  onQueueCancel,
  onQueueReorder,
  onQueueMoveToTask,
}) => {
  const [widthPx, setWidthPx] = useState(420);
  const [draft, setDraft] = useState("");
  const [anexos, setAnexos] = useState<AnexoChat[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [listeningVoice, setListeningVoice] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitleDraft(thread?.titulo ?? tarefa?.titulo ?? "");
    setEditingTitle(false);
  }, [thread?.thread_id, thread?.titulo, tarefa?.titulo]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || (!thread && !tarefa)) {
    return null;
  }

  const startResize = (ev: React.MouseEvent) => {
    if (typeof window === "undefined") return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startW = widthPx;
    const onMove = (moveEv: MouseEvent) => {
      const next = Math.max(320, Math.min(720, startW + (startX - moveEv.clientX)));
      setWidthPx(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const cfg = (agente?.config ?? {}) as Record<string, unknown>;
  const fb = getDefaultMascotForAgent(agente?.agente_id ?? thread?.agente_id ?? "estrategista");
  const avatarShape = (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : fb.shape) as AvatarShape;
  const avatarColor = typeof cfg.avatar_color === "string" ? cfg.avatar_color : fb.color;
  const isRunning = thread?.estado === "executando" || tarefa?.status === "executando";
  const isArchived = Boolean(thread?.arquivada_em);
  const messages: MensagemChat[] = pagina?.mensagens ?? [];

  const handleUpload = async (files: FileList | null) => {
    if (!files || !onUploadFile) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      const next = [...anexos];
      for (const f of list) {
        next.push(await onUploadFile(f));
      }
      setAnexos(next);
    } finally {
      setUploading(false);
    }
  };

  const handleVoice = () => {
    if (typeof window === "undefined") return;
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SpeechRec || listeningVoice) {
      setListeningVoice(false);
      return;
    }
    try {
      const rec = new SpeechRec() as {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
      rec.lang = "pt-BR";
      rec.interimResults = false;
      setListeningVoice(true);
      rec.onresult = (ev) => {
        const text = ev.results?.[0]?.[0]?.transcript ?? "";
        if (text) setDraft((prev) => (prev ? `${prev} ${text}` : text));
      };
      rec.onerror = () => setListeningVoice(false);
      rec.onend = () => setListeningVoice(false);
      rec.start();
    } catch {
      setListeningVoice(false);
    }
  };

  const handleSend = async () => {
    if (!thread || (!draft.trim() && anexos.length === 0)) return;
    setSending(true);
    try {
      const txt = draft.trim() || "Anexo enviado";
      const curAnexos = anexos;
      setDraft("");
      setAnexos([]);
      await onSendMessage(thread.thread_id, txt, curAnexos);
    } finally {
      setSending(false);
    }
  };

  const commitRename = async () => {
    setEditingTitle(false);
    if (!thread || !onRenameThread) return;
    const clean = titleDraft.trim();
    if (clean && clean !== thread.titulo) {
      await onRenameThread(thread.thread_id, clean);
    }
  };

  return (
    <aside
      aria-label="Detalhes da sub-tarefa paralela"
      style={{ width: `${widthPx}px` }}
      className="relative flex h-full shrink-0 flex-col border-l border-white/[0.06] bg-[#141414]"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={startResize}
        className="absolute inset-y-0 left-0 w-1 cursor-ew-resize hover:bg-[#007CF7]"
      />

      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] bg-[#141414] px-4">
        <div className="flex min-w-0 items-center gap-2">
          <MascoteAvatar
            shape={avatarShape}
            color={avatarColor}
            size={24}
            mood={isRunning ? "working" : "idle"}
          />
          {editingTitle && thread ? (
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="w-40 rounded border border-[#007CF7] bg-[#212121] px-2 py-1 text-[14px] font-semibold text-white focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => thread && setEditingTitle(true)}
              className="truncate text-left text-[14px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
            >
              {thread?.titulo ?? tarefa?.titulo ?? "Sub-tarefa"}
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {thread && (
            <>
              <button
                type="button"
                onClick={() => void onToggleArchive(thread)}
                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#212121] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              >
                {isArchived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                <span>{isArchived ? "Restaurar thread" : "Arquivar thread"}</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenInChat(thread)}
                className="inline-flex items-center gap-1 rounded-lg bg-[#007CF7] px-2 py-1 text-[12px] font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              >
                <MessageSquare className="h-3 w-3" />
                <span>Abrir no Chat</span>
              </button>
            </>
          )}

          <button
            type="button"
            aria-label="Fechar painel"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-[#979797] transition hover:bg-[#242424] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Fechar painel</span>
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto bg-[#1A1A1A] p-4">
        {pagina?.has_older && pagina.older_cursor && thread && onLoadOlder && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void onLoadOlder(thread.thread_id, pagina.older_cursor!)}
              className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-[#212121] px-4 py-1 text-[12px] font-semibold text-[#DCDCDC] transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
            >
              <ChevronUp className="h-3 w-3" />
              <span>Carregar anteriores</span>
            </button>
          </div>
        )}

        {loading && messages.length === 0 && (
          <p className="text-[12px] font-normal text-[#979797]">Carregando histórico da thread...</p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.mensagem_id}
            className={`rounded-xl border border-white/[0.06] p-4 ${
              msg.autor === "usuario" ? "bg-[#242424]" : "bg-[#212121]"
            }`}
          >
            <div className="mb-1 flex items-center justify-between text-[12px] font-normal text-[#979797]">
              <span className="font-semibold text-[#DCDCDC]">
                {msg.autor === "usuario" ? "Você" : (msg.autor_nome ?? agente?.nome ?? "Especialista")}
              </span>
              <span>{new Date(msg.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className="whitespace-pre-wrap text-[14px] font-normal text-white">
              {msg.conteudo_markdown}
            </div>
            {msg.anexos.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {msg.anexos.map((ax, i) => (
                  <a
                    key={`${ax.caminho_relativo}-${i}`}
                    href={ax.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-white/[0.06] bg-[#141414] px-2 py-1 text-[12px] font-normal text-[#42A0FF]"
                  >
                    <Paperclip className="h-3 w-3" />
                    <span>{ax.nome}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}

        {steps.length > 0 && (
          <AgentStepsWaterfall
            steps={steps}
            thoughtStream={thoughtStream}
            selectedTaskId={tarefa?.tarefa_id ?? thread?.tarefa_id ?? null}
          />
        )}

        {tarefa && (
          <div className="space-y-4">
            <InstagramMobilePreview tarefa={tarefa} />
            {onApproveTask && onRequestRevision && (
              <ApprovalBridge
                tarefa={tarefa}
                onApprove={onApproveTask}
                onRequestRevision={onRequestRevision}
              />
            )}
            {tarefa.status === "falha" && onRetryTask && (
              <button
                type="button"
                onClick={() => onRetryTask(tarefa.tarefa_id)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#FF9412] bg-[#212121] px-4 py-2 text-[12px] font-semibold text-[#FF9412] transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Reprocessar tarefa</span>
              </button>
            )}
          </div>
        )}
      </div>

      {thread && (
        <div className="shrink-0 space-y-2 border-t border-white/[0.06] bg-[#212121] p-4">
          {queueSnapshot && queueSnapshot.entregas.length > 0 && onQueueSteer && onQueueCancel && onQueueReorder && onQueueMoveToTask && (
            <QueuePanel
              entregas={queueSnapshot.entregas}
              suportaSteerNativo={queueSnapshot.suporta_steer_nativo}
              onBeginEdit={async () => {}}
              onCancelOrDelete={onQueueCancel}
              onReorder={onQueueReorder}
              onSteer={onQueueSteer}
              onMoveToTask={onQueueMoveToTask}
            />
          )}

          {anexos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {anexos.map((ax, idx) => (
                <span
                  key={`${ax.caminho_relativo}-${idx}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#242424] px-2 py-1 text-[12px] font-normal text-[#DCDCDC]"
                >
                  <span className="truncate max-w-[140px]">{ax.nome}</span>
                  <button
                    type="button"
                    aria-label="Remover anexo"
                    onClick={() => setAnexos(anexos.filter((_, i) => i !== idx))}
                    className="text-[#979797] hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Envie instruções adicionais nesta sub-tarefa..."
            className="w-full resize-none rounded-lg border border-white/[0.06] bg-[#141414] p-2 text-[14px] font-normal text-white placeholder-[#979797] focus:border-[#007CF7] focus:outline-none"
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleUpload(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={!onUploadFile || uploading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#141414] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                <span>Anexar arquivo</span>
              </button>

              <button
                type="button"
                onClick={handleVoice}
                className={`inline-flex items-center gap-1 rounded-lg border border-white/[0.06] px-2 py-1 text-[12px] font-semibold ${
                  listeningVoice ? "bg-[#FD2F3B]/20 text-[#FD2F3B]" : "bg-[#141414] text-[#DCDCDC]"
                }`}
              >
                <Mic className="h-3 w-3" />
                <span>Gravar áudio</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {isRunning && onStopThread && (
                <button
                  type="button"
                  onClick={() => void onStopThread(thread.thread_id)}
                  className="inline-flex items-center gap-1 rounded-full border border-[#FD2F3B] bg-[#FD2F3B]/15 px-3 py-1 text-[12px] font-semibold text-[#FD2F3B] transition hover:bg-[#FD2F3B]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
                >
                  <Square className="h-3 w-3 fill-current" />
                  <span>Interromper turno</span>
                </button>
              )}

              <button
                type="button"
                disabled={sending || (!draft.trim() && anexos.length === 0)}
                onClick={() => void handleSend()}
                className="inline-flex items-center gap-1 rounded-full bg-[#F0F0F0] px-4 py-1 text-[12px] font-semibold text-[#141414] transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] disabled:opacity-40"
              >
                <Send className="h-3 w-3" />
                <span>Enviar mensagem</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
