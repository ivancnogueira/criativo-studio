import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type {
  AgentRoutine,
  RoutineDestinationOption,
  RoutineResultDelivery,
  RoutineRun,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { RoutineStore } from "./routine-store.ts";

export interface WhatsAppDeliveryAdapter {
  getStatus(): { status: string; numero?: string | null };
  sendMessage(
    toJid: string,
    payload: { text?: string; image?: Buffer; caption?: string }
  ): Promise<unknown>;
}

export interface RoutineResultDispatcherOptions {
  db: CriativoDatabase;
  routineStore: RoutineStore;
  wsHub: WebSocketHub;
  vault: VaultService;
  whatsapp?: WhatsAppDeliveryAdapter | null;
  fetchImpl?: FetchLike;
}

function sanitizeProviderError(message: string, secrets: string[]): string {
  let clean = message;
  for (const s of secrets) {
    if (s && s.length >= 6) {
      clean = clean.split(s).join("[SEGREDO_REDIGIDO]");
    }
  }
  return clean.slice(0, 600);
}

/**
 * Roteia entregas externas configuradas em rotinas (`canal`, `whatsapp`, `telegram`, `notificacao`)
 * registrando o ciclo em `projecao_rotina_entregas` sem jamais falhar ou sobrescrever `execucao.status`.
 */
export class RoutineResultDispatcher {
  private readonly db: CriativoDatabase;
  private readonly routineStore: RoutineStore;
  private readonly wsHub: WebSocketHub;
  private readonly vault: VaultService;
  private whatsapp: WhatsAppDeliveryAdapter | null;
  private readonly fetchImpl: FetchLike;

  constructor(options: RoutineResultDispatcherOptions) {
    this.db = options.db;
    this.routineStore = options.routineStore;
    this.wsHub = options.wsHub;
    this.vault = options.vault;
    this.whatsapp = options.whatsapp ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public setWhatsAppAdapter(adapter: WhatsAppDeliveryAdapter | null): void {
    this.whatsapp = adapter;
  }

  private resolveTelegramCredentials(): { token: string | null; defaultChatId: string | null } {
    const token =
      this.vault.getSecret("TELEGRAM_BOT_TOKEN") ??
      this.vault.getSecret("telegram_bot_token");
    const defaultChatId =
      this.vault.getSecret("TELEGRAM_CHAT_ID") ??
      this.vault.getSecret("telegram_chat_id");
    return { token, defaultChatId };
  }

  public listDestinationOptions(): RoutineDestinationOption[] {
    const options: RoutineDestinationOption[] = [
      {
        tipo: "notificacao",
        id: "cockpit",
        nome: "Notificação no Cockpit",
        disponivel: true,
        detalhe: "Exibe alerta em tempo real na interface",
      },
    ];

    const channels = this.db.connection
      .prepare(
        `SELECT canal_id, nome FROM projecao_grupos_equipe ORDER BY atualizado_em DESC, nome ASC;`
      )
      .all() as Array<{ canal_id: string; nome: string }>;

    for (const ch of channels) {
      options.push({
        tipo: "canal",
        id: ch.canal_id,
        nome: ch.nome,
        disponivel: true,
        detalhe: "Posta entrega no Canal em Equipe",
      });
    }

    const wpp = this.whatsapp?.getStatus();
    if (wpp) {
      const targetId = wpp.numero ? `${wpp.numero}@s.whatsapp.net` : "whatsapp-conectado";
      options.push({
        tipo: "whatsapp",
        id: targetId,
        nome: wpp.numero ? `WhatsApp (${wpp.numero})` : "WhatsApp conectado",
        disponivel: wpp.status === "conectado",
        detalhe: wpp.status === "conectado" ? "Conectado e pronto" : "Desconectado no momento",
      });
    }

    const { token, defaultChatId } = this.resolveTelegramCredentials();
    options.push({
      tipo: "telegram",
      id: defaultChatId || "telegram-bot",
      nome: "Telegram Bot",
      disponivel: Boolean(token),
      detalhe: token ? "Configurado no Cofre" : "Configure TELEGRAM_BOT_TOKEN no Cofre",
    });

    return options;
  }

  public async dispatchDelivery(params: {
    execucao: RoutineRun;
    routine: AgentRoutine;
    contentText: string;
    artifacts: string[];
    silenced: boolean;
  }): Promise<RoutineResultDelivery | null> {
    const { execucao, routine, contentText, artifacts, silenced } = params;
    const dest = routine.destino_resultado;

    if (!dest || dest.tipo === "none") {
      return null;
    }

    const destId =
      dest.tipo === "canal"
        ? dest.canal_id
        : dest.tipo === "whatsapp"
          ? dest.destino_id
          : dest.tipo === "telegram"
            ? dest.chat_id
            : "cockpit";
    const destName = dest.destino_nome || destId;

    if (silenced) {
      return this.routineStore.upsertDelivery({
        execucao_id: execucao.execucao_id,
        rotina_id: routine.rotina_id,
        owner_id: routine.owner_id,
        destino_tipo: dest.tipo,
        destino_id: destId,
        destino_nome: destName,
        conteudo_texto: null,
        status: "quiet",
        tentativas: 0,
      });
    }

    const formattedText = (contentText || "Rotina concluída.").trim();
    const existing = this.routineStore.getDelivery(execucao.execucao_id);
    const attemptNumber = (existing?.tentativas ?? 0) + 1;

    this.routineStore.upsertDelivery({
      execucao_id: execucao.execucao_id,
      rotina_id: routine.rotina_id,
      owner_id: routine.owner_id,
      destino_tipo: dest.tipo,
      destino_id: destId,
      destino_nome: destName,
      conteudo_texto: formattedText,
      status: "sending",
      tentativas: attemptNumber,
    });

    const secretsToRedact: string[] = [];

    try {
      if (dest.tipo === "canal") {
        const msgId = `msg-rot-${randomUUID()}`;
        const agora = new Date().toISOString();
        const anexosJson = JSON.stringify(
          artifacts.slice(0, 6).map((pathStr, idx) => ({
            arquivo_id: `rot-art-${idx}-${execucao.execucao_id}`,
            nome: pathStr.split(/[\\/]/).pop() || `arquivo-${idx + 1}`,
            caminho_relativo: pathStr,
            url: pathStr,
            mime_type: /\.(png|jpe?g|webp)$/i.test(pathStr)
              ? "image/png"
              : "application/octet-stream",
          }))
        );

        this.db.connection
          .prepare(
            `
            INSERT INTO projecao_conversas_chat (
              mensagem_id, canal_id, agente_id, autor, autor_nome,
              conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em
            ) VALUES (?, ?, ?, 'agente', ?, ?, ?, '[]', ?, 0, ?);
          `
          )
          .run(
            msgId,
            dest.canal_id,
            routine.owner_id,
            routine.nome,
            formattedText,
            anexosJson,
            execucao.tarefa_id ?? null,
            agora
          );

        this.wsHub.broadcast("chat:message", {
          canal_id: dest.canal_id,
          agente_id: routine.owner_id,
          mensagem: {
            mensagem_id: msgId,
            canal_id: dest.canal_id,
            agente_id: routine.owner_id,
            autor: "agente",
            autor_nome: routine.nome,
            conteudo_markdown: formattedText,
            anexos: [],
            steps: [],
            tarefa_id: execucao.tarefa_id ?? null,
            lida: false,
            criado_em: agora,
          },
        });
      } else if (dest.tipo === "whatsapp") {
        if (!this.whatsapp || this.whatsapp.getStatus().status !== "conectado") {
          throw new Error("WhatsApp desconectado no momento do envio da rotina.");
        }
        const firstImage = artifacts.find(
          (p) => /\.(png|jpe?g|webp)$/i.test(p) && existsSync(p)
        );
        if (firstImage) {
          await this.whatsapp.sendMessage(dest.destino_id, {
            image: readFileSync(firstImage),
            caption: formattedText.slice(0, 1000),
          });
        } else {
          await this.whatsapp.sendMessage(dest.destino_id, {
            text: formattedText.slice(0, 4000),
          });
        }
      } else if (dest.tipo === "telegram") {
        const { token, defaultChatId } = this.resolveTelegramCredentials();
        if (token) secretsToRedact.push(token);
        const chatId = dest.chat_id || defaultChatId;
        if (!token || !chatId) {
          throw new Error("Credenciais TELEGRAM_BOT_TOKEN / chat_id ausentes no Cofre.");
        }

        const resp = await this.fetchImpl(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `*${routine.nome}*\n\n${formattedText.slice(0, 3500)}`,
              parse_mode: "Markdown",
            }),
          }
        );

        if (!resp.ok) {
          throw new Error(`Telegram retornou HTTP ${resp.status}.`);
        }
      } else if (dest.tipo === "notificacao") {
        this.wsHub.broadcast("routine:notification", {
          rotina_id: routine.rotina_id,
          rotina_nome: routine.nome,
          owner_id: routine.owner_id,
          resumo: formattedText.slice(0, 280),
          execucao_id: execucao.execucao_id,
        });
      }

      return this.routineStore.upsertDelivery({
        execucao_id: execucao.execucao_id,
        rotina_id: routine.rotina_id,
        owner_id: routine.owner_id,
        destino_tipo: dest.tipo,
        destino_id: destId,
        destino_nome: destName,
        conteudo_texto: formattedText,
        status: "sent",
        tentativas: attemptNumber,
        enviado_em: new Date().toISOString(),
        motivo_falha: null,
      });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = sanitizeProviderError(rawMsg, secretsToRedact);
      const retryAfter = new Date(Date.now() + 60_000 * attemptNumber).toISOString();

      return this.routineStore.upsertDelivery({
        execucao_id: execucao.execucao_id,
        rotina_id: routine.rotina_id,
        owner_id: routine.owner_id,
        destino_tipo: dest.tipo,
        destino_id: destId,
        destino_nome: destName,
        conteudo_texto: formattedText,
        status: "failed",
        tentativas: attemptNumber,
        proximo_envio_em: attemptNumber < 3 ? retryAfter : null,
        motivo_falha: safeMsg,
      });
    }
  }

  public async resendDelivery(
    rotinaId: string,
    execucaoId: string
  ): Promise<RoutineResultDelivery | null> {
    const routine = this.routineStore.getById(rotinaId);
    const execucao = this.routineStore.getRun(execucaoId);
    const existing = this.routineStore.getDelivery(execucaoId);
    if (!routine || !execucao || !existing || execucao.rotina_id !== rotinaId) {
      return null;
    }

    return await this.dispatchDelivery({
      execucao,
      routine,
      contentText:
        existing.conteudo_texto ?? execucao.resultado_resumo ?? routine.instrucao,
      artifacts: [],
      silenced: false,
    });
  }
}
