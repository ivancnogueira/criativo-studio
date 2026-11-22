import type { AnexoChat, ChatVisualMeta, ToolDefinition } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { SharedTablesService } from "../../agent-data/shared-tables-service.ts";
import type { ChatVisualPreviewService } from "../../engine/runner/chat-visual-preview-service.ts";
import type { CanalMensagemRow, HandoffBus } from "../../engine/runner/handoff-bus.ts";
import type { HistorySearchService } from "../../engine/runner/history-search-service.ts";
import type { LibraryFoldersService } from "../../engine/runner/library-folders-service.ts";
import type { MemoryManager } from "../../engine/runner/memory-manager.ts";
import type { MemoryReviewService } from "../../engine/runner/memory-review-service.ts";
import type { SkillLearningService } from "../../engine/runner/skill-learning-service.ts";
import type { UiBlockRegistry } from "../../engine/runner/ui-block-registry.ts";
import type { LicenseClientService } from "../../license/license-service.ts";
import type { ApiKeysBridge, OrigemTurnoApiKey } from "../../vault/api-keys-bridge.ts";
import type { WebSocketHub } from "../websocket-hub.ts";
export const PHASE14_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "remember",
    description:
      "Registra ou atualiza uma memória de longo prazo no agente atual (em staging até a conclusão do turno). Respeita o orçamento de 8.192 bytes para 'essential' e protege memórias manuais do usuário.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Texto conciso da regra, preferência ou aprendizado durável." },
        memoryId: { type: "string", description: "ID opcional de memória anterior a atualizar." },
        inclusion: {
          type: "string",
          enum: ["essential", "searchable"],
          description: "'essential' entra sempre no prompt vivo; 'searchable' fica disponível via memory_recall.",
        },
        site: { type: "string", description: "Domínio opcional associado à memória (ex.: instagram.com)." },
      },
      required: ["text"],
    },
  },
  {
    name: "forget_memory",
    description:
      "Agenda a remoção de uma memória automática obsoleta ao concluir o turno (memórias manuais controladas pelo usuário são protegidas).",
    parameters: {
      type: "object",
      properties: {
        memoryId: { type: "string", description: "ID da memória a esquecer." },
        text: { type: "string", description: "Texto exato alternativo caso não possua o ID." },
      },
    },
  },
  {
    name: "memory_recall",
    description:
      "Busca memórias via SQLite FTS5 BM25 ('search'), lista memórias paginadas ('list') ou ajusta inclusão ('set_inclusion').",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["search", "list", "set_inclusion"],
          description: "Operação desejada (padrão: 'search' quando query presente, senão 'list').",
        },
        query: { type: "string", description: "Termos de busca FTS5." },
        site: { type: "string", description: "Domínio opcional para filtrar memórias." },
        limit: { type: "number", description: "Limite de itens retornados (1 a 50)." },
        after: { type: "string", description: "Cursor temporal ISO para paginação em 'list'." },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              memoryId: { type: "string" },
              inclusion: { type: "string", enum: ["essential", "searchable"] },
            },
            required: ["memoryId", "inclusion"],
          },
        },
      },
    },
  },
  {
    name: "search_memories",
    description: "Alias direto para buscar memórias do agente via FTS5 BM25.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        site: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description: "Alias direto para listar memórias paginadas do agente.",
    parameters: {
      type: "object",
      properties: {
        inclusion: { type: "string", enum: ["essential", "searchable"] },
        site: { type: "string" },
        after: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "set_memory_inclusion",
    description: "Altera a categoria ('essential' | 'searchable') de memórias automáticas do agente.",
    parameters: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              memoryId: { type: "string" },
              inclusion: { type: "string", enum: ["essential", "searchable"] },
            },
            required: ["memoryId", "inclusion"],
          },
        },
      },
      required: ["changes"],
    },
  },
  {
    name: "history_search",
    description:
      "Pesquisa conversas, threads e mensagens anteriores do agente com filtro temporal ('24h', '7d', 'YYYY-MM-DD') ou lê trecho contextual ao redor de uma mensagem.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID opcional da tarefa ou thread para restringir a busca." },
        query: { type: "string", description: "Texto a localizar nas mensagens anteriores." },
        after: { type: "string", description: "Filtro temporal relativo ('24h', '7d') ou data ISO." },
        cursor: { type: "string", description: "Cursor base64url retornado em nextCursor." },
        limit: { type: "number", description: "Quantidade máxima de resultados (1 a 50)." },
        messageId: { type: "string", description: "Se informado, lê trecho de mensagens até este messageId." },
        before: { type: "string", description: "Timestamp ISO opcional para ler mensagens anteriores." },
        offset: { type: "number" },
        includeWorkSteps: { type: "boolean" },
        workStepsOffset: { type: "number" },
      },
    },
  },
  {
    name: "history_read",
    description: "Lê um trecho cronológico de mensagens anteriores de uma conversa ou thread do agente.",
    parameters: {
      type: "object",
      properties: {
        canalId: { type: "string" },
        messageId: { type: "string" },
        before: { type: "string" },
        offset: { type: "number" },
        limit: { type: "number" },
        includeWorkSteps: { type: "boolean" },
        workStepsOffset: { type: "number" },
      },
    },
  },
  {
    name: "list_tables",
    description:
      "Lista todas as tabelas SQL colaborativas em shared-tables.db com schema CREATE TABLE, contagem de linhas e agente proprietário.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "query_data",
    description:
      "Executa uma única consulta SQL somente-leitura (SELECT, VALUES ou EXPLAIN) no banco compartilhado entre agentes.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Instrução SQL SELECT/VALUES única." },
        params: {
          type: "array",
          items: {
            type: "string",
            description: "Parâmetro posicional (?): texto, número ou booleano.",
          },
          description: "Parâmetros posicionais opcionais (?).",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "execute_data",
    description:
      "Executa uma única instrução DML/DDL (CREATE, INSERT, UPDATE, DELETE, ALTER, DROP) no banco SQL compartilhado respeitando posse por agente.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Instrução SQL DML/DDL única." },
        params: {
          type: "array",
          items: {
            type: "string",
            description: "Parâmetro posicional (?): texto, número ou booleano.",
          },
          description: "Parâmetros posicionais opcionais (?).",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "delete_table",
    description: "Remove uma tabela do banco SQL compartilhado caso pertença ao agente atual.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome exato da tabela a excluir." },
      },
      required: ["name"],
    },
  },
  {
    name: "html_render",
    description:
      "Renderiza um widget, gráfico, calculadora ou painel HTML interativo em iframe sandboxed no chat com suporte à ponte window.criativoPage.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "Código HTML completo ou fragmento (até 512.000 caracteres)." },
        title: { type: "string", description: "Título curto exibido no cabeçalho do painel." },
        height: { type: "number", description: "Altura inicial sugerida em pixels (80 a 2000)." },
      },
      required: ["html", "title"],
    },
  },
  {
    name: "html_preview",
    description:
      "Valida e pré-renderiza fora de vista um documento HTML antes de exibi-lo ao usuário, retornando altura medida e mensagens de console.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string" },
        width: { type: "number", description: "Largura da viewport de teste (240 a 1600, padrão 728)." },
        appearance: { type: "string", enum: ["dark", "light"] },
      },
      required: ["html"],
    },
  },
  {
    name: "ask_user",
    description:
      "Exibe um cartão interativo com 1 a 3 perguntas estruturadas (opções, múltipla escolha ou entrada secreta mascarada) e aguarda a resposta do usuário.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              header: { type: "string" },
              question: { type: "string" },
              detail: { type: "string" },
              isSecret: { type: "boolean" },
              multiSelect: { type: "boolean" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["label"],
                },
              },
            },
            required: ["question"],
          },
        },
      },
      required: ["questions"],
    },
  },
  {
    name: "ask_ui",
    description:
      "Exibe um cartão de aprovação, formulário estruturado ou confirmação crítica (com suporte a confirmHold para ações destrutivas) e suspende o turno até decisão.",
    parameters: {
      type: "object",
      properties: {
        blockId: { type: "string" },
        block: {
          type: "object",
          properties: {
            type: { type: "string" },
            variant: {
              type: "string",
              enum: ["confirm", "quick_replies", "choice", "form", "approval", "progress", "block_run"],
            },
            title: { type: "string" },
            description: { type: "string" },
            preview: { type: "string" },
            markdownPreview: { type: "string" },
            danger: { type: "boolean" },
            confirmHold: {
              type: "object",
              properties: {
                label: { type: "string" },
                durationMs: { type: "number" },
              },
              description: "Configuração opcional de segurar para confirmar (ou ativação).",
            },
            fields: { type: "array", items: { type: "object" } },
            actions: { type: "array", items: { type: "object" } },
          },
          required: ["title"],
        },
      },
      required: ["block"],
    },
  },
  {
    name: "acknowledge_request",
    description:
      "Apresenta um plano prévio resumido em etapas com contagem regressiva opcional (planStartAfterMs) antes de iniciar uma execução longa.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        message: { type: "string" },
        summaryMarkdown: { type: "string" },
        steps: { type: "array", items: { type: "string" }, description: "De 1 a 4 etapas resumidas." },
        startLabel: { type: "string" },
        cancelLabel: { type: "string" },
        alternativeLabel: { type: "string" },
        planStartAfterMs: { type: "number" },
      },
      required: ["steps"],
    },
  },
  {
    name: "request_api_key",
    description:
      "Solicita ao usuário uma chave de API através de um cartão seguro cifrado diretamente no Cofre AES-256-GCM (sem expor o segredo ao histórico).",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Identificador em maiúsculas (/^[A-Z][A-Z0-9_]{0,63}$/, ex.: ELEVENLABS_API_KEY).",
        },
        title: { type: "string" },
        label: { type: "string" },
        description: { type: "string" },
        docsUrl: { type: "string" },
        placeholder: { type: "string" },
        submit: { type: "string" },
        defaultScope: { type: "string", enum: ["todos_agentes", "agente_especifico"] },
      },
      required: ["name"],
    },
  },
  {
    name: "list_api_keys",
    description:
      "Lista apenas os nomes e escopos das chaves de API configuradas no Cofre visíveis ao agente (jamais retorna valores).",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "save_api_key",
    description:
      "Salva uma chave de API cifrada no Cofre AES-256-GCM (permitido exclusivamente em turnos iniciados diretamente pelo usuário local).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        key: { type: "string" },
        scope: { type: "string", enum: ["todos_agentes", "agente_especifico"] },
        notes: { type: "string" },
      },
      required: ["name", "key"],
    },
  },
  {
    name: "remove_api_key",
    description:
      "Remove uma chave de API exclusiva deste agente no Cofre (chaves globais compartilhadas só podem ser removidas pelo usuário).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_library_folders",
    description:
      "Lista a árvore de pastas hierárquicas da Biblioteca do agente, seus arquivos (até 200) e contagem de itens sem pasta.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Caminho ou ID opcional da pasta para filtrar." },
      },
    },
  },
  {
    name: "attach_files_to_response",
    description:
      "Anexa arquivos gerados/existentes de recursos/, conteudos/, saidas/ ou previas/ na resposta do chat e opcionalmente os organiza em uma pasta hierárquica.",
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Caminhos relativos dos arquivos dentro do workspace.",
        },
        folder: {
          type: "string",
          description: "Caminho hierárquico opcional (até 4 níveis, ex.: 'Campanha Outono/Carrossel').",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "react_to_user_message",
    description:
      "Adiciona exatamente 1 grafema emoji Unicode à mensagem atual do usuário (disponível apenas em chat 1:1 com o usuário).",
    parameters: {
      type: "object",
      properties: {
        emoji: { type: "string", description: "Exatamente 1 emoji Unicode (ex.: '🔥', '✅', '🎯')." },
      },
      required: ["emoji"],
    },
  },
  {
    name: "send_message",
    description:
      "Envia mensagem assíncrona estruturada para 1 a 32 colegas agentes com correlação por replyToMessageId, expectsReply e roteamento steer vs queue.",
    parameters: {
      type: "object",
      properties: {
        recipientAgentIds: {
          type: "array",
          items: { type: "string" },
          description: "Lista de 1 a 32 IDs de agentes destinatários distintos.",
        },
        text: { type: "string", description: "Mensagem ou instrução completa para os destinatários." },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Até 10 caminhos relativos seguros do workspace para anexar.",
        },
        replyToMessageId: {
          type: "string",
          description: "ID da mensagem inter-agente anterior que está sendo respondida.",
        },
        expectsReply: {
          type: "boolean",
          description: "Se true (padrão), aguarda retorno na conversa de origem; se false, entrega informativa final.",
        },
      },
      required: ["recipientAgentIds", "text"],
    },
  },
  {
    name: "load_skill",
    description:
      "Carrega sob demanda o manual SKILL.md completo de uma habilidade específica ou da habilidade principal do agente atual. Use apenas quando precisar das instruções técnicas detalhadas.",
    parameters: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Slug da habilidade (ex.: 'criar-carrossel'). Se omitido, carrega a habilidade padrão do agente atual.",
        },
      },
    },
  },
  {
    name: "list_agents",
    description:
      "Lista todos os agentes e especialistas configurados no estúdio (incluindo customizados) com seus IDs canônicos e @apelidos.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

export const PHASE14_TOOL_NAMES: ReadonlySet<string> = new Set(
  PHASE14_TOOLS_SCHEMA.map((t) => t.name),
);

export function isPhase14ToolName(name: string): boolean {
  return PHASE14_TOOL_NAMES.has(name);
}

export interface Phase14ToolServices {
  db: CriativoDatabase;
  wsHub?: WebSocketHub;
  sharedTables?: SharedTablesService;
  memoryManager?: MemoryManager;
  memoryReview?: MemoryReviewService;
  skillLearning?: SkillLearningService;
  historySearch?: HistorySearchService;
  libraryFolders?: LibraryFoldersService;
  handoffBus?: HandoffBus;
  visualPreview?: ChatVisualPreviewService;
  uiBlockRegistry?: UiBlockRegistry;
  apiKeysBridge?: ApiKeysBridge;
  licenseService?: LicenseClientService;
  workspaceRoot?: string;
  productRoot?: string;
  isAgentBusy?: (agenteId: string) => { busy: boolean; policy: "steer" | "queue" };
  onSteerMessage?: (recipientId: string, row: CanalMensagemRow) => void;
  onDispatchQueuedInterAgent?: (
    recipientId: string,
    row: CanalMensagemRow,
    nextHopDepth: number,
  ) => void;
}

export interface Phase14ToolContext {
  agenteId: string;
  canalId: string;
  threadId?: string | null;
  tarefaId?: string | null;
  turnId: string;
  origemTurno: OrigemTurnoApiKey;
  isOneToOneUserChat: boolean;
  lastUserMessageId?: string | null;
  hopDepth?: number;
  generatedArtifacts?: string[];
  generatedAnexos?: AnexoChat[];
  persistVisualMessage?: boolean;
  onVisualMessage?: (meta: ChatVisualMeta, itemType: string) => void;
}
