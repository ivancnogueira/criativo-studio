import type { ConversationMessage } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { ProviderRegistry } from "../engine/providers/provider-registry.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import type { WebSocketHub } from "../server/websocket-hub.ts";

export const MAX_SIDE_CONTEXT_MESSAGES = 60;
export const MAX_SIDE_CONTEXT_CHARS = 60_000;
export const MAX_SIDE_HISTORY_CHARS = 60_000;

export interface SideQuestionServiceDeps {
  db: CriativoDatabase;
  providers: ProviderRegistry;
  providerConnection: ProviderConnectionService;
  wsHub?: WebSocketHub;
}

export interface AskSideQuestionInput {
  agenteId: string;
  threadId?: string | null;
  pergunta: string;
  historicoLateral?: Array<{ pergunta: string; resposta?: string | null }>;
}

/**
 * Executa Pergunta Lateral efêmera (Side Question) lendo contexto visível pós-cutoff sem usar ferramentas
 * e sem gravar nenhuma entrada no histórico principal ou na fila do chat.
 */
export class SideQuestionService {
  private readonly db: CriativoDatabase;
  private readonly providers: ProviderRegistry;
  private readonly providerConnection: ProviderConnectionService;

  constructor(deps: SideQuestionServiceDeps) {
    this.db = deps.db;
    this.providers = deps.providers;
    this.providerConnection = deps.providerConnection;
  }

  public async ask(input: AskSideQuestionInput): Promise<{
    resposta: string;
    respondida_em: string;
    contexto_mensagens_usadas: number;
    caracteres_contexto: number;
  }> {
    const cleanQuestion = input.pergunta.trim();
    if (!cleanQuestion) {
      throw new Error("Digite uma pergunta para o painel lateral.");
    }

    const agente = this.db.connection
      .prepare(
        "SELECT agente_id, nome, cargo, modelo_padrao, prompt_sistema, config_json FROM projecao_agentes WHERE agente_id = ?;",
      )
      .get(input.agenteId) as
      | {
          agente_id: string;
          nome: string;
          cargo: string;
          modelo_padrao: string;
          prompt_sistema: string;
          config_json: string;
        }
      | undefined;

    if (!agente) {
      throw new Error(`Agente não encontrado: ${input.agenteId}`);
    }

    let cutoffAt: string | null = null;
    try {
      const cfg = JSON.parse(agente.config_json) as { context_cutoff_at?: unknown };
      if (typeof cfg.context_cutoff_at === "string" && cfg.context_cutoff_at.length > 0) {
        cutoffAt = cfg.context_cutoff_at;
      }
    } catch {
      // ignora config inválida
    }

    const effectiveThreadId =
      input.threadId && input.threadId.trim().length > 0
        ? input.threadId
        : `main:${agente.agente_id}`;
    const isMain = effectiveThreadId === `main:${agente.agente_id}`;

    const rawRows = (
      isMain
        ? this.db.connection
            .prepare(
              `
              SELECT autor, conteudo_markdown, criado_em
              FROM projecao_conversas_chat
              WHERE (thread_id = ? OR (thread_id IS NULL AND canal_id = ?))
                AND COALESCE(status, 'completed') != 'streaming'
                AND COALESCE(item_type, 'mensagem') = 'mensagem'
                AND (? IS NULL OR criado_em > ?)
              ORDER BY criado_em DESC, COALESCE(ordinal, 0) DESC, mensagem_id DESC
              LIMIT ?;
            `,
            )
            .all(
              effectiveThreadId,
              `agente:${agente.agente_id}`,
              cutoffAt,
              cutoffAt,
              MAX_SIDE_CONTEXT_MESSAGES,
            )
        : this.db.connection
            .prepare(
              `
              SELECT autor, conteudo_markdown, criado_em
              FROM projecao_conversas_chat
              WHERE thread_id = ?
                AND COALESCE(status, 'completed') != 'streaming'
                AND COALESCE(item_type, 'mensagem') = 'mensagem'
              ORDER BY criado_em DESC, COALESCE(ordinal, 0) DESC, mensagem_id DESC
              LIMIT ?;
            `,
            )
            .all(effectiveThreadId, MAX_SIDE_CONTEXT_MESSAGES)
    ) as Array<{ autor: string; conteudo_markdown: string; criado_em: string }>;

    // Mantém ordem cronológica respeitando orçamento de MAX_SIDE_CONTEXT_CHARS (do mais antigo ao mais novo)
    const chronological = [...rawRows].reverse();
    const boundedContext: Array<{ autor: string; texto: string }> = [];
    let ctxChars = 0;
    for (let i = chronological.length - 1; i >= 0; i -= 1) {
      const item = chronological[i]!;
      const len = item.conteudo_markdown.length;
      if (boundedContext.length > 0 && ctxChars + len > MAX_SIDE_CONTEXT_CHARS) {
        break;
      }
      boundedContext.unshift({
        autor: item.autor,
        texto: item.conteudo_markdown.slice(0, MAX_SIDE_CONTEXT_CHARS),
      });
      ctxChars += Math.min(len, MAX_SIDE_CONTEXT_CHARS);
    }

    const boundedSideHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let sideChars = 0;
    const rawSide = input.historicoLateral ?? [];
    for (let i = rawSide.length - 1; i >= 0; i -= 1) {
      const pair = rawSide[i]!;
      const q = (pair.pergunta ?? "").trim();
      const a = (pair.resposta ?? "").trim();
      const pairChars = q.length + a.length;
      if (boundedSideHistory.length > 0 && sideChars + pairChars > MAX_SIDE_HISTORY_CHARS) {
        break;
      }
      const chunk: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (q) chunk.push({ role: "user", content: q.slice(0, MAX_SIDE_HISTORY_CHARS) });
      if (a) chunk.push({ role: "assistant", content: a.slice(0, MAX_SIDE_HISTORY_CHARS) });
      boundedSideHistory.unshift(...chunk);
      sideChars += pairChars;
    }

    const contextSummary =
      boundedContext.length > 0
        ? boundedContext
            .map((m) => `[${m.autor === "usuario" ? "Usuário" : agente.nome}]: ${m.texto}`)
            .join("\n\n")
        : "(Sem mensagens anteriores no contexto atual desta conversa.)";

    const systemPrompt = [
      `Você é ${agente.nome} (${agente.cargo}).`,
      agente.prompt_sistema,
      "Modo PERGUNTA LATERAL EFÊMERA:",
      "- Responda apenas à dúvida paralela do usuário com base no recorte da conversa abaixo e em seu conhecimento.",
      "- Você NÃO possui ferramentas disponíveis neste painel (tools: []): não execute ações, não altere arquivos e não simule tool calls.",
      "- Responda em pt-br de forma direta e concisa.",
      "",
      "## Recorte da conversa principal:",
      contextSummary,
    ].join("\n");

    const providerName = this.providers.resolveProviderName(agente.modelo_padrao);
    const agService = this.providerConnection.getAntigravityService();
    const [statusList, agSnapshot] = await Promise.all([
      this.providerConnection.getProvidersStatus(false),
      agService.getLiveSnapshot(false),
    ]);
    const providerStatus = statusList.find((item) => item.provedor === providerName);
    const claudeOAuthStatus = statusList.find((item) => item.provedor === "claude");
    const openaiOAuthStatus = statusList.find((item) => item.provedor === "openai");
    const opencodeStatus = statusList.find((item) => item.provedor === "opencode");

    const hasAntigravityAccount = agSnapshot.contas.some(
      (c) => c.estado === "conectado" || Boolean(c.token_valido),
    );
    const modelBelongsToAntigravity =
      hasAntigravityAccount &&
      (providerName === "gemini" || agSnapshot.modelos.some((m) => m.id === agente.modelo_padrao));
    const hasClaudeOAuth = Boolean(claudeOAuthStatus?.contas && claudeOAuthStatus.contas.length > 0);
    const hasOpenAIOAuth = Boolean(openaiOAuthStatus?.contas && openaiOAuthStatus.contas.length > 0);
    const canOpenCode = providerName === "opencode" && Boolean(opencodeStatus?.conectado);
    const canVaultOrLocal =
      Boolean(providerStatus?.vault_configurado) ||
      (providerName === "ollama" && Boolean(providerStatus?.conectado));

    const messages: ConversationMessage[] = [
      ...boundedSideHistory,
      { role: "user", content: cleanQuestion },
    ];

    let respostaTexto: string | null = null;

    if (
      ((providerName === "claude" && hasClaudeOAuth) ||
        (providerName === "openai" && hasOpenAIOAuth)) &&
      !providerStatus?.vault_configurado
    ) {
      const res = await this.providerConnection.getCliOAuthService().executeTurn({
        provedor: providerName as "claude" | "openai",
        modelId: agente.modelo_padrao,
        systemPrompt,
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant",
          text: m.content,
        })),
      });
      respostaTexto = res.text;
    } else if (canOpenCode) {
      const res = await this.providerConnection.getOpenCodeService().executePrompt({
        modelId: agente.modelo_padrao,
        systemPrompt,
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant",
          text: m.content,
        })),
        agentId: agente.agente_id,
      });
      respostaTexto = res.text;
    } else if (canVaultOrLocal) {
      const client = this.providers.getClientForModel(agente.modelo_padrao);
      const res = await client.executeTurn({
        model: agente.modelo_padrao,
        systemPrompt,
        messages,
        tools: [],
      });
      respostaTexto = res.text;
    } else if (modelBelongsToAntigravity) {
      const res = await agService.executeCodeAssistGenerate({
        model: agente.modelo_padrao,
        systemPrompt,
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant",
          text: m.content,
        })),
        agentId: agente.agente_id,
      });
      respostaTexto = res.text;
    } else {
      throw new Error(
        `Nenhum provedor conectado para responder à pergunta lateral com o modelo '${agente.modelo_padrao}'.`,
      );
    }

    return {
      resposta: (respostaTexto ?? "").trim() || "Não foi possível obter resposta do modelo.",
      respondida_em: new Date().toISOString(),
      contexto_mensagens_usadas: boundedContext.length,
      caracteres_contexto: ctxChars,
    };
  }
}
