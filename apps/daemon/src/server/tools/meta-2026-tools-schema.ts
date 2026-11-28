import type { ToolDefinition } from "@criativo/contracts";
import { META_COMMENT_DM_TOOLS_SCHEMA } from "./meta-comment-dm-tools-schema.ts";

/**
 * Schemas das tools Meta Graph API 2026 (Fase 44 e Fase 47).
 * Mantido separado de `phase10-tools-schema.ts` para respeitar o orçamento de linhas.
 */
export const META_2026_TOOLS_SCHEMA: ToolDefinition[] = [
  ...META_COMMENT_DM_TOOLS_SCHEMA,
  {
    name: "meta_agendar_primeiro_comentario",
    description:
      "Agenda ou publica o 1º comentário pós-publicação (hashtags, CTA ou link) em uma mídia Instagram via Meta Graph API v27.0. Sem approved_by_human=true, salva apenas rascunho 'pending_approval' para aprovação humana.",
    parameters: {
      type: "object",
      properties: {
        media_id: {
          type: "string",
          description: "ID oficial da mídia publicada no Instagram.",
        },
        comment_text: {
          type: "string",
          description: "Texto do 1º comentário (máximo 2.200 caracteres).",
        },
        approved_by_human: {
          type: "boolean",
          description:
            "Obrigatório para envio automático. Se false, apenas registra rascunho pendente de aprovação no Cockpit.",
        },
        delay_seconds: {
          type: "number",
          description: "Atraso em segundos após publicação (0 a 3600, padrão 30).",
        },
        editorial_post_id: {
          type: "string",
          description: "ID opcional da pauta no calendário editorial.",
        },
        conta_id: {
          type: "string",
          description: "ID opcional da conta Instagram conectada na Loja.",
        },
      },
      required: ["media_id", "comment_text", "approved_by_human"],
    },
  },
  {
    name: "meta_excluir_midia",
    description:
      "Exclui uma mídia publicada no Instagram via Meta Graph API v27.0 com dupla confirmação humana obrigatória (approved_by_human=true e confirm_media_id igual ao media_id ou 'EXCLUIR'), registrando auditoria completa.",
    parameters: {
      type: "object",
      properties: {
        media_id: {
          type: "string",
          description: "ID oficial da mídia publicada no Instagram.",
        },
        approved_by_human: {
          type: "boolean",
          description: "Confirmação humana explícita obrigatória.",
        },
        confirm_media_id: {
          type: "string",
          description: "Confirmação textual: deve ser idêntica ao media_id ou à palavra 'EXCLUIR'.",
        },
        reason: {
          type: "string",
          description: "Motivo opcional da exclusão para registro na trilha de auditoria.",
        },
        conta_id: {
          type: "string",
          description: "ID opcional da conta Instagram conectada na Loja.",
        },
      },
      required: ["media_id", "approved_by_human", "confirm_media_id"],
    },
  },
];

export const META_2026_TOOL_NAMES: ReadonlySet<string> = new Set(
  META_2026_TOOLS_SCHEMA.map((t) => t.name)
);

export function isMeta2026ToolName(name: string): boolean {
  return META_2026_TOOL_NAMES.has(name);
}
