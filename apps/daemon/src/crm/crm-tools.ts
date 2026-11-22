import type { CrmProposal, ToolDefinition } from "@criativo/contracts";
import type { CrmService } from "./crm-service.ts";

export const CRM_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "crm_search",
    description:
      "Consulta contatos e propostas pendentes do CRM opcional (somente leitura; disponível apenas com CRM ativo).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Nome, e-mail ou empresa para filtrar contatos." },
      },
    },
  },
  {
    name: "crm_propose",
    description:
      "Propõe criação, atualização, avanço de estágio ou registro de atividade no CRM. Nunca altera dados diretamente — aguarda aprovação humana.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["create_contact", "update_contact", "move_stage", "add_activity"],
        },
        contactId: { type: "string" },
        summary: { type: "string" },
        diff: { type: "object", description: "Campos propostos para alteração." },
      },
      required: ["operation", "summary", "diff"],
    },
  },
];

export const CRM_TOOL_NAMES = new Set(CRM_TOOL_DEFINITIONS.map((t) => t.name));

export function executeCrmTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { agenteId: string },
  crm: CrmService,
): unknown {
  if (!crm.isEnabled()) {
    return {
      ok: false,
      erro: "O módulo CRM opcional está desativado neste servidor.",
    };
  }

  if (toolName === "crm_search") {
    const query = typeof args.query === "string" ? args.query : "";
    return {
      ok: true,
      contacts: crm.listContacts(query),
      pendingProposals: crm.listProposals("pending"),
    };
  }

  if (toolName === "crm_propose") {
    const operation = String(args.operation ?? "create_contact") as CrmProposal["operation"];
    const summary = String(args.summary ?? "Proposta de atualização CRM").trim();
    const diff =
      args.diff && typeof args.diff === "object" ? (args.diff as Record<string, unknown>) : {};
    const proposal = crm.proposeMutation({
      agenteId: ctx.agenteId,
      operation,
      contactId: typeof args.contactId === "string" ? args.contactId : null,
      summary,
      diff,
    });
    return {
      ok: true,
      requiresApproval: true,
      proposal,
    };
  }

  throw new Error(`Ferramenta CRM desconhecida: ${toolName}`);
}
