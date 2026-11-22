import { randomUUID } from "node:crypto";
import type {
  TelemetrySampleEvent,
  TelemetryStatusSnapshot,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { redactTelemetryPayload, redactTelemetryString } from "./telemetry-redactor.ts";

const TELEMETRY_SETTINGS_KEY = "telemetria_opt_in_config";
const MAX_LOCAL_BUFFER = 50;

export class TelemetryService {
  private readonly db: CriativoDatabase;
  private readonly appVersion: string;
  private readonly buffer: TelemetrySampleEvent[] = [];

  constructor(db: CriativoDatabase, appVersion = "1.0.0") {
    this.db = db;
    this.appVersion = appVersion;
  }

  public isEnabled(): boolean {
    try {
      const row = this.db.connection
        .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = ?;")
        .get(TELEMETRY_SETTINGS_KEY) as { valor_json: string } | undefined;
      if (!row?.valor_json) return false;
      const parsed = JSON.parse(row.valor_json) as { telemetry_opt_in?: unknown };
      return parsed.telemetry_opt_in === true;
    } catch {
      return false;
    }
  }

  public setOptIn(enabled: boolean): TelemetryStatusSnapshot {
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET
           valor_json = excluded.valor_json,
           atualizado_em = excluded.atualizado_em;`,
      )
      .run(
        TELEMETRY_SETTINGS_KEY,
        JSON.stringify({ telemetry_opt_in: Boolean(enabled) }),
        now,
      );

    if (!enabled) {
      this.buffer.length = 0;
    }
    return this.getStatus();
  }

  public buildRedactedSample(params: {
    eventName: string;
    errorCode?: string | null;
    durationMs?: number | null;
    meta?: Record<string, unknown>;
  }): TelemetrySampleEvent {
    return {
      eventId: `tel_${randomUUID().slice(0, 10)}`,
      eventName: redactTelemetryString(params.eventName).slice(0, 80),
      appVersion: this.appVersion,
      platform: process.platform,
      errorCode: params.errorCode ? redactTelemetryString(params.errorCode).slice(0, 32) : null,
      durationMs:
        typeof params.durationMs === "number" && Number.isFinite(params.durationMs)
          ? Math.max(0, Math.round(params.durationMs))
          : null,
      meta: redactTelemetryPayload(params.meta ?? {}),
      createdAt: new Date().toISOString(),
    };
  }

  public recordEvent(params: {
    eventName: string;
    errorCode?: string | null;
    durationMs?: number | null;
    meta?: Record<string, unknown>;
  }): TelemetrySampleEvent | null {
    if (!this.isEnabled()) {
      return null;
    }
    const sample = this.buildRedactedSample(params);
    this.buffer.push(sample);
    if (this.buffer.length > MAX_LOCAL_BUFFER) {
      this.buffer.shift();
    }
    return sample;
  }

  public listBufferedEvents(): TelemetrySampleEvent[] {
    return [...this.buffer];
  }

  public getStatus(): TelemetryStatusSnapshot {
    const sample =
      this.buffer[this.buffer.length - 1] ??
      this.buildRedactedSample({
        eventName: "studio.diagnostic.preview",
        errorCode: "CRV-000",
        durationMs: 120,
        meta: {
          stage: "preview",
          examplePath: "C:\\Users\\Operador\\projeto",
        },
      });

    return {
      telemetryOptIn: this.isEnabled(),
      bufferedCount: this.buffer.length,
      lastSample: sample,
      collectedFields: ["eventName", "appVersion", "platform", "errorCode", "durationMs", "meta"],
      redactedPatterns: [
        "Caminho do usuário (C:\\Users\\..., /home/..., /Users/...)",
        "Tokens Bearer e chaves API (sk-*, AIza*, ghp_*, xoxb-*)",
        "E-mails, handles @usuario, URLs privadas, IPs e campos de prompt/senha",
      ],
    };
  }
}
