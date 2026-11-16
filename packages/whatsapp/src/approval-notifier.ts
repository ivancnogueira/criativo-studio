import { existsSync, readFileSync } from "node:fs";
import type { StatusTarefa, TarefaRegistro } from "@criativo/contracts";
import type { WhatsAppStudioClient } from "./client.ts";

export interface ApprovalPreviewPayload {
  tarefa_id: string;
  tipo: string;
  previews: string[];
  copy: string;
  targetJid: string;
}

export interface ApprovalNotifierDependencies {
  client: WhatsAppStudioClient;
  updateTaskStatus: (
    tarefaId: string,
    status: StatusTarefa,
    result?: Record<string, unknown> | null,
    errorDetails?: string | null
  ) => TarefaRegistro;
  onApproveAndPublish: (tarefaId: string) => Promise<{ permalink?: string }>;
  onRequestAdjustment?: (tarefaId: string, feedback: string) => Promise<void>;
}

/**
 * Notificador de aprovação rápida via WhatsApp: envia prévias geradas (imagens/MP4)
 * com legenda e interpreta respostas '1' / 'aprovar' ou '2' / 'ajustar'.
 */
export class WhatsAppApprovalNotifier {
  private readonly deps: ApprovalNotifierDependencies;
  private readonly pendingByJid = new Map<string, string>();

  constructor(deps: ApprovalNotifierDependencies) {
    this.deps = deps;
  }

  public getPendingTaskForJid(jid: string): string | null {
    return this.pendingByJid.get(jid) ?? null;
  }

  public async notifyReadyForApproval(payload: ApprovalPreviewPayload): Promise<void> {
    this.pendingByJid.set(payload.targetJid, payload.tarefa_id);

    for (const filePath of payload.previews) {
      if (!existsSync(filePath)) continue;
      const isVideo = filePath.toLowerCase().endsWith(".mp4");
      const mediaBuffer = readFileSync(filePath);
      if (isVideo) {
        await this.deps.client.sendMessage(payload.targetJid, {
          video: mediaBuffer,
          caption: `Prévia pronta (${payload.tipo})`,
        });
      } else {
        await this.deps.client.sendMessage(payload.targetJid, {
          image: mediaBuffer,
          caption: `Prévia gerada (${payload.tipo})`,
        });
      }
    }

    const menuTexto = [
      `*Criativo pronto para aprovação* (#${payload.tarefa_id.slice(0, 8)})`,
      "",
      payload.copy.slice(0, 1200),
      "",
      "Responda:",
      "1 - Aprovar e Publicar Agora",
      "2 - Pedir Ajuste (ou digite `2 <o que mudar>`)",
    ].join("\n");

    await this.deps.client.sendMessage(payload.targetJid, { text: menuTexto });
  }

  /**
   * Processa uma mensagem recebida no WhatsApp verificando se corresponde à aprovação pendente.
   */
  public async handleReply(jid: string, rawText: string): Promise<boolean> {
    const pendingTaskId = this.pendingByJid.get(jid);
    if (!pendingTaskId) {
      return false;
    }

    const normalized = rawText.trim().toLowerCase();

    if (normalized === "1" || normalized === "aprovar" || normalized === "sim") {
      this.pendingByJid.delete(jid);
      this.deps.updateTaskStatus(pendingTaskId, "concluido", {
        aprovado: true,
        aprovado_via: "whatsapp",
        aprovado_em: new Date().toISOString(),
      });

      const pubRes = await this.deps.onApproveAndPublish(pendingTaskId);
      const linkMsg = pubRes.permalink ? `\nLink: ${pubRes.permalink}` : "";
      await this.deps.client.sendMessage(jid, {
        text: `Aprovado! O agente publicador Meta API disparou sua postagem.${linkMsg}`,
      });
      return true;
    }

    if (normalized === "2" || normalized.startsWith("2 ") || normalized.startsWith("ajustar")) {
      this.pendingByJid.delete(jid);
      const feedback = rawText.replace(/^(2|ajustar)\s*/i, "").trim() || "Ajustar criativo";
      await this.deps.onRequestAdjustment?.(pendingTaskId, feedback);
      await this.deps.client.sendMessage(jid, {
        text: `Entendido! Solicitei o ajuste aos agentes: "${feedback}".`,
      });
      return true;
    }

    return false;
  }
}
