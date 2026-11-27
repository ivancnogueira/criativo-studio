/**
 * Contratos compartilhados da Fase 42 (Workflows Pro):
 * Templates de marketing, seleção de modelo viável, Answer fields, condições determinísticas, lote 4x e portabilidade.
 */

import type { ArquivoStudio } from "./domains/providers-usage-brand.ts";
import type {
  WorkflowAresta,
  WorkflowDetail,
  WorkflowNo,
  WorkflowTraco,
  WorkflowVisual,
} from "./workflow-graph.ts";

export type WorkflowTemplateId =
  | "briefing-diario"
  | "post-com-imagem"
  | "relatorio-meta"
  | "radar-concorrente";

export type WorkflowTemplateCategory =
  | "conteudo"
  | "criacao"
  | "metricas"
  | "inteligencia";

export interface WorkflowTemplateDefinition {
  id: WorkflowTemplateId;
  nome: string;
  descricao: string;
  categoria: WorkflowTemplateCategory;
  badge: string;
  estimativaNos: number;
  nos: WorkflowNo[];
  arestas: WorkflowAresta[];
}

export interface WorkflowViableModelInfo {
  model: string | null;
  provider: string | null;
  label: string | null;
  source:
    | "explicit"
    | "connected_default"
    | "connected_fallback"
    | "vault_key"
    | "none";
}

export type WorkflowAnswerFieldType =
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "json";

export interface WorkflowAnswerField {
  id: string;
  key: string;
  label: string;
  type: WorkflowAnswerFieldType;
  description?: string;
  options?: string[];
  required?: boolean;
}

export type WorkflowConditionMode = "ai" | "deterministic";

export type WorkflowDeterministicOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_true"
  | "is_false"
  | "is_empty"
  | "not_empty"
  | "regex";

export interface WorkflowDeterministicClause {
  fieldRef: string;
  operator: WorkflowDeterministicOperator;
  value?: string;
  caseSensitive?: boolean;
}

export interface WorkflowDeterministicRule {
  combine: "and" | "or";
  clauses: WorkflowDeterministicClause[];
}

export const MAX_WORKFLOW_MEDIA_BATCH = 4;

export interface WorkflowBatchVariantResult {
  slotIndex: number;
  status: "pending" | "running" | "done" | "failed";
  arquivoId?: string;
  relPath?: string;
  mimeType?: string;
  error?: string;
  providerUsed?: string;
  modelUsed?: string;
}

export type WorkflowStepArtifactEntry =
  | string
  | {
      path?: string;
      arquivoId?: string;
      mimeType?: string;
      slotIndex?: number;
      status?: WorkflowBatchVariantResult["status"];
      error?: string;
      providerUsed?: string;
      modelUsed?: string;
    };

export type WorkflowStepArtifactsPayload = WorkflowStepArtifactEntry[];

export const WORKFLOW_PORTABLE_FORMAT = "criativoos.workflow.v1" as const;

export interface PortableWorkflowAsset {
  assetRefId: string;
  originalFileId?: string;
  fileName: string;
  mimeType: string;
  tipoUso: ArquivoStudio["tipo_uso"];
  sizeBytes: number;
  sha256: string;
  base64: string;
}

export interface PortableWorkflowAgentRef {
  agenteId: string;
  nome: string;
}

export interface PortableWorkflowBundle {
  format: typeof WORKFLOW_PORTABLE_FORMAT;
  exportedAt: string;
  workflow: {
    nome: string;
    descricao: string;
    nos: WorkflowNo[];
    arestas: WorkflowAresta[];
    tracos: WorkflowTraco[];
  };
  agents: PortableWorkflowAgentRef[];
  assets: PortableWorkflowAsset[];
  warnings?: string[];
}

export interface WorkflowImportResult {
  workflow: WorkflowVisual;
  detail: WorkflowDetail;
  importedAssets: number;
  remappedAgents: Array<{ from: string; to: string; by: "id" | "name" | "fallback" }>;
  pausedOnImport: true;
  warnings: string[];
}
