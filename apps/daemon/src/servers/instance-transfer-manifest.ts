import { createHash, randomUUID } from "node:crypto";
import type {
  InstanceTransferManifest,
  InstanceTransferScope,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

export interface InstanceTransferBundlePayload {
  manifest: InstanceTransferManifest;
  data: {
    agents?: unknown[];
    memories?: unknown[];
    workflows?: unknown[];
    routines?: unknown[];
    libraryFiles?: unknown[];
    preferences?: unknown[];
  };
}

/**
 * Empacota dados selecionados da instância para transferência segura,
 * excluindo terminantemente segredos cifrados de `cofre_segredos` e `cofre_logins`.
 */
export function buildInstanceTransferBundle(options: {
  db: CriativoDatabase;
  scope: InstanceTransferScope;
  sourceServerName?: string;
  chunkSizeBytes?: number;
}): { bundle: InstanceTransferBundlePayload; serializedJson: string } {
  const { db, scope } = options;
  const data: InstanceTransferBundlePayload["data"] = {};

  const safeAll = (sql: string): unknown[] => {
    try {
      return db.connection.prepare(sql).all() as unknown[];
    } catch {
      return [];
    }
  };

  if (scope.agents) {
    data.agents = safeAll("SELECT * FROM projecao_agentes ORDER BY ordem_exibicao ASC;");
  }
  if (scope.memories) {
    data.memories = safeAll("SELECT * FROM projecao_agente_memorias ORDER BY criado_em ASC;");
  }
  if (scope.workflows) {
    data.workflows = safeAll("SELECT * FROM projecao_workflows ORDER BY criado_em ASC;");
  }
  if (scope.routines) {
    data.routines = safeAll("SELECT * FROM projecao_agente_rotinas ORDER BY criado_em ASC;");
  }
  if (scope.library) {
    data.libraryFiles = safeAll("SELECT * FROM projecao_arquivos ORDER BY criado_em ASC;");
  }
  if (scope.preferences) {
    data.preferences = safeAll(
      `SELECT chave, valor_json, atualizado_em FROM projecao_studio_config
       WHERE chave NOT LIKE '%secret%' AND chave NOT LIKE '%token%';`,
    );
  }

  const chunkSize = Math.max(1024, options.chunkSizeBytes ?? 4 * 1024 * 1024);
  const jobId = `xfer_${randomUUID().slice(0, 10)}`;
  const bodyForHash = JSON.stringify(data);
  const payloadSha256 = createHash("sha256").update(bodyForHash, "utf8").digest("hex");
  const totalBytes = Buffer.byteLength(bodyForHash, "utf8");
  const totalChunks = Math.max(1, Math.ceil(totalBytes / chunkSize));

  const manifest: InstanceTransferManifest = {
    version: "1.0",
    jobId,
    sourceServerName: options.sourceServerName?.trim() || "CriativoOS",
    createdAt: new Date().toISOString(),
    scope,
    counts: {
      agents: data.agents?.length ?? 0,
      memories: data.memories?.length ?? 0,
      workflows: data.workflows?.length ?? 0,
      routines: data.routines?.length ?? 0,
      libraryFiles: data.libraryFiles?.length ?? 0,
      preferences: data.preferences?.length ?? 0,
    },
    secretsExcluded: true,
    totalBytes,
    totalChunks,
    payloadSha256,
  };

  const bundle: InstanceTransferBundlePayload = { manifest, data };
  return {
    bundle,
    serializedJson: bodyForHash,
  };
}
