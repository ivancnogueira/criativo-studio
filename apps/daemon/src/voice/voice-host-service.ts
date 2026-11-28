import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  VoiceExecutionMode,
  VoiceHostStatusSnapshot,
  VoiceModelDescriptor,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

const VOICE_CONFIG_KEY = "voice_host_config";

const DEFAULT_CATALOG: Array<Omit<VoiceModelDescriptor, "installed">> = [
  { modelId: "whisper-small-local", kind: "stt", label: "Whisper Small (PT-BR / Multi)", sizeMb: 465 },
  { modelId: "whisper-base-local", kind: "stt", label: "Whisper Base (Ultra Rápido)", sizeMb: 142 },
  { modelId: "piper-ptbr-faber", kind: "tts", label: "Piper PT-BR Neural", sizeMb: 63 },
];

interface PendingRpc {
  resolve: (data: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class VoiceHostService {
  private readonly db: CriativoDatabase;
  private readonly modelsDir: string;
  private readonly workerScriptPath: string;
  private worker: ChildProcess | null = null;
  private lastError: string | null = null;
  private readonly pending = new Map<string, PendingRpc>();
  private disposed = false;

  constructor(options: {
    db: CriativoDatabase;
    modelsDir?: string;
    workerScriptPath?: string;
  }) {
    this.db = options.db;
    this.modelsDir = resolve(options.modelsDir ?? join(process.cwd(), "dados", "voice-models"));
    const here = dirname(fileURLToPath(import.meta.url));
    const tsWorker = join(here, "voice-worker.ts");
    const jsWorker = join(here, "voice-worker.js");
    this.workerScriptPath = options.workerScriptPath ?? (existsSync(tsWorker) ? tsWorker : jsWorker);
  }

  public getSettings(): {
    mode: VoiceExecutionMode;
    activeSttModel: string;
    activeTtsVoice: string;
  } {
    try {
      const row = this.db.connection
        .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = ?;")
        .get(VOICE_CONFIG_KEY) as { valor_json: string } | undefined;
      if (!row?.valor_json) {
        return {
          mode: "auto",
          activeSttModel: "whisper-small-local",
          activeTtsVoice: "piper-ptbr-faber",
        };
      }
      const parsed = JSON.parse(row.valor_json) as {
        mode?: VoiceExecutionMode;
        activeSttModel?: string;
        activeTtsVoice?: string;
      };
      return {
        mode: parsed.mode === "local" || parsed.mode === "cloud" ? parsed.mode : "auto",
        activeSttModel: parsed.activeSttModel || "whisper-small-local",
        activeTtsVoice: parsed.activeTtsVoice || "piper-ptbr-faber",
      };
    } catch {
      return {
        mode: "auto",
        activeSttModel: "whisper-small-local",
        activeTtsVoice: "piper-ptbr-faber",
      };
    }
  }

  public updateSettings(patch: {
    mode?: VoiceExecutionMode;
    activeSttModel?: string;
    activeTtsVoice?: string;
  }): VoiceHostStatusSnapshot {
    const prev = this.getSettings();
    const next = {
      mode: patch.mode ?? prev.mode,
      activeSttModel: patch.activeSttModel?.trim() || prev.activeSttModel,
      activeTtsVoice: patch.activeTtsVoice?.trim() || prev.activeTtsVoice,
    };
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET
           valor_json = excluded.valor_json,
           atualizado_em = excluded.atualizado_em;`,
      )
      .run(VOICE_CONFIG_KEY, JSON.stringify(next), new Date().toISOString());
    return this.getStatus();
  }

  public listModels(): VoiceModelDescriptor[] {
    return DEFAULT_CATALOG.map((m) => ({
      ...m,
      installed: existsSync(join(this.modelsDir, `${m.modelId}.json`)),
    }));
  }

  public installLocalModel(modelId: string): VoiceModelDescriptor[] {
    const found = DEFAULT_CATALOG.find((m) => m.modelId === modelId);
    if (!found) {
      throw new Error(`Modelo de voz desconhecido: '${modelId}'.`);
    }
    mkdirSync(this.modelsDir, { recursive: true });
    writeFileSync(
      join(this.modelsDir, `${modelId}.json`),
      JSON.stringify({ ...found, installedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    return this.listModels();
  }

  public removeLocalModel(modelId: string): VoiceModelDescriptor[] {
    const target = join(this.modelsDir, `${modelId}.json`);
    if (existsSync(target)) {
      rmSync(target, { force: true });
    }
    return this.listModels();
  }

  private ensureWorker(): ChildProcess {
    if (this.worker && this.worker.connected) {
      return this.worker;
    }

    const child = fork(this.workerScriptPath, [], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      silent: true,
      ...({ windowsHide: true } as Record<string, unknown>),
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: process.env.NODE_ENV ?? "production",
      },
    });

    child.on("message", (msg: unknown) => {
      if (!msg || typeof msg !== "object" || !("id" in msg)) return;
      const rec = msg as Record<string, unknown>;
      const reqId = String(rec.id);
      const pending = this.pending.get(reqId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(reqId);
      if (rec.ok === false) {
        pending.reject(new Error(String(rec.error ?? "Erro no worker de voz local.")));
      } else {
        pending.resolve(rec);
      }
    });

    child.on("exit", (code) => {
      if (this.worker === child) {
        this.worker = null;
      }
      if (!this.disposed && code !== 0) {
        this.lastError = `Voice worker encerrou com código ${String(code)}.`;
      }
      for (const [id, p] of this.pending.entries()) {
        clearTimeout(p.timer);
        p.reject(new Error("Voice worker encerrou durante operação."));
        this.pending.delete(id);
      }
    });

    this.worker = child;
    this.lastError = null;
    return child;
  }

  private sendWorkerRequest(
    payload: Record<string, unknown>,
    timeoutMs = 15_000,
  ): Promise<Record<string, unknown>> {
    const child = this.ensureWorker();
    const id = `vrpc_${randomUUID().slice(0, 10)}`;

    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        try {
          child.kill("SIGKILL");
        } catch {
          // ignora
        }
        rejectPromise(new Error(`Timeout (${timeoutMs}ms) aguardando Voice Worker isolado.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });

      child.send({ id, ...payload });
    });
  }

  public async pingWorker(timeoutMs = 5_000): Promise<{ ok: boolean; pid: number | null }> {
    const res = await this.sendWorkerRequest({ action: "ping" }, timeoutMs);
    return {
      ok: true,
      pid: typeof res.pid === "number" ? res.pid : null,
    };
  }

  public async transcribeLocal(audioBuffer: Buffer, mimeType = "audio/ogg"): Promise<string> {
    const cfg = this.getSettings();
    const res = await this.sendWorkerRequest({
      action: "stt",
      modelsDir: this.modelsDir,
      modelId: cfg.activeSttModel,
      mimeType,
      audioBase64: audioBuffer.toString("base64"),
    });
    return String(res.transcript ?? "");
  }

  public async synthesizeLocal(text: string): Promise<Buffer> {
    const cfg = this.getSettings();
    const res = await this.sendWorkerRequest({
      action: "tts",
      modelsDir: this.modelsDir,
      modelId: cfg.activeTtsVoice,
      text,
    });
    return Buffer.from(String(res.audioBase64 ?? ""), "base64");
  }

  public getStatus(): VoiceHostStatusSnapshot {
    const cfg = this.getSettings();
    return {
      running: Boolean(this.worker && this.worker.connected),
      pid: this.worker?.pid ?? null,
      mode: cfg.mode,
      activeSttModel: cfg.activeSttModel,
      activeTtsVoice: cfg.activeTtsVoice,
      models: this.listModels(),
      lastError: this.lastError,
    };
  }

  public dispose(): void {
    this.disposed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("VoiceHostService encerrado."));
    }
    this.pending.clear();
    if (this.worker) {
      try {
        this.worker.kill("SIGKILL");
      } catch {
        // ignora
      }
      this.worker = null;
    }
  }
}
