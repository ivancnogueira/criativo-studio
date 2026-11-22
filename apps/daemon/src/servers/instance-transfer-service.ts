import type {
  InstanceTransferJob,
  InstanceTransferManifest,
  InstanceTransferScope,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import {
  verifyAndAssembleChunks,
  splitPayloadIntoChunks,
  type TransferChunkPacket,
} from "./instance-transfer-chunks.ts";
import {
  buildInstanceTransferBundle,
  type InstanceTransferBundlePayload,
} from "./instance-transfer-manifest.ts";

interface TransferHistoryRow {
  job_id: string;
  direction: "export" | "import";
  status: InstanceTransferJob["status"];
  target_server_url: string | null;
  total_chunks: number;
  completed_chunks: number;
  payload_sha256: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface StagingImportJob {
  manifest: InstanceTransferManifest;
  chunks: Map<number, TransferChunkPacket>;
}

function toJobSummary(row: TransferHistoryRow): InstanceTransferJob {
  return {
    jobId: row.job_id,
    direction: row.direction,
    status: row.status,
    targetServerUrl: row.target_server_url,
    totalChunks: row.total_chunks,
    completedChunks: row.completed_chunks,
    payloadSha256: row.payload_sha256,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class InstanceTransferService {
  private readonly db: CriativoDatabase;
  private readonly incomingStaging = new Map<string, StagingImportJob>();

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  public listHistory(limit = 30): InstanceTransferJob[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM instance_transfer_history ORDER BY created_at DESC LIMIT ?;")
      .all(Math.max(1, Math.min(100, limit))) as unknown as TransferHistoryRow[];
    return rows.map(toJobSummary);
  }

  private upsertJobRecord(job: InstanceTransferJob): void {
    this.db.connection
      .prepare(
        `INSERT INTO instance_transfer_history (
          job_id, direction, status, target_server_url, total_chunks, completed_chunks, payload_sha256, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          status = excluded.status,
          completed_chunks = excluded.completed_chunks,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at;`,
      )
      .run(
        job.jobId,
        job.direction,
        job.status,
        job.targetServerUrl ?? null,
        job.totalChunks,
        job.completedChunks,
        job.payloadSha256,
        job.errorMessage ?? null,
        job.createdAt,
        job.updatedAt,
      );
  }

  public exportToChunks(params: {
    scope: InstanceTransferScope;
    sourceServerName?: string;
    chunkSizeBytes?: number;
  }): { manifest: InstanceTransferManifest; chunks: TransferChunkPacket[] } {
    const chunkSize = params.chunkSizeBytes ?? 256 * 1024;
    const { bundle, serializedJson } = buildInstanceTransferBundle({
      db: this.db,
      scope: params.scope,
      sourceServerName: params.sourceServerName,
      chunkSizeBytes: chunkSize,
    });
    const chunks = splitPayloadIntoChunks(serializedJson, chunkSize);
    bundle.manifest.totalChunks = chunks.length;

    const now = new Date().toISOString();
    this.upsertJobRecord({
      jobId: bundle.manifest.jobId,
      direction: "export",
      status: "completed",
      totalChunks: chunks.length,
      completedChunks: chunks.length,
      payloadSha256: bundle.manifest.payloadSha256,
      createdAt: now,
      updatedAt: now,
    });

    return { manifest: bundle.manifest, chunks };
  }

  public beginImportJob(manifest: InstanceTransferManifest): InstanceTransferJob {
    const now = new Date().toISOString();
    this.incomingStaging.set(manifest.jobId, {
      manifest,
      chunks: new Map(),
    });
    const job: InstanceTransferJob = {
      jobId: manifest.jobId,
      direction: "import",
      status: "transferring",
      totalChunks: manifest.totalChunks,
      completedChunks: 0,
      payloadSha256: manifest.payloadSha256,
      createdAt: now,
      updatedAt: now,
    };
    this.upsertJobRecord(job);
    return job;
  }

  public receiveChunk(jobId: string, packet: TransferChunkPacket): { receivedChunks: number } {
    const staged = this.incomingStaging.get(jobId);
    if (!staged) {
      throw new Error(`Sessão de importação '${jobId}' não iniciada.`);
    }
    staged.chunks.set(packet.index, packet);
    const now = new Date().toISOString();
    this.upsertJobRecord({
      jobId,
      direction: "import",
      status: "transferring",
      totalChunks: staged.manifest.totalChunks,
      completedChunks: staged.chunks.size,
      payloadSha256: staged.manifest.payloadSha256,
      createdAt: staged.manifest.createdAt,
      updatedAt: now,
    });
    return { receivedChunks: staged.chunks.size };
  }

  public commitImport(jobId: string): { ok: boolean; importedCounts: InstanceTransferManifest["counts"] } {
    const staged = this.incomingStaging.get(jobId);
    if (!staged) {
      throw new Error(`Sessão de importação '${jobId}' não encontrada.`);
    }

    try {
      const assembledJson = verifyAndAssembleChunks({
        packets: Array.from(staged.chunks.values()),
        expectedTotalChunks: staged.manifest.totalChunks,
        expectedPayloadSha256: staged.manifest.payloadSha256,
      });
      const data = JSON.parse(assembledJson) as InstanceTransferBundlePayload["data"];

      this.db.runInTransaction(() => {
        for (const ag of (data.agents ?? []) as Array<Record<string, unknown>>) {
          if (!ag.agente_id || !ag.nome) continue;
          this.db.connection
            .prepare(
              `INSERT INTO projecao_agentes (
                agente_id, nome, papel, modelo_padrao, status, config_json, ordem_exibicao, atualizado_em
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(agente_id) DO UPDATE SET
                nome = excluded.nome,
                papel = excluded.papel,
                config_json = excluded.config_json,
                atualizado_em = excluded.atualizado_em;`,
            )
            .run(
              String(ag.agente_id),
              String(ag.nome),
              String(ag.papel ?? "Especialista"),
              String(ag.modelo_padrao ?? "gemini-2.5-pro"),
              String(ag.status ?? "ocioso"),
              String(ag.config_json ?? "{}"),
              Number(ag.ordem_exibicao ?? 99),
              String(ag.atualizado_em ?? new Date().toISOString()),
            );
        }

        for (const pref of (data.preferences ?? []) as Array<{
          chave?: string;
          valor_json?: string;
          atualizado_em?: string;
        }>) {
          if (!pref.chave || !pref.valor_json) continue;
          this.db.connection
            .prepare(
              `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
               VALUES (?, ?, ?)
               ON CONFLICT(chave) DO UPDATE SET
                 valor_json = excluded.valor_json,
                 atualizado_em = excluded.atualizado_em;`,
            )
            .run(pref.chave, pref.valor_json, pref.atualizado_em ?? new Date().toISOString());
        }

        for (const wf of (data.workflows ?? []) as Array<Record<string, unknown>>) {
          if (!wf.workflow_id || !wf.nome) continue;
          this.db.connection
            .prepare(
              `INSERT OR IGNORE INTO projecao_workflows (
                workflow_id, nome, descricao, nos_json, arestas_json, tracos_json,
                ativo, revisao_atual, criado_em, atualizado_em
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            )
            .run(
              String(wf.workflow_id),
              String(wf.nome),
              String(wf.descricao ?? ""),
              String(wf.nos_json ?? "[]"),
              String(wf.arestas_json ?? "[]"),
              String(wf.tracos_json ?? "[]"),
              Number(wf.ativo ?? 1),
              Number(wf.revisao_atual ?? 1),
              String(wf.criado_em ?? new Date().toISOString()),
              String(wf.atualizado_em ?? new Date().toISOString()),
            );
        }
      });

      const now = new Date().toISOString();
      this.upsertJobRecord({
        jobId,
        direction: "import",
        status: "completed",
        totalChunks: staged.manifest.totalChunks,
        completedChunks: staged.manifest.totalChunks,
        payloadSha256: staged.manifest.payloadSha256,
        createdAt: staged.manifest.createdAt,
        updatedAt: now,
      });
      this.incomingStaging.delete(jobId);

      return { ok: true, importedCounts: staged.manifest.counts };
    } catch (err) {
      const now = new Date().toISOString();
      this.upsertJobRecord({
        jobId,
        direction: "import",
        status: "rolled_back",
        totalChunks: staged.manifest.totalChunks,
        completedChunks: staged.chunks.size,
        payloadSha256: staged.manifest.payloadSha256,
        errorMessage: err instanceof Error ? err.message : String(err),
        createdAt: staged.manifest.createdAt,
        updatedAt: now,
      });
      this.incomingStaging.delete(jobId);
      throw err;
    }
  }
}
