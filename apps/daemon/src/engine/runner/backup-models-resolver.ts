/**
 * Motor de resolução de failover em cascata (`BackupModelsResolver` — UX-01 / D-04).
 * Classifica erros retentáveis (429 / cota / 5xx), filtra até 8 modelos reserva prontos
 * sem mutar `modelo_padrao` no SQLite e constrói `UsageLimitAskPayload` quando `automatic === false`.
 */
import { randomUUID } from "node:crypto";
import type {
  BackupModelChoice,
  BackupModelsConfig,
  ProvedorStatusInfo,
  ProviderName,
  UsageLimitAskPayload,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";

export const MAX_BACKUP_MODELS = 8;

export type ProviderFailureReasonCode =
  | "rate_limit"
  | "quota_exceeded"
  | "model_unavailable"
  | "provider_5xx"
  | "fatal";

export function isRetryableQuotaOrProviderError(err: unknown): {
  retryable: boolean;
  reasonCode: ProviderFailureReasonCode;
  message: string;
} {
  const msg = err instanceof Error ? err.message : String(err ?? "Erro desconhecido");
  const lower = msg.toLowerCase();

  if (
    /\b429\b/.test(lower) ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests")
  ) {
    return { retryable: true, reasonCode: "rate_limit", message: msg };
  }

  if (
    lower.includes("quota") ||
    lower.includes("resource_exhausted") ||
    lower.includes("insufficient_quota") ||
    lower.includes("credit balance") ||
    lower.includes("usage limit") ||
    lower.includes("limite de cota") ||
    lower.includes("cota esgotada")
  ) {
    return { retryable: true, reasonCode: "quota_exceeded", message: msg };
  }

  if (
    /\b(500|502|503|504|529)\b/.test(lower) ||
    lower.includes("overloaded") ||
    lower.includes("service unavailable") ||
    lower.includes("bad gateway")
  ) {
    return { retryable: true, reasonCode: "provider_5xx", message: msg };
  }

  if (
    lower.includes("model_not_found") ||
    lower.includes("model unavailable") ||
    lower.includes("does not exist") ||
    lower.includes("indisponível")
  ) {
    return { retryable: true, reasonCode: "model_unavailable", message: msg };
  }

  return { retryable: false, reasonCode: "fatal", message: msg };
}

export function parseBackupModelsJson(raw?: string | null): BackupModelsConfig {
  if (!raw) return { automatic: false, order: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<BackupModelsConfig>;
    const automatic = Boolean(parsed?.automatic);
    const rawOrder = Array.isArray(parsed?.order) ? parsed.order : [];
    const order: BackupModelChoice[] = [];
    for (const item of rawOrder) {
      if (!item || typeof item !== "object") continue;
      const rec = item as unknown as Record<string, unknown>;
      if (typeof rec.provedor === "string" && typeof rec.modelo === "string" && rec.modelo.trim()) {
        order.push({
          provedor: rec.provedor as ProviderName,
          modelo: rec.modelo.trim(),
          conta_id: typeof rec.conta_id === "string" ? rec.conta_id : null,
        });
      }
      if (order.length >= MAX_BACKUP_MODELS) break;
    }
    return { automatic, order };
  } catch {
    return { automatic: false, order: [] };
  }
}

export class BackupModelsResolver {
  private readonly cooldownUntilByKey = new Map<string, number>();

  public markModelCooldown(provedor: ProviderName, modelo: string, durationMs = 60_000): void {
    this.cooldownUntilByKey.set(`${provedor}:${modelo}`, Date.now() + durationMs);
  }

  public isInCooldown(provedor: ProviderName, modelo: string, externalMap?: Map<string, number>): boolean {
    const key = `${provedor}:${modelo}`;
    const now = Date.now();
    const internal = this.cooldownUntilByKey.get(key) ?? 0;
    const ext = externalMap?.get(key) ?? 0;
    return Math.max(internal, ext) > now;
  }

  public resolveCandidates(params: {
    primaryModel: string;
    backupConfig: BackupModelsConfig;
    statuses: ProvedorStatusInfo[];
    cooldowns?: Map<string, number>;
  }): BackupModelChoice[] {
    const candidates: BackupModelChoice[] = [];
    const seen = new Set<string>([params.primaryModel.trim().toLowerCase()]);
    const orderSlice = (params.backupConfig.order ?? []).slice(0, MAX_BACKUP_MODELS);

    for (const choice of orderSlice) {
      const modelNorm = choice.modelo.trim().toLowerCase();
      const dedupKey = `${choice.provedor}:${modelNorm}:${choice.conta_id ?? ""}`;
      if (!modelNorm || seen.has(modelNorm) || seen.has(dedupKey)) {
        continue;
      }

      if (this.isInCooldown(choice.provedor, choice.modelo, params.cooldowns)) {
        continue;
      }

      if (params.statuses.length > 0) {
        const provStatus = params.statuses.find((s) => s.provedor === choice.provedor);
        if (provStatus && !provStatus.conectado && !provStatus.vault_configurado) {
          continue;
        }
      }

      seen.add(dedupKey);
      candidates.push({
        provedor: choice.provedor,
        modelo: choice.modelo.trim(),
        conta_id: choice.conta_id ?? null,
      });
    }

    return candidates;
  }

  public buildUsageLimitAsk(params: {
    agenteId: string;
    canalId: string;
    currentModel: string;
    currentProvider: ProviderName;
    reason: string;
    backupConfig: BackupModelsConfig;
    statuses: ProvedorStatusInfo[];
  }): UsageLimitAskPayload {
    const opcoes: BackupModelChoice[] = [];
    const seen = new Set<string>([params.currentModel.trim().toLowerCase()]);

    // 1. Prioriza os modelos reserva explicitamente configurados pelo usuário
    const configured = this.resolveCandidates({
      primaryModel: params.currentModel,
      backupConfig: params.backupConfig,
      statuses: params.statuses,
    });
    for (const c of configured) {
      seen.add(c.modelo.toLowerCase());
      opcoes.push(c);
    }

    // 2. Complementa com outros modelos conectados prontos para uso imediato
    for (const st of params.statuses) {
      if (!st.conectado && !st.vault_configurado) continue;
      for (const m of st.modelos) {
        if (m.oculto) continue;
        if (typeof m.restante_percentual === "number" && m.restante_percentual <= 5) continue;
        if (seen.has(m.id.toLowerCase())) continue;
        seen.add(m.id.toLowerCase());
        opcoes.push({
          provedor: st.provedor,
          modelo: m.id,
          conta_id: st.pool?.conta_em_uso ?? null,
        });
        if (opcoes.length >= MAX_BACKUP_MODELS) break;
      }
      if (opcoes.length >= MAX_BACKUP_MODELS) break;
    }

    return {
      ask_id: `ulim-${randomUUID().slice(0, 8)}`,
      agente_id: params.agenteId,
      canal_id: params.canalId,
      modelo_atual: params.currentModel,
      provedor_atual: params.currentProvider,
      motivo: params.reason.slice(0, 280),
      opcoes,
    };
  }

  /**
   * Ativa `automatic: true` no `backup_models_json` do agente sem alterar `modelo_padrao`.
   */
  public rememberAutomaticFailover(
    db: CriativoDatabase,
    agenteId: string,
    selectedChoice?: BackupModelChoice,
  ): BackupModelsConfig {
    const row = db.connection
      .prepare("SELECT backup_models_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
      .get(agenteId) as { backup_models_json?: string } | undefined;

    const current = parseBackupModelsJson(row?.backup_models_json);
    const nextOrder = [...current.order];
    if (
      selectedChoice &&
      !nextOrder.some(
        (o) =>
          o.provedor === selectedChoice.provedor &&
          o.modelo.toLowerCase() === selectedChoice.modelo.toLowerCase(),
      ) &&
      nextOrder.length < MAX_BACKUP_MODELS
    ) {
      nextOrder.unshift({
        provedor: selectedChoice.provedor,
        modelo: selectedChoice.modelo,
        conta_id: selectedChoice.conta_id ?? null,
      });
    }

    const updated: BackupModelsConfig = {
      automatic: true,
      order: nextOrder.slice(0, MAX_BACKUP_MODELS),
    };

    db.connection
      .prepare("UPDATE projecao_agentes SET backup_models_json = ?, atualizado_em = ? WHERE agente_id = ?;")
      .run(JSON.stringify(updated), new Date().toISOString(), agenteId);

    return updated;
  }
}
