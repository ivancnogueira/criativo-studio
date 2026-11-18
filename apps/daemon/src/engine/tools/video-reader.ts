/**
 * Leitura estruturada de vídeos públicos (`read_video` — BRWS-03 / D-03).
 * Extrai metadados, legendas temporizadas (yt-dlp + fallback oEmbed/OpenGraph + fallback TranscriptionService)
 * e até 12 frames-chave JPEG via ffmpeg usando `spawn(..., { shell: false })` e limpeza garantida em `finally`.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReadVideoResult } from "@criativo/contracts";
import type { TranscriptionService } from "../../voice/transcription-service.ts";
import { assertSafeNavigationUrl } from "./browser-snapshot.ts";

export const MAX_VIDEO_DOWNLOAD_BYTES = 150 * 1024 * 1024; // 150 MB
export const MAX_VIDEO_FRAMES = 12;

export interface ReadVideoDeps {
  transcription?: TranscriptionService;
  spawnImpl?: typeof spawn;
  fetchImpl?: typeof fetch;
}

interface SpawnCaptureResult {
  code: number | null;
  stdout: string;
  stderr: string;
  notFound: boolean;
}

function runSpawnSafe(
  spawnFn: typeof spawn,
  command: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<SpawnCaptureResult> {
  return new Promise((resolvePromise) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let notFound = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolvePromise({ code: null, stdout: "", stderr: "spawn error", notFound: true });
      return;
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        resolvePromise({ code: null, stdout, stderr: `${stderr}\ntimeout`, notFound: false });
      }
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (stdout.length < 4 * 1024 * 1024) {
        stdout += chunk.toString();
      }
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length < 512 * 1024) {
        stderr += chunk.toString();
      }
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") notFound = true;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ code: null, stdout, stderr: err.message, notFound });
      }
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ code, stdout, stderr, notFound });
      }
    });
  });
}

function parseTimestampToSeconds(raw: string): number | null {
  const clean = raw.trim().replace(",", ".");
  const parts = clean.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) {
    return Math.round((parts[0]! * 3600 + parts[1]! * 60 + parts[2]!) * 10) / 10;
  }
  if (parts.length === 2) {
    return Math.round((parts[0]! * 60 + parts[1]!) * 10) / 10;
  }
  return null;
}

export function parseSubtitleContent(raw: string): Array<{ seconds: number; text: string }> {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const cues: Array<{ seconds: number; text: string }> = [];

  let currentSec: number | null = null;
  let currentText: string[] = [];

  const flush = () => {
    if (currentSec !== null && currentText.length > 0) {
      const joined = currentText
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (joined && (cues.length === 0 || cues[cues.length - 1]!.text !== joined)) {
        cues.push({ seconds: currentSec, text: joined });
      }
    }
    currentSec = null;
    currentText = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (trimmed === "WEBVTT" || /^\d+$/.test(trimmed) || trimmed.startsWith("NOTE")) {
      continue;
    }
    const arrowIdx = trimmed.indexOf("-->");
    if (arrowIdx > 0) {
      flush();
      const startToken = trimmed.slice(0, arrowIdx).trim().split(/\s+/)[0] ?? "";
      currentSec = parseTimestampToSeconds(startToken);
      continue;
    }
    if (currentSec !== null) {
      currentText.push(trimmed);
    }
  }
  flush();

  return cues.slice(0, 800);
}

async function fetchOpenGraphAndOEmbedFallback(
  targetUrl: URL,
  fetchFn: typeof fetch,
): Promise<{
  title: string;
  uploader: string | null;
  description: string | null;
}> {
  const host = targetUrl.hostname.toLowerCase();
  let oembedEndpoint: string | null = null;
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    oembedEndpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl.toString())}&format=json`;
  } else if (host.includes("tiktok.com")) {
    oembedEndpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(targetUrl.toString())}`;
  } else if (host.includes("vimeo.com")) {
    oembedEndpoint = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(targetUrl.toString())}`;
  }

  if (oembedEndpoint) {
    try {
      const oRes = await fetchFn(oembedEndpoint, {
        headers: { Accept: "application/json" },
      });
      if (oRes.ok) {
        const oJson = (await oRes.json()) as {
          title?: string;
          author_name?: string;
        };
        if (oJson.title) {
          return {
            title: oJson.title,
            uploader: oJson.author_name ?? null,
            description: null,
          };
        }
      }
    } catch {
      // segue para OpenGraph HTML
    }
  }

  try {
    const res = await fetchFn(targetUrl.toString(), {
      headers: {
        "User-Agent": "CriativoAIStudio-MediaReader/2.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = (await res.text()).slice(0, 250_000);
    const extractMeta = (prop: string): string | null => {
      const rx = new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
        "i",
      );
      const revRx = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
        "i",
      );
      const m = html.match(rx) ?? html.match(revRx);
      return m?.[1]?.trim() ?? null;
    };
    const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
    return {
      title: extractMeta("og:title") ?? titleTag ?? targetUrl.hostname,
      uploader: extractMeta("og:site_name"),
      description: extractMeta("og:description") ?? extractMeta("description"),
    };
  } catch {
    return {
      title: targetUrl.hostname,
      uploader: null,
      description: null,
    };
  }
}

export async function readVideoTool(
  params: { url: string; frames?: number; timeoutMs?: number },
  deps?: ReadVideoDeps,
): Promise<ReadVideoResult> {
  const safeUrl = assertSafeNavigationUrl(params.url);
  const requestedFrames = Math.min(
    Math.max(0, Math.round(params.frames ?? 6)),
    MAX_VIDEO_FRAMES,
  );
  const timeoutMs = Math.min(Math.max(5_000, params.timeoutMs ?? 45_000), 120_000);
  const spawnFn = deps?.spawnImpl ?? spawn;
  const fetchFn = deps?.fetchImpl ?? fetch;

  const tmpDir = mkdtempSync(join(tmpdir(), "criativo-video-"));

  try {
    const ytdlpCheck = await runSpawnSafe(spawnFn, "yt-dlp", ["--version"], 6_000);
    const ffmpegCheck = await runSpawnSafe(spawnFn, "ffmpeg", ["-version"], 6_000);
    const hasYtDlp = !ytdlpCheck.notFound && ytdlpCheck.code === 0;
    const hasFfmpeg = !ffmpegCheck.notFound && ffmpegCheck.code === 0;

    let title = safeUrl.hostname;
    let uploader: string | null = null;
    let webpageUrl: string | null = safeUrl.toString();
    let durationSeconds: number | null = null;
    let uploadDate: string | null = null;
    let viewCount: number | null = null;
    let likeCount: number | null = null;
    let commentCount: number | null = null;
    let description: string | null = null;
    let transcript: Array<{ seconds: number; text: string }> = [];
    const frames: string[] = [];
    let transcriptNote: string | undefined;
    let framesNote: string | undefined;

    if (hasYtDlp) {
      const subPrefix = join(tmpDir, "meta");
      const metaRun = await runSpawnSafe(
        spawnFn,
        "yt-dlp",
        [
          "--dump-single-json",
          "--no-playlist",
          "--write-subs",
          "--write-auto-subs",
          "--sub-langs",
          "pt,pt-BR,en",
          "--skip-download",
          "-o",
          subPrefix,
          safeUrl.toString(),
        ],
        timeoutMs,
      );

      if (metaRun.stdout.trim()) {
        try {
          const lines = metaRun.stdout.trim().split("\n");
          const jsonLine = lines.reverse().find((l) => l.trim().startsWith("{")) ?? metaRun.stdout;
          const meta = JSON.parse(jsonLine) as Record<string, unknown>;
          if (typeof meta.title === "string") title = meta.title;
          if (typeof meta.uploader === "string") uploader = meta.uploader;
          if (typeof meta.webpage_url === "string") webpageUrl = meta.webpage_url;
          if (typeof meta.duration === "number") durationSeconds = meta.duration;
          if (typeof meta.upload_date === "string") uploadDate = meta.upload_date;
          if (typeof meta.view_count === "number") viewCount = meta.view_count;
          if (typeof meta.like_count === "number") likeCount = meta.like_count;
          if (typeof meta.comment_count === "number") commentCount = meta.comment_count;
          if (typeof meta.description === "string") description = meta.description.slice(0, 4000);
        } catch {
          // ignora JSON parcial
        }
      }

      const files = readdirSync(tmpDir);
      const subFile = files.find((f) => f.endsWith(".vtt") || f.endsWith(".srt"));
      if (subFile) {
        const subRaw = readFileSync(join(tmpDir, subFile), "utf8");
        transcript = parseSubtitleContent(subRaw);
      }
    } else {
      const fb = await fetchOpenGraphAndOEmbedFallback(safeUrl, fetchFn);
      title = fb.title;
      uploader = fb.uploader;
      description = fb.description;
      transcriptNote =
        "Binário 'yt-dlp' não detectado no host; metadados extraídos via oEmbed/OpenGraph.";
    }

    const isDirectVideoUrl = /\.(mp4|webm|mov)(?:$|\?)/i.test(safeUrl.pathname);
    const needVideoDownload =
      requestedFrames > 0 || (transcript.length === 0 && Boolean(deps?.transcription));

    let localVideoPath: string | null = null;

    if (needVideoDownload && (hasYtDlp || isDirectVideoUrl)) {
      const targetVideoFile = join(tmpDir, "video.mp4");
      if (isDirectVideoUrl) {
        try {
          const vRes = await fetchFn(safeUrl.toString());
          if (vRes.ok) {
            const arrBuf = await vRes.arrayBuffer();
            if (arrBuf.byteLength <= MAX_VIDEO_DOWNLOAD_BYTES && arrBuf.byteLength > 0) {
              writeFileSync(targetVideoFile, Buffer.from(arrBuf));
              localVideoPath = targetVideoFile;
            }
          }
        } catch {
          localVideoPath = null;
        }
      } else if (hasYtDlp) {
        const dlRun = await runSpawnSafe(
          spawnFn,
          "yt-dlp",
          [
            "--no-playlist",
            "--max-filesize",
            "150M",
            "-f",
            "mp4[height<=720]/best[height<=720]/best",
            "-o",
            targetVideoFile,
            safeUrl.toString(),
          ],
          timeoutMs,
        );
        if (dlRun.code === 0 && existsSync(targetVideoFile)) {
          localVideoPath = targetVideoFile;
        } else {
          const anyVid = readdirSync(tmpDir).find((f) =>
            f.startsWith("video.") && /\.(mp4|webm|mkv)$/i.test(f),
          );
          if (anyVid) localVideoPath = join(tmpDir, anyVid);
        }
      }
    }

    // Extração de frames-chave via ffmpeg
    if (requestedFrames > 0) {
      if (!hasFfmpeg) {
        framesNote =
          "Binário 'ffmpeg' não detectado no host; extração de quadros-chave indisponível.";
      } else if (!localVideoPath || !existsSync(localVideoPath)) {
        framesNote =
          framesNote ?? "Arquivo de vídeo local não pôde ser baixado para extração de quadros.";
      } else {
        const effDuration = durationSeconds && durationSeconds > 0 ? durationSeconds : 12;
        for (let i = 0; i < requestedFrames; i += 1) {
          const tsSec = Math.max(0, Number(((effDuration * (i + 0.5)) / requestedFrames).toFixed(2)));
          const outFrame = join(tmpDir, `frame-${i}.jpg`);
          const ffRes = await runSpawnSafe(
            spawnFn,
            "ffmpeg",
            [
              "-y",
              "-ss",
              String(tsSec),
              "-i",
              localVideoPath,
              "-frames:v",
              "1",
              "-vf",
              "scale=720:-2",
              "-q:v",
              "5",
              outFrame,
            ],
            15_000,
          );
          if (ffRes.code === 0 && existsSync(outFrame)) {
            const jpgBuf = readFileSync(outFrame);
            frames.push(`data:image/jpeg;base64,${jpgBuf.toString("base64")}`);
          }
        }
      }
    }

    // Fallback de transcrição de áudio quando não havia legendas prontas
    if (transcript.length === 0 && hasFfmpeg && localVideoPath && deps?.transcription) {
      const audioPath = join(tmpDir, "audio.mp3");
      const audioExt = await runSpawnSafe(
        spawnFn,
        "ffmpeg",
        [
          "-y",
          "-i",
          localVideoPath,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-b:a",
          "48k",
          audioPath,
        ],
        25_000,
      );
      if (audioExt.code === 0 && existsSync(audioPath)) {
        try {
          const audioBuf = readFileSync(audioPath);
          const text = await deps.transcription.transcribeAudio(audioBuf, "audio/mpeg");
          if (text.trim()) {
            transcript = [{ seconds: 0, text: text.trim() }];
            transcriptNote = "Transcrição gerada a partir da faixa de áudio via TranscriptionService.";
          }
        } catch (err) {
          transcriptNote =
            err instanceof Error
              ? `Transcrição de áudio indisponível: ${err.message}`
              : "Transcrição de áudio indisponível.";
        }
      }
    } else if (transcript.length === 0 && !transcriptNote) {
      transcriptNote = "O vídeo não possui legendas públicas disponíveis.";
    }

    return {
      url: safeUrl.toString(),
      title,
      uploader,
      webpage_url: webpageUrl,
      durationSeconds,
      uploadDate,
      viewCount,
      likeCount,
      commentCount,
      description,
      transcript,
      frames,
      ...(transcriptNote ? { transcriptNote } : {}),
      ...(framesNote ? { framesNote } : {}),
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
