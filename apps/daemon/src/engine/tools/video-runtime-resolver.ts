import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type NormalizedRemotionComposition = "ReelsFaceless" | "ReelsTalkingHead";

export interface FfmpegBinariesInfo {
  ffmpeg: string | null;
  ffprobe: string | null;
  available: boolean;
}

export interface VideoStudioProjectResolution {
  projectDir: string;
  entrypoint: string;
  remotionBin: string | null;
  provisionedNow: boolean;
}

const installLocks = new Map<string, Promise<void>>();

export function resolveRemotionCompositionId(raw: string): NormalizedRemotionComposition {
  const clean = String(raw ?? "").trim().toLowerCase();
  if (clean === "reelstalkinghead" || clean === "talkingheadreels" || clean === "talking-head") {
    return "ReelsTalkingHead";
  }
  return "ReelsFaceless";
}

function findBinaryOnSystem(name: string, extraDirs: string[]): string | null {
  const ext = process.platform === "win32" ? ".exe" : "";
  const fileName = name.endsWith(ext) ? name : `${name}${ext}`;
  const pathEnv = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean);
  for (const dir of [...extraDirs, ...pathEnv]) {
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveFfmpegBinaries(options?: { appDataDir?: string }): FfmpegBinariesInfo {
  const extraDirs: string[] = [];
  if (options?.appDataDir) {
    extraDirs.push(join(resolve(options.appDataDir), "runtimes", "ffmpeg", "bin"));
    extraDirs.push(join(resolve(options.appDataDir), "runtimes", "ffmpeg"));
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    extraDirs.push(join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"));
  }
  const ffmpeg = findBinaryOnSystem("ffmpeg", extraDirs);
  const ffprobe = findBinaryOnSystem("ffprobe", extraDirs);
  return {
    ffmpeg,
    ffprobe,
    available: Boolean(ffmpeg && ffprobe),
  };
}

function resolveProjectEntrypoint(projectDir: string): string {
  if (existsSync(join(projectDir, "src", "index.ts"))) return "src/index.ts";
  if (existsSync(join(projectDir, "src", "Root.tsx"))) return "src/Root.tsx";
  return "src/index.ts";
}

function resolveLocalRemotionBin(projectDir: string): string | null {
  const binName = process.platform === "win32" ? "remotion.cmd" : "remotion";
  const localBin = join(projectDir, "node_modules", ".bin", binName);
  return existsSync(localBin) ? localBin : null;
}

function hasRemotionInstalled(projectDir: string): boolean {
  return (
    existsSync(join(projectDir, "package.json")) &&
    existsSync(join(projectDir, "node_modules", "@remotion"))
  );
}

async function runNpmInstallInDir(targetDir: string): Promise<void> {
  const existing = installLocks.get(targetDir);
  if (existing) return existing;

  const promise = new Promise<void>((resolveInstall, rejectInstall) => {
    const isWin = process.platform === "win32";
    const child = spawn(
      isWin ? process.env.ComSpec || "cmd.exe" : "npm",
      isWin
        ? ["/c", "npm", "install", "--omit=dev", "--no-audit", "--no-fund"]
        : ["install", "--omit=dev", "--no-audit", "--no-fund"],
      {
        cwd: targetDir,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let errTail = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      rejectInstall(new Error("Tempo limite excedido ao provisionar dependências do Remotion."));
    }, 5 * 60_000);
    timer.unref?.();

    child.stderr.on("data", (c) => {
      errTail = (errTail + c.toString("utf8")).slice(-800);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectInstall(new Error(`Falha ao executar npm install para Remotion: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveInstall();
      else rejectInstall(new Error(`npm install Remotion falhou (código ${code}): ${errTail}`));
    });
  }).finally(() => {
    installLocks.delete(targetDir);
  });

  installLocks.set(targetDir, promise);
  return promise;
}

export async function ensureVideoStudioProject(options?: {
  appDataDir?: string;
  productRoot?: string;
  workspaceRoot?: string;
}): Promise<VideoStudioProjectResolution> {
  const workspaceRoot = resolve(options?.workspaceRoot ?? process.cwd());
  const runtimeBase = options?.appDataDir
    ? resolve(options.appDataDir, "runtimes", "video-studio")
    : resolve(workspaceRoot, "dados", "runtimes", "video-studio");

  const readyCandidates = [
    join(workspaceRoot, "video"),
    runtimeBase,
    resolve(workspaceRoot, "..", "criativo-video-studio", "modulo-video"),
  ];
  for (const cand of readyCandidates) {
    if (hasRemotionInstalled(cand)) {
      return {
        projectDir: cand,
        entrypoint: resolveProjectEntrypoint(cand),
        remotionBin: resolveLocalRemotionBin(cand),
        provisionedNow: false,
      };
    }
  }

  const templateCandidates = [
    options?.productRoot ? join(resolve(options.productRoot), "templates", "video-studio") : null,
    join(workspaceRoot, "templates", "video-studio"),
    process.env.CRIATIVO_PRODUCT_ROOT
      ? join(resolve(process.env.CRIATIVO_PRODUCT_ROOT), "templates", "video-studio")
      : null,
  ].filter((p): p is string => Boolean(p));

  const templateDir = templateCandidates.find((dir) => existsSync(join(dir, "package.json")));
  if (!templateDir) {
    throw new Error(
      "Template Remotion (templates/video-studio) não encontrado na instalação do CriativoOS."
    );
  }

  mkdirSync(dirname(runtimeBase), { recursive: true });
  cpSync(templateDir, runtimeBase, {
    recursive: true,
    force: true,
    filter: (src) => !src.includes("node_modules"),
  });

  await runNpmInstallInDir(runtimeBase);
  return {
    projectDir: runtimeBase,
    entrypoint: resolveProjectEntrypoint(runtimeBase),
    remotionBin: resolveLocalRemotionBin(runtimeBase),
    provisionedNow: true,
  };
}
