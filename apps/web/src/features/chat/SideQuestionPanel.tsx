import React, { useEffect, useState } from "react";
import type { AvatarShape, AvatarStyle, PerguntaLateralTroca } from "@criativo/contracts";
import { Loader2, MessageCircleQuestion, RotateCcw, Send, X } from "lucide-react";
import { MascoteAvatar } from "../../components/MascoteAvatar";

export interface SideQuestionPanelProps {
  open: boolean;
  agenteNome: string;
  agenteAvatar?: {
    shape: AvatarShape;
    color: string;
    style?: AvatarStyle;
    variant?: string;
    imageUrl?: string | null;
  };
  threadId: string | null;
  onAsk: (
    pergunta: string,
    historicoLateral: Array<{ pergunta: string; resposta: string }>
  ) => Promise<string>;
  onClose: () => void;
}

/**
 * Painel lateral efêmero ("Perguntar ao lado") sem acesso a ferramentas e sem persistência em SQLite.
 * O estado local é descartado ao fechar o painel.
 */
export const SideQuestionPanel: React.FC<SideQuestionPanelProps> = ({
  open,
  agenteNome,
  agenteAvatar,
  threadId,
  onAsk,
  onClose,
}) => {
  const [exchanges, setExchanges] = useState<PerguntaLateralTroca[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setExchanges([]);
      setInput("");
      setErrorMsg(null);
      setLastFailedPrompt(null);
      setLoading(false);
    }
  }, [open, threadId]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const submitQuestion = async (questionText: string) => {
    const clean = questionText.trim();
    if (!clean || loading) return;

    setLoading(true);
    setErrorMsg(null);
    setLastFailedPrompt(null);
    const id = `sq-${Date.now()}`;
    const askedAt = new Date().toISOString();
    const historyPayload = exchanges
      .filter((e) => e.resposta !== null)
      .map((e) => ({ pergunta: e.pergunta, resposta: e.resposta ?? "" }));

    setExchanges((prev) => [
      ...prev,
      { id, pergunta: clean, perguntada_em: askedAt, resposta: null, respondida_em: null },
    ]);
    setInput("");

    try {
      const resposta = await onAsk(clean, historyPayload);
      setExchanges((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, resposta, respondida_em: new Date().toISOString() }
            : item
        )
      );
    } catch (err) {
      setExchanges((prev) => prev.filter((item) => item.id !== id));
      setLastFailedPrompt(clean);
      setErrorMsg(err instanceof Error ? err.message : "Não foi possível responder à pergunta lateral.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside
      aria-label="Perguntar ao lado"
      className="flex h-full w-[360px] lg:w-[400px] shrink-0 flex-col border-l border-white/[0.06] bg-[#141414]"
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-4">
        <div className="flex items-center gap-2">
          {agenteAvatar && (
            <MascoteAvatar
              avatar={agenteAvatar}
              size={22}
              mood={loading ? "working" : "idle"}
              activity={loading ? "talking" : "idle"}
            />
          )}
          <span className="text-[14px] font-semibold text-white">Perguntar ao lado</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-[#979797] transition hover:bg-[#212121] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7]"
        >
          <X className="h-4 w-4" />
          <span>Fechar painel</span>
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto bg-[#1A1A1A] p-4">
        {exchanges.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center">
            <MessageCircleQuestion className="h-8 w-8 text-[#979797]" />
            <p className="text-[14px] font-normal text-[#979797]">
              Pergunte ao lado sem poluir a conversa. Tire dúvidas rápidas sobre o contexto de [@SEU_PERFIL]; nada aqui fica salvo ao fechar o painel.
            </p>
          </div>
        ) : (
          exchanges.map((item) => (
            <div key={item.id} className="space-y-2">
              <div className="rounded-xl border border-white/[0.06] bg-[#242424] p-4">
                <div className="mb-1 text-[12px] font-semibold text-[#DCDCDC]">Você</div>
                <p className="whitespace-pre-wrap text-[14px] font-normal text-white">
                  {item.pergunta}
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-[#212121] p-4">
                <div className="mb-1 text-[12px] font-semibold text-[#DCDCDC]">{agenteNome}</div>
                {item.resposta === null ? (
                  <div className="flex items-center gap-2 text-[12px] font-normal text-[#979797]">
                    <Loader2 className="h-4 w-4 animate-spin text-[#007CF7]" />
                    <span>Consultando contexto...</span>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-[14px] font-normal text-[#DCDCDC]">
                    {item.resposta}
                  </p>
                )}
              </div>
            </div>
          ))
        )}

        {errorMsg && (
          <div className="rounded-xl border border-[#FD2F3B]/40 bg-[#FD2F3B]/10 p-4 space-y-2">
            <p className="text-[12px] font-normal text-[#FD2F3B]">{errorMsg}</p>
            {lastFailedPrompt && (
              <button
                type="button"
                onClick={() => void submitQuestion(lastFailedPrompt)}
                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#212121] px-2 py-1 text-[12px] font-semibold text-white hover:bg-[#2A2A2A]"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Tentar pergunta</span>
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-white/[0.06] bg-[#212121] p-4">
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitQuestion(input);
              }
            }}
            placeholder="Faça uma pergunta rápida ao lado..."
            className="flex-1 resize-none rounded-lg border border-white/[0.06] bg-[#141414] p-2 text-[14px] font-normal text-white placeholder-[#979797] focus:border-[#007CF7] focus:outline-none"
          />
          <button
            type="button"
            disabled={loading || !input.trim()}
            onClick={() => void submitQuestion(input)}
            className="inline-flex items-center gap-1 rounded-full bg-[#F0F0F0] px-4 py-2 text-[12px] font-semibold text-[#141414] transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007CF7] disabled:opacity-40"
          >
            <Send className="h-3 w-3" />
            <span>Enviar pergunta</span>
          </button>
        </div>
      </footer>
    </aside>
  );
};
