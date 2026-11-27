import type {
  PortableWorkflowBundle,
  WorkflowBatchVariantResult,
  WorkflowImportResult,
  WorkflowStepRecord,
  WorkflowTemplateDefinition,
  WorkflowViableModelInfo,
} from "@criativo/contracts";
import { apiFetch } from "../http-client";

export const workflowsProApi = {
  async listWorkflowTemplates(): Promise<{
    templates: WorkflowTemplateDefinition[];
    viable_model: WorkflowViableModelInfo;
  }> {
    const res = await apiFetch("/api/workflows/templates");
    const json = (await res.json()) as {
      templates?: WorkflowTemplateDefinition[];
      viable_model?: WorkflowViableModelInfo;
      erro?: string;
    };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao listar templates de workflow.");
    }
    return {
      templates: json.templates ?? [],
      viable_model: json.viable_model ?? {
        model: null,
        provider: null,
        label: null,
        source: "none",
      },
    };
  },

  async getViableWorkflowModel(): Promise<WorkflowViableModelInfo> {
    const res = await apiFetch("/api/workflows/modelo-viavel");
    const json = (await res.json()) as WorkflowViableModelInfo & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao consultar modelo conectado viável.");
    }
    return json;
  },

  async retryWorkflowStepVariant(
    stepId: string,
    slotIndex: number
  ): Promise<{ ok: boolean; step: WorkflowStepRecord; variants: WorkflowBatchVariantResult[] }> {
    const res = await apiFetch(
      `/api/workflows/etapas/${encodeURIComponent(stepId)}/variacoes/${slotIndex}/retentar`,
      { method: "POST" }
    );
    const json = (await res.json()) as {
      ok?: boolean;
      step?: WorkflowStepRecord;
      variants?: WorkflowBatchVariantResult[];
      erro?: string;
    };
    if (!res.ok || !json.step) {
      throw new Error(json.erro ?? "Falha ao retentar variação individual do lote.");
    }
    return {
      ok: Boolean(json.ok),
      step: json.step,
      variants: json.variants ?? [],
    };
  },

  async exportWorkflowBundle(workflowId: string): Promise<PortableWorkflowBundle> {
    const res = await apiFetch(`/api/workflows/${encodeURIComponent(workflowId)}/exportar`);
    const json = (await res.json()) as PortableWorkflowBundle & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao exportar pacote portável do workflow.");
    }
    return json;
  },

  async importWorkflowBundle(bundle: unknown): Promise<WorkflowImportResult> {
    const res = await apiFetch("/api/workflows/importar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle),
    });
    const json = (await res.json()) as WorkflowImportResult & { erro?: string };
    if (!res.ok) {
      throw new Error(json.erro ?? "Falha ao importar pacote de workflow.");
    }
    return json;
  },
};
