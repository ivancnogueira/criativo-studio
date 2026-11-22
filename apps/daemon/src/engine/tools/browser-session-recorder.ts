import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface BrowserRecordingSessionState {
  tabId: string;
  recording: boolean;
  recordingId: string | null;
  startedAt: string | null;
  framesCount: number;
  lastVideoPath: string | null;
  lastError: string | null;
}

interface ActiveRecording {
  recordingId: string;
  tabId: string;
  startedAt: string;
  framesDir: string;
  outputVideoPath: string;
  framesCount: number;
}

/**
 * Gravador de sessão do navegador baseado em captura sequencial de frames CDP
 * e consolidação para MP4 via ffmpeg na pasta `saidas/` do workspace.
 */
export class BrowserSessionRecorder {
  private readonly workspaceRoot: string;
  private readonly activeByTab = new Map<string, ActiveRecording>();
  private readonly lastStatusByTab = new Map<string, BrowserRecordingSessionState>();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  public startRecording(tabId: string): BrowserRecordingSessionState {
    if (!tabId.trim()) {
      throw new Error("tabId inválido para iniciar gravação.");
    }
    const existing = this.activeByTab.get(tabId);
    if (existing) {
      return this.getStatus(tabId);
    }

    const recordingId = `rec-${randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();
    const stamp = startedAt.replace(/[:.]/g, "-").slice(0, 19);
    const outDir = join(this.workspaceRoot, "saidas", "browser-gravacoes");
    const framesDir = join(outDir, `.frames-${recordingId}`);
    mkdirSync(framesDir, { recursive: true });

    const rec: ActiveRecording = {
      recordingId,
      tabId,
      startedAt,
      framesDir,
      outputVideoPath: join(outDir, `sessao-${stamp}-${recordingId}.mp4`),
      framesCount: 0,
    };
    this.activeByTab.set(tabId, rec);
    const state: BrowserRecordingSessionState = {
      tabId,
      recording: true,
      recordingId,
      startedAt,
      framesCount: 0,
      lastVideoPath: null,
      lastError: null,
    };
    this.lastStatusByTab.set(tabId, state);
    return state;
  }

  public appendDataUrlFrame(tabId: string, dataUrl: string): boolean {
    const rec = this.activeByTab.get(tabId);
    if (!rec) return false;
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(dataUrl.trim());
    if (!match) return false;
    const ext = match[1]!.toLowerCase() === "png" ? "png" : "jpg";
    const buf = Buffer.from(match[2]!, "base64");
    rec.framesCount += 1;
    const padded = String(rec.framesCount).padStart(5, "0");
    writeFileSync(join(rec.framesDir, `frame-${padded}.${ext}`), buf);

    const st = this.lastStatusByTab.get(tabId);
    if (st) {
      st.framesCount = rec.framesCount;
    }
    return true;
  }

  public stopRecording(tabId: string): BrowserRecordingSessionState {
    const rec = this.activeByTab.get(tabId);
    if (!rec) {
      return this.getStatus(tabId);
    }
    this.activeByTab.delete(tabId);

    let lastVideoPath: string | null = null;
    let lastError: string | null = null;

    if (rec.framesCount > 0) {
      // Detecta padrão png ou jpg conforme primeiro frame gravado
      const probeJpg = spawnSync(
        "ffmpeg",
        [
          "-y",
          "-framerate",
          "2",
          "-i",
          join(rec.framesDir, "frame-%05d.jpg"),
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-vf",
          "pad=ceil(iw/2)*2:ceil(ih/2)*2",
          rec.outputVideoPath,
        ],
        { encoding: "utf8", windowsHide: true }
      );
      if (probeJpg.status === 0) {
        lastVideoPath = rec.outputVideoPath;
      } else {
        const probePng = spawnSync(
          "ffmpeg",
          [
            "-y",
            "-framerate",
            "2",
            "-i",
            join(rec.framesDir, "frame-%05d.png"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            "pad=ceil(iw/2)*2:ceil(ih/2)*2",
            rec.outputVideoPath,
          ],
          { encoding: "utf8", windowsHide: true }
        );
        if (probePng.status === 0) {
          lastVideoPath = rec.outputVideoPath;
        } else {
          lastError =
            "Frames gravados, mas o ffmpeg não conseguiu gerar MP4 neste host. Verifique a instalação do ffmpeg.";
        }
      }
    } else {
      lastError = "Nenhum frame capturado durante a gravação.";
    }

    if (lastVideoPath) {
      try {
        rmSync(rec.framesDir, { recursive: true, force: true });
      } catch {
        // limpeza best-effort
      }
    }

    const finalState: BrowserRecordingSessionState = {
      tabId,
      recording: false,
      recordingId: rec.recordingId,
      startedAt: rec.startedAt,
      framesCount: rec.framesCount,
      lastVideoPath,
      lastError,
    };
    this.lastStatusByTab.set(tabId, finalState);
    return finalState;
  }

  public getStatus(tabId: string): BrowserRecordingSessionState {
    const active = this.activeByTab.get(tabId);
    if (active) {
      return {
        tabId,
        recording: true,
        recordingId: active.recordingId,
        startedAt: active.startedAt,
        framesCount: active.framesCount,
        lastVideoPath: null,
        lastError: null,
      };
    }
    return (
      this.lastStatusByTab.get(tabId) ?? {
        tabId,
        recording: false,
        recordingId: null,
        startedAt: null,
        framesCount: 0,
        lastVideoPath: null,
        lastError: null,
      }
    );
  }
}
