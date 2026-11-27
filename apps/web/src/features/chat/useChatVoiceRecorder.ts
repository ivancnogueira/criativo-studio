import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AnexoChat } from "@criativo/contracts";
import { daemonApi } from "../../services/websocket-client";
import {
  ClientVoiceVadTracker,
  encodeAudioBufferSegmentsToWavBlobs,
  MAX_CLIENT_DICTATION_SEC,
  SEGMENT_ROTATION_SEC,
} from "./voice-vad-chunker";

export interface UseChatVoiceRecorderParams {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onUploadFile: (file: File) => Promise<AnexoChat>;
  setDraft: Dispatch<SetStateAction<string>>;
  setPendingAttachments: Dispatch<SetStateAction<AnexoChat[]>>;
  setUploading: Dispatch<SetStateAction<boolean>>;
}

export function useChatVoiceRecorder({
  textareaRef,
  onUploadFile,
  setDraft,
  setPendingAttachments,
  setUploading,
}: UseChatVoiceRecorderParams) {
  const [listeningVoice, setListeningVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [transcribingVoice, setTranscribingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState<string | null>(null);
  const vadTrackerRef = useRef<ClientVoiceVadTracker | null>(null);
  const secondsRef = useRef(0);
  const [pendingFailedAudio, setPendingFailedAudio] = useState<{
    file: File;
    message: string;
  } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const voiceRafRef = useRef<number | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const cancelledRecordRef = useRef<boolean>(false);

  const cleanupVoiceCapture = () => {
    if (voiceRafRef.current !== null) {
      window.cancelAnimationFrame(voiceRafRef.current);
      voiceRafRef.current = null;
    }
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignora falha ao finalizar gravador no cleanup
      }
    }
    mediaRecorderRef.current = null;
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setRecordingLevel(0);
  };

  useEffect(() => {
    return () => {
      cancelledRecordRef.current = true;
      cleanupVoiceCapture();
    };
  }, []);

  const formatRecordingTimer = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const commaIdx = result.indexOf(",");
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
      };
      reader.onerror = () => reject(new Error("Falha ao ler o áudio gravado."));
      reader.readAsDataURL(blob);
    });

  const stopRecordingAndTranscribe = () => {
    cancelledRecordRef.current = false;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    } else {
      cleanupVoiceCapture();
      setListeningVoice(false);
    }
  };

  const cancelVoiceRecording = () => {
    cancelledRecordRef.current = true;
    setListeningVoice(false);
    setRecordingSeconds(0);
    cleanupVoiceCapture();
  };

  const handleAttachFailedAudio = async () => {
    if (!pendingFailedAudio) return;
    setUploading(true);
    try {
      const uploaded = await onUploadFile(pendingFailedAudio.file);
      setPendingAttachments((prev) => [...prev, uploaded]);
      setVoiceError(null);
      setPendingFailedAudio(null);
    } catch (err) {
      setVoiceError(
        err instanceof Error ? err.message : "Não foi possível anexar o arquivo de áudio."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleVoiceDictation = async () => {
    if (transcribingVoice) return;
    if (listeningVoice) {
      stopRecordingAndTranscribe();
      return;
    }
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Captura de microfone indisponível neste ambiente.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setVoiceError("MediaRecorder indisponível para gravação de áudio.");
      return;
    }

    setVoiceError(null);
    setPendingFailedAudio(null);
    cancelledRecordRef.current = false;
    recordChunksRef.current = [];
    secondsRef.current = 0;
    vadTrackerRef.current = new ClientVoiceVadTracker();
    setSpeechDetected(false);
    setTranscriptionProgress(null);
    setRecordingSeconds(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const chosenMime =
        mimeCandidates.find(
          (candidate) =>
            typeof MediaRecorder.isTypeSupported === "function" &&
            MediaRecorder.isTypeSupported(candidate)
        ) ?? "";

      const recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const sampleLevel = () => {
          if (!micStreamRef.current) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) sum += data[i];
          const avg = Math.min(100, Math.round((sum / Math.max(1, data.length)) * 1.6));
          setRecordingLevel(avg);
          const active = vadTrackerRef.current?.push(avg, performance.now()) ?? false;
          setSpeechDetected(active);
          voiceRafRef.current = window.requestAnimationFrame(sampleLevel);
        };
        voiceRafRef.current = window.requestAnimationFrame(sampleLevel);
      }

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const wasCancelled = cancelledRecordRef.current;
        const chunks = [...recordChunksRef.current];
        const mimeType = recorder.mimeType || chosenMime || "audio/webm";
        cleanupVoiceCapture();
        setListeningVoice(false);

        if (wasCancelled || chunks.length === 0) {
          setRecordingSeconds(0);
          return;
        }

        const audioBlob = new Blob(chunks, { type: mimeType });
        const vadSummary = vadTrackerRef.current?.getSummary();
        const durationSec = Math.min(secondsRef.current, MAX_CLIENT_DICTATION_SEC);
        if (vadSummary && !vadSummary.hasSpeech) {
          setRecordingSeconds(0);
          setTranscriptionProgress(null);
          setVoiceError("Nenhuma fala detectada (silêncio ignorado).");
          return;
        }
        setTranscribingVoice(true);
        try {
          let blobs: Blob[] = [audioBlob];
          let blobMime = mimeType;
          if (durationSec > SEGMENT_ROTATION_SEC || audioBlob.size > 4 * 1024 * 1024) {
            try {
              const ctx = new window.AudioContext();
              const decoded = await ctx.decodeAudioData(await audioBlob.arrayBuffer());
              void ctx.close().catch(() => undefined);
              blobs = await encodeAudioBufferSegmentsToWavBlobs(decoded, SEGMENT_ROTATION_SEC);
              blobMime = "audio/wav";
            } catch {
              blobs = [audioBlob];
            }
          }
          let anyText = false;
          for (let i = 0; i < blobs.length; i += 1) {
            setTranscriptionProgress(
              blobs.length > 1 ? `Transcrevendo bloco ${i + 1}/${blobs.length}...` : null
            );
            const base64 = await blobToBase64(blobs[i]!);
            const res = await daemonApi.transcribeAudio(base64, blobMime, {
              vadEnabled: true,
              clientSpeechMs: vadSummary?.speechMs,
              durationSec,
            });
            const cleanText = res.texto?.trim();
            if (cleanText) {
              anyText = true;
              setDraft((prev) => (prev.trim() ? `${prev.trim()} ${cleanText}` : cleanText));
            }
          }
          if (anyText) {
            window.requestAnimationFrame(() => textareaRef.current?.focus());
          } else {
            setVoiceError("Nenhuma fala foi detectada na gravação.");
          }
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : "Não foi possível transcrever o áudio. Verifique sua chave de transcrição em Conexões.";
          const audioFile = new File([audioBlob], "audio-pedido.webm", { type: mimeType });
          setVoiceError(msg);
          setPendingFailedAudio({ file: audioFile, message: msg });
        } finally {
          setTranscribingVoice(false);
          setTranscriptionProgress(null);
          setRecordingSeconds(0);
        }
      };

      recorder.start(250);
      setListeningVoice(true);
      recordTimerRef.current = window.setInterval(() => {
        secondsRef.current += 1;
        setRecordingSeconds((sec) => sec + 1);
        if (secondsRef.current >= MAX_CLIENT_DICTATION_SEC) {
          setTranscriptionProgress("Limite de 10 minutos atingido; transcrevendo gravação...");
          stopRecordingAndTranscribe();
        }
      }, 1000);
    } catch {
      cleanupVoiceCapture();
      setListeningVoice(false);
      setVoiceError(
        "Permissão de microfone negada ou dispositivo indisponível. Libere o acesso no sistema e tente novamente."
      );
    }
  };

  return {
    listeningVoice,
    recordingSeconds,
    recordingLevel,
    transcribingVoice,
    voiceError,
    speechDetected,
    transcriptionProgress,
    maxDurationSec: MAX_CLIENT_DICTATION_SEC,
    setVoiceError,
    pendingFailedAudio,
    setPendingFailedAudio,
    formatRecordingTimer,
    stopRecordingAndTranscribe,
    cancelVoiceRecording,
    handleAttachFailedAudio,
    handleVoiceDictation,
  };
}
