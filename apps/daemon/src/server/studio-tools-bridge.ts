import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  mcpConfigErrors,
  normalizeMcpConfig,
  whatsAppNumberForms,
  type ArquivoStudio,
  type MarketplaceSourceFilter,
  type McpAcessoAgentes,
  type McpServidorConfig,
  type ToolDefinition,
} from "@criativo/contracts";
import {
  DEFAULT_WHATSAPP_ACCOUNT_ID,
  WHATSAPP_MAX_POST_CHARS,
  WhatsAppArchiveService,
  type WhatsAppOrchestrator,
  type WhatsAppSessionManager,
} from "@criativo/whatsapp";
import type { CriativoDatabase } from "../database/client.ts";
import { ROSTER_15_AGENTES } from "../engine/runner/roster-defaults.ts";
import type { CatalogService } from "../marketplace/catalog-service.ts";
import type { SkillsManager } from "../marketplace/skills-manager.ts";
import type { McpGateway } from "../mcp/mcp-gateway.ts";
import {
  maskMcpServerForClient,
  redactMcpPayload,
  redactMcpSecrets,
} from "../mcp/mcp-redaction.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import {
  executeRoutineToolCall,
  isRoutineToolName,
  ROUTINE_AGENT_TOOLS_SCHEMA,
  type RoutineToolExecutionContext,
  type RoutineToolsDeps,
} from "../routines/routine-agent-tools.ts";
import {
  executeWorkflowToolCall,
  isWorkflowToolName,
  WORKFLOW_TOOL_DEFINITIONS,
  WORKFLOW_TOOL_NAMES,
} from "../workflows/workflow-tools.ts";
import type { WorkflowEngine } from "../workflows/workflow-engine.ts";
import type { AgentTasksService } from "../threads/agent-tasks-service.ts";
import type { AgentWaitsService } from "../waits/agent-waits-service.ts";
import type { QueueControlsService } from "../queue/queue-controls-service.ts";
import type { ContextResetService } from "../chat/context-reset-service.ts";
import type { MessagePinsService } from "../chat/message-pins-service.ts";
import type { WorkflowStore } from "../workflows/workflow-store.ts";
import type { VaultService } from "../vault/vault-service.ts";
import type { WebSocketHub } from "./websocket-hub.ts";

export {
  isRoutineToolName,
  isWorkflowToolName,
  ROUTINE_AGENT_TOOLS_SCHEMA,
  WORKFLOW_TOOL_DEFINITIONS,
  WORKFLOW_TOOL_NAMES,
};

export interface MetaCredentialsResolved {
  accessToken: string | null;
  accountId: string | null;
  tokenKeyFound: string | null;
  accountIdKeyFound: string | null;
  configured: boolean;
}

export interface MetaValidationReport {
  ok: boolean;
  estagio: 3 | 4 | 5 | 7;
  resumo: string;
  detalhes: {
    tokenConfigurado: boolean;
    accountIdConfigurado: boolean;
    httpStatus: number | null;
    graphApiOk: boolean;
    idConfere: boolean;
    username: string | null;
    followersCount: number | null;
    mediaCount: number | null;
    erro: string | null;
  };
}

export const UPGRADE_PACKAGE_SLUGS = {
  bonus: [
    "gerador-de-entregaveis",
    "engenharia-reversa-concorrentes",
    "consistencia-personagem",
  ],
  video: [
    "criar-video-reels",
    "roteirista-faceless",
    "roteirista-talking-head",
  ],
} as const;

export function resolveMetaCredentials(vault?: VaultService): MetaCredentialsResolved {
  if (!vault) {
    return {
      accessToken: null,
      accountId: null,
      tokenKeyFound: null,
      accountIdKeyFound: null,
      configured: false,
    };
  }

  let accessToken: string | null = null;
  let tokenKeyFound: string | null = null;
  for (const k of ["instagram_access_token", "META_ACCESS_TOKEN"]) {
    const val = vault.getSecret(k);
    if (val && val.trim().length > 0) {
      accessToken = val.trim();
      tokenKeyFound = k;
      break;
    }
  }

  let accountId: string | null = null;
  let accountIdKeyFound: string | null = null;
  for (const k of ["instagram_business_account_id", "META_IG_USER_ID"]) {
    const val = vault.getSecret(k);
    if (val && val.trim().length > 0) {
      accountId = val.trim();
      accountIdKeyFound = k;
      break;
    }
  }

  return {
    accessToken,
    accountId,
    tokenKeyFound,
    accountIdKeyFound,
    configured: Boolean(accessToken && accountId),
  };
}

/**
 * Executa validação segura da integração Meta Graph API v21.0 lendo do Cofre SQLite
 * sem jamais expor o token em logs, retornos ou mensagens ao usuário.
 */
export async function validateMetaIntegration(
  vault?: VaultService,
  fetchImpl: typeof fetch = fetch
): Promise<MetaValidationReport> {
  const creds = resolveMetaCredentials(vault);
  if (!creds.configured || !creds.accessToken || !creds.accountId) {
    return {
      ok: false,
      estagio: 3,
      resumo:
        "Credenciais Meta ausentes no Cofre AES-256-GCM. Salve Access Token e Business Account ID em Conexões → Apps & Canais → Instagram.",
      detalhes: {
        tokenConfigurado: Boolean(creds.accessToken),
        accountIdConfigurado: Boolean(creds.accountId),
        httpStatus: null,
        graphApiOk: false,
        idConfere: false,
        username: null,
        followersCount: null,
        mediaCount: null,
        erro: "Credenciais não cadastradas no Cofre.",
      },
    };
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(
      creds.accountId
    )}?fields=id,username,followers_count,media_count&access_token=${encodeURIComponent(
      creds.accessToken
    )}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      username?: string;
      followers_count?: number;
      media_count?: number;
      error?: { message?: string; code?: number };
    };

    if (!res.ok) {
      const msgErro = data.error?.message ?? `Meta Graph API respondeu HTTP ${res.status}`;
      return {
        ok: false,
        estagio: 7,
        resumo: `Falha na validação Meta Graph API (HTTP ${res.status}): ${msgErro}`,
        detalhes: {
          tokenConfigurado: true,
          accountIdConfigurado: true,
          httpStatus: res.status,
          graphApiOk: false,
          idConfere: false,
          username: null,
          followersCount: null,
          mediaCount: null,
          erro: msgErro,
        },
      };
    }

    const idConfere = String(data.id ?? "") === String(creds.accountId);
    const username = typeof data.username === "string" ? data.username : null;
    const followersCount = typeof data.followers_count === "number" ? data.followers_count : null;
    const mediaCount = typeof data.media_count === "number" ? data.media_count : null;

    return {
      ok: true,
      estagio: 5,
      resumo: `Integração Meta validada com sucesso (HTTP ${res.status} · Perfil conectado${
        username ? `: @${username}` : ""
      }).`,
      detalhes: {
        tokenConfigurado: true,
        accountIdConfigurado: true,
        httpStatus: res.status,
        graphApiOk: true,
        idConfere,
        username,
        followersCount,
        mediaCount,
        erro: null,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha de rede ao consultar Meta Graph API.";
    return {
      ok: false,
      estagio: 7,
      resumo: `Erro ao consultar Meta Graph API: ${msg}`,
      detalhes: {
        tokenConfigurado: true,
        accountIdConfigurado: true,
        httpStatus: null,
        graphApiOk: false,
        idConfere: false,
        username: null,
        followersCount: null,
        mediaCount: null,
        erro: msg,
      },
    };
  }
}

/**
 * Verifica se um pacote modular (`base`, `bonus` ou `video`) está desbloqueado na instalação.
 */
export function isUpgradeUnlocked(
  db: CriativoDatabase,
  workspaceRoot: string,
  pacote: "base" | "bonus" | "video"
): boolean {
  if (pacote === "base") return true;

  try {
    const row = db.connection
      .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'upgrades_instalados';`)
      .get() as { valor_json: string } | undefined;
    if (row) {
      const list = JSON.parse(row.valor_json) as unknown;
      if (Array.isArray(list) && list.includes(pacote)) {
        return true;
      }
    }
  } catch {
    // ignora erro de leitura
  }

  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return false;
  }

  const skillsDir = resolve(workspaceRoot, ".agents", "skills");
  const required = UPGRADE_PACKAGE_SLUGS[pacote];
  return required.some((slug) => existsSync(join(skillsDir, slug, "SKILL.md")));
}

const STUDIO_MEDIA_MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export interface ScannedWorkspaceFile {
  nome_original: string;
  caminho_relativo: string;
  mime_type: string;
  tamanho_bytes: number;
  tipo_uso: ArquivoStudio["tipo_uso"];
  criado_em: string;
  diskPath: string;
}

/**
 * Escaneia arquivos reais presentes nas pastas do workspace (`recursos/` e `saidas/`)
 * para exibição no Cockpit Web e injeção no contexto/ImagePaths dos agentes.
 */
export function scanWorkspaceMediaFiles(workspaceRoot: string, limit = 120): ScannedWorkspaceFile[] {
  const roots: Array<{ dir: string; tipoUso: ArquivoStudio["tipo_uso"] }> = [
    { dir: resolve(workspaceRoot, "recursos", "referencias"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "recursos", "fotos"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "recursos", "logos"), tipoUso: "logo" },
    { dir: resolve(workspaceRoot, "recursos", "personagens"), tipoUso: "personagem" },
    { dir: resolve(workspaceRoot, "recursos", "uploads"), tipoUso: "referencia" },
    { dir: resolve(workspaceRoot, "saidas"), tipoUso: "gerado" },
  ];

  const found: ScannedWorkspaceFile[] = [];

  const walk = (dir: string, defaultUso: ArquivoStudio["tipo_uso"]): void => {
    if (found.length >= limit || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) break;
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, defaultUso);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      const mime = STUDIO_MEDIA_MIME_MAP[ext];
      if (!mime) continue;
      try {
        const st = statSync(fullPath);
        if (st.size <= 0) continue;
        const rel = relative(workspaceRoot, fullPath).replaceAll("\\", "/");
        const tipoUso: ArquivoStudio["tipo_uso"] =
          mime.startsWith("video/") && defaultUso === "gerado" ? "video" : defaultUso;
        found.push({
          nome_original: basename(entry.name),
          caminho_relativo: rel,
          mime_type: mime,
          tamanho_bytes: st.size,
          tipo_uso: tipoUso,
          criado_em: st.mtime.toISOString(),
          diskPath: fullPath,
        });
      } catch {
        // ignora arquivo inacessível
      }
    }
  };

  for (const r of roots) {
    walk(r.dir, r.tipoUso);
  }

  return found.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}

/**
 * Sincroniza de forma idempotente arquivos do disco para `projecao_arquivos` no SQLite.
 */
export function syncWorkspaceFilesToDatabase(db: CriativoDatabase, workspaceRoot: string): number {
  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") return 0;

  const existingRows = db.connection
    .prepare(`SELECT caminho_relativo FROM projecao_arquivos;`)
    .all() as Array<{ caminho_relativo: string }>;
  const known = new Set(existingRows.map((r) => r.caminho_relativo.replaceAll("\\", "/")));

  const scanned = scanWorkspaceMediaFiles(workspaceRoot);
  const insertStmt = db.connection.prepare(
    `INSERT INTO projecao_arquivos (arquivo_id, nome_original, caminho_relativo, mime_type, tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?);`
  );

  let added = 0;
  for (const item of scanned) {
    if (known.has(item.caminho_relativo)) continue;
    insertStmt.run(
      `arq-${randomUUID().slice(0, 8)}`,
      item.nome_original,
      item.caminho_relativo,
      item.mime_type,
      item.tamanho_bytes,
      item.tipo_uso,
      item.criado_em
    );
    known.add(item.caminho_relativo);
    added += 1;
  }
  return added;
}

function readBrandSnippetIfRich(filePath: string, maxChars: number): string {
  if (!existsSync(filePath)) return "";
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return "";
    const onlyTemplates =
      raw.includes("[A PREENCHER]") && raw.includes("[NOME_DA_MARCA]") && raw.length < 300;
    return onlyTemplates ? "" : raw.slice(0, maxChars);
  } catch {
    return "";
  }
}

/**
 * Monta o Contexto Vivo seguro do Studio para injetar no systemPrompt de qualquer agente no Chat.
 */
export function buildStudioLiveContext(deps: {
  db: CriativoDatabase;
  vault?: VaultService;
  providerConnection: ProviderConnectionService;
  workspaceRoot: string;
}): string {
  syncWorkspaceFilesToDatabase(deps.db, deps.workspaceRoot);

  const onboarding = deps.providerConnection.getOnboardingState();
  const marcaConfig = deps.providerConnection.getStudioConfig<Record<string, unknown>>(
    "identidade_marca",
    {}
  );
  const metaCreds = resolveMetaCredentials(deps.vault);

  const secretsMeta = deps.vault ? deps.vault.listSecretsMetadata() : [];
  const secretNames = new Set(secretsMeta.map((s) => s.chave_nome));
  const hasEleven = secretNames.has("elevenlabs_api_key") || secretNames.has("ELEVENLABS_API_KEY");
  const hasTelegram = secretNames.has("telegram_bot_token") || secretNames.has("TELEGRAM_BOT_TOKEN");

  const files = deps.db.connection
    .prepare(
      `SELECT nome_original, caminho_relativo, tipo_uso FROM projecao_arquivos ORDER BY criado_em DESC LIMIT 20;`
    )
    .all() as Array<{ nome_original: string; caminho_relativo: string; tipo_uso: string }>;

  const canReadDisk = process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1";
  const perfilFileSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "conteudos", "perfil-da-marca.md"), 2500)
    : "";
  const idVisualSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "conteudos", "identidade-visual.yml"), 1400)
    : "";
  const brandbookSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "recursos", "brand", "brandbook.md"), 1500)
    : "";
  const designSystemSnippet = canReadDisk
    ? readBrandSnippetIfRich(resolve(deps.workspaceRoot, "recursos", "brand", "design-system.md"), 1200)
    : "";

  const lines: string[] = [
    "## Contexto Vivo do Criativo AI Studio Online",
    `- Marca configurada: ${String(marcaConfig.marca_nome ?? onboarding.marca_nome)} (${String(
      marcaConfig.perfil_handle ?? onboarding.perfil_handle
    )})`,
    ...(typeof marcaConfig.nicho === "string" && marcaConfig.nicho
      ? [`- Nicho/Segmento: ${marcaConfig.nicho}`]
      : []),
    ...(typeof marcaConfig.tom_voz === "string" && marcaConfig.tom_voz
      ? [`- Tom de Voz: ${marcaConfig.tom_voz}`]
      : []),
    `- Cofre AES-256-GCM (SQLite) — Meta/Instagram: ${
      metaCreds.configured
        ? "CONFIGURADO (token e account ID salvos no Cofre; nunca peça token no chat)"
        : "NÃO CONFIGURADO (oriente salvar em Conexões -> Apps & Canais -> Instagram)"
    }`,
    `- Cofre — ElevenLabs TTS: ${hasEleven ? "Configurado" : "Não configurado (fallback edge-tts)"}`,
    `- Cofre — Telegram Bot: ${hasTelegram ? "Configurado" : "Não configurado"}`,
    `- Regra de Ouro do Studio Online: As credenciais NÃO ficam em .env visível; ficam cifradas no Cofre SQLite e validadas pela ferramenta nativa 'validar_integracao_meta' (ou via 'npm run validar:integracoes').`,
  ];

  if (files.length > 0) {
    lines.push(
      `- Arquivos/Referências/ImagePaths disponíveis (${files.length}): ${files
        .map((f) => `${f.nome_original} (${f.tipo_uso}: ${f.caminho_relativo})`)
        .join("; ")}`
    );
  } else {
    lines.push(
      "- Arquivos/Referências/ImagePaths disponíveis: nenhuma mídia salva ainda em recursos/referencias/, recursos/fotos/ ou recursos/logos/."
    );
  }

  if (perfilFileSnippet) {
    lines.push("", "### Memória Estratégica (conteudos/perfil-da-marca.md)", perfilFileSnippet);
  }
  if (idVisualSnippet) {
    lines.push("", "### Identidade Visual (conteudos/identidade-visual.yml)", idVisualSnippet);
  }
  if (brandbookSnippet) {
    lines.push("", "### Brandbook da Marca (recursos/brand/brandbook.md)", brandbookSnippet);
  }
  if (designSystemSnippet) {
    lines.push("", "### Design System (recursos/brand/design-system.md)", designSystemSnippet);
  }

  lines.push(
    "",
    "### Equipe de Colegas para Handoff",
    ROSTER_15_AGENTES.map((a) => `- \`@${a.agente_id}\`: ${a.nome} — ${a.papel}`).join("\n"),
    "IMPORTANTE SOBRE HANDOFF: Só emita a tag `[HANDOFF:agente_id]` quando o usuário tiver pedido explicitamente para executar uma tarefa prática que exija passar o bastão para aquele especialista. NUNCA emita `[HANDOFF:...]` nem transfira a conversa quando estiver apenas se apresentando, respondendo 'oi', explicando o que você/sua equipe fazem ou tirando dúvidas."
  );

  try {
    if (deps.db.hasTable("projecao_agente_rotinas")) {
      const rotinasRows = deps.db.connection
        .prepare(
          `SELECT nome, owner_id, trigger_kind, ativa FROM projecao_agente_rotinas ORDER BY atualizado_em DESC LIMIT 15;`
        )
        .all() as Array<{ nome: string; owner_id: string; trigger_kind: string; ativa: number }>;
      const ativasCount = rotinasRows.filter((r) => r.ativa === 1).length;
      lines.push(
        "",
        "### Rotinas, Webhooks e Agenda",
        `- Rotinas registradas no estúdio: ${rotinasRows.length} (${ativasCount} ativas).`,
        "- Use `create_routine`, `update_routine`, `delete_routine`, `list_routines` ou `test_routine` para gerenciar rotinas agendadas; `create_webhook_routine`/`update_webhook_routine` apenas mediante pedido explícito humano no chat; e `routine_no_update`/`routine_report_failure` quando rodando em turno automático."
      );
    }
  } catch {
    // Tabela opcional em contextos legados
  }

  return lines.join("\n");
}

export interface StudioExtensionToolDeps {
  db: CriativoDatabase;
  vault?: VaultService;
  wsHub?: WebSocketHub;
  workspaceRoot?: string;
  agenteId?: string;
  canalId?: string | null;
  mcpGateway?: McpGateway;
  catalogService?: CatalogService;
  skillsManager?: SkillsManager;
  whatsappManager?: WhatsAppSessionManager;
  whatsappOrchestrator?: WhatsAppOrchestrator;
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
];

export const PHASE10_TOOL_NAMES: ReadonlySet<string> = new Set(
  PHASE10_TOOL_DEFINITIONS.map((t) => t.name)
);

export function isPhase10ExtensionTool(name: string): boolean {
  return PHASE10_TOOL_NAMES.has(name);
}

function readStringArg(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = args[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

function readStringArrayArg(args: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const val = args[key];
    if (Array.isArray(val)) {
      return val.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    }
  }
  return [];
}

function readStringRecordArg(
  args: Record<string, unknown>,
  ...keys: string[]
): Record<string, string> | undefined {
  for (const key of keys) {
    const val = args[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  }
  return undefined;
}

export function resolveSafeStudioMediaPath(workspaceRoot: string, rawMediaPath: string): string {
  const trimmed = rawMediaPath.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error("Caminho de mídia inválido.");
  }

  const allowedRoots = [
    resolve(workspaceRoot, "recursos"),
    resolve(workspaceRoot, "saidas"),
    resolve(workspaceRoot, "previas"),
  ];
  const resolvedTarget = isAbsolute(trimmed)
    ? resolve(trimmed)
    : resolve(workspaceRoot, trimmed);

  const contained = allowedRoots.some((root) => {
    const rel = relative(root, resolvedTarget);
    return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`) && !isAbsolute(rel);
  });

  if (!contained) {
    throw new Error(
      "Acesso negado: o anexo de mídia deve estar contido em recursos/, saidas/ ou previas/."
    );
  }

  if (!existsSync(resolvedTarget) || !statSync(resolvedTarget).isFile()) {
    throw new Error(`Arquivo de mídia não encontrado: ${rawMediaPath}`);
  }

  return resolvedTarget;
}

function normalizeTargetWhatsAppJid(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, "");
  return digits ? `${digits}@s.whatsapp.net` : trimmed;
}

function isRecipientAuthorizedForAccount(
  db: CriativoDatabase,
  contaId: string,
  targetJid: string
): boolean {
  const account = db.connection
    .prepare(`SELECT jid_proprio, numero_telefone FROM whatsapp_contas WHERE conta_id = ? LIMIT 1;`)
    .get(contaId) as { jid_proprio?: string | null; numero_telefone?: string | null } | undefined;

  const targetForms = new Set(whatsAppNumberForms(targetJid));
  if (account) {
    const ownForms = new Set([
      ...(account.jid_proprio ? whatsAppNumberForms(account.jid_proprio) : []),
      ...(account.numero_telefone ? whatsAppNumberForms(account.numero_telefone) : []),
    ]);
    for (const form of targetForms) {
      if (ownForms.has(form)) return true;
    }
  }

  const rows = db.connection
    .prepare(
      `SELECT tipo, identificador_jid, telefone_normalizado, variantes_json
       FROM whatsapp_contatos_autorizados
       WHERE conta_id = ? AND permitido = 1;`
    )
    .all(contaId) as Array<{
    tipo: string;
    identificador_jid: string;
    telefone_normalizado: string | null;
    variantes_json: string;
  }>;

  for (const row of rows) {
    if (row.identificador_jid === targetJid) return true;
    if (row.tipo === "contato") {
      if (row.telefone_normalizado && targetForms.has(row.telefone_normalizado)) return true;
      try {
        const variants = JSON.parse(row.variantes_json) as unknown;
        if (Array.isArray(variants) && variants.some((v) => typeof v === "string" && targetForms.has(v))) {
          return true;
        }
      } catch {
        // ignora JSON inválido
      }
      if (whatsAppNumberForms(row.identificador_jid).some((f) => targetForms.has(f))) {
        return true;
      }
    }
  }

  return false;
}

export async function executeStudioExtensionTool(
  toolName: string,
  args: Record<string, unknown>,
  deps: StudioExtensionToolDeps
): Promise<unknown> {
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();
  const getArchive = () =>
    new WhatsAppArchiveService({
      db: deps.db.connection,
      workspaceRoot,
    });

  switch (toolName) {
    // ------------------------------------------------------------------
    // 5 Tools WhatsApp (WAPP-03 / D-04)
    // ------------------------------------------------------------------
    case "messaging_list_places": {
      const contaId = readStringArg(args, "contaId", "conta_id");
      return getArchive().listPlaces(contaId);
    }

    case "messaging_history": {
      const contaId = readStringArg(args, "contaId", "conta_id");
      const chatJid = readStringArg(args, "chatJid", "chat_jid");
      const rawLimit = typeof args.limit === "number" ? args.limit : Number(args.limit ?? 30);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(100, Math.max(1, Math.trunc(rawLimit)))
        : 30;
      const mensagens = getArchive().listHistory({ contaId, chatJid, limit });
      return {
        contaId: contaId ?? null,
        chatJid: chatJid ?? null,
        limit,
        total: mensagens.length,
        mensagens,
      };
    }

    case "messaging_post": {
      if (!deps.whatsappOrchestrator) {
        throw new Error("Orquestrador WhatsApp não está ativo neste daemon.");
      }
      const contaId = readStringArg(args, "contaId", "conta_id") ?? DEFAULT_WHATSAPP_ACCOUNT_ID;
      const rawTarget = readStringArg(args, "chatJid", "chat_jid", "to", "destinatario");
      if (!rawTarget) {
        throw new Error("Informe 'chatJid' do destinatário autorizado para envio.");
      }
      const targetJid = normalizeTargetWhatsAppJid(rawTarget);
      if (!isRecipientAuthorizedForAccount(deps.db, contaId, targetJid)) {
        throw new Error(
          `Destinatário '${rawTarget}' não está autorizado na conta WhatsApp '${contaId}'.`
        );
      }

      const text = typeof args.text === "string"
        ? args.text
        : typeof args.texto === "string"
          ? args.texto
          : "";
      if (text.length > WHATSAPP_MAX_POST_CHARS) {
        throw new Error(
          `Mensagem excede o limite de ${WHATSAPP_MAX_POST_CHARS} caracteres por envio no WhatsApp.`
        );
      }

      const rawMediaPath = readStringArg(args, "mediaPath", "media_path");
      const safeMediaPath = rawMediaPath
        ? resolveSafeStudioMediaPath(workspaceRoot, rawMediaPath)
        : undefined;

      if (!text.trim() && !safeMediaPath) {
        throw new Error("Informe 'text' ou 'mediaPath' para enviar no WhatsApp.");
      }

      const registro = await deps.whatsappOrchestrator.sendMessageAndArchive(
        contaId,
        targetJid,
        {
          text,
          mediaPath: safeMediaPath,
          caption: readStringArg(args, "caption", "legenda"),
          asAudioPtt: typeof args.asAudioPtt === "boolean" ? args.asAudioPtt : undefined,
        }
      );

      return { ok: true, mensagem: registro };
    }

    case "messaging_remember": {
      if (!deps.whatsappOrchestrator) {
        throw new Error("Orquestrador WhatsApp não está ativo neste daemon.");
      }
      const texto = readStringArg(args, "texto", "text", "memory");
      if (!texto) {
        throw new Error("Informe o campo 'texto' para gravar a memória operacional.");
      }
      const contaId = readStringArg(args, "contaId", "conta_id") ?? DEFAULT_WHATSAPP_ACCOUNT_ID;
      const chatJid = readStringArg(args, "chatJid", "chat_jid");
      const memoria = deps.whatsappOrchestrator.rememberChannelMemory({
        contaId,
        chatJid,
        texto,
        origem: "manual",
      });
      return { ok: Boolean(memoria), memoria };
    }

    case "messaging_forget_memory": {
      if (!deps.whatsappOrchestrator) {
        throw new Error("Orquestrador WhatsApp não está ativo neste daemon.");
      }
      const contaId = readStringArg(args, "contaId", "conta_id") ?? DEFAULT_WHATSAPP_ACCOUNT_ID;
      const memoriaId = readStringArg(args, "memoriaId", "memoria_id", "id");
      const texto = readStringArg(args, "texto", "text");
      const chatJid = readStringArg(args, "chatJid", "chat_jid");
      if (!memoriaId && !texto) {
        throw new Error("Informe 'memoriaId' ou 'texto' para remover a memória do canal.");
      }
      const removed = deps.whatsappOrchestrator.forgetChannelMemory({
        contaId,
        memoriaId,
        texto,
        chatJid,
      });
      return { ok: removed, removed };
    }

    // ------------------------------------------------------------------
    // 5 Tools MCP + Sugestão de App (MCP-03 / STORE-02 / D-07)
    // ------------------------------------------------------------------
    case "list_mcp_servers": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const includeDisabled =
        typeof args.includeDisabled === "boolean" ? args.includeDisabled : true;
      const agentId = readStringArg(args, "agentId", "agenteId");
      const servers = deps.mcpGateway.store
        .listServersForClient({ includeDisabled, agentId })
        .map((srv) => ({
          ...maskMcpServerForClient(srv),
          oauthStatus: deps.mcpGateway!.oauthProvider.getOAuthStatus(srv.mcp_id),
        }));

      return { total: servers.length, servidores: servers };
    }

    case "save_mcp_server": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const rawAcesso = (args.acesso ?? args.access) as Partial<McpAcessoAgentes> | undefined;
      const payload: Partial<McpServidorConfig> = {
        mcp_id: readStringArg(args, "mcp_id", "mcpId"),
        nome: readStringArg(args, "nome", "name"),
        transporte:
          args.transporte === "http" || args.transport === "http"
            ? "http"
            : args.transporte === "stdio" || args.transport === "stdio"
              ? "stdio"
              : undefined,
        comando: readStringArg(args, "comando", "command"),
        args: readStringArrayArg(args, "args"),
        env: readStringRecordArg(args, "env"),
        envPassthrough: readStringArrayArg(args, "envPassthrough", "env_passthrough"),
        workingDirectory:
          args.workingDirectory === null || args.working_directory === null
            ? null
            : readStringArg(args, "workingDirectory", "working_directory"),
        url: args.url === null ? null : readStringArg(args, "url"),
        headers: readStringRecordArg(args, "headers"),
        acesso:
          rawAcesso && typeof rawAcesso === "object"
            ? {
                mode: rawAcesso.mode === "agents" ? "agents" : "everyone",
                agentIds: Array.isArray(rawAcesso.agentIds)
                  ? rawAcesso.agentIds.filter((id): id is string => typeof id === "string")
                  : [],
              }
            : undefined,
        ativo: typeof args.ativo === "boolean" ? args.ativo : true,
      };

      const normalized = normalizeMcpConfig(payload);
      const errors = mcpConfigErrors(normalized);
      const firstErr = errors.nome ?? errors.comando ?? errors.url ?? errors.acesso;
      if (firstErr) {
        throw new Error(firstErr);
      }

      const saved = deps.mcpGateway.store.saveServer(payload);
      deps.mcpGateway.invalidateServer(saved.mcp_id);
      deps.mcpGateway.refreshProxyRoutes();

      const shouldProbe = args.testar === true || args.probe === true;
      const probe = shouldProbe ? await deps.mcpGateway.testServer(saved.mcp_id) : undefined;
      const latest = deps.mcpGateway.store.getServer(saved.mcp_id, false) ?? saved;
      const oauthStatus = deps.mcpGateway.oauthProvider.getOAuthStatus(saved.mcp_id);

      deps.wsHub?.broadcast("mcp.status_atualizado", {
        mcp_id: latest.mcp_id,
        ativo: latest.ativo,
        oauth_status: oauthStatus,
        qtd_ferramentas: probe?.toolCount ?? latest.qtdFerramentas,
        ultimo_erro: latest.ultimoErro ?? null,
      });

      return redactMcpPayload(
        {
          ok: true,
          servidor: maskMcpServerForClient({ ...latest, oauthStatus }),
          ...(probe ? { probe } : {}),
        },
        []
      );
    }

    case "test_mcp_server": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const mcpId = readStringArg(args, "mcpId", "mcp_id");
      if (!mcpId) {
        throw new Error("Informe 'mcpId' do servidor MCP a testar.");
      }

      const resultado = await deps.mcpGateway.testServer(mcpId);
      const server = deps.mcpGateway.store.getServer(mcpId, false);
      if (resultado.status === "needs_sign_in") {
        const motivo = resultado.error ?? `Autenticação OAuth necessária para '${server?.nome ?? mcpId}'.`;
        deps.wsHub?.broadcast("mcp.oauth_solicitado", {
          mcp_id: mcpId,
          nome: server?.nome ?? mcpId,
          app_slug: server?.origemAppSlug ?? null,
          authorize_url: resultado.authUrl ?? null,
          canal_id: deps.canalId ?? null,
          agente_id: deps.agenteId ?? null,
          motivo,
        });
        return redactMcpPayload(
          {
            ...resultado,
            ok: false,
            action: "sign_in",
            mcpId,
            nome: server?.nome ?? mcpId,
            appSlug: server?.origemAppSlug ?? null,
            motivo,
          },
          []
        );
      }

      return redactMcpPayload({ ...resultado, mcpId }, []);
    }

    case "set_mcp_server_enabled": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const mcpId = readStringArg(args, "mcpId", "mcp_id");
      if (!mcpId || typeof args.ativo !== "boolean") {
        throw new Error("Informe 'mcpId' e 'ativo' (boolean).");
      }

      const updated = deps.mcpGateway.store.setServerEnabled(mcpId, args.ativo);
      deps.mcpGateway.invalidateServer(mcpId);
      deps.mcpGateway.refreshProxyRoutes();
      const oauthStatus = deps.mcpGateway.oauthProvider.getOAuthStatus(mcpId);

      deps.wsHub?.broadcast("mcp.status_atualizado", {
        mcp_id: updated.mcp_id,
        ativo: updated.ativo,
        oauth_status: oauthStatus,
        qtd_ferramentas: updated.qtdFerramentas,
        ultimo_erro: updated.ultimoErro ?? null,
      });

      return {
        ok: true,
        servidor: maskMcpServerForClient({ ...updated, oauthStatus }),
      };
    }

    case "remove_mcp_server": {
      if (!deps.mcpGateway) {
        throw new Error("McpGateway não inicializado neste daemon.");
      }
      const mcpId = readStringArg(args, "mcpId", "mcp_id");
      if (!mcpId) {
        throw new Error("Informe 'mcpId' do servidor MCP a remover.");
      }

      await deps.mcpGateway.oauthProvider.signOut(mcpId).catch(() => undefined);
      deps.mcpGateway.invalidateServer(mcpId);
      const removed = deps.mcpGateway.store.removeServer(mcpId);
      deps.mcpGateway.refreshProxyRoutes();

      if (removed) {
        deps.wsHub?.broadcast("mcp.status_atualizado", {
          mcp_id: mcpId,
          ativo: false,
          oauth_status: "disconnected",
          qtd_ferramentas: 0,
          ultimo_erro: null,
        });
      }

      return { ok: removed, removed, mcpId };
    }

    case "suggest_marketplace_app": {
      if (!deps.catalogService) {
        throw new Error("CatalogService não inicializado neste daemon.");
      }
      const slug = readStringArg(args, "slug");
      const query = readStringArg(args, "query", "q");
      let app = slug ? deps.catalogService.findAppBySlug(slug) : null;
      if (!app && (query || slug)) {
        app = deps.catalogService.searchCatalogApps(query ?? slug ?? "", 1)[0] ?? null;
      }

      if (!app) {
        return {
          type: "marketplace_app_suggestion",
          found: false,
          app: null,
        };
      }

      return {
        type: "marketplace_app_suggestion",
        app: {
          slug: app.slug,
          name: app.name,
          tagline: app.tagline,
          category: app.category,
          verified: app.verified,
          prompts: app.prompts,
        },
      };
    }

    // ------------------------------------------------------------------
    // 7 Tools Skills (STORE-03 / D-09)
    // ------------------------------------------------------------------
    case "list_local_skills": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const skills = deps.skillsManager.listSkills({
        query: readStringArg(args, "query", "q"),
        source: (readStringArg(args, "source", "fonte") as MarketplaceSourceFilter) ?? "all",
        agentId: readStringArg(args, "agentId", "agenteId"),
        category: readStringArg(args, "category", "categoria"),
      });
      return { total: skills.length, skills };
    }

    case "read_local_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!slugOrId) {
        throw new Error("Informe 'slugOrId' da habilidade.");
      }
      const result = deps.skillsManager.readSkill(slugOrId);
      if (!result) {
        throw new Error(`Habilidade '${slugOrId}' não encontrada.`);
      }
      return result;
    }

    case "create_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const name = readStringArg(args, "name", "nome");
      const description = readStringArg(args, "description", "descricao");
      const instructions = readStringArg(args, "instructions", "instrucoes");
      if (!name || !description || !instructions) {
        throw new Error("Informe 'name', 'description' e 'instructions' para criar a habilidade.");
      }
      const created = deps.skillsManager.createCustomSkill({
        name,
        slug: readStringArg(args, "slug"),
        description,
        category: readStringArg(args, "category", "categoria") ?? "Automação & Rotinas",
        instructions,
        agentIds: readStringArrayArg(args, "agentIds", "agentes"),
      });
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: created.skillId,
        acao: "criada",
      });
      return { ok: true, skill: created };
    }

    case "revise_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      const instructions = readStringArg(args, "instructions", "instrucoes");
      if (!slugOrId || !instructions) {
        throw new Error("Informe 'slugOrId' e 'instructions' para revisar a habilidade.");
      }
      const updated = deps.skillsManager.reviseSkill(slugOrId, {
        name: readStringArg(args, "name", "nome"),
        description: readStringArg(args, "description", "descricao"),
        category: readStringArg(args, "category", "categoria"),
        instructions,
      });
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: updated.skillId,
        acao: "atualizada",
      });
      return { ok: true, skill: updated };
    }

    case "install_local_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!slugOrId) {
        throw new Error("Informe 'slugOrId' da habilidade a instalar.");
      }
      const targetAgentIds = readStringArrayArg(args, "targetAgentIds", "agentIds", "agentes");
      const installed = deps.skillsManager.installCatalogSkill(slugOrId, targetAgentIds);
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: installed.skillId,
        acao: "instalada",
      });
      return { ok: true, skill: installed };
    }

    case "set_skill_enabled": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const agenteId = readStringArg(args, "agenteId", "agentId") ?? deps.agenteId;
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!agenteId || !slugOrId || typeof args.habilitada !== "boolean") {
        throw new Error("Informe 'agenteId', 'slugOrId' e 'habilitada' (boolean).");
      }
      const res = deps.skillsManager.setSkillEnabledForAgent(agenteId, slugOrId, args.habilitada);
      deps.wsHub?.broadcast("loja.skill_atualizada", {
        skill_id: res.skillId,
        acao: "vinculada",
      });
      return { ok: true, ...res };
    }

    case "uninstall_skill": {
      if (!deps.skillsManager) {
        throw new Error("SkillsManager não inicializado neste daemon.");
      }
      const slugOrId = readStringArg(args, "slugOrId", "slug", "skillId", "skill_id");
      if (!slugOrId) {
        throw new Error("Informe 'slugOrId' da habilidade a desinstalar.");
      }
      const res = deps.skillsManager.uninstallSkill(slugOrId);
      if (res.removed && res.skillId) {
        deps.wsHub?.broadcast("loja.skill_atualizada", {
          skill_id: res.skillId,
          acao: "removida",
        });
      }
      return { ok: res.removed, ...res };
    }

    default:
      throw new Error(`Ferramenta de extensão desconhecida: ${toolName}`);
  }
}

export async function executeStudioRoutineTool(
  toolName: string,
  args: Record<string, unknown>,
  options: {
    agenteId: string;
    turnOrigin?: RoutineToolExecutionContext["turnOrigin"];
    execucaoId?: string | null;
    routineToolsDeps?: RoutineToolsDeps;
    flags?: RoutineToolExecutionContext["flags"];
  }
): Promise<unknown> {
  if (!options.routineToolsDeps) {
    throw new Error("Serviço de rotinas e webhooks ainda não inicializado neste daemon.");
  }
  const ctx: RoutineToolExecutionContext = {
    agenteId: options.agenteId,
    turnOrigin: options.turnOrigin ?? "human",
    execucaoId: options.execucaoId ?? null,
    flags: options.flags ?? { noUpdateCalled: false, failureReason: null },
  };
  return await executeRoutineToolCall(
    {
      id: `studio-rot-${randomUUID().slice(0, 8)}`,
      name: toolName,
      arguments: args,
    },
    ctx,
    options.routineToolsDeps
  );
}

export function getChatWorkflowToolCatalog(): ToolDefinition[] {
  return WORKFLOW_TOOL_DEFINITIONS;
}

export async function executeChatWorkflowTool(
  toolName: string,
  args: Record<string, unknown>,
  options: {
    store?: WorkflowStore;
    engine?: WorkflowEngine;
    wsHub?: WebSocketHub;
    agenteId?: string;
    requestSeed?: string;
  }
): Promise<unknown> {
  if (!options.store || !options.engine) {
    throw new Error("Serviço de workflows em grafo ainda não inicializado neste daemon.");
  }
  return await executeWorkflowToolCall(toolName, args, {
    store: options.store,
    engine: options.engine,
    wsHub: options.wsHub,
    agenteId: options.agenteId,
    requestSeed: options.requestSeed,
  });
}

export const PHASE13_TOOL_NAMES = new Set([
  "start_task",
  "await_event",
  "close_wait",
  "list_waits",
  "interrupt_agent",
  "start_new_chat",
  "pin_message",
]);

export function isPhase13ToolName(name: string): boolean {
  return PHASE13_TOOL_NAMES.has(name);
}

export const PHASE13_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "start_task",
    description:
      "Inicia uma sub-tarefa paralela em uma nova thread isolada sem bloquear o chat principal. Disponível apenas no chat principal do agente ou em thread de rotina.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Título curto da tarefa paralela (1 a 140 caracteres)",
        },
        brief: {
          type: "string",
          description: "Briefing completo e instruções para o agente executar na sub-thread",
        },
      },
      required: ["title", "brief"],
    },
  },
  {
    name: "await_event",
    description:
      "Registra uma espera longa (>15 min) para acordar o agente automaticamente quando uma rotina futura ou webhook com waitId disparar.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Resumo do que está sendo aguardado e o que fazer quando despertar (1 a 2000 caracteres)",
        },
        routineId: {
          type: "string",
          description: "ID opcional da rotina específica vinculada a esta espera",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "close_wait",
    description: "Encerra definitivamente uma espera aberta após ela ter sido resolvida ou cancelada.",
    parameters: {
      type: "object",
      properties: {
        waitId: { type: "string", description: "ID da espera (waitId) a encerrar" },
        agentId: { type: "string", description: "ID opcional do agente dono da espera" },
      },
      required: ["waitId"],
    },
  },
  {
    name: "list_waits",
    description: "Lista todas as esperas abertas no agente informado (ou no agente atual).",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID opcional do agente alvo" },
      },
    },
  },
  {
    name: "interrupt_agent",
    description:
      "Cancela mensagens pendentes que você enviou para outro agente e interrompe o turno dele se estiver executando exclusivamente trabalho seu.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID do agente alvo (nunca você mesmo)" },
        reason: { type: "string", description: "Motivo breve exibido ao agente interrompido" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "start_new_chat",
    description:
      "Inicia um novo chat limpo para o modelo ao final do turno quando a fila estiver vazia, salvando memórias essenciais e preservando todo o histórico visual.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "pin_message",
    description:
      "Fixa ou desafixa uma mensagem importante nesta conversa. Sem quote, fixa a última mensagem do usuário no turno atual.",
    parameters: {
      type: "object",
      properties: {
        quote: {
          type: "string",
          description: "Trecho exato (1 a 500 chars) de uma mensagem anterior para localizar e fixar",
        },
        pinned: {
          type: "boolean",
          description: "true para fixar (padrão) ou false para desafixar (apenas pins do agente)",
        },
      },
    },
  },
];

export interface Phase13ToolServices {
  tasksService?: AgentTasksService;
  waitsService?: AgentWaitsService;
  queueControls?: QueueControlsService;
  contextReset?: ContextResetService;
  pinsService?: MessagePinsService;
}

export interface Phase13ToolContext {
  agenteId: string;
  turnoId: string;
  callId: string;
  threadId: string | null;
  canalId: string | null;
  entregaOrigemId: string;
  pedidoTexto: string;
  isRoutine?: boolean;
  isResumingWait?: boolean;
}

/**
 * Executa de maneira segura e corrigível qualquer uma das 7 ferramentas nativas da Fase 13.
 */
export async function executePhase13Tool(
  callName: string,
  args: Record<string, unknown>,
  context: Phase13ToolContext,
  services: Phase13ToolServices,
): Promise<{ handled: boolean; result?: unknown }> {
  if (!isPhase13ToolName(callName)) {
    return { handled: false };
  }

  try {
    switch (callName) {
      case "start_task": {
        if (!services.tasksService) {
          return { handled: true, result: { erro: "AgentTasksService indisponível." } };
        }
        const title = readStringArg(args, "title", "titulo") ?? "";
        const brief = readStringArg(args, "brief", "instrucao", "conteudo") ?? "";
        const result = services.tasksService.startTaskFromTool(
          {
            agenteId: context.agenteId,
            callerThreadId: context.threadId,
            callerChannelId: context.canalId,
            turnoId: context.turnoId,
            callId: context.callId,
          },
          { title, brief },
        );
        return { handled: true, result };
      }

      case "await_event": {
        if (!services.waitsService) {
          return { handled: true, result: { erro: "AgentWaitsService indisponível." } };
        }
        const note = readStringArg(args, "note", "nota") ?? "";
        const routineId = readStringArg(args, "routineId", "rotinaId", "rotina_id") ?? undefined;
        const result = services.waitsService.openWaitFromTool(
          {
            agenteId: context.agenteId,
            entregaOrigemId: context.entregaOrigemId,
            pedidoTexto: context.pedidoTexto,
            callerThreadId: context.threadId,
            callerIsRoutine: Boolean(context.isRoutine),
            isResumingWait: context.isResumingWait,
          },
          { note, routineId },
        );
        return { handled: true, result };
      }

      case "close_wait": {
        if (!services.waitsService) {
          return { handled: true, result: { erro: "AgentWaitsService indisponível." } };
        }
        const waitId = readStringArg(args, "waitId", "esperaId", "espera_id") ?? "";
        const agentId = readStringArg(args, "agentId", "agenteId", "agente_id") ?? undefined;
        if (!waitId) {
          return { handled: true, result: { erro: "Informe 'waitId' para encerrar a espera." } };
        }
        const result = services.waitsService.closeWait(waitId, agentId);
        return { handled: true, result };
      }

      case "list_waits": {
        if (!services.waitsService) {
          return { handled: true, result: { erro: "AgentWaitsService indisponível." } };
        }
        const targetAgent =
          readStringArg(args, "agentId", "agenteId", "agente_id") ?? context.agenteId;
        const result = services.waitsService.listWaitsFromTool(targetAgent);
        return { handled: true, result };
      }

      case "interrupt_agent": {
        if (!services.queueControls) {
          return { handled: true, result: { erro: "QueueControlsService indisponível." } };
        }
        const targetAgent = readStringArg(args, "agentId", "agenteId", "agente_id") ?? "";
        const reason = readStringArg(args, "reason", "motivo") ?? undefined;
        if (!targetAgent) {
          return { handled: true, result: { erro: "Informe 'agentId' do agente alvo." } };
        }
        const result = services.queueControls.interruptAgentFromTool(
          context.agenteId,
          targetAgent,
          reason,
        );
        return { handled: true, result };
      }

      case "start_new_chat": {
        if (!services.contextReset) {
          return { handled: true, result: { erro: "ContextResetService indisponível." } };
        }
        const result = services.contextReset.requestNewChat({
          agenteId: context.agenteId,
          threadId: context.threadId,
        });
        return { handled: true, result };
      }

      case "pin_message": {
        if (!services.pinsService) {
          return { handled: true, result: { erro: "MessagePinsService indisponível." } };
        }
        const quote = readStringArg(args, "quote", "trecho") ?? undefined;
        const pinned = typeof args.pinned === "boolean" ? args.pinned : true;
        const result = services.pinsService.pinFromTool({
          agenteId: context.agenteId,
          threadId: context.threadId ?? `main:${context.agenteId}`,
          currentTurnId: context.turnoId,
          quote,
          pinned,
        });
        return { handled: true, result };
      }

      default:
        return { handled: false };
    }
  } catch (err) {
    return {
      handled: true,
      result: {
        ok: false,
        erro: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function readAgentContextCutoffAt(db: CriativoDatabase, agenteId: string): string | null {
  const row = db.connection
    .prepare("SELECT config_json FROM projecao_agentes WHERE agente_id = ?;")
    .get(agenteId) as { config_json: string } | undefined;
  if (!row) return null;
  try {
    const cfg = JSON.parse(row.config_json) as { context_cutoff_at?: unknown };
    return typeof cfg.context_cutoff_at === "string" && cfg.context_cutoff_at.length > 0
      ? cfg.context_cutoff_at
      : null;
  } catch {
    return null;
  }
}

export function buildPhase13SystemGuidance(options?: {
  allowStartTask?: boolean;
  wokenWaitsBlock?: string | null;
}): string {
  const parts: string[] = [
    "## Sub-tarefas, Esperas, Fila & Contexto (Ferramentas Nativas)",
    "- Use `start_task(title, brief)` quando uma solicitação envolver uma entrega pesada paralela ou múltiplos eixos que possam rodar sem travar o chat principal.",
    "- Use `await_event(note, routineId?)` para processos externos longos (>15 min) ligados a uma rotina/webhook e `close_wait(waitId)` / `list_waits()` quando concluir.",
    "- Use `pin_message(quote?, pinned?)` para fixar decisões-chave desta conversa, e `start_new_chat()` quando a conversa mudar totalmente de tópico e precisar renovar o contexto.",
  ];
  if (options?.wokenWaitsBlock) {
    parts.push("", options.wokenWaitsBlock);
  }
  return parts.join("\n");
}
