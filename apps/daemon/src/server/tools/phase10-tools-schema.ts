import type { ToolDefinition } from "@criativo/contracts";
import type { WhatsAppOrchestrator, WhatsAppSessionManager } from "@criativo/whatsapp";
import type { CriativoDatabase } from "../../database/client.ts";
import type { FetchLike } from "../../engine/providers/provider-interface.ts";
import type { CatalogService } from "../../marketplace/catalog-service.ts";
import type { NativeAppConnectionsStore } from "../../marketplace/native-app-connections-store.ts";
import type { SkillsManager } from "../../marketplace/skills-manager.ts";
import type { McpGateway } from "../../mcp/mcp-gateway.ts";
import type { ProviderConnectionService } from "../../providers/provider-connection-service.ts";
import type { LicenseClientService } from "../../license/license-service.ts";
import type { TranscriptionService } from "../../voice/transcription-service.ts";
import type { VaultService } from "../../vault/vault-service.ts";
import type { BackgroundJobService } from "../../waits/background-job-service.ts";
import type { WebSocketHub } from "../websocket-hub.ts";
import { META_2026_TOOLS_SCHEMA } from "./meta-2026-tools-schema.ts";
import { VIDEO_STUDIO_TOOLS_SCHEMA } from "./video-tools-schema.ts";
export interface StudioExtensionToolDeps {
  db: CriativoDatabase;
  vault?: VaultService;
  wsHub?: WebSocketHub;
  workspaceRoot?: string;
  productRoot?: string;
  licenseService?: LicenseClientService;
  transcription?: TranscriptionService;
  agenteId?: string;
  canalId?: string | null;
  threadId?: string | null;
  channelOrigin?: "web" | "whatsapp";
  whatsappContaId?: string | null;
  whatsappChatJid?: string | null;
  backgroundJobService?: BackgroundJobService;
  mcpGateway?: McpGateway;
  catalogService?: CatalogService;
  nativeStore?: NativeAppConnectionsStore;
  providerConnection?: ProviderConnectionService;
  skillsManager?: SkillsManager;
  whatsappManager?: WhatsAppSessionManager;
  whatsappOrchestrator?: WhatsAppOrchestrator;
  fetchImpl?: FetchLike;
  onImageProgress?: (evt: {
    status: "executando" | "concluido" | "erro";
    formato: string;
    mensagem: string;
    stepId: string;
  }) => void;
}

export const PHASE10_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "messaging_list_places",
    description:
      "Lista as contas WhatsApp configuradas, contatos/grupos autorizados e conversas recentes disponíveis para envio ou consulta.",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "Opcional: filtra por ID da conta WhatsApp." },
      },
    },
  },
  {
    name: "messaging_history",
    description:
      "Consulta o histórico recente de mensagens WhatsApp armazenadas (padrão 30, máximo 100 mensagens).",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "ID da conta WhatsApp." },
        chatJid: { type: "string", description: "JID do chat/contato/grupo." },
        limit: { type: "number", description: "Quantidade máxima de mensagens (1 a 100, padrão 30)." },
      },
    },
  },
  {
    name: "messaging_post",
    description:
      "Envia mensagem de texto (máximo 8.000 caracteres) e anexo de mídia opcional para um contato ou grupo autorizado no WhatsApp.",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "ID da conta WhatsApp (padrão: whatsapp-principal)." },
        chatJid: { type: "string", description: "JID ou número de telefone autorizado do destinatário." },
        text: { type: "string", description: "Texto da mensagem (até 8.000 caracteres)." },
        mediaPath: {
          type: "string",
          description: "Caminho relativo seguro em recursos/, saidas/ ou previas/ para anexo.",
        },
        caption: { type: "string", description: "Legenda opcional para imagem/vídeo/documento." },
        asAudioPtt: { type: "boolean", description: "Se áudio, envia como mensagem de voz (PTT)." },
      },
      required: ["chatJid"],
    },
  },
  {
    name: "messaging_remember",
    description:
      "Registra uma memória operacional durável para uma conta ou conversa específica do WhatsApp.",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "ID da conta WhatsApp (padrão: whatsapp-principal)." },
        chatJid: { type: "string", description: "Opcional: JID do chat associado à memória." },
        texto: { type: "string", description: "Regra, preferência ou contexto operacional a lembrar." },
      },
      required: ["texto"],
    },
  },
  {
    name: "messaging_forget_memory",
    description: "Remove uma memória operacional registrada anteriormente no canal WhatsApp.",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "ID da conta WhatsApp (padrão: whatsapp-principal)." },
        memoriaId: { type: "string", description: "ID exato da memória a esquecer." },
        texto: { type: "string", description: "Texto exato ou trecho da memória a remover." },
        chatJid: { type: "string", description: "Opcional: JID do chat associado." },
      },
    },
  },
  {
    name: "list_mcp_servers",
    description:
      "Lista todos os servidores MCP cadastrados, status de conexão, quantidade de ferramentas, status OAuth e escopo de agentes (sem expor segredos).",
    parameters: {
      type: "object",
      properties: {
        includeDisabled: { type: "boolean", description: "Incluir servidores desativados (padrão true)." },
        agentId: { type: "string", description: "Opcional: filtra servidores autorizados para este agente." },
      },
    },
  },
  {
    name: "save_mcp_server",
    description:
      "Cria ou atualiza um servidor MCP STDIO ou Streamable HTTP no estúdio, armazenando segredos com segurança no Cofre.",
    parameters: {
      type: "object",
      properties: {
        mcp_id: { type: "string", description: "Opcional ao criar; obrigatório para atualizar servidor específico." },
        nome: { type: "string", description: "Nome identificador do servidor MCP." },
        transporte: { type: "string", enum: ["stdio", "http"] },
        comando: { type: "string", description: "Executável STDIO (ex.: npx, node)." },
        args: { type: "array", items: { type: "string" } },
        env: { type: "object", additionalProperties: { type: "string" } },
        envPassthrough: { type: "array", items: { type: "string" } },
        workingDirectory: { type: "string" },
        url: { type: "string", description: "URL HTTP/HTTPS para transporte Streamable HTTP." },
        headers: { type: "object", additionalProperties: { type: "string" } },
        acesso: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["everyone", "agents"] },
            agentIds: { type: "array", items: { type: "string" } },
          },
        },
        ativo: { type: "boolean" },
        testar: { type: "boolean", description: "Quando true, executa sondagem real após salvar." },
      },
      required: ["nome"],
    },
  },
  {
    name: "test_mcp_server",
    description:
      "Executa sondagem real em um servidor MCP salvo, retornando ferramentas descobertas ou solicitando OAuth se necessário.",
    parameters: {
      type: "object",
      properties: {
        mcpId: { type: "string", description: "ID do servidor MCP a testar." },
      },
      required: ["mcpId"],
    },
  },
  {
    name: "set_mcp_server_enabled",
    description: "Ativa ou desativa um servidor MCP cadastrado sem apagá-lo.",
    parameters: {
      type: "object",
      properties: {
        mcpId: { type: "string" },
        ativo: { type: "boolean" },
      },
      required: ["mcpId", "ativo"],
    },
  },
  {
    name: "remove_mcp_server",
    description: "Remove um servidor MCP e revoga credenciais OAuth e segredos associados no Cofre.",
    parameters: {
      type: "object",
      properties: {
        mcpId: { type: "string" },
      },
      required: ["mcpId"],
    },
  },
  {
    name: "suggest_marketplace_app",
    description:
      "Sugere ao usuário um aplicativo oficial do catálogo da Loja Unificada inline no chat com prompts prontos.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Slug do app (ex.: canva, figma, notion, elevenlabs, github)." },
        query: { type: "string", description: "Termo de busca caso não saiba o slug exato." },
      },
    },
  },
  {
    name: "list_local_skills",
    description: "Lista habilidades instaladas e disponíveis no catálogo local da Loja.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        source: { type: "string", enum: ["all", "verified", "public"] },
        agentId: { type: "string" },
        category: { type: "string" },
      },
    },
  },
  {
    name: "read_local_skill",
    description: "Lê os metadados e o conteúdo completo do SKILL.md de uma habilidade instalada ou do catálogo.",
    parameters: {
      type: "object",
      properties: {
        slugOrId: { type: "string", description: "Slug ou skillId da habilidade." },
      },
      required: ["slugOrId"],
    },
  },
  {
    name: "create_skill",
    description:
      "Cria uma nova habilidade personalizada (SKILL.md) em dados/skills-loja/ e opcionalmente vincula aos agentes.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        slug: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        instructions: { type: "string", description: "Conteúdo Markdown completo das instruções." },
        agentIds: { type: "array", items: { type: "string" } },
      },
      required: ["name", "description", "instructions"],
    },
  },
  {
    name: "revise_skill",
    description: "Atualiza instruções e metadados de uma habilidade local não-nativa.",
    parameters: {
      type: "object",
      properties: {
        slugOrId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        instructions: { type: "string" },
      },
      required: ["slugOrId", "instructions"],
    },
  },
  {
    name: "install_local_skill",
    description: "Instala uma habilidade do catálogo da Loja para o disco local e vincula aos agentes informados.",
    parameters: {
      type: "object",
      properties: {
        slugOrId: { type: "string" },
        targetAgentIds: { type: "array", items: { type: "string" } },
      },
      required: ["slugOrId"],
    },
  },
  {
    name: "set_skill_enabled",
    description: "Habilita ou desabilita uma habilidade vinculada para um agente específico.",
    parameters: {
      type: "object",
      properties: {
        agenteId: { type: "string" },
        slugOrId: { type: "string" },
        habilitada: { type: "boolean" },
      },
      required: ["agenteId", "slugOrId", "habilitada"],
    },
  },
  {
    name: "uninstall_skill",
    description: "Desinstala uma habilidade da Loja, GitHub ou personalizada (habilidades nativas são protegidas).",
    parameters: {
      type: "object",
      properties: {
        slugOrId: { type: "string" },
      },
      required: ["slugOrId"],
    },
  },
  {
    name: "validar_integracao_meta",
    description:
      "Valida as credenciais Meta/Instagram armazenadas no Cofre AES-256-GCM contra a Meta Graph API v27.0 oficial sem expor tokens.",
    parameters: {
      type: "object",
      properties: {
        contaId: { type: "string", description: "Opcional: ID da conta Instagram nativa salva na Loja." },
      },
    },
  },
  {
    name: "consultar_metricas_meta",
    description:
      "Consulta métricas reais da conta Instagram Business/Creator e dos posts/Reels recentes via Meta Graph API v27.0 (views, reach, saved, shares, reposts, total_interactions, taxa de salvamento, ig_reels_avg_watch_time, reels_skip_rate [skip_rate_3s_pct] e hook_retention_3s_pct).",
    parameters: {
      type: "object",
      properties: {
        periodo: {
          type: "string",
          enum: ["7d", "28d", "30d", "90d"],
          description: "Janela de análise desejada (padrão 30d).",
        },
        limite_posts: {
          type: "number",
          description: "Quantidade máxima de publicações recentes a inspecionar (1 a 25, padrão 15).",
        },
        incluir_reels: {
          type: "boolean",
          description: "Incluir métricas de retenção de Reels (padrão true).",
        },
        conta_id: {
          type: "string",
          description: "Opcional: ID da conta Instagram salva na Loja.",
        },
      },
    },
  },
  {
    name: "meta_publicar",
    description:
      "Publica criativo aprovado no Instagram via Meta Graph API v27.0 (bloqueado se approved_by_human != true ou se o agente não tiver permissão ao app Instagram).",
    parameters: {
      type: "object",
      properties: {
        media_type: { type: "string", enum: ["IMAGE", "CAROUSEL", "REELS", "STORIES"] },
        media_urls: { type: "array", items: { type: "string" } },
        caption: { type: "string" },
        approved_by_human: { type: "boolean" },
        conta_id: { type: "string" },
        editorial_post_id: { type: "string" },
        trial_reel: {
          type: "boolean",
          description: "Quando true e media_type='REELS', publica como Trial Reel (teste com não seguidores; exige >= 1.000 seguidores).",
        },
        trial_graduation_strategy: {
          type: "string",
          enum: ["MANUAL", "SS_PERFORMANCE"],
          description: "Estratégia de graduação do Trial Reel (padrão SS_PERFORMANCE).",
        },
        first_comment: {
          type: "string",
          description: "Texto opcional do 1º comentário pós-publicação (hashtags, CTA ou link).",
        },
        first_comment_approved: {
          type: "boolean",
          description: "Exige aprovação humana explícita para agendar/disparar o 1º comentário; se false, fica pendente.",
        },
        first_comment_delay_seconds: {
          type: "number",
          description: "Atraso em segundos após a publicação para disparar o 1º comentário (0 a 3600, padrão 30).",
        },
      },
      required: ["media_type", "media_urls", "caption", "approved_by_human"],
    },
  },
  {
    name: "salvar_identidade_marca",
    description:
      "Salva ou atualiza os dados estruturados da marca (nome comercial, @handle, nicho, público-alvo, oferta principal, tom de voz, cores e fontes) em conteudos/perfil-da-marca.md e SQLite.",
    parameters: {
      type: "object",
      properties: {
        marca_nome: { type: "string" },
        perfil_handle: { type: "string" },
        nicho: { type: "string" },
        publico_alvo: { type: "string" },
        oferta_principal: { type: "string" },
        tom_voz: { type: "string" },
        cores: {
          type: "object",
          properties: {
            fundo: { type: "string" },
            texto: { type: "string" },
            primaria: { type: "string" },
            secundaria: { type: "string" },
            acento: { type: "string" },
          },
        },
        fontes: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            texto: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "concluir_setup_inicial",
    description:
      "Marca o setup inicial assistido como concluído (setup_assistant_dismissed = true) e oculta automaticamente o agente Assistente de Configuração da Sidebar.",
    parameters: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Resumo curto do que foi concluído ou dispensado." },
      },
    },
  },
  {
    name: "concluir_conexao_vps",
    description:
      "Marca o fluxo guiado de conexão de servidor VPS como concluído/encerrado (vps_assistant_visible = false) e oculta o Especialista em Servidor VPS da Sidebar.",
    parameters: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Resumo curto da conexão concluída ou motivo do encerramento." },
      },
    },
  },
  {
    name: "generate_image",
    description:
      "Gera uma imagem ou arte visual real via Gemini Nano Banana 2.1 (até 14 referências), OpenAI GPT Image 2.6/2.5 (até 16 referências via /images/edits), Flux ou Antigravity. Você decide quantas e quais referências enviar via `imagens_referencia` (ou `fotos_especificas`/`referencias_especificas`).",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Briefing visual detalhado da arte (cena, texto na arte, composição e preservação da foto real).",
        },
        formato: {
          type: "string",
          enum: ["3:4", "9:16", "1:1", "16:9"],
          description: "Proporção desejada: '3:4' (post feed), '9:16' (stories), '1:1' ou '16:9'.",
        },
        motor: {
          type: "string",
          enum: ["auto", "gemini", "openai", "antigravity", "flux"],
          description: "Motor de geração preferido. Padrão 'auto' prioriza API Keys configuradas (Nano Banana 2.1 / GPT Image 2.6) ou conta Antigravity.",
        },
        modelo: {
          type: "string",
          description: "Modelo explícito opcional (ex.: 'gemini-nano-banana-2.1', 'gpt-image-2.6-sunburst', 'gpt-image-2.5-sunburst').",
        },
        resolucao: {
          type: "string",
          enum: ["1K", "2K", "4K"],
          description: "Resolução desejada no Gemini Nano Banana 2.1 (padrão '2K').",
        },
        qualidade: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Qualidade desejada no GPT Image (padrão 'high').",
        },
        usar_fotos_reais: {
          type: "boolean",
          description: "Se false, evita incluir fotos reais automaticamente quando nenhuma lista explícita for passada.",
        },
        imagens_referencia: {
          type: "array",
          items: { type: "string" },
          description: "Lista livre escolhida pelo agente com caminhos relativos de fotos, referências estéticas e/ou logos (até 14 no Gemini ou 16 no GPT Image).",
        },
        fotos_especificas: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos relativos opcionais de fotos específicas em recursos/fotos/.",
        },
        referencias_especificas: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos relativos opcionais de referências de estilo em recursos/referencias/.",
        },
        max_fotos: {
          type: "number",
          description: "Quantidade máxima opcional de fotos reais para busca automática quando nenhuma lista explícita for informada.",
        },
        max_referencias: {
          type: "number",
          description: "Quantidade máxima opcional de referências estéticas para busca automática.",
        },
        max_logos: {
          type: "number",
          description: "Quantidade máxima opcional de logos para busca automática.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_video",
    description:
      "Gera um vídeo MP4 curto com áudio nativo sincronizado usando Gemini Omni 1.2 Flash (`gemini-omni-1.2-flash`), com duração de 3 a 15s e até 6 imagens de referência à escolha do agente, salvando em saidas/videos/.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Descrição cinematográfica detalhada da cena, movimento de câmera, ação, falas/áudio ambiente e ritmo visual.",
        },
        formato: {
          type: "string",
          enum: ["9:16", "16:9", "1:1"],
          description: "Proporção do vídeo: '9:16' (Reels/Shorts/Stories), '16:9' (landscape) ou '1:1'. Padrão '9:16'.",
        },
        duracao_segundos: {
          type: "number",
          description: "Duração do clipe em segundos inteiros (mínimo 3, máximo 15, padrão 8).",
        },
        resolucao: {
          type: "string",
          enum: ["360p", "720p", "1080p", "4k"],
          description: "Resolução de saída desejada (padrão '720p').",
        },
        modelo: {
          type: "string",
          description: "Modelo opcional (padrão 'gemini-omni-1.2-flash').",
        },
        usar_fotos_reais: {
          type: "boolean",
          description: "Se true (padrão quando não passar imagens_referencia), inclui fotos reais da marca para consistência.",
        },
        imagens_referencia: {
          type: "array",
          items: { type: "string" },
          description: "Lista livre escolhida pelo agente com até 6 imagens de referência (personagem, produto, cenário).",
        },
        fotos_especificas: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos relativos opcionais de fotos específicas em recursos/fotos/.",
        },
        referencias_especificas: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos relativos opcionais de referências visuais em recursos/referencias/.",
        },
        max_fotos: { type: "number" },
        max_referencias: { type: "number" },
      },
      required: ["prompt"],
    },
  },
  ...VIDEO_STUDIO_TOOLS_SCHEMA,
  ...META_2026_TOOLS_SCHEMA,
];

export const PHASE10_TOOL_NAMES: ReadonlySet<string> = new Set(
  PHASE10_TOOL_DEFINITIONS.map((t) => t.name)
);

export function isPhase10ExtensionTool(name: string): boolean {
  return PHASE10_TOOL_NAMES.has(name);
}
