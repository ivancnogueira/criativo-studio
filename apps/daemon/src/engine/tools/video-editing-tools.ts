import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentAllowedFolder } from "@criativo/contracts";
import { isPathInsideAllowedFolders } from "../../server/tools/phase15-governance.ts";
import type { TranscriptionService } from "../../voice/transcription-service.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import { resolveFfmpegBinaries } from "./video-runtime-resolver.ts";

export interface VideoEditingToolContext {
  workspaceRoot: string;
  appDataDir?: string;
  allowedFolders?: readonly AgentAllowedFolder[];
  vault?: VaultService;
  transcription?: TranscriptionService;
}

export function resolveAuthorizedVideoInputPath(
  rawPath: string,
  ctx: { workspaceRoot: string; allowedFolders?: readonly AgentAllowedFolder[] }
): string {
  const trimmed = String(rawPath ?? "").trim().replace(/^["']|["']$/g, "");
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error("Caminho de vídeo inválido.");
  }
  const rootAbs = resolve(ctx.workspaceRoot);
  const absTarget = isAbsolute(trimmed) ? resolve(trimmed) : resolve(rootAbs, trimmed);

  const relToRoot = relative(rootAbs, absTarget);
  const insideWorkspace =
    relToRoot === "" ||
    (!relToRoot.startsWith("..") && !relToRoot.includes(`..${sep}`) && !isAbsolute(relToRoot));

  const insideAllowed =
    Boolean(ctx.allowedFolders && ctx.allowedFolders.length > 0) &&
    isPathInsideAllowedFolders(absTarget, ctx.allowedFolders!, "read");

  if (!insideWorkspace && !insideAllowed) {
    throw new Error(
      `Pasta não autorizada para leitura de vídeo ('${trimmed}'). Mova o arquivo para o workspace ou autorize a pasta em Inspetor do Agente → Pastas Autorizadas.`
    );
  }
  if (!existsSync(absTarget) || !statSync(absTarget).isFile()) {
    throw new Error(`Arquivo de mídia não encontrado em: ${absTarget}`);
  }
  return absTarget;
}

function runBin(
  bin: string,
  args: string[],
  timeoutMs = 10 * 60_000
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(bin, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      rejectRun(new Error(`Timeout ao executar ${basename(bin)} (${Math.round(timeoutMs / 1000)}s).`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (c) => {
      stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString("utf8");
      if (stderr.length > 512_000) stderr = stderr.slice(-256_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectRun(new Error(`Falha ao iniciar ${basename(bin)}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export async function videoInspectAndSilences(
  params: {
    input_path: string;
    noise_db?: number;
    min_silence_duration?: number;
  },
  ctx: VideoEditingToolContext
) {
  const bins = resolveFfmpegBinaries({ appDataDir: ctx.appDataDir });
  if (!bins.ffmpeg || !bins.ffprobe) {
    throw new Error("FFmpeg/FFprobe não encontrados no sistema nem em runtimes gerenciados.");
  }
  const absPath = resolveAuthorizedVideoInputPath(params.input_path, ctx);
  const probe = await runBin(
    bins.ffprobe,
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", absPath],
    60_000
  );
  if (probe.code !== 0) {
    throw new Error(`ffprobe falhou: ${probe.stderr.slice(-300)}`);
  }
  const parsed = JSON.parse(probe.stdout || "{}") as {
    format?: { duration?: string; size?: string; bit_rate?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }>;
  };
  const vStream = parsed.streams?.find((s) => s.codec_type === "video");
  const aStream = parsed.streams?.find((s) => s.codec_type === "audio");
  const durationSec = Number(parsed.format?.duration ?? 0);

  const noiseDb = Number.isFinite(params.noise_db) ? Number(params.noise_db) : -32;
  const minDur = Number.isFinite(params.min_silence_duration) ? Number(params.min_silence_duration) : 0.45;
  const silRes = await runBin(
    bins.ffmpeg,
    ["-i", absPath, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`, "-f", "null", "-"],
    180_000
  );

  const silences: Array<{ start: number; end: number; duration: number }> = [];
  let pendingStart: number | null = null;
  for (const line of silRes.stderr.split(/\r?\n/)) {
    const mStart = line.match(/silence_start:\s*([\d.]+)/);
    if (mStart) {
      pendingStart = Number(mStart[1]);
      continue;
    }
    const mEnd = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (mEnd) {
      const end = Number(mEnd[1]);
      const dur = Number(mEnd[2]);
      silences.push({
        start: pendingStart ?? Math.max(0, Number((end - dur).toFixed(3))),
        end,
        duration: dur,
      });
      pendingStart = null;
    }
  }

  return {
    ok: true,
    input_path: absPath,
    duration_seconds: Number.isFinite(durationSec) ? Number(durationSec.toFixed(3)) : 0,
    size_bytes: Number(parsed.format?.size ?? statSync(absPath).size),
    video: vStream
      ? {
          codec: vStream.codec_name ?? null,
          width: vStream.width ?? null,
          height: vStream.height ?? null,
          fps: vStream.r_frame_rate ?? null,
        }
      : null,
    audio: aStream ? { codec: aStream.codec_name ?? null } : null,
    silences_count: silences.length,
    silences,
  };
}

export async function videoTranscribeWords(
  params: { input_path: string; language?: string },
  ctx: VideoEditingToolContext
) {
  const bins = resolveFfmpegBinaries({ appDataDir: ctx.appDataDir });
  if (!bins.ffmpeg) {
    throw new Error("FFmpeg não encontrado para extração de áudio.");
  }
  const absPath = resolveAuthorizedVideoInputPath(params.input_path, ctx);
  const tmp = mkdtempSync(join(tmpdir(), "crv-transcribe-"));
  const audioPath = join(tmp, "audio-16k.mp3");

  try {
    const ext = await runBin(
      bins.ffmpeg,
      ["-y", "-i", absPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", audioPath],
      180_000
    );
    if (ext.code !== 0 || !existsSync(audioPath)) {
      throw new Error(`Falha ao extrair áudio para transcrição: ${ext.stderr.slice(-300)}`);
    }

    const audioBuf = readFileSync(audioPath);
    const groqKey =
      ctx.vault?.getSecret("GROQ_API_KEY") || ctx.vault?.getSecret("groq_api_key");

    if (groqKey && groqKey.trim()) {
      const form = new FormData();
      form.append("file", new Blob([audioBuf], { type: "audio/mpeg" }), "audio.mp3");
      form.append("model", "whisper-large-v3-turbo");
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "word");
      if (params.language) form.append("language", params.language);

      const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${groqKey.trim()}` },
        body: form,
      });
      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => "");
        throw new Error(`Groq Whisper HTTP ${resp.status}: ${errTxt.slice(0, 220)}`);
      }
      const data = (await resp.json()) as {
        text?: string;
        words?: Array<{ word?: string; start?: number; end?: number }>;
      };
      const words = (data.words ?? [])
        .filter((w) => typeof w.word === "string" && typeof w.start === "number" && typeof w.end === "number")
        .map((w) => ({ word: String(w.word).trim(), start: Number(w.start), end: Number(w.end) }));
      return {
        ok: true,
        provider: "groq-whisper-large-v3-turbo",
        text: String(data.text ?? "").trim(),
        words,
      };
    }

    if (ctx.transcription) {
      const text = await ctx.transcription.transcribeAudio(audioBuf, "audio/mpeg");
      return {
        ok: true,
        provider: "studio-transcription-fallback",
        text: text.trim(),
        words: [],
        aviso:
          "Transcrição completa gerada sem timestamps palavra-por-palavra (cadastre GROQ_API_KEY no Cofre para timestamps precisos).",
      };
    }

    throw new Error(
      "Nenhuma chave de transcrição disponível. Cadastre GROQ_API_KEY (gratuita) ou OPENAI_API_KEY no Cofre."
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function execFfmpegEdit(
  params: {
    input_path: string;
    output_filename?: string;
    keep_segments?: Array<{ start: number; end: number }>;
    subtitles_path?: string;
    background_music_path?: string;
    music_volume?: number;
    aspect?: "9:16" | "16:9" | "1:1" | "original";
  },
  ctx: VideoEditingToolContext
) {
  const bins = resolveFfmpegBinaries({ appDataDir: ctx.appDataDir });
  if (!bins.ffmpeg) {
    throw new Error("FFmpeg não encontrado no sistema.");
  }
  const absInput = resolveAuthorizedVideoInputPath(params.input_path, ctx);
  const absSubs = params.subtitles_path
    ? resolveAuthorizedVideoInputPath(params.subtitles_path, ctx)
    : null;
  const absMusic = params.background_music_path
    ? resolveAuthorizedVideoInputPath(params.background_music_path, ctx)
    : null;

  const outDir = resolve(ctx.workspaceRoot, "saidas", "videos");
  mkdirSync(outDir, { recursive: true });
  const rawOutName = (params.output_filename ?? `video-editado-${randomUUID().slice(0, 6)}.mp4`)
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
  const finalName = rawOutName.toLowerCase().endsWith(".mp4") ? rawOutName : `${rawOutName}.mp4`;
  const outAbs = join(outDir, finalName);

  const tmp = mkdtempSync(join(tmpdir(), "crv-ffmpeg-edit-"));
  const startedAt = Date.now();
  try {
    let workingInput = absInput;
    const segments = (params.keep_segments ?? []).filter(
      (s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start
    );
    if (segments.length > 0) {
      const partFiles: string[] = [];
      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i]!;
        const partPath = join(tmp, `part-${i}.ts`);
        const cut = await runBin(bins.ffmpeg, [
          "-y",
          "-ss",
          String(seg.start),
          "-to",
          String(seg.end),
          "-i",
          absInput,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-c:a",
          "aac",
          "-b:a",
          "160k",
          "-f",
          "mpegts",
          partPath,
        ]);
        if (cut.code !== 0) {
          throw new Error(`Falha ao cortar segmento ${i}: ${cut.stderr.slice(-260)}`);
        }
        partFiles.push(partPath);
      }
      const listPath = join(tmp, "concat.txt");
      writeFileSync(listPath, partFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
      const joinedPath = join(tmp, "joined.mp4");
      const concat = await runBin(bins.ffmpeg, [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        joinedPath,
      ]);
      if (concat.code !== 0) {
        throw new Error(`Falha ao concatenar segmentos: ${concat.stderr.slice(-260)}`);
      }
      workingInput = joinedPath;
    }

    const vFilters: string[] = [];
    if (params.aspect === "9:16") {
      vFilters.push("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920");
    } else if (params.aspect === "16:9") {
      vFilters.push("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080");
    } else if (params.aspect === "1:1") {
      vFilters.push("scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080");
    }
    if (absSubs) {
      const escapedSubs = absSubs.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
      vFilters.push(
        absSubs.toLowerCase().endsWith(".ass") ? `ass='${escapedSubs}'` : `subtitles='${escapedSubs}'`
      );
    }

    const args: string[] = ["-y", "-i", workingInput];
    if (absMusic) {
      args.push("-stream_loop", "-1", "-i", absMusic);
    }
    if (vFilters.length > 0) {
      args.push("-vf", vFilters.join(","));
    }
    if (absMusic) {
      const vol = Number.isFinite(params.music_volume) ? Math.min(1, Math.max(0.02, Number(params.music_volume))) : 0.12;
      args.push(
        "-filter_complex",
        `[1:a]volume=${vol}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
        "-map",
        "0:v:0",
        "-map",
        "[aout]"
      );
    }
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outAbs);

    const renderRes = await runBin(bins.ffmpeg, args, 15 * 60_000);
    if (renderRes.code !== 0 || !existsSync(outAbs)) {
      throw new Error(`FFmpeg falhou ao renderizar saída: ${renderRes.stderr.slice(-320)}`);
    }

    const relPath = `saidas/videos/${finalName}`;
    return {
      ok: true,
      output_path: outAbs,
      caminho_relativo: relPath,
      url: `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`,
      tamanho_bytes: statSync(outAbs).size,
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
