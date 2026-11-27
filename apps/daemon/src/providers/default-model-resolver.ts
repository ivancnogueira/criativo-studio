import type {
  ModeloProvedorInfo,
  ProvedorStatusInfo,
  ProviderName,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";

/**
 * Modelo gratuito padrão usado quando o usuário ainda não conectou
 * nenhuma conta paga ou chave de API no CriativoOS.
 */
export const DEFAULT_FALLBACK_FREE_MODEL = "opencode/glm-5.3-flash-free";

/**
 * Modelos antigos/descontinuados que causavam erro quando os agentes
 * nasciam hardcoded com eles.
 */
export const LEGACY_OR_DEPRECATED_DEFAULT_MODELS = new Set<string>([
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-image",
  "claude-3-7-sonnet-latest",
  "gpt-4o",
  "grok-4.6",
]);

const PRIMARY_ACCOUNT_PROVIDER_ORDER: readonly ProviderName[] = [
  "openai",
  "gemini",
  "claude",
  "grok",
];

/**
 * Identifica modelos dedicados exclusivamente à geração de imagem, vídeo ou áudio,
 * que não devem ser selecionados como modelo conversacional padrão de agentes.
 */
export function isDedicatedMediaOnlyModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return true;
  if (id.includes("-image") || id.endsWith("/image")) return true;
  if (id.startsWith("imagen-") || id.startsWith("veo-")) return true;
  if (id.startsWith("gpt-image") || id.startsWith("dall-e")) return true;
  if (id.startsWith("tts-") || id.startsWith("whisper")) return true;
  if (id.includes("realtime") || id.includes("-audio")) return true;
  return false;
}

function getEligibleModels(prov: ProvedorStatusInfo | undefined): ModeloProvedorInfo[] {
  if (!prov || !prov.conectado || !Array.isArray(prov.modelos)) return [];
  return prov.modelos.filter(
    (m) =>
      Boolean(m?.id?.trim()) &&
      !m.oculto &&
      !isDedicatedMediaOnlyModel(m.id) &&
      !LEGACY_OR_DEPRECATED_DEFAULT_MODELS.has(m.id.trim())
  );
}

function pickFromEligible(models: ModeloProvedorInfo[], providerId: ProviderName): string | null {
  if (models.length === 0) return null;
  const preferredDefault = models.find((m) => m.padrao);
  if (preferredDefault) return preferredDefault.id;

  if (providerId === "opencode") {
    const exactFallback = models.find((m) => m.id === DEFAULT_FALLBACK_FREE_MODEL);
    if (exactFallback) return exactFallback.id;
    const freeModel = models.find((m) => m.id.endsWith("-free") || m.id.includes("big-pickle"));
    if (freeModel) return freeModel.id;
  }

  return models[0]!.id;
}

/**
 * Escolhe o melhor modelo real disponível com base nas contas/provedores conectados:
 * 1) `preferredProvider` (se conectado e com modelos válidos);
 * 2) contas principais conectadas (`openai` -> `gemini` -> `claude` -> `grok`);
 * 3) `opencode` (modelos gratuitos);
 * 4) `ollama` (modelos locais);
 * 5) fallback seguro `DEFAULT_FALLBACK_FREE_MODEL`.
 */
export function pickBestAvailableModel(
  statusList: readonly ProvedorStatusInfo[],
  preferredProvider?: ProviderName | null
): string {
  if (preferredProvider) {
    const pref = statusList.find((p) => p.provedor === preferredProvider);
    const prefModel = pickFromEligible(getEligibleModels(pref), preferredProvider);
    if (prefModel) return prefModel;
  }

  for (const provId of PRIMARY_ACCOUNT_PROVIDER_ORDER) {
    const prov = statusList.find((p) => p.provedor === provId);
    const chosen = pickFromEligible(getEligibleModels(prov), provId);
    if (chosen) return chosen;
  }

  for (const fallbackProv of ["opencode", "ollama"] as const) {
    const prov = statusList.find((p) => p.provedor === fallbackProv);
    const chosen = pickFromEligible(getEligibleModels(prov), fallbackProv);
    if (chosen) return chosen;
  }

  return DEFAULT_FALLBACK_FREE_MODEL;
}

/**
 * Retorna true se existe pelo menos um provedor com modelos de chat válidos conectados.
 */
export function hasAnyUsableConnectedProvider(statusList: readonly ProvedorStatusInfo[]): boolean {
  return statusList.some((prov) => getEligibleModels(prov).length > 0);
}

/**
 * Infere a qual provedor um ID de modelo pertence no contexto de reconciliação.
 */
export function inferProviderKeyFromModel(modelId: string): ProviderName {
  const m = modelId.trim().toLowerCase();
  if (m.startsWith("opencode/") || m.endsWith("-free") || m.includes("big-pickle")) return "opencode";
  if (m.includes("claude")) return "claude";
  if (m.includes("grok")) return "grok";
  if (m.includes("ollama") || m.includes("llama") || m.includes("qwen") || m.includes("deepseek-r1")) {
    return "ollama";
  }
  if (m.includes("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) {
    return "openai";
  }
  return "gemini";
}

export interface ReconcileAgentsDefaultModelsResult {
  updatedIds: string[];
  targetModel: string;
}

/**
 * Atualiza `modelo_padrao` dos agentes que ainda não foram fixados manualmente pelo usuário
 * (`config.modelo_fixado_usuario !== true`), eliminando modelos descontinuados (`gemini-2.5-pro`, etc.)
 * e promovendo do fallback gratuito OpenCode quando uma conta conectada fica disponível.
 */
export function reconcileAgentsDefaultModels(
  db: CriativoDatabase,
  statusList: readonly ProvedorStatusInfo[]
): ReconcileAgentsDefaultModelsResult {
  const targetModel = pickBestAvailableModel(statusList);
  const hasPaidAccount = PRIMARY_ACCOUNT_PROVIDER_ORDER.some(
    (provId) => getEligibleModels(statusList.find((p) => p.provedor === provId)).length > 0
  );
  const connectedIds = new Set<ProviderName>(
    statusList.filter((p) => getEligibleModels(p).length > 0).map((p) => p.provedor)
  );
  const anyConnected = connectedIds.size > 0;

  const rows = db.connection
    .prepare(`SELECT agente_id, modelo_padrao, config_json FROM projecao_agentes;`)
    .all() as Array<{ agente_id: string; modelo_padrao: string; config_json: string }>;

  const updatedIds: string[] = [];
  const agora = new Date().toISOString();

  db.runInTransaction(() => {
    const updateStmt = db.connection.prepare(
      `UPDATE projecao_agentes SET modelo_padrao = ?, atualizado_em = ? WHERE agente_id = ?;`
    );

    for (const row of rows) {
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
      } catch {
        config = {};
      }

      if (config.modelo_fixado_usuario === true) {
        continue;
      }

      const currentModel = (row.modelo_padrao || "").trim();
      const currentProvider = inferProviderKeyFromModel(currentModel);
      const isLegacy =
        !currentModel || LEGACY_OR_DEPRECATED_DEFAULT_MODELS.has(currentModel);
      const isFreeDefault =
        currentModel === DEFAULT_FALLBACK_FREE_MODEL ||
        currentProvider === "opencode";
      const currentProviderConnected = connectedIds.has(currentProvider);

      let shouldUpdate = false;
      if (isLegacy) {
        shouldUpdate = currentModel !== targetModel;
      } else if (hasPaidAccount && isFreeDefault) {
        shouldUpdate = currentModel !== targetModel;
      } else if (anyConnected && !currentProviderConnected && currentModel !== targetModel) {
        shouldUpdate = true;
      }

      if (shouldUpdate) {
        updateStmt.run(targetModel, agora, row.agente_id);
        updatedIds.push(row.agente_id);
      }
    }
  });

  return { updatedIds, targetModel };
}
