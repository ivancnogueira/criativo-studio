import { randomUUID } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { AnexoChat } from "@criativo/contracts";
import { executeRemotionRender } from "../../engine/tools/remotion-bridge.ts";
import {
  execFfmpegEdit,
  videoInspectAndSilences,
  videoTranscribeWords,
} from "../../engine/tools/video-editing-tools.ts";
import { resolveRemotionCompositionId } from "../../engine/tools/video-runtime-resolver.ts";
import { readAgentGovernance } from "./phase15-governance.ts";
import type { StudioExtensionToolDeps } from "./phase10-tools-schema.ts";
import { readStringArg } from "./studio-tool-helpers.ts";

export const VIDEO_STUDIO_TOOL_NAMES = new Set([
  "exec_remotion_render",
  "video_inspect_and_silences",
  "video_transcribe_words",
  "exec_ffmpeg_edit",
]);

export function isVideoStudioToolName(toolName: string): boolean {
  return VIDEO_STUDIO_TOOL_NAMES.has(toolName);
}

function registerGeneratedVideoAttachment(
  deps: StudioExtensionToolDeps,
  workspaceRoot: string,
  absPath: string
): AnexoChat {
  const rel = relative(resolve(workspaceRoot), absPath).replace(/\\/g, "/");
  const relPath =
    rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : `saidas/videos/${basename(absPath)}`;
  const fileName = basename(absPath);
  const sizeBytes = statSync(absPath).size;
  const arquivoId = `vid-${randomUUID().slice(0, 8)}`;
  const urlRaw = `/api/arquivos/raw?path=${encodeURIComponent(relPath)}`;

  deps.db.connection
    .prepare(
      `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
       VALUES (?, ?, ?, 'video/mp4', ?, 'video', ?, NULL, ?);`
    )
    .run(arquivoId, fileName, relPath, sizeBytes, deps.agenteId ?? null, new Date().toISOString());

  return {
    arquivo_id: arquivoId,
    nome: fileName,
    caminho_relativo: relPath,
    url: urlRaw,
    mime_type: "video/mp4",
    tamanho_bytes: sizeBytes,
    tipo_uso: "video",
  };
}

export async function executeVideoStudioTool(
  toolName: string,
  args: Record<string, unknown>,
  deps: StudioExtensionToolDeps,
  workspaceRoot: string
): Promise<unknown> {
  const governance = deps.agenteId ? readAgentGovernance(deps.db, deps.agenteId) : null;
  const toolCtx = {
    workspaceRoot,
    appDataDir: process.env.CRIATIVO_USER_DATA_DIR,
    allowedFolders: governance?.allowedFolders ?? [],
    vault: deps.vault,
    transcription: deps.transcription,
  };

  if (toolName === "video_inspect_and_silences") {
    const inputPath = readStringArg(args, "input_path");
    if (!inputPath) throw new Error("Parâmetro 'input_path' é obrigatório.");
    return await videoInspectAndSilences(
      {
        input_path: inputPath,
        noise_db: typeof args.noise_db === "number" ? args.noise_db : undefined,
        min_silence_duration:
          typeof args.min_silence_duration === "number" ? args.min_silence_duration : undefined,
      },
      toolCtx
    );
  }

  if (toolName === "video_transcribe_words") {
    const inputPath = readStringArg(args, "input_path");
    if (!inputPath) throw new Error("Parâmetro 'input_path' é obrigatório.");
    return await videoTranscribeWords(
      {
        input_path: inputPath,
        language: readStringArg(args, "language"),
      },
      toolCtx
    );
  }

  if (toolName === "exec_ffmpeg_edit") {
    const inputPath = readStringArg(args, "input_path");
    if (!inputPath) throw new Error("Parâmetro 'input_path' é obrigatório.");
    const rawSegs = Array.isArray(args.keep_segments) ? args.keep_segments : [];
    const keepSegments = rawSegs
      .filter((s): s is { start: number; end: number } =>
        Boolean(s && typeof s === "object" && typeof (s as { start?: unknown }).start === "number" && typeof (s as { end?: unknown }).end === "number")
      )
      .map((s) => ({ start: s.start, end: s.end }));
    const rawAspect = readStringArg(args, "aspect");
    const aspect =
      rawAspect === "9:16" || rawAspect === "16:9" || rawAspect === "1:1" || rawAspect === "original"
        ? rawAspect
        : undefined;

    const editRes = await execFfmpegEdit(
      {
        input_path: inputPath,
        output_filename: readStringArg(args, "output_filename"),
        keep_segments: keepSegments,
        subtitles_path: readStringArg(args, "subtitles_path"),
        background_music_path: readStringArg(args, "background_music_path"),
        music_volume: typeof args.music_volume === "number" ? args.music_volume : undefined,
        aspect,
      },
      toolCtx
    );
    const anexo = registerGeneratedVideoAttachment(deps, workspaceRoot, editRes.output_path);
    return { ...editRes, anexo };
  }

  if (toolName === "exec_remotion_render") {
    const rawComp = readStringArg(args, "composicao") ?? "ReelsFaceless";
    const composicao = resolveRemotionCompositionId(rawComp);
    const audioPath = readStringArg(args, "audio_path") ?? "";
    const outArg = readStringArg(args, "output_path");
    const outDir = resolve(workspaceRoot, "saidas", "videos");
    mkdirSync(outDir, { recursive: true });
    const outputAbs = outArg
      ? isAbsolute(outArg)
        ? resolve(outArg)
        : resolve(workspaceRoot, outArg)
      : join(outDir, `remotion-${composicao.toLowerCase()}-${randomUUID().slice(0, 6)}.mp4`);

    const renderRes = await executeRemotionRender({
      composicao,
      audio_path: audioPath,
      legendas_srt_path: readStringArg(args, "legendas_srt_path"),
      output_path: outputAbs,
      props: args.props && typeof args.props === "object" ? (args.props as Record<string, unknown>) : undefined,
      workspaceRoot,
      productRoot: deps.productRoot,
      appDataDir: process.env.CRIATIVO_USER_DATA_DIR,
    });
    const anexo = registerGeneratedVideoAttachment(deps, workspaceRoot, renderRes.output_path);
    return { ok: true, ...renderRes, anexo };
  }

  throw new Error(`Ferramenta de vídeo não suportada: ${toolName}`);
}
