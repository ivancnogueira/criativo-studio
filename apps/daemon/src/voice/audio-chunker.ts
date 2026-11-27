import { parseWavHeader } from "./voice-vad.ts";

/** Teto de ditado: 10 minutos. */
export const MAX_DICTATION_DURATION_SEC = 600;
/** Tamanho padrão de cada bloco enviado ao STT. */
export const DEFAULT_CHUNK_DURATION_SEC = 90;
const MAX_SINGLE_UPLOAD_BYTES = 15 * 1024 * 1024;

export interface WavChunkResult {
  chunks: Buffer[];
  totalDurationSec: number;
}

function buildWavHeader(
  pcmLength: number,
  channels: number,
  sampleRate: number,
  bitsPerSample: number,
  audioFormat: number
): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = (channels * bitsPerSample) / 8;
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(audioFormat, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmLength, 40);
  return header;
}

/**
 * Fatia um WAV PCM em blocos `<= maxChunkSec` com sobreposição curta.
 * Rejeita áudios acima de 10 minutos com o prefixo `CRV-VOICE-DURATION:`.
 */
export function splitWavPcmIntoChunks(
  wavBuffer: Buffer,
  maxChunkSec = DEFAULT_CHUNK_DURATION_SEC,
  overlapSec = 0.4
): WavChunkResult {
  const wav = parseWavHeader(wavBuffer);
  if (!wav) {
    throw new Error("Áudio WAV inválido para fatiamento.");
  }
  const blockAlign = (wav.channels * wav.bitsPerSample) / 8;
  const bytesPerSec = wav.sampleRate * blockAlign;
  const totalDurationSec = wav.dataLength / bytesPerSec;

  if (totalDurationSec > MAX_DICTATION_DURATION_SEC) {
    throw new Error(
      `CRV-VOICE-DURATION: ditado de ${Math.ceil(totalDurationSec)}s excede o limite de ${MAX_DICTATION_DURATION_SEC}s (10 minutos).`
    );
  }
  if (totalDurationSec <= maxChunkSec) {
    return { chunks: [wavBuffer], totalDurationSec };
  }

  const align = (bytes: number) => Math.floor(bytes / blockAlign) * blockAlign;
  const chunkBytes = align(maxChunkSec * bytesPerSec);
  const stepBytes = Math.max(blockAlign, align((maxChunkSec - overlapSec) * bytesPerSec));
  const chunks: Buffer[] = [];

  for (let start = 0; start < wav.dataLength; start += stepBytes) {
    const end = Math.min(wav.dataLength, start + chunkBytes);
    const pcm = wavBuffer.subarray(wav.dataOffset + start, wav.dataOffset + end);
    chunks.push(
      Buffer.concat([
        buildWavHeader(pcm.length, wav.channels, wav.sampleRate, wav.bitsPerSample, wav.audioFormat),
        pcm,
      ])
    );
    if (end >= wav.dataLength) break;
  }

  return { chunks, totalDurationSec };
}

/**
 * Prepara o áudio para transcrição: WAV longo é fatiado; containers comprimidos seguem em bloco único
 * (o cliente já fatia em WAVs de até 90s) desde que caibam no limite de 15 MB.
 */
export function splitAudioBufferForTranscription(
  buffer: Buffer,
  mimeType: string,
  options: { maxChunkSec?: number } = {}
): Buffer[] {
  if (parseWavHeader(buffer)) {
    return splitWavPcmIntoChunks(buffer, options.maxChunkSec ?? DEFAULT_CHUNK_DURATION_SEC).chunks;
  }
  if (buffer.length > MAX_SINGLE_UPLOAD_BYTES) {
    throw new Error(
      `CRV-VOICE-DURATION: áudio ${mimeType} maior que 15 MB não pode ser fatiado sem WAV. Grave em blocos menores.`
    );
  }
  return [buffer];
}
