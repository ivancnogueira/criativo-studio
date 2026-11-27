/**
 * VAD (Voice Activity Detection) pré-transcrição — Fase 43 (UX43-03).
 * Zero dependências nativas: analisa WAV PCM16/PCM32/Float32 por energia RMS em janelas de 20 ms
 * e valida containers comprimidos (webm/ogg/mp3/m4a) por tamanho mínimo e entropia de bytes.
 */

export interface VadAnalysisResult {
  hasSpeech: boolean;
  speechMs: number;
  durationMs: number;
  peakDbfs: number;
  rmsDbfs: number;
  activeFrameRatio: number;
  reason: string;
}

export const VAD_MIN_SPEECH_MS = 250;
export const VAD_MIN_ACTIVE_RATIO = 0.03;
export const VAD_ABSOLUTE_FLOOR_DBFS = -44;
const VAD_FRAME_MS = 20;
const MIN_COMPRESSED_BYTES = 1200;
const SILENCE_DBFS = -100;

function toDbfs(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 1e-6) return SILENCE_DBFS;
  return Math.max(SILENCE_DBFS, 20 * Math.log10(linear));
}

export interface ParsedWav {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

/** Localiza os chunks `fmt ` e `data` de um container RIFF/WAVE. Retorna null se não for WAV válido. */
export function parseWavHeader(buf: Buffer): ParsedWav | null {
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let fmt: Omit<ParsedWav, "dataOffset" | "dataLength"> | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= buf.length) {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: Math.max(1, buf.readUInt16LE(body + 2)),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data" && fmt) {
      const available = Math.max(0, Math.min(size, buf.length - body));
      return { ...fmt, dataOffset: body, dataLength: available };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

function readSample(buf: Buffer, pos: number, wav: ParsedWav): number {
  if (wav.audioFormat === 3 && wav.bitsPerSample === 32) return buf.readFloatLE(pos);
  if (wav.bitsPerSample === 16) return buf.readInt16LE(pos) / 32768;
  if (wav.bitsPerSample === 32) return buf.readInt32LE(pos) / 2147483648;
  if (wav.bitsPerSample === 8) return (buf.readUInt8(pos) - 128) / 128;
  return 0;
}

function analyzeWav(buf: Buffer, wav: ParsedWav): VadAnalysisResult {
  const bytesPerSample = wav.bitsPerSample / 8;
  const frameBytes = bytesPerSample * wav.channels;
  const totalFrames = Math.floor(wav.dataLength / frameBytes);
  const durationMs = Math.round((totalFrames / wav.sampleRate) * 1000);
  const windowFrames = Math.max(1, Math.round((wav.sampleRate * VAD_FRAME_MS) / 1000));
  const windows: number[] = [];
  let peak = 0;
  let sumSq = 0;

  for (let start = 0; start < totalFrames; start += windowFrames) {
    const end = Math.min(totalFrames, start + windowFrames);
    let acc = 0;
    for (let f = start; f < end; f += 1) {
      const pos = wav.dataOffset + f * frameBytes;
      let mono = 0;
      for (let c = 0; c < wav.channels; c += 1) mono += readSample(buf, pos + c * bytesPerSample, wav);
      mono /= wav.channels;
      acc += mono * mono;
      const abs = Math.abs(mono);
      if (abs > peak) peak = abs;
    }
    sumSq += acc;
    windows.push(Math.sqrt(acc / Math.max(1, end - start)));
  }

  if (windows.length === 0) {
    return {
      hasSpeech: false,
      speechMs: 0,
      durationMs,
      peakDbfs: SILENCE_DBFS,
      rmsDbfs: SILENCE_DBFS,
      activeFrameRatio: 0,
      reason: "audio_vazio",
    };
  }

  const dbWindows = windows.map(toDbfs);
  const sorted = [...dbWindows].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] ?? SILENCE_DBFS;
  const threshold = Math.max(noiseFloor + 8, VAD_ABSOLUTE_FLOOR_DBFS);
  const activeFrames = dbWindows.filter((db) => db > threshold).length;
  const speechMs = activeFrames * VAD_FRAME_MS;
  const activeFrameRatio = activeFrames / windows.length;
  const hasSpeech = speechMs >= VAD_MIN_SPEECH_MS && activeFrameRatio >= VAD_MIN_ACTIVE_RATIO;

  return {
    hasSpeech,
    speechMs,
    durationMs,
    peakDbfs: toDbfs(peak),
    rmsDbfs: toDbfs(Math.sqrt(sumSq / Math.max(1, totalFrames))),
    activeFrameRatio,
    reason: hasSpeech ? "fala_detectada" : "silencio_ou_ruido",
  };
}

function byteEntropy(buf: Buffer): number {
  const sample = buf.subarray(0, Math.min(buf.length, 65_536));
  const counts = new Array<number>(256).fill(0);
  for (const b of sample) counts[b] += 1;
  let entropy = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / sample.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Analisa o áudio e decide se existe fala real antes de gastar cota de STT.
 */
export function analyzeAudioVoiceActivity(buffer: Buffer, mimeType: string): VadAnalysisResult {
  const wav = parseWavHeader(buffer);
  if (wav) return analyzeWav(buffer, wav);

  if (buffer.length < MIN_COMPRESSED_BYTES) {
    return {
      hasSpeech: false,
      speechMs: 0,
      durationMs: 0,
      peakDbfs: SILENCE_DBFS,
      rmsDbfs: SILENCE_DBFS,
      activeFrameRatio: 0,
      reason: `container_muito_curto:${mimeType}`,
    };
  }
  if (byteEntropy(buffer) < 1.0) {
    return {
      hasSpeech: false,
      speechMs: 0,
      durationMs: 0,
      peakDbfs: SILENCE_DBFS,
      rmsDbfs: SILENCE_DBFS,
      activeFrameRatio: 0,
      reason: "payload_repetitivo",
    };
  }
  // Container comprimido plausível: sem decodificação nativa, delega ao cliente/STT (duração desconhecida).
  return {
    hasSpeech: true,
    speechMs: 0,
    durationMs: 0,
    peakDbfs: 0,
    rmsDbfs: 0,
    activeFrameRatio: 1,
    reason: "container_comprimido_nao_analisado",
  };
}

const PHANTOM_PHRASES = [
  "obrigado.",
  "obrigado",
  "obrigado por assistir",
  "obrigado por assistir!",
  "legendas pela comunidade",
  "legendas pela comunidade amara.org",
  "inscreva-se no canal",
  "inscreva-se no canal!",
];

/**
 * Remove frases fantasma típicas do Whisper quando o áudio tinha pouca energia vocal.
 */
export function sanitizeTranscriptHallucinations(text: string, analysis: VadAnalysisResult): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const lowEnergy = analysis.durationMs > 0 && analysis.speechMs < 550 && analysis.peakDbfs < -26;
  if (!lowEnergy) return trimmed;
  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
  return PHANTOM_PHRASES.includes(normalized) ? "" : trimmed;
}
