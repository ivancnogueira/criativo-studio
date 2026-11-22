import {
  join,
} from "node:path";
import type {
  ConectorIntegracaoInfo,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  VaultService,
} from "../vault/vault-service.ts";
export * from "./skills-discovery-service.ts";
export * from "./telemetry-ingest-service.ts";
export * from "./host-analytics-service.ts";

export function buildConnectorsList(db: CriativoDatabase, vault: VaultService): ConectorIntegracaoInfo[] {
  const secrets = new Map(vault.listSecretsMetadata().map((s) => [s.chave_nome, s]));
  const waRow = db.connection
    .prepare(`SELECT status, sessao_dados_json FROM projecao_conexoes_mensageria WHERE tipo_servico = 'whatsapp';`)
    .get() as { status: string; sessao_dados_json?: string | null } | undefined;

  let waAccounts: Array<{
    conta_id: string;
    rotulo: string;
    numero_telefone: string | null;
    modo_operacao: string;
    status: string;
    agente_orquestrador_id: string | null;
  }> = [];
  try {
    waAccounts = db.connection
      .prepare(
        `SELECT conta_id, rotulo, numero_telefone, modo_operacao, status, agente_orquestrador_id
         FROM whatsapp_contas
         ORDER BY CASE WHEN conta_id = 'whatsapp-principal' THEN 0 ELSE 1 END, atualizado_em DESC;`
      )
      .all() as typeof waAccounts;
  } catch {
    waAccounts = [];
  }

  const mcpCountRow = db.connection
    .prepare(`SELECT COUNT(*) as total FROM projecao_mcp_servidores WHERE ativo = 1;`)
    .get() as { total: number };
  const mcpServers = db.connection
    .prepare(
      `SELECT mcp_id, nome, transporte, comando, url, ativo, qtd_ferramentas
       FROM projecao_mcp_servidores
       ORDER BY posicao ASC, nome ASC;`
    )
    .all() as Array<{
    mcp_id: string;
    nome: string;
    transporte?: string | null;
    comando: string;
    url?: string | null;
    ativo: number;
    qtd_ferramentas?: number | null;
  }>;

  const oauthStatusMap = new Map<string, "conectado" | "expirado">();
  try {
    const oauthRows = db.connection
      .prepare(`SELECT mcp_id, perdido_em FROM projecao_mcp_oauth_tokens;`)
      .all() as Array<{ mcp_id: string; perdido_em: string | null }>;
    for (const row of oauthRows) {
      if (row.perdido_em === null) {
        oauthStatusMap.set(row.mcp_id, "conectado");
      } else if (!oauthStatusMap.has(row.mcp_id)) {
        oauthStatusMap.set(row.mcp_id, "expirado");
      }
    }
  } catch {
    // tabela ausente em bancos legados antes da migração
  }

  const cfgRow = db.connection
    .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'conectores_orquestradores';`)
    .get() as { valor_json: string } | undefined;
  const orquestradores = cfgRow ? (JSON.parse(cfgRow.valor_json) as Record<string, string>) : {};

  const igTokenOk = secrets.has("instagram_access_token") || secrets.has("META_ACCESS_TOKEN");
  const igBizOk = secrets.has("instagram_business_account_id") || secrets.has("META_IG_USER_ID");
  const tgOk = secrets.has("telegram_bot_token") || secrets.has("TELEGRAM_BOT_TOKEN");
  const elevenOk = secrets.has("elevenlabs_api_key") || secrets.has("ELEVENLABS_API_KEY");
  const fishOk = secrets.has("fish_audio_api_key") || secrets.has("FISH_AUDIO_API_KEY");
  const slackBotOk = secrets.has("slack_bot_token");
  const slackSecretOk = secrets.has("slack_signing_secret");
  const discordBotOk = secrets.has("discord_bot_token");
  const discordAppOk = secrets.has("discord_application_id");
  const discordPubOk = secrets.has("discord_public_key");
  const discordWebhookOk = secrets.has("discord_webhook_url");
  const githubTokenOk = secrets.has("github_token");
  const githubSecretOk = secrets.has("github_webhook_secret");

  const connectedAccounts = waAccounts.filter((a) => a.status === "conectado");
  const awaitingAccounts = waAccounts.filter(
    (a) => a.status === "aguardando_qrcode" || a.status === "aguardando_qr"
  );
  const waStatus: ConectorIntegracaoInfo["status"] =
    waAccounts.length > 0
      ? connectedAccounts.length > 0
        ? "conectado"
        : awaitingAccounts.length > 0
          ? "atencao"
          : "desconectado"
      : waRow?.status === "conectado"
        ? "conectado"
        : waRow?.status === "aguardando_qrcode" || waRow?.status === "aguardando_qr"
          ? "atencao"
          : "desconectado";

  const waResumo =
    waAccounts.length > 0
      ? connectedAccounts.length > 0
        ? `${connectedAccounts.length} de ${waAccounts.length} conta(s) conectada(s)`
        : awaitingAccounts.length > 0
          ? "Aguardando pareamento (QR Code ou código)"
          : `${waAccounts.length} conta(s) configurada(s) · desconectado`
      : waStatus === "conectado"
        ? "Aparelho pareado e pronto para comandos"
        : waStatus === "atencao"
          ? "Aguardando leitura do QR Code"
          : "Não conectado";

  const waDetalhes =
    waAccounts.length > 0
      ? waAccounts.map((acc) => ({
          chave: acc.conta_id,
          rotulo: `${acc.rotulo}${acc.numero_telefone ? ` (${acc.numero_telefone})` : ""} · ${
            acc.modo_operacao === "ownNumber" ? "Número próprio" : "Dedicado"
          }`,
          configurado: acc.status === "conectado",
        }))
      : [{ chave: "whatsapp_pairing", rotulo: "Pareamento Baileys", configurado: waStatus === "conectado" }];

  return [
    {
      id: "whatsapp",
      nome: "WhatsApp",
      categoria: "mensageria",
      descricao: "Receba áudios, imagens e briefings pelo WhatsApp (multi-número, QR Code ou código) e aprove prévias com '1'.",
      subtitulo:
        waAccounts.length > 1
          ? `${connectedAccounts.length}/${waAccounts.length} contas WhatsApp conectadas`
          : "Canal direto do Studio no celular",
      status: waStatus,
      resumo_estado: waResumo,
      cor_marca: "#25D366",
      agente_orquestrador_id:
        orquestradores.whatsapp ?? waAccounts[0]?.agente_orquestrador_id ?? "estrategista",
      detalhes: waDetalhes,
    },
    {
      id: "instagram",
      nome: "Instagram (Meta Graph API)",
      categoria: "publicacao",
      descricao: "Publique Posts, Carrosséis e Reels oficialmente na conta Instagram Business após aprovação humana.",
      subtitulo: "Publicação oficial + métricas de alcance",
      status: igTokenOk && igBizOk ? "conectado" : igTokenOk || igBizOk ? "atencao" : "desconectado",
      resumo_estado:
        igTokenOk && igBizOk
          ? "Token Meta + Business ID cifrados no Cofre"
          : igTokenOk || igBizOk
            ? "Falta preencher Token ou Account ID"
            : "Não configurado",
      cor_marca: "#E1306C",
      agente_orquestrador_id: orquestradores.instagram ?? "publicador_meta",
      detalhes: [
        {
          chave: "instagram_access_token",
          rotulo: "Instagram Access Token",
          configurado: igTokenOk,
          valor_mascarado: igTokenOk ? "•••• (cifrado no Cofre)" : null,
        },
        {
          chave: "instagram_business_account_id",
          rotulo: "Instagram Business Account ID",
          configurado: igBizOk,
          valor_mascarado: igBizOk ? "•••• (cifrado no Cofre)" : null,
        },
      ],
    },
    {
      id: "telegram",
      nome: "Telegram Bot",
      categoria: "mensageria",
      descricao: "Envie alertas instantâneos de renderização, links de aprovação com botões inline e comandos remotos.",
      subtitulo: "Notificações e aprovações em 1 toque",
      status: tgOk ? "conectado" : "desconectado",
      resumo_estado: tgOk ? "Bot Token cifrado no Cofre" : "Não configurado",
      cor_marca: "#26A5E4",
      agente_orquestrador_id: orquestradores.telegram ?? "estrategista",
      detalhes: [
        {
          chave: "telegram_bot_token",
          rotulo: "Telegram Bot Token",
          configurado: tgOk,
          valor_mascarado: tgOk ? "•••• (cifrado no Cofre)" : null,
        },
      ],
    },
    {
      id: "elevenlabs",
      nome: "ElevenLabs Voice",
      categoria: "voz",
      descricao: "Síntese de narração natural em pt-br com clonagem de voz para Reels Faceless e legendas karaokê.",
      subtitulo: "Motor premium de narração TTS",
      status: elevenOk ? "conectado" : "desconectado",
      resumo_estado: elevenOk ? "API Key cifrada no Cofre" : "Não configurado (usando edge-tts fallback)",
      cor_marca: "#F0F0F0",
      detalhes: [
        {
          chave: "elevenlabs_api_key",
          rotulo: "ElevenLabs API Key",
          configurado: elevenOk,
          valor_mascarado: elevenOk ? "•••• (cifrado no Cofre)" : null,
        },
      ],
    },
    {
      id: "fish_audio",
      nome: "Fish Audio",
      categoria: "voz",
      descricao: "Síntese vocal alternativa de baixa latência para vídeos curtos, Shorts e anúncios narrados.",
      subtitulo: "Voz expressiva de baixa latência",
      status: fishOk ? "conectado" : "desconectado",
      resumo_estado: fishOk ? "API Key cifrada no Cofre" : "Não configurado",
      cor_marca: "#00B4D8",
      detalhes: [
        {
          chave: "fish_audio_api_key",
          rotulo: "Fish Audio API Key",
          configurado: fishOk,
          valor_mascarado: fishOk ? "•••• (cifrado no Cofre)" : null,
        },
      ],
    },
    {
      id: "mcp",
      nome: "Servidores MCP (Model Context Protocol)",
      categoria: "sistema",
      descricao: "Conecte servidores de ferramentas externas (STDIO, Streamable HTTP e OAuth 2.1) aos agentes do estúdio.",
      subtitulo: `${mcpCountRow?.total ?? 0} servidor(es) ativo(s)`,
      status: Number(mcpCountRow?.total ?? 0) > 0 ? "conectado" : "desconectado",
      resumo_estado:
        mcpServers.length > 0
          ? mcpServers.map((m) => m.nome).join(", ")
          : "Nenhum servidor MCP externo cadastrado",
      cor_marca: "#74B9FF",
      detalhes: mcpServers.map((m) => {
        const transportLabel = m.transporte === "http" ? (m.url ?? "HTTP") : m.comando;
        const oauthState = oauthStatusMap.get(m.mcp_id);
        const oauthSuffix = oauthState ? ` · OAuth ${oauthState}` : "";
        const toolsSuffix =
          typeof m.qtd_ferramentas === "number" && m.qtd_ferramentas > 0
            ? ` · ${m.qtd_ferramentas} tools`
            : "";
        return {
          chave: m.mcp_id,
          rotulo: `${m.nome} (${transportLabel})${oauthSuffix}${toolsSuffix}`,
          configurado: m.ativo === 1,
        };
      }),
    },
    {
      id: "slack",
      nome: "Slack",
      categoria: "mensageria",
      descricao: "Receba menções com verificação HMAC-SHA256 e publique atualizações automáticas de campanhas em canais Slack.",
      subtitulo: "Webhook assinado + notificações de canal",
      status:
        slackBotOk && slackSecretOk
          ? "conectado"
          : slackBotOk || slackSecretOk
            ? "atencao"
            : "desconectado",
      resumo_estado:
        slackBotOk && slackSecretOk
          ? "Bot Token + Signing Secret cifrados no Cofre"
          : slackBotOk || slackSecretOk
            ? "Credencial parcial configurada no Cofre"
            : "Opcional · não configurado",
      cor_marca: "#E01E5A",
      agente_orquestrador_id: orquestradores.slack ?? "estrategista",
      detalhes: [
        {
          chave: "slack_bot_token",
          rotulo: "Slack Bot Token",
          configurado: slackBotOk,
          valor_mascarado: slackBotOk ? "•••• (cifrado no Cofre)" : null,
        },
        {
          chave: "slack_signing_secret",
          rotulo: "Slack Signing Secret",
          configurado: slackSecretOk,
          valor_mascarado: slackSecretOk ? "•••• (cifrado no Cofre)" : null,
        },
      ],
    },
    {
      id: "discord",
      nome: "Discord",
      categoria: "mensageria",
      descricao: "Verificação Ed25519 para interações/comandos Discord e envios via Bot ou Webhook.",
      subtitulo: "Interações Ed25519 + alertas de equipe",
      status:
        (discordBotOk && discordPubOk) || discordWebhookOk
          ? "conectado"
          : discordBotOk || discordAppOk || discordPubOk
            ? "atencao"
            : "desconectado",
      resumo_estado:
        (discordBotOk && discordPubOk) || discordWebhookOk
          ? "Credenciais Discord cifradas no Cofre"
          : discordBotOk || discordAppOk || discordPubOk
            ? "Falta completar Public Key ou Bot Token"
            : "Opcional · não configurado",
      cor_marca: "#5865F2",
      agente_orquestrador_id: orquestradores.discord ?? "estrategista",
      detalhes: [
        {
          chave: "discord_bot_token",
          rotulo: "Discord Bot Token",
          configurado: discordBotOk,
          valor_mascarado: discordBotOk ? "•••• (cifrado no Cofre)" : null,
        },
        {
          chave: "discord_application_id",
          rotulo: "Discord Application ID",
          configurado: discordAppOk,
          valor_mascarado: discordAppOk ? "•••• (cifrado no Cofre)" : null,
        },
        {
          chave: "discord_public_key",
          rotulo: "Discord Public Key (Ed25519)",
          configurado: discordPubOk,
          valor_mascarado: discordPubOk ? "•••• (cifrado no Cofre)" : null,
        },
      ],
    },
    {
      id: "github",
      nome: "GitHub",
      categoria: "sistema",
      descricao: "Conecte repositórios GitHub com webhook HMAC-SHA256 para disparar workflows, releases e abrir issues.",
      subtitulo: "Webhooks de push/PR/release + ações em issues",
      status:
        githubTokenOk && githubSecretOk
          ? "conectado"
          : githubTokenOk || githubSecretOk
            ? "atencao"
            : "desconectado",
      resumo_estado:
        githubTokenOk && githubSecretOk
          ? "Personal Token + Webhook Secret cifrados no Cofre"
          : githubTokenOk || githubSecretOk
            ? "Configuração parcial no Cofre"
            : "Opcional · não configurado",
      cor_marca: "#F0F0F0",
      agente_orquestrador_id: orquestradores.github ?? "estrategista",
      detalhes: [
        {
          chave: "github_token",
          rotulo: "GitHub Token (PAT)",
          configurado: githubTokenOk,
          valor_mascarado: githubTokenOk ? "•••• (cifrado no Cofre)" : null,
        },
        {
          chave: "github_webhook_secret",
          rotulo: "GitHub Webhook Secret",
          configurado: githubSecretOk,
          valor_mascarado: githubSecretOk ? "•••• (cifrado no Cofre)" : null,
        },
      ],
    },
  ];
}

