import type { WhatsNewReleaseInfo } from "@criativo/contracts";

export const CRIATIVOOS_CHANGELOG_BASE_URL = "https://criativoos.com.br/changelog";

export type ReleaseNoteEntry = WhatsNewReleaseInfo["notas"][number];

/**
 * Gera o link direto para a âncora da versão na página oficial de changelogs.
 */
export function buildChangelogUrl(version?: string | null): string {
  const clean = String(version ?? "")
    .trim()
    .replace(/^v/i, "");
  if (!clean) return CRIATIVOOS_CHANGELOG_BASE_URL;
  const anchor = `v${clean.replace(/[^0-9a-z]+/gi, "-").toLowerCase()}`;
  return `${CRIATIVOOS_CHANGELOG_BASE_URL}#${anchor}`;
}

export const RELEASE_NOTES_CATALOG: readonly ReleaseNoteEntry[] = [
  {
    versao: "1.1.2",
    data: "2026-11-28",
    added: [
      "Motor persistente Codex App Server (codex app-server --listen stdio://) com reuso de thread, streaming em tempo real, compactação nativa (thread/compact/start) e fallback transparente para codex exec.",
      "Sessões persistentes e higiene nativa em todas as plataformas: Claude CLI (ENABLE_TOOL_SEARCH=true, --strict-mcp-config, --disallowedTools e --resume com recuperação automática), OpenCode ACP e Antigravity ACP com cache compartilhado por conversa.",
      "Descoberta Lazy MCP universal (tool_search com schemas e guias sob demanda, tool_describe, tool_call), compactação real /compact com pacote determinístico de handoff de 32k caracteres e trava automatizada check:context-budget.",
    ],
    changed: [
      "Turnos leves de conversa ('oi') isolados sem anexar schemas MCP ociosos, arquivos de marca completos ou regra anti-alucinação visual, reduzindo drasticamente o consumo de tokens e a latência de resposta.",
    ],
    fixed: [
      "Fim definitivo das janelas pretas de CMD/Terminal no Windows com resolução direta de binários nativos .exe, migração automática de instalações npm legadas para standalone e windowsHide: true absoluto.",
      "Fim do desaparecimento intermitente de agentes e provedores na UI com cache stale-while-revalidate no SQLite (timeout de 4s por sonda e fallback local sem rede), guarda de hidratação no frontend e isolamento Crashpad/Watchdog no daemon Desktop.",
    ],
  },
  {
    versao: "1.1.1",
    data: "2026-11-27",
    added: [
      "Automação Comentário → Direct [BETA] unificada em Automações (sub-sidebar Fluxos Criativos | Fluxos Instagram [BETA]) com regras por palavra-chave, escopo de publicações, aprovação humana opcional e Simulador Dry-Run.",
      "Motor de fluxos multi-etapa pós-abertura da janela de 24h (mensagens, delays, coleta CRM, ramificação por botões, cartões de entregáveis HTTPS, disparo de workflows e handoff para Criativo IA) com limite de 200 req/h.",
      "3 modos de recepção (Polling 7d local, Webhook Direto HMAC-SHA256 e Relay Zero-Trust no Painel Central), publicador público HTTPS (GitHub Pages via Cofre ou Showcase sob domínio válido sem expor IP) e ferramentas MCP com rascunhos sempre pausados.",
    ],
    changed: [],
    fixed: [
      "Fim do loop de inicialização/splash com timeout defensivo nas leituras HTTP (15s), sondagens de CLIs/cotas desacopladas em segundo plano, instância única de preloader e auto-recuperação do Watchdog Desktop (ensureRunning).",
      "Eliminação das janelas de console CMD no Windows ao iniciar o app ou abrir Configurações (windowsHide: true global em processos filhos e deduplicação de catálogo OpenCode em voo).",
    ],
  },
  {
    versao: "1.1.0",
    data: "2026-11-27",
    added: [
      "Estabilidade em Escala: Auto-Unload inteligente de abas CDP sob pressão de RAM com recarga sob demanda e Pool Multi-Conta Spread.",
      "Workflows Pro: 4 templates de marketing, Organizar (Tidy up), campos tipados {{campo}} (Answer fields), condições determinísticas Zero-IA, geração Batch 4x com retry individual e exportação/importação portável .workflow.json.",
      "Cockpit Pro & Observabilidade: Multi-split vertical (até 3 grupos), janela destacada multi-monitor, gráficos empilhados por provedor, VAD + fatiamento de ditado até 10 min, cursores colaborativos, preview .docx e miniaturas no chat.",
      "Meta Graph API 2026: Trial Reels (>= 1.000 seguidores), Primeiro Comentário automático com aprovação humana, Exclusão Controlada auditada, Skip Rate (3s), Reposts e Melhor Horário com IA.",
    ],
    changed: [
      "Payload ACP ampliado para 256 MB, cache SQLite até 64 MB com retenção indexada, sidebar enxuta (24-100) e compactação pré-expiração de cache 1h (>= 200K tokens).",
    ],
    fixed: [
      "Higienização Clean-Room integral da UI Web e sincronização em tempo real via WebSocket para abas suspensas (browser:tab_unloaded).",
    ],
  },
  {
    versao: "1.0.9",
    data: "2026-11-27",
    added: [
      "Auto-update silencioso com reinício assistido em 1 clique no Windows, macOS e Linux ('Reiniciar para atualizar').",
      "Codex CLI standalone: instalação e atualização direta sem depender de Node.js ou npm.",
      "Banner dedicado de atualização das CLIs de provedores no topo e suporte a envio de imagens nos modelos multimodais ChatGPT/Codex.",
    ],
    changed: [
      "Resolução dinâmica do modelo padrão para novos Criativos a partir das contas conectadas ou OpenCode gratuito.",
      "Limpeza automática do cache de modelos após atualizar o runtime de qualquer provedor.",
    ],
    fixed: [],
  },
  {
    versao: "1.0.8",
    data: "2026-11-27",
    added: [
      "Motor universal de tarefas em segundo plano com auto-despertar reativo para renderizações de vídeo e fluxos longos.",
    ],
    changed: [
      "Execução assíncrona em paralelo mantendo o chat livre para novos pedidos enquanto tarefas pesadas finalizam.",
    ],
    fixed: [],
  },
  {
    versao: "1.0.7",
    data: "2026-11-26",
    added: [
      "Animação Update Beam no banner de atualização e streaming por blocos com etapas reais em tempo real no ACP.",
    ],
    changed: [
      "Pipeline de validação automática para pacotes multiplataforma Windows, macOS e Linux.",
    ],
    fixed: [],
  },
  {
    versao: "1.0.6",
    data: "2026-11-26",
    added: [
      "Ferramentas nativas de edição de vídeo com Remotion e FFmpeg integradas ao estúdio de Reels.",
      "Upload ampliado de arquivos até 100 MB e watchdog inteligente de inatividade real sem teto fixo de turno.",
    ],
    changed: [],
    fixed: [
      "Compensação de hibernação do sistema operacional e isolamento de estabilidade ACP por agente.",
    ],
  },
  {
    versao: "1.0.5",
    data: "2026-11-26",
    added: [
      "Descoberta automática dos modelos reais da conta ChatGPT conectada e atualização automática das CLIs a cada 24h.",
    ],
    changed: [],
    fixed: [
      "Execução discreta no Windows sem janelas piscando do cmd.exe e sanitização aprimorada de tabelas no chat.",
    ],
  },
  {
    versao: "1.0.4",
    data: "2026-11-25",
    added: [
      "Auto-instalador local e detecção blindada multiplataforma para Antigravity CLI com fallback resiliente.",
    ],
    changed: [
      "Painel de contas conectadas por provedor mais claro na tela de Provedores.",
    ],
    fixed: [],
  },
  {
    versao: "1.0.3",
    data: "2026-11-22",
    added: [],
    changed: [
      "Vocabulário unificado CriativoOS e Criativos em toda a interface, skills e estúdio de vídeo, com guardrail automático de marca.",
    ],
    fixed: [],
  },
  {
    versao: "1.0.2",
    data: "2026-11-22",
    added: [],
    changed: [
      "Padronização dos diretórios de dados locais e executáveis oficiais para CriativoOS em Windows, macOS e Linux.",
    ],
    fixed: [],
  },
  {
    versao: "1.0.1",
    data: "2026-11-22",
    added: [
      "Design System Obsidian, Volt e Cobalt, busca global Ctrl+K, Calendário Editorial, Galeria Meta e Editor Visual 4:5 e 9:16 com Safe Zones.",
      "Hardening Desktop/Cofre, auto-compactação de contexto, descoberta lazy de ferramentas, navegador anti-CAPTCHA, Team RBAC, CUA e deep links criativo://.",
    ],
    changed: [],
    fixed: [],
  },
  {
    versao: "1.0.0",
    data: "2026-11-18",
    added: [
      "Lançamento oficial do CriativoOS para Windows, macOS, Linux e VPS 24h com 15 Criativos, +253 aplicativos, navegador inteligente e WhatsApp integrado.",
    ],
    changed: [],
    fixed: [],
  },
];

function normalizeVersionKey(version: string): string {
  return String(version ?? "")
    .trim()
    .replace(/^v/i, "");
}

/**
 * Retorna as notas de lançamento ordenadas com a versão em execução sempre em destaque no topo.
 */
export function getReleaseNotesForVersion(currentVersion: string): ReleaseNoteEntry[] {
  const cleanCurrent = normalizeVersionKey(currentVersion) || "1.0.0";
  const exactIndex = RELEASE_NOTES_CATALOG.findIndex(
    (entry) => normalizeVersionKey(entry.versao) === cleanCurrent,
  );

  if (exactIndex === 0) {
    return RELEASE_NOTES_CATALOG.map((entry) => structuredClone(entry));
  }

  if (exactIndex > 0) {
    const selected = RELEASE_NOTES_CATALOG[exactIndex];
    const remaining = RELEASE_NOTES_CATALOG.filter((_, idx) => idx !== exactIndex);
    return [selected, ...remaining].map((entry) => structuredClone(entry));
  }

  const fallbackCurrent: ReleaseNoteEntry = {
    versao: cleanCurrent,
    data: new Date().toISOString().slice(0, 10),
    added: [
      `CriativoOS v${cleanCurrent} ativo nesta instância com todas as melhorias acumuladas da série.`,
    ],
    changed: [],
    fixed: [],
  };

  return [fallbackCurrent, ...RELEASE_NOTES_CATALOG.map((entry) => structuredClone(entry))];
}
