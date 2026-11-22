import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnConfinedProcess } from "../sandbox/process-confinement.ts";

export type RemotionCompositionId = "ReelsFaceless" | "ReelsTalkingHead";

export interface RemotionRenderParams {
  composicao: RemotionCompositionId;
  audio_path: string;
  legendas_srt_path?: string;
  output_path: string;
  props?: Record<string, unknown>;
  remotionProjectDir?: string;
  onProgress?: (percent: number, rawLine: string) => void;
}

export interface RemotionRenderResult {
  output_path: string;
  composicao: RemotionCompositionId;
  props_file_path: string;
  duration_ms: number;
}

/**
 * Monta os argumentos oficiais do CLI do Remotion para renderização MP4 1080x1920 a 30fps.
 */
export function buildRemotionCliArgs(
  params: RemotionRenderParams,
  propsFilePath: string
): string[] {
  return [
    "remotion",
    "render",
    "src/index.ts",
    params.composicao,
    params.output_path,
    "--codec=h264",
    "--width=1080",
    "--height=1920",
    "--fps=30",
    `--props=${propsFilePath}`,
  ];
}

/**
 * Ponte de renderização headless Remotion (@remotion/renderer / CLI) com streaming de progresso (0-100%).
 */
export async function executeRemotionRender(
  params: RemotionRenderParams
): Promise<RemotionRenderResult> {
  const startedAt = Date.now();
  mkdirSync(dirname(params.output_path), { recursive: true });

  const propsFilePath = join(
    dirname(params.output_path),
    `${params.composicao.toLowerCase()}-props.json`
  );

  const renderProps = {
    audioPath: params.audio_path,
    subtitlesSrtPath: params.legendas_srt_path ?? null,
    width: 1080,
    height: 1920,
    fps: 30,
    ...(params.props ?? {}),
  };
  writeFileSync(propsFilePath, JSON.stringify(renderProps, null, 2), "utf8");

  const args = buildRemotionCliArgs(params, propsFilePath);
  const cwd = params.remotionProjectDir ?? process.cwd();

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const { child, dispose } = spawnConfinedProcess({
      command: "npx",
      args,
      workspaceRoot: cwd,
      requestedCwd: cwd,
      shell: process.platform === "win32",
      timeoutMs: 10 * 60_000,
    });

    let stderrLog = "";
    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderrLog += text;
      const match = text.match(/(\d{1,3})%/);
      if (match && params.onProgress) {
        const pct = Math.min(100, Math.max(0, Number.parseInt(match[1], 10)));
        params.onProgress(pct, text.trim());
      }
    };

    child.stdout.on("data", handleOutput);
    child.stderr.on("data", handleOutput);

    child.on("error", (err) => {
      dispose();
      rejectPromise(
        new Error(`Falha ao iniciar processo Remotion CLI: ${err.message}`)
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        params.onProgress?.(100, "Renderização MP4 concluída");
        resolvePromise();
      } else {
        rejectPromise(
          new Error(
            `Remotion CLI encerrou com código ${code}. Detalhes: ${stderrLog.slice(-400)}`
          )
        );
      }
    });
  });

  return {
    output_path: params.output_path,
    composicao: params.composicao,
    props_file_path: propsFilePath,
    duration_ms: Date.now() - startedAt,
  };
}
