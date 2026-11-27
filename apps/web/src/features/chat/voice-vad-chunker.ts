/**
 * VAD em tempo real e fatiamento WAV no navegador — Fase 43 (UX43-03).
 */

export const MAX_CLIENT_DICTATION_SEC = 600;
export const SEGMENT_ROTATION_SEC = 90;
const MIN_SPEECH_MS = 250;
const CALIBRATION_MS = 300;

export interface ClientVadSummary {
  hasSpeech: boolean;
  speechMs: number;
  noiseFloor: number;
}

/**
 * Calibra o piso de ruído nos primeiros 300 ms e acumula apenas o tempo de fala acima do limiar.
 */
export class ClientVoiceVadTracker {
  private calibration: number[] = [];
  private calibrated = false;
  private noiseFloor = 0;
  private startedAt = 0;
  private lastTs = 0;
  private speechMs = 0;

  /** Registra uma amostra de nível (0..100). Retorna `true` quando há fala neste instante. */
  public push(level: number, nowMs: number): boolean {
    if (this.startedAt === 0) {
      this.startedAt = nowMs;
      this.lastTs = nowMs;
    }
    const delta = Math.max(0, Math.min(100, nowMs - this.lastTs));
    this.lastTs = nowMs;

    if (!this.calibrated) {
      this.calibration.push(level);
      if (nowMs - this.startedAt >= CALIBRATION_MS) {
        this.noiseFloor =
          this.calibration.reduce((a, b) => a + b, 0) / Math.max(1, this.calibration.length);
        this.calibrated = true;
      }
      return false;
    }

    const active = level >= Math.max(this.noiseFloor * 2.2, 8);
    if (active) this.speechMs += delta;
    return active;
  }

  public getSummary(): ClientVadSummary {
    return {
      hasSpeech: this.speechMs >= MIN_SPEECH_MS,
      speechMs: Math.round(this.speechMs),
      noiseFloor: this.noiseFloor,
    };
  }
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Decodifica o áudio gravado, converte para mono 16 kHz PCM16 e divide em WAVs de até `maxSegmentSec`.
 */
export async function encodeAudioBufferSegmentsToWavBlobs(
  audioBuffer: AudioBuffer,
  maxSegmentSec = SEGMENT_ROTATION_SEC
): Promise<Blob[]> {
  const targetRate = 16_000;
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) mono[i] += (data[i] ?? 0) / channels;
  }

  const ratio = audioBuffer.sampleRate / targetRate;
  const outLength = Math.floor(length / ratio);
  const resampled = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(length - 1, i0 + 1);
    const frac = pos - i0;
    resampled[i] = (mono[i0] ?? 0) * (1 - frac) + (mono[i1] ?? 0) * frac;
  }

  const segmentSamples = maxSegmentSec * targetRate;
  const blobs: Blob[] = [];
  for (let start = 0; start < outLength; start += segmentSamples) {
    blobs.push(
      encodeMonoPcm16Wav(resampled.subarray(start, Math.min(outLength, start + segmentSamples)), targetRate)
    );
  }
  return blobs;
}
