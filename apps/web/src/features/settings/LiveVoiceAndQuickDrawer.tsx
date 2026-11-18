import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AgenteRegistro, AvatarShape } from "@criativo/contracts";
import { ChevronRight, Mic, PanelRightClose, PanelRightOpen, Radio, Square } from "lucide-react";
import { MascoteAvatar, getDefaultMascotForAgent } from "../../components/MascoteAvatar";

type LiveVoiceState = "ouvindo" | "processando" | "falando";

export interface LiveVoiceBarProps {
  active: boolean;
  agentName: string;
  processing?: boolean;
  lastAssistantReply?: string | null;
  speechRate?: number;
  autoRead?: boolean;
  vadSilenceMs?: number;
  onSendTranscript: (texto: string) => Promise<void> | void;
  onClose: () => void;
}

/**
 * Barra Web de Voz Contínua (getUserMedia + AudioContext VAD + Web Speech / SpeechSynthesis).
 */
export const LiveVoiceBar: React.FC<LiveVoiceBarProps> = ({
  active,
  agentName,
  processing = false,
  lastAssistantReply = null,
  speechRate = 1,
  autoRead = true,
  vadSilenceMs = 1200,
  onSendTranscript,
  onClose,
}) => {
  const [voiceState, setVoiceState] = useState<LiveVoiceState>("ouvindo");
  const [audioLevel, setAudioLevel] = useState(0);
  const [interimText, setInterimText] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const pendingTranscriptRef = useRef<string>("");
  const lastSpokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (processing) {
      setVoiceState("processando");
    } else if (voiceState === "processando") {
      setVoiceState("ouvindo");
    }
  }, [processing, voiceState]);

  useEffect(() => {
    if (!active || (!autoRead && !active) || !lastAssistantReply) return;
    if (lastSpokenRef.current === lastAssistantReply) return;
    lastSpokenRef.current = lastAssistantReply;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(lastAssistantReply.slice(0, 600));
      utter.lang = "pt-BR";
      utter.rate = Math.min(1.5, Math.max(0.75, speechRate));
      utter.onstart = () => setVoiceState("falando");
      utter.onend = () => setVoiceState("ouvindo");
      utter.onerror = () => setVoiceState("ouvindo");
      window.speechSynthesis.speak(utter);
    } catch {
      setVoiceState("ouvindo");
    }
  }, [active, autoRead, lastAssistantReply, speechRate]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let recognition: {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
      onerror: (() => void) | null;
      start: () => void;
      stop: () => void;
    } | null = null;

    const flushPendingTurn = async () => {
      const text = pendingTranscriptRef.current.trim();
      if (!text) return;
      pendingTranscriptRef.current = "";
      setInterimText("");
      setVoiceState("processando");
      await onSendTranscript(text);
    };

    const startMic = async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setMicError("Captura de microfone indisponível neste navegador.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);

          const tick = () => {
            if (cancelled) return;
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i += 1) sum += data[i];
            const avg = Math.min(100, Math.round((sum / Math.max(1, data.length)) * 1.4));
            setAudioLevel(avg);
            if (avg > 14 && silenceTimerRef.current) {
              window.clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
            if (avg <= 14 && pendingTranscriptRef.current.trim() && !silenceTimerRef.current) {
              silenceTimerRef.current = window.setTimeout(() => {
                silenceTimerRef.current = null;
                void flushPendingTurn();
              }, vadSilenceMs);
            }
            rafRef.current = window.requestAnimationFrame(tick);
          };
          rafRef.current = window.requestAnimationFrame(tick);
        }

        const w = window as unknown as {
          SpeechRecognition?: new () => NonNullable<typeof recognition>;
          webkitSpeechRecognition?: new () => NonNullable<typeof recognition>;
        };
        const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
        if (SpeechRec) {
          recognition = new SpeechRec();
          recognition.lang = "pt-BR";
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.onresult = (ev) => {
            let full = "";
            for (let i = 0; i < ev.results.length; i += 1) {
              full += ` ${ev.results[i]?.[0]?.transcript ?? ""}`;
            }
            const clean = full.trim();
            pendingTranscriptRef.current = clean;
            setInterimText(clean);
            if (silenceTimerRef.current) {
              window.clearTimeout(silenceTimerRef.current);
            }
            silenceTimerRef.current = window.setTimeout(() => {
              silenceTimerRef.current = null;
              void flushPendingTurn();
            }, vadSilenceMs);
          };
          recognition.onerror = () => {
            setMicError("Reconhecimento de fala pausado; aguarde ou reinicie a sessão.");
          };
          recognition.start();
        }
      } catch {
        setMicError("Permissão de microfone recusada para Live Voice.");
      }
    };

    void startMic();

    return () => {
      cancelled = true;
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      try {
        recognition?.stop();
      } catch {
        // Ignore cleanup failure
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => undefined);
        audioCtxRef.current = null;
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [active, onSendTranscript, vadSilenceMs]);

  if (!active) return null;

  const statusText =
    voiceState === "falando"
      ? "Falando resposta..."
      : voiceState === "processando"
        ? "Processando resposta..."
        : "Ouvindo você...";

  return (
    <div
      data-testid="live-voice-bar"
      className="mx-5 mb-2 rounded-xl border border-[#007CF7]/60 bg-[#212121] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-lg"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="h-8 w-8 rounded-full bg-[#007CF7]/20 text-[#42A0FF] flex items-center justify-center shrink-0">
          {voiceState === "ouvindo" ? (
            <Mic className="h-4 w-4 animate-pulse" />
          ) : (
            <Radio className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
            <span>{statusText}</span>
            <span className="text-[11px] text-[#979797] font-normal">· {agentName}</span>
          </div>
          {micError ? (
            <p className="text-[11.5px] text-[#FF7675] truncate">{micError}</p>
          ) : interimText ? (
            <p className="text-[11.5px] text-[#DCDCDC] truncate">{interimText}</p>
          ) : (
            <div className="mt-1 h-1.5 w-44 rounded-full bg-[#141414] overflow-hidden">
              <div
                className="h-full bg-[#31CF76] transition-all"
                style={{ width: `${Math.max(8, audioLevel)}%` }}
              />
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1.5 rounded-full border border-[#FD2F3B]/50 bg-[#FD2F3B]/15 px-3 py-1.5 text-[12px] font-semibold text-[#FF7675] hover:bg-[#FD2F3B]/25 shrink-0"
      >
        <Square className="h-3 w-3 fill-current" />
        <span>Encerrar voz contínua</span>
      </button>
    </div>
  );
};

export interface QuickAgentDrawerProps {
  enabled: boolean;
  agentes: Array<AgenteRegistro & { nao_lidas?: number }>;
  pinnedIds: string[];
  selectedAgentId: string | null;
  onSelectAgent: (agenteId: string) => void;
}

/**
 * Drawer flutuante recolhível (versão Web do AgentDock) para trocar agentes fixados em 1 clique.
 */
export const QuickAgentDrawer: React.FC<QuickAgentDrawerProps> = ({
  enabled,
  agentes,
  pinnedIds,
  selectedAgentId,
  onSelectAgent,
}) => {
  const [expanded, setExpanded] = useState(false);

  const quickList = useMemo(() => {
    const byId = new Map(agentes.map((a) => [a.agente_id, a]));
    const pinned = pinnedIds
      .map((id) => byId.get(id))
      .filter((a): a is AgenteRegistro & { nao_lidas?: number } => Boolean(a));
    if (pinned.length > 0) return pinned.slice(0, 6);
    return agentes.slice(0, 6);
  }, [agentes, pinnedIds]);

  if (!enabled || quickList.length === 0) return null;

  return (
    <div
      data-testid="quick-agent-drawer"
      className="fixed right-3 bottom-4 z-30 flex items-end gap-2"
    >
      {expanded && (
        <div className="rounded-2xl border border-white/10 bg-[#212121]/95 backdrop-blur p-2 shadow-2xl flex items-center gap-1.5">
          {quickList.map((ag) => {
            const cfg = (ag.config ?? {}) as Record<string, unknown>;
            const fb = getDefaultMascotForAgent(ag.agente_id);
            const shape = (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : fb.shape) as AvatarShape;
            const color = typeof cfg.avatar_color === "string" ? cfg.avatar_color : fb.color;
            const selected = selectedAgentId === ag.agente_id;
            const working = ag.status === "trabalhando";
            const unread = ag.nao_lidas ?? 0;

            return (
              <button
                key={ag.agente_id}
                type="button"
                title={ag.nome}
                aria-label={`Abrir rapidamente ${ag.nome}`}
                onClick={() => onSelectAgent(ag.agente_id)}
                className={`relative rounded-xl p-1.5 transition-colors ${
                  selected ? "bg-[#007CF7]/25 ring-1 ring-[#007CF7]" : "hover:bg-[#2A2A2A]"
                }`}
              >
                <MascoteAvatar
                  shape={shape}
                  color={color}
                  size={30}
                  animated={working}
                  mood={working ? "working" : unread > 0 ? "waiting" : "idle"}
                />
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[#74B9FF] text-[#0D0D0D] text-[10px] font-bold flex items-center justify-center">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Recolher barra rápida"
            title="Recolher barra rápida"
            className="h-9 w-8 rounded-xl border border-white/[0.06] bg-[#141414] flex items-center justify-center text-[#979797] hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Abrir barra rápida"
          title="Abrir barra rápida de agentes"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#212121] px-3 py-2 text-[12px] font-semibold text-white shadow-xl hover:bg-[#2A2A2A]"
        >
          <PanelRightOpen className="h-3.5 w-3.5 text-[#42A0FF]" />
          <span>Barra rápida ({quickList.length})</span>
        </button>
      )}

      {expanded && (
        <span className="sr-only">
          <PanelRightClose />
        </span>
      )}
    </div>
  );
};
