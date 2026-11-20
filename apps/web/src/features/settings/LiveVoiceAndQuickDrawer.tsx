import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AgenteRegistro, AvatarShape } from "@criativo/contracts";
import { Mic, Pin, PinOff, Plus, Radio, Square } from "lucide-react";
import {
  MascoteAvatar,
  resolveAgentAvatarConfig,
} from "../../components/MascoteAvatar";

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
      onerror: ((ev?: { error?: string; message?: string }) => void) | null;
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
          recognition.onerror = (ev) => {
            const code = String(ev?.error ?? "");
            if (code === "network" || code === "service-not-allowed") {
              setMicError(
                "Reconhecimento nativo do navegador bloqueado/offline neste ambiente. Configure GEMINI_API_KEY ou OPENAI_API_KEY no Cofre e use o botão do microfone no chat."
              );
              try {
                recognition?.stop();
              } catch {
                // Ignora erro ao encerrar SpeechRecognition
              }
              return;
            }
            if (code === "not-allowed") {
              setMicError("Permissão de microfone recusada para Live Voice.");
              return;
            }
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

const AGENT_DOCK_PINNED_STORAGE_KEY = "criativo.agent_dock.pinned";

export interface QuickAgentDrawerProps {
  enabled: boolean;
  agentes: Array<AgenteRegistro & { nao_lidas?: number }>;
  pinnedIds: string[];
  selectedAgentId: string | null;
  onSelectAgent: (agenteId: string) => void;
  workingAgentIds?: Set<string> | ReadonlyArray<string>;
  pinned?: boolean;
  onTogglePinned?: () => void;
  onCreateAgent?: () => void;
}

/**
 * Ilha / Dock Lateral Vertical ancorado à direita (Fixo ou Recolhível com persistência local).
 */
export const QuickAgentDrawer: React.FC<QuickAgentDrawerProps> = ({
  enabled,
  agentes,
  pinnedIds,
  selectedAgentId,
  onSelectAgent,
  workingAgentIds,
  pinned,
  onTogglePinned,
  onCreateAgent,
}) => {
  const [localPinned, setLocalPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = window.localStorage.getItem(AGENT_DOCK_PINNED_STORAGE_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [hoveredOrOpen, setHoveredOrOpen] = useState(false);
  const [customTopPx, setCustomTopPx] = useState<number | null>(null);
  const dragTopStartRef = useRef<{ clientY: number; baseTop: number } | null>(null);

  const isPinned = pinned ?? localPinned;
  const handleTogglePin = () => {
    if (onTogglePinned) {
      onTogglePinned();
      return;
    }
    setLocalPinned((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(AGENT_DOCK_PINNED_STORAGE_KEY, String(next));
        } catch {
          // ignora erro de quota
        }
      }
      if (!next) setHoveredOrOpen(false);
      return next;
    });
  };

  const workingSet = useMemo(() => {
    if (!workingAgentIds) return new Set<string>();
    return workingAgentIds instanceof Set
      ? workingAgentIds
      : new Set<string>(workingAgentIds);
  }, [workingAgentIds]);

  const quickList = useMemo(() => {
    const byId = new Map(agentes.map((a) => [a.agente_id, a]));
    const pinnedList = pinnedIds
      .map((id) => byId.get(id))
      .filter((a): a is AgenteRegistro & { nao_lidas?: number } => Boolean(a));
    if (pinnedList.length > 0) return pinnedList.slice(0, 7);
    return agentes.slice(0, 7);
  }, [agentes, pinnedIds]);

  if (!enabled || quickList.length === 0) return null;

  const isVisible = isPinned || hoveredOrOpen;

  return (
    <div
      data-testid="quick-agent-drawer"
      onMouseEnter={() => {
        if (!isPinned) setHoveredOrOpen(true);
      }}
      onMouseLeave={() => {
        if (!isPinned) setHoveredOrOpen(false);
      }}
      style={customTopPx !== null ? { top: `${customTopPx}px`, transform: "none" } : undefined}
      className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex items-center"
    >
      {!isVisible && (
        <button
          type="button"
          onClick={() => setHoveredOrOpen(true)}
          aria-label="Expandir ilha lateral de agentes"
          title="Expandir ilha lateral de agentes"
          className="h-24 w-3.5 rounded-l-[24px] border border-r-0 border-[var(--studio-border)] bg-[#1B1B1E]/95 backdrop-blur-xl shadow-2xl flex items-center justify-center hover:w-5 hover:bg-[#242428] transition-all"
        >
          <span className="h-8 w-1 rounded-full bg-[#42A0FF]/70" />
        </button>
      )}

      {isVisible && (
        <div className="rounded-l-[24px] border border-r-0 border-[var(--studio-border)] bg-[#1B1B1E]/95 backdrop-blur-xl shadow-2xl px-2 py-2.5 flex flex-col items-center gap-2">
          <div
            onPointerDown={(e) => {
              const rect = e.currentTarget.parentElement?.getBoundingClientRect();
              dragTopStartRef.current = {
                clientY: e.clientY,
                baseTop: customTopPx ?? rect?.top ?? Math.round(window.innerHeight * 0.35),
              };
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragTopStartRef.current) return;
              const nextTop = Math.max(
                56,
                Math.min(
                  window.innerHeight - 240,
                  dragTopStartRef.current.baseTop + (e.clientY - dragTopStartRef.current.clientY)
                )
              );
              setCustomTopPx(Math.round(nextTop));
            }}
            onPointerUp={() => {
              dragTopStartRef.current = null;
            }}
            title="Arrastar posição vertical da ilha"
            className="w-8 h-2.5 flex items-center justify-center cursor-ns-resize"
          >
            <span className="h-1 w-5 rounded-full bg-white/20" />
          </div>
          <button
            type="button"
            onClick={handleTogglePin}
            title={isPinned ? "Recolher ilha lateral" : "Fixar ilha na lateral"}
            aria-label={isPinned ? "Recolher ilha lateral" : "Fixar ilha na lateral"}
            className="h-7 w-7 rounded-full border border-white/[0.08] bg-[#141414]/80 hover:bg-[#2A2A2E] flex items-center justify-center text-[#979797] hover:text-white transition-colors"
          >
            {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5 text-[#42A0FF]" />}
          </button>

          <div className="flex flex-col items-center gap-1.5">
            {quickList.map((ag) => {
              const vis = resolveAgentAvatarConfig(ag);
              const selected = selectedAgentId === ag.agente_id;
              const working = workingSet.has(ag.agente_id) || ag.status === "trabalhando";
              const unread = ag.nao_lidas ?? 0;

              return (
                <button
                  key={ag.agente_id}
                  type="button"
                  title={ag.nome}
                  aria-label={`Abrir rapidamente ${ag.nome}`}
                  onClick={() => onSelectAgent(ag.agente_id)}
                  className={`group relative rounded-2xl p-1.5 transition-all ${
                    selected
                      ? "bg-[#007CF7]/25 ring-1 ring-[#007CF7]"
                      : "hover:bg-[#2A2A2E]"
                  }`}
                >
                  {selected && (
                    <span className="absolute -left-1 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-[#42A0FF]" />
                  )}
                  <MascoteAvatar
                    avatar={vis}
                    agentKey={ag.agente_id}
                    size={34}
                    animated={working}
                    mood={working ? "working" : unread > 0 ? "waiting" : "idle"}
                  />
                  {unread > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[#74B9FF] text-[#0D0D0D] text-[10px] font-bold flex items-center justify-center">
                      {unread}
                    </span>
                  )}
                  <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#141414] px-2.5 py-1 text-[11.5px] font-medium text-white shadow-xl">
                    {ag.nome}
                  </span>
                </button>
              );
            })}
          </div>

          {onCreateAgent && (
            <button
              type="button"
              onClick={onCreateAgent}
              title="Criar novo agente"
              aria-label="Criar novo agente"
              className="mt-0.5 h-8 w-8 rounded-full border border-white/10 bg-[#141414]/90 hover:bg-[#007CF7]/20 hover:border-[#007CF7]/50 flex items-center justify-center text-[#979797] hover:text-white transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
