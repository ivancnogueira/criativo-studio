import React, { useEffect, useRef, useState } from "react";
import type { AgenteRegistro, AnexoChat } from "@criativo/contracts";
import { ArrowRight, Mic, Paperclip, Plus, RotateCcw, X } from "lucide-react";
import { TaskAgentSelect } from "./TaskAgentSelect";

export const TASK_UNDO_WINDOW_MS = 6_000;

export interface PendingUndoTask {
  clientMessageId: string;
  agenteId: string;
  titulo: string;
  conteudo: string;
  anexos: AnexoChat[];
  expiresAt: number;
}

interface TasksComposerProps {
  agentes: AgenteRegistro[];
  selectedAgentId: string;
  onChangeAgent: (agenteId: string) => void;
  concurrencyLimit?: number;
  draft: string;
  onChangeDraft: (next: string) => void;
  tituloDraft: string;
  onChangeTituloDraft: (next: string) => void;
  anexos: AnexoChat[];
  onChangeAnexos: (next: AnexoChat[]) => void;
  onUploadFile?: (file: File) => Promise<AnexoChat>;
  onStartTask: () => void;
  focusNonce?: number;
  disabled?: boolean;
}

/**
 * Composer superior para disparo imediato de sub-tarefa paralela com anexos ImagePaths e voz.
 */
export const TasksComposer: React.FC<TasksComposerProps> = ({
  agentes,
  selectedAgentId,
  onChangeAgent,
  concurrencyLimit = 4,
  draft,
  onChangeDraft,
  tituloDraft,
  onChangeTituloDraft,
  anexos,
  onChangeAnexos,
  onUploadFile,
  onStartTask,
  focusNonce = 0,
  disabled = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [listeningVoice, setListeningVoice] = useState(false);

  useEffect(() => {
    if (focusNonce > 0) {
      textareaRef.current?.focus();
    }
  }, [focusNonce]);

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || !onUploadFile) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      const next: AnexoChat[] = [...anexos];
      for (const file of list) {
        const uploaded = await onUploadFile(file);
        next.push(uploaded);
      }
      onChangeAnexos(next);
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = (ev: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = ev.clipboardData?.files;
    if (files && files.length > 0 && onUploadFile) {
      ev.preventDefault();
      void handleFiles(files);
    }
  };

  const handleToggleVoice = () => {
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
        const transcript = ev.results?.[0]?.[0]?.transcript ?? "";
        if (transcript) {
          onChangeDraft(draft ? `${draft} ${transcript}` : transcript);
        }
      };
      rec.onerror = () => setListeningVoice(false);
      rec.onend = () => setListeningVoice(false);
      rec.start();
    } catch {
      setListeningVoice(false);
    }
  };

  const canSubmit = !disabled && !uploading && (draft.trim().length > 0 || anexos.length > 0);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.06] bg-[#212121] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <TaskAgentSelect
            agentes={agentes}
            selectedAgentId={selectedAgentId}
            onSelectAgent={onChangeAgent}
          />
          <span className="rounded-lg border border-white/[0.06] bg-[#141414] px-2 py-1 text-[12px] font-normal text-[#979797]">
            Até {concurrencyLimit} paralelas
          </span>
        </div>

        <input
          type="text"
          value={tituloDraft}
          onChange={(e) => onChangeTituloDraft(e.target.value)}
          placeholder="Título opcional da entrega..."
          className="w-60 rounded-lg border border-white/[0.06] bg-[#141414] px-2 py-1 text-[12px] font-normal text-white placeholder-[#979797] focus:border-[#007CF7] focus:outline-none"
        />
      </div>

      <textarea
        ref={textareaRef}
        rows={3}
        value={draft}
        onChange={(e) => onChangeDraft(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
            e.preventDefault();
            onStartTask();
          }
        }}
        placeholder="Descreva a sub-tarefa paralela para [NOME_DA_MARCA]..."
        className="w-full resize-none bg-transparent text-[14px] font-normal text-white placeholder-[#979797] focus:outline-none"
      />

      {anexos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {anexos.map((ax, idx) => (
            <div
              key={`${ax.caminho_relativo}-${idx}`}
              className="inline-flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#242424] px-2 py-1 text-[12px] font-normal text-[#DCDCDC]"
            >
              {ax.mime_type.startsWith("image/") ? (
                <img src={ax.url} alt={ax.nome} className="h-5 w-5 rounded object-cover" />
              ) : (
                <Paperclip className="h-4 w-4 text-[#979797]" />
              )}
              <span className="max-w-[160px] truncate">{ax.nome}</span>
              <button
                type="button"
                aria-label="Remover anexo"
                onClick={() => onChangeAnexos(anexos.filter((_, i) => i !== idx))}
                className="text-[#979797] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={!onUploadFile || uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#141414] px-2 py-1 text-[12px] font-semibold text-[#DCDCDC] transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            <span>{uploading ? "Enviando arquivo..." : "Anexar arquivo"}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleVoice}
            className={`inline-flex items-center gap-1 rounded-lg border border-white/[0.06] px-2 py-1 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] ${
              listeningVoice
                ? "bg-[#FD2F3B]/20 text-[#FD2F3B]"
                : "bg-[#141414] text-[#DCDCDC] hover:bg-[#2A2A2A]"
            }`}
          >
            <Mic className="h-4 w-4" />
            <span>Gravar áudio</span>
          </button>
        </div>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={onStartTask}
          className="inline-flex items-center gap-2 rounded-full bg-[#F0F0F0] px-4 py-2 text-[12px] font-semibold text-[#141414] transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] disabled:opacity-40"
        >
          <span>Iniciar tarefa</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

interface TaskTookLineProps {
  pending: PendingUndoTask;
  agentes: AgenteRegistro[];
  remainingSeconds: number;
  onChangePendingAgent: (agenteId: string) => void;
  onUndo: () => void;
  onOpenNow: () => void;
  onDismiss: () => void;
}

/**
 * Barra exibida durante a janela de Undo de 6.000ms após iniciar tarefa na `TasksQueuePage`.
 */
export const TaskTookLine: React.FC<TaskTookLineProps> = ({
  pending,
  agentes,
  remainingSeconds,
  onChangePendingAgent,
  onUndo,
  onOpenNow,
  onDismiss,
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#333335] bg-[#242424] px-4 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <TaskAgentSelect
          agentes={agentes}
          selectedAgentId={pending.agenteId}
          onSelectAgent={onChangePendingAgent}
          compact
          ariaLabel="Trocar Criativo antes de iniciar"
        />
        <span className="truncate text-[14px] font-normal text-[#DCDCDC] max-w-[280px]">
          {pending.titulo}
        </span>
        <span className="rounded bg-[#141414] px-2 py-1 font-mono text-[12px] font-normal text-[#979797]">
          {remainingSeconds}s
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#141414] px-2 py-1 text-[12px] font-semibold text-white transition hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Desfazer envio</span>
        </button>

        <button
          type="button"
          onClick={onOpenNow}
          className="inline-flex items-center gap-1 rounded-lg bg-[#007CF7] px-2 py-1 text-[12px] font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        >
          <span>Abrir thread</span>
        </button>

        <button
          type="button"
          aria-label="Dispensar aviso"
          onClick={onDismiss}
          className="rounded-lg px-2 py-1 text-[12px] font-semibold text-[#979797] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        >
          Dispensar aviso
        </button>
      </div>
    </div>
  );
};
