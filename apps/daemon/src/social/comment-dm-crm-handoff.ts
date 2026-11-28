import type { CommentDmRule, CommentDmSession } from "@criativo/contracts";
import type { CrmService } from "../crm/crm-service.ts";
import type { WorkflowEngine } from "../workflows/workflow-engine.ts";
import type { MetaCommentDmClient } from "./meta-comment-dm-client.ts";
import type { CrmAndHandoffHooks } from "./meta-comment-dm-engine.ts";

export interface CreativeAgentReplyExecutor {
  replyInDmWindow: (input: {
    agentId: string;
    threadId: string;
    prompt: string;
  }) => Promise<string>;
}

/**
 * Conecta o motor Comentário -> Direct ao CRM (CrmService), Workflows Visuais (WorkflowEngine)
 * e Criativos de IA sob a proteção estrita da janela oficial de 24 horas.
 */
export function createCommentDmCrmHandoffAdapter(deps: {
  crmService: CrmService;
  workflowEngine?: WorkflowEngine;
  client: MetaCommentDmClient;
  agentExecutor?: CreativeAgentReplyExecutor;
}): CrmAndHandoffHooks & {
  handoffToCreativeAgent: NonNullable<CrmAndHandoffHooks["handoffToAgent"]>;
} {
  const syncLead: NonNullable<CrmAndHandoffHooks["syncLead"]> = async (input) => {
    const cleanHandle = input.igUsername
      ? input.igUsername.startsWith("@")
        ? input.igUsername
        : `@${input.igUsername}`
      : `@ig_${input.igUserId}`;

    const contacts = deps.crmService.listContacts();
    const existing = contacts.find((c) => {
      if (input.email && c.email?.toLowerCase() === input.email.toLowerCase()) return true;
      if (input.phoneWhatsapp && c.phone && c.phone.replace(/\D/g, "") === input.phoneWhatsapp.replace(/\D/g, "")) {
        return true;
      }
      return c.notes.includes(cleanHandle) || c.notes.includes(input.igUserId);
    });

    const mergedTags = Array.from(
      new Set([
        ...(existing?.tags ?? []),
        "instagram_dm",
        ...input.tags.map((t) => t.trim()).filter(Boolean),
      ])
    );

    const contact = existing
      ? deps.crmService.updateContact(existing.contactId, {
          email: input.email ?? existing.email,
          phone: input.phoneWhatsapp ?? existing.phone,
          tags: mergedTags,
          notes: existing.notes.includes(cleanHandle)
            ? existing.notes
            : `${existing.notes}\nInstagram: ${cleanHandle} (${input.igUserId})`.trim(),
        })!
      : deps.crmService.createContact({
          name: cleanHandle,
          email: input.email ?? null,
          phone: input.phoneWhatsapp ?? null,
          stage: "lead",
          tags: mergedTags,
          sourceChannel: "instagram_dm",
          notes: `Origem regra '${input.ruleName}' | Instagram: ${cleanHandle} (${input.igUserId})`,
        });

    const summaryParts = [`Regra: ${input.ruleName}`];
    if (input.commentText) summaryParts.push(`Comentário: "${input.commentText.slice(0, 120)}"`);
    if (input.email) summaryParts.push(`E-mail capturado: ${input.email}`);
    if (input.phoneWhatsapp) summaryParts.push(`WhatsApp capturado: ${input.phoneWhatsapp}`);

    deps.crmService.addActivity({
      contactId: contact.contactId,
      channel: "instagram_dm",
      summary: summaryParts.join(" · "),
      author: "instagram_dm_engine",
    });
  };

  const triggerWorkflow: NonNullable<CrmAndHandoffHooks["triggerWorkflow"]> = async ({
    workflowId,
    session,
    rule,
  }) => {
    if (!deps.workflowEngine) {
      return { ok: false, erro: "WorkflowEngine indisponível neste contexto." };
    }
    const execResult = await deps.workflowEngine.startRun({
      workflowId,
      origem: "webhook",
      payload: {
        triggerKind: "instagram_comment_dm",
        rule_id: rule.rule_id,
        rule_name: rule.nome,
        conta_id: session.conta_id,
        ig_user_id: session.ig_user_id,
        ig_username: session.ig_username,
        media_id: session.media_id,
        comment_id: session.comment_id,
        collected_data: session.collected_data,
      },
    });
    return {
      ok: Boolean(execResult && typeof execResult === "object"),
    };
  };

  const handoffToCreativeAgent: NonNullable<CrmAndHandoffHooks["handoffToAgent"]> = async ({
    agentId,
    greeting,
    session,
    rule,
    incomingText,
  }) => {
    const expiresMs = session.window_24h_expires_at ? Date.parse(session.window_24h_expires_at) : Number.NaN;
    if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
      return { ok: false, erro: "window_24h_closed" };
    }

    let replyText = greeting?.trim() || "";
    if (incomingText && deps.agentExecutor) {
      const prompt = [
        `Atendimento via Instagram Direct (janela 24h ativa · regra "${rule.nome}")`,
        `Seguidor: ${session.ig_username ?? session.ig_user_id}`,
        Object.keys(session.collected_data).length > 0
          ? `Dados coletados: ${JSON.stringify(session.collected_data)}`
          : null,
        `Mensagem do seguidor: ${incomingText}`,
      ]
        .filter(Boolean)
        .join("\n");

      replyText = await deps.agentExecutor.replyInDmWindow({
        agentId,
        threadId: `ig_dm:${session.conta_id}:${session.ig_user_id}`,
        prompt,
      });
    }

    if (!replyText) {
      return { ok: true, replyText: null };
    }

    const sendRes = await deps.client.sendWindowDm({
      contaId: session.conta_id,
      recipientIgUserId: session.ig_user_id,
      payload: {
        text: replyText,
        metadataTag: `criativo_dm:${session.session_id}:handoff_${agentId}`,
      },
    });
    return {
      ok: sendRes.ok,
      replyText,
      erro: sendRes.erro,
    };
  };

  return {
    syncLead,
    triggerWorkflow,
    handoffToAgent: handoffToCreativeAgent,
    handoffToCreativeAgent,
  };
}
