import type { CanalOrigem, TarefaRegistro } from "@criativo/contracts";
import type { WhatsAppStudioClient } from "./client.ts";
import type { IncomingWhatsAppMessage } from "./types.ts";

export interface CreativeIntent {
  tipo: string;
  agente_id: string;
  titulo: string;
  prioridade: number;
}

export interface EnqueueWhatsAppTaskInput {
  canal_origem: CanalOrigem;
  tipo: string;
  agente_id: string;
  titulo: string;
  prioridade: number;
  payload: Record<string, unknown>;
}

export interface WhatsAppHandlerDependencies {
  client: WhatsAppStudioClient;
  enqueueTask: (input: EnqueueWhatsAppTaskInput) => TarefaRegistro;
  transcribeAudio?: (audioBuffer: Buffer, mimeType: string) => Promise<string>;
  onApprovalReply?: (jid: string, rawText: string) => Promise<boolean>;
  authorizedJids?: string[];
  allowFromMe?: boolean;
}

/**
 * Analisa comandos em linguagem natural para encaminhar diretamente ao especialista certo dos 15 agentes.
 */
export function detectCreativeIntent(promptText: string): CreativeIntent {
  const lower = promptText.toLowerCase();

  if (lower.includes("carrossel") || lower.includes("slides")) {
    return {
      tipo: "carrossel",
      agente_id: "designer_carrossel",
      titulo: promptText.slice(0, 80),
      prioridade: 2,
    };
  }
  if (lower.includes("talking head") || lower.includes("teleprompter")) {
    return {
      tipo: "talking_head",
      agente_id: "roteirista_talking_head",
      titulo: promptText.slice(0, 80),
      prioridade: 2,
    };
  }
  if (lower.includes("faceless")) {
    return {
      tipo: "faceless",
      agente_id: "roteirista_faceless",
      titulo: promptText.slice(0, 80),
      prioridade: 2,
    };
  }
  if (lower.includes("reels") || lower.includes("vídeo") || lower.includes("video")) {
    return {
      tipo: "reels",
      agente_id: "editor_video",
      titulo: promptText.slice(0, 80),
      prioridade: 2,
    };
  }
  if (lower.includes("storie") || lower.includes("story")) {
    return {
      tipo: "stories",
      agente_id: "designer_stories",
      titulo: promptText.slice(0, 80),
      prioridade: 3,
    };
  }
  if (lower.includes("anúncio") || lower.includes("anuncio") || lower.includes("ads")) {
    return {
      tipo: "anuncio",
      agente_id: "designer_ads",
      titulo: promptText.slice(0, 80),
      prioridade: 2,
    };
  }
  if (lower.includes("concorrente") || lower.includes("mercado")) {
    return {
      tipo: "concorrentes",
      agente_id: "inteligencia_competitiva",
      titulo: promptText.slice(0, 80),
      prioridade: 3,
    };
  }
  if (lower.includes("planejar") || lower.includes("pauta") || lower.includes("calendário") || lower.includes("semana")) {
    return {
      tipo: "planejamento",
      agente_id: "estrategista",
      titulo: promptText.slice(0, 80),
      prioridade: 3,
    };
  }
  if (lower.includes("métrica") || lower.includes("metrica") || lower.includes("desempenho")) {
    return {
      tipo: "metricas",
      agente_id: "analista_metricas",
      titulo: promptText.slice(0, 80),
      prioridade: 4,
    };
  }
  return {
    tipo: "post_individual",
    agente_id: "designer_individual",
    titulo: promptText.slice(0, 80),
    prioridade: 3,
  };
}

/**
 * Escuta mensagens de texto e áudios no WhatsApp, transcreve comandos de voz e enfileira tarefas na Fila FIFO.
 */
export class WhatsAppMessageHandler {
  private readonly deps: WhatsAppHandlerDependencies;

  constructor(deps: WhatsAppHandlerDependencies) {
    this.deps = deps;
  }

  public async handleIncomingMessage(msg: IncomingWhatsAppMessage): Promise<TarefaRegistro | null> {
    if (msg.fromMe && !this.deps.allowFromMe) {
      return null;
    }

    if (
      this.deps.authorizedJids &&
      this.deps.authorizedJids.length > 0 &&
      !this.deps.authorizedJids.includes(msg.remoteJid)
    ) {
      return null;
    }

    let commandText = msg.text?.trim() ?? "";

    // Se for áudio (OGG/Opus), transcreve automaticamente antes de detectar intenção
    if (!commandText && msg.audioBuffer) {
      if (!this.deps.transcribeAudio) {
        await this.deps.client.sendMessage(msg.remoteJid, {
          text: "Recebi seu áudio, mas o serviço de transcrição não está configurado no Cofre.",
        });
        return null;
      }
      commandText = (
        await this.deps.transcribeAudio(
          msg.audioBuffer,
          msg.audioMimeType ?? "audio/ogg; codecs=opus"
        )
      ).trim();
    }

    if (!commandText) {
      return null;
    }

    // Verifica primeiro se é uma resposta de aprovação ("1", "aprovar", "2 <ajuste>")
    if (this.deps.onApprovalReply) {
      const handledAsApproval = await this.deps.onApprovalReply(msg.remoteJid, commandText);
      if (handledAsApproval) {
        return null;
      }
    }

    const intent = detectCreativeIntent(commandText);
    const tarefa = this.deps.enqueueTask({
      canal_origem: "whatsapp",
      tipo: intent.tipo,
      agente_id: intent.agente_id,
      titulo: intent.titulo,
      prioridade: intent.prioridade,
      payload: {
        prompt: commandText,
        remetente_jid: msg.remoteJid,
        remetente_nome: msg.pushName ?? null,
        origem_audio: Boolean(msg.audioBuffer),
      },
    });

    await this.deps.client.sendMessage(msg.remoteJid, {
      text: `Recebi seu pedido! Os agentes iniciaram a produção (${intent.tipo} • tarefa #${tarefa.tarefa_id.slice(0, 8)}).`,
    });

    return tarefa;
  }
}
