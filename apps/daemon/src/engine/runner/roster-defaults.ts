import type { AvatarShape, FrenteAgente, NivelEsforco } from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import {
  DEFAULT_FALLBACK_FREE_MODEL,
  LEGACY_OR_DEPRECATED_DEFAULT_MODELS,
} from "../../providers/default-model-resolver.ts";

export interface AgenteDefinicao {
  agente_id: string;
  nome: string;
  papel: string;
  frente: FrenteAgente;
  pacote: "base" | "bonus" | "video";
  pasta: string;
  skill_slug: string;
  modelo_padrao: string;
  avatar_shape: AvatarShape;
  avatar_color: string;
  effort: NivelEsforco;
  ordem_exibicao: number;
  skills_paths: string[];
  ferramentas: string[];
  prompt_base: string;
}

const DEFAULT_AGENT_TOOLS: Record<string, string[]> = {
  assistente_setup: [
    "salvar_identidade_marca",
    "validar_integracao_meta",
    "concluir_setup_inicial",
    "ask_user",
    "request_api_key",
  ],
  assistente_servidor_vps: [
    "instalar_parear_servidor_vps",
    "gerar_comando_claim_vps",
    "concluir_conexao_vps",
    "ask_user",
  ],
  estrategista: ["salvar_identidade_marca", "inspecionar_ativos_marca", "handoff_agente"],
  copywriter: ["inspecionar_ativos_marca", "handoff_agente"],
  designer_individual: ["generate_image", "crop_margem_segura", "inspecionar_ativos_marca", "handoff_agente"],
  designer_carrossel: ["generate_image", "crop_margem_segura", "inspecionar_ativos_marca", "handoff_agente"],
  designer_ads: ["generate_image", "generate_video", "crop_margem_segura", "inspecionar_ativos_marca", "handoff_agente"],
  designer_stories: ["generate_image", "generate_video", "crop_margem_segura", "inspecionar_ativos_marca", "handoff_agente"],
  diretor_identidade: ["salvar_identidade_marca", "inspecionar_ativos_marca", "handoff_agente"],
  engenheiro_meta: [
    "validar_integracao_meta",
    "consultar_metricas_meta",
    "meta_publicar",
    "meta_agendar_primeiro_comentario",
    "meta_excluir_midia",
    "handoff_agente",
  ],
  analista_metricas: ["consultar_metricas_meta", "handoff_agente"],
  diretor_entregaveis: ["inspecionar_ativos_marca", "handoff_agente"],
  inteligencia_competitiva: ["inspecionar_url", "handoff_agente"],
  consistencia_visual: ["generate_image", "inspecionar_ativos_marca", "handoff_agente"],
  editor_video: [
    "exec_remotion_render",
    "video_inspect_and_silences",
    "video_transcribe_words",
    "exec_ffmpeg_edit",
    "generate_video",
    "read_video",
    "inspecionar_ativos_marca",
    "handoff_agente",
  ],
  roteirista_faceless: ["read_video", "generate_video", "inspecionar_ativos_marca", "handoff_agente"],
  roteirista_talking_head: ["read_video", "video_inspect_and_silences", "inspecionar_ativos_marca", "handoff_agente"],
};

const DEFAULT_AVATAR_THEMES: Record<
  string,
  { shape: AvatarShape; color: string; effort: NivelEsforco; pasta: string }
> = {
  assistente_setup: { shape: "pill", color: "#42a0ff", effort: "baixo", pasta: "Setup Inicial" },
  assistente_servidor_vps: { shape: "hex", color: "#2EC4B6", effort: "medio", pasta: "Infraestrutura VPS" },
  estrategista: { shape: "hex", color: "#31cf76", effort: "alto", pasta: "Conteúdo Base" },
  copywriter: { shape: "blob", color: "#38bdf8", effort: "alto", pasta: "Conteúdo Base" },
  designer_individual: { shape: "diamond", color: "#f27ba5", effort: "medio", pasta: "Conteúdo Base" },
  designer_carrossel: { shape: "rounded_square", color: "#2dd4bf", effort: "alto", pasta: "Conteúdo Base" },
  designer_ads: { shape: "triangle", color: "#f97316", effort: "medio", pasta: "Conteúdo Base" },
  designer_stories: { shape: "cloud", color: "#eab308", effort: "medio", pasta: "Conteúdo Base" },
  diretor_identidade: { shape: "octo", color: "#8b5cf6", effort: "alto", pasta: "Conteúdo Base" },
  engenheiro_meta: { shape: "pill", color: "#34479c", effort: "baixo", pasta: "Conteúdo Base" },
  analista_metricas: { shape: "diamond", color: "#6bc7d9", effort: "alto", pasta: "Conteúdo Base" },
  diretor_entregaveis: { shape: "rounded_square", color: "#d6b98c", effort: "medio", pasta: "Agentes Bônus" },
  inteligencia_competitiva: { shape: "octo", color: "#6366f1", effort: "alto", pasta: "Agentes Bônus" },
  consistencia_visual: { shape: "blob", color: "#a855f7", effort: "alto", pasta: "Agentes Bônus" },
  editor_video: { shape: "hex", color: "#ef4444", effort: "alto", pasta: "Estúdio de Vídeo" },
  roteirista_faceless: { shape: "triangle", color: "#f59e0b", effort: "medio", pasta: "Estúdio de Vídeo" },
  roteirista_talking_head: { shape: "cloud", color: "#a8324e", effort: "medio", pasta: "Estúdio de Vídeo" },
};

export const ROSTER_15_AGENTES: readonly AgenteDefinicao[] = ([
  {
    agente_id: "estrategista",
    nome: "Estrategista Editorial",
    papel: "Calendário editorial, pilares, pautas e formatos de conteúdo",
    frente: "conteudo",
    pasta: "Conteúdo Base",
    skill_slug: "planejar-conteudo",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "hex",
    avatar_color: "#31cf76",
    effort: "alto",
    ordem_exibicao: 1,
    skills_paths: [".agents/skills/planejar-conteudo/SKILL.md"],
    prompt_base:
      "Você é o Estrategista Editorial do estúdio para a marca [NOME_DA_MARCA] ([@SEU_PERFIL]). Estruture calendários editoriais, objetivos de cada publicação, pilares e briefs acionáveis.",
  },
  {
    agente_id: "copywriter",
    nome: "Copywriter de Resposta Direta",
    papel: "Ganchos magnéticos, headlines, textos de lâminas, legendas e CTAs",
    frente: "conteudo",
    pasta: "Conteúdo Base",
    skill_slug: "copywriter-instagram",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "blob",
    avatar_color: "#38bdf8",
    effort: "alto",
    ordem_exibicao: 2,
    skills_paths: [".agents/skills/copywriter-instagram/SKILL.md"],
    prompt_base:
      "Você é o Copywriter de Resposta Direta. Escreva ganchos fortes, textos concisos de slides (AIDA/PAS), legendas estruturadas e CTAs alinhados ao nível de consciência da audiência.",
  },
  {
    agente_id: "designer_individual",
    nome: "Designer de Post Individual",
    papel: "Direção de arte generativa 1080x1350 (3:4) para posts estáticos",
    frente: "conteudo",
    pasta: "Conteúdo Base",
    skill_slug: "criar-post-individual",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "diamond",
    avatar_color: "#f27ba5",
    effort: "medio",
    ordem_exibicao: 3,
    skills_paths: [".agents/skills/criar-post-individual/SKILL.md"],
    prompt_base:
      "Você é o Designer de Post Individual. SEMPRE utilize a ferramenta `generate_image` (nunca layouts genéricos) com aspect_ratio 3:4, passando image_paths reais quando disponíveis e preservando consistência facial.",
  },
  {
    agente_id: "designer_carrossel",
    nome: "Designer de Carrosséis",
    papel: "Narrativas visuais contínuas de 4 a 10 slides em 1080x1350",
    frente: "conteudo",
    pasta: "Conteúdo Base",
    skill_slug: "criar-carrossel",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "rounded_square",
    avatar_color: "#2dd4bf",
    effort: "alto",
    ordem_exibicao: 4,
    skills_paths: [".agents/skills/criar-carrossel/SKILL.md"],
    prompt_base:
      "Você é o Designer de Carrosséis. Produza sequências de slides coesas via `generate_image` (aspect_ratio 3:4) garantindo ritmo visual, capa magnética e margens de respiro mínimas de 10%.",
  },
  {
    agente_id: "designer_ads",
    nome: "Designer de Anúncios (Ads)",
    papel: "Criativos estáticos de alta conversão para Meta Ads com copy testável",
    frente: "conteudo",
    pasta: "Conteúdo Base",
    skill_slug: "criar-post-anuncio",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "triangle",
    avatar_color: "#f97316",
    effort: "medio",
    ordem_exibicao: 5,
    skills_paths: [".agents/skills/criar-post-anuncio/SKILL.md"],
    prompt_base:
      "Você é o Designer de Anúncios de Performance. Crie variações A/B visuais com foco em clareza de oferta e contraste imediato usando `generate_image`.",
  },
  {
    agente_id: "designer_stories",
    nome: "Designer de Stories",
    papel: "Layouts verticais 9:16 (1080x1920) com zonas seguras Instagram",
    frente: "conteudo",
    pasta: "Conteúdo Base",
    skill_slug: "gerar-stories",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "cloud",
    avatar_color: "#eab308",
    effort: "medio",
    ordem_exibicao: 6,
    skills_paths: [".agents/skills/gerar-stories/SKILL.md"],
    prompt_base:
      "Você é o Designer de Stories 9:16. Gere sequências nativas com `generate_image` (aspect_ratio 9:16) respeitando as zonas seguras superior e inferior para enquetes e links.",
  },
  {
    agente_id: "diretor_identidade",
    nome: "Diretor de Identidade Visual",
    papel: "Brandbook, design system, paleta de cores e tokens visuais",
    frente: "conteudo",
    pasta: "Conteúdo Base",
    skill_slug: "criar-identidade-visual",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "octo",
    avatar_color: "#8b5cf6",
    effort: "alto",
    ordem_exibicao: 7,
    skills_paths: [".agents/skills/criar-identidade-visual/SKILL.md"],
    prompt_base:
      "Você é o Diretor de Identidade Visual. Traduza posicionamento em tokens de design system, paleta agnóstica, tipografia e regras visuais antes da produção.",
  },
  {
    agente_id: "engenheiro_meta",
    nome: "Engenheiro de Integração & Meta",
    papel: "Validação de credenciais e publicação segura via Meta Graph API",
    frente: "conteudo",
    pasta: "Conteúdo Base",
    skill_slug: "configurar-instagram",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "pill",
    avatar_color: "#34479c",
    effort: "baixo",
    ordem_exibicao: 8,
    skills_paths: [".agents/skills/configurar-instagram/SKILL.md"],
    prompt_base:
      "Você é o Engenheiro de Integração & Meta. NUNCA publique na conta Instagram sem aprovação humana explícita registrada. Valide mídias e acione `meta_publicar` apenas após autorização.",
  },
  {
    agente_id: "analista_metricas",
    nome: "Analista de BI & Métricas",
    papel: "Análise de alcance, salvamentos, retenção e loops de melhoria",
    frente: "conteudo",
    pasta: "Conteúdo Base",
    skill_slug: "analise-metricas",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "diamond",
    avatar_color: "#6bc7d9",
    effort: "alto",
    ordem_exibicao: 9,
    skills_paths: [".agents/skills/analise-metricas/SKILL.md"],
    prompt_base:
      "Você é o Analista de BI & Métricas. Identifique padrões de retenção e taxa de salvamento e retroalimente o Estrategista Editorial com recomendações objetivas.",
  },
  {
    agente_id: "diretor_entregaveis",
    nome: "Diretor de Operações & Entregáveis",
    papel: "PDFs executivos, planilhas CSV editoriais e vitrines de aprovação",
    frente: "bonus",
    pasta: "Agentes Bônus",
    skill_slug: "gerador-de-entregaveis",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "rounded_square",
    avatar_color: "#d6b98c",
    effort: "medio",
    ordem_exibicao: 10,
    skills_paths: ["../skills-agents-bonus/gerador-de-entregaveis/SKILL.md"],
    prompt_base:
      "Você é o Diretor de Operações & Entregáveis. Organize campanhas geradas em pacotes executivos e garanta envio claro para aprovação no WhatsApp e Cockpit Web.",
  },
  {
    agente_id: "inteligencia_competitiva",
    nome: "Diretor de Inteligência Competitiva",
    papel: "Engenharia reversa de mercado, ganchos virais e brechas competitivas",
    frente: "bonus",
    pasta: "Agentes Bônus",
    skill_slug: "engenharia-reversa-concorrentes",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "octo",
    avatar_color: "#6366f1",
    effort: "alto",
    ordem_exibicao: 11,
    skills_paths: ["../skills-agents-bonus/engenharia-reversa-concorrentes/SKILL.md"],
    prompt_base:
      "Você é o Diretor de Inteligência Competitiva. Utilize `inspecionar_url` e pesquisas estruturadas para mapear formatos virais sem nunca copiar nomes ou @handles concorrentes.",
  },
  {
    agente_id: "consistencia_visual",
    nome: "Engenheiro de Consistência Visual",
    papel: "Folha 360° de personagem e âncoras biométricas faciais para IA",
    frente: "bonus",
    pasta: "Agentes Bônus",
    skill_slug: "consistencia-personagem",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "blob",
    avatar_color: "#a855f7",
    effort: "alto",
    ordem_exibicao: 12,
    skills_paths: ["../skills-agents-bonus/consistencia-personagem/SKILL.md"],
    prompt_base:
      "Você é o Engenheiro de Consistência Visual. Gere tokens antropométricos e selecione referências faciais em `ImagePaths` para preservar a identidade do criador em 100% das artes.",
  },
  {
    agente_id: "editor_video",
    nome: "Diretor & Editor de Vídeo",
    papel: "Renderização cinematográfica Remotion com legendas animadas karaokê",
    frente: "video",
    pasta: "Estúdio de Vídeo",
    skill_slug: "criar-video-reels",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "hex",
    avatar_color: "#ef4444",
    effort: "alto",
    ordem_exibicao: 13,
    skills_paths: [".agents/skills-upgrades/video/criar-video-reels/SKILL.md"],
    prompt_base:
      "Você é o Diretor & Editor de Vídeo do CriativoOS. Use as ferramentas nativas MCP (`video_inspect_and_silences`, `video_transcribe_words`, `exec_ffmpeg_edit` e `exec_remotion_render`) para cortar pausas/erros, aplicar legendas karaokê, letterings e trilha sonora em 1080x1920 a 30fps. Para vídeos maiores que 100 MB, peça ao usuário o caminho completo do arquivo ou para autorizar a pasta em Inspetor do Agente → Pastas Autorizadas.",
  },
  {
    agente_id: "roteirista_faceless",
    nome: "Roteirista Faceless",
    papel: "Roteiros cena a cena com B-rolls, imagens de IA e infográficos",
    frente: "video",
    pasta: "Estúdio de Vídeo",
    skill_slug: "roteirista-faceless",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "triangle",
    avatar_color: "#f59e0b",
    effort: "medio",
    ordem_exibicao: 14,
    skills_paths: [".agents/skills-upgrades/video/roteirista-faceless/SKILL.md"],
    prompt_base:
      "Você é o Roteirista Faceless. Escreva narrações magnéticas com marcação de tempo e direção visual cena a cena para vídeos sem aparição na câmera.",
  },
  {
    agente_id: "roteirista_talking_head",
    nome: "Roteirista Talking Head",
    papel: "Roteiros teleprompter com ganchos de fala e marcações de corte",
    frente: "video",
    pasta: "Estúdio de Vídeo",
    skill_slug: "roteirista-talking-head",
    modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
    avatar_shape: "cloud",
    avatar_color: "#a8324e",
    effort: "medio",
    ordem_exibicao: 15,
    skills_paths: [".agents/skills-upgrades/video/roteirista-talking-head/SKILL.md"],
    prompt_base:
      "Você é o Roteirista Talking Head. Crie roteiros conversacionais formatados para teleprompter com marcações de ênfase e ganchos visuais nos primeiros 3 segundos.",
  },
] as Array<Omit<AgenteDefinicao, "pacote" | "ferramentas">>).map((ag) => ({
  ...ag,
  pacote: ag.frente === "bonus" ? "bonus" : ag.frente === "video" ? "video" : "base",
  ferramentas: DEFAULT_AGENT_TOOLS[ag.agente_id] ?? ["handoff_agente"],
}));

export const SETUP_ASSISTANT_AGENT_DEF: AgenteDefinicao = {
  agente_id: "assistente_setup",
  nome: "Assistente de Configuração",
  papel: "Setup inicial guiado de marca, arquivos visuais e integrações (auto-ocultável)",
  frente: "conteudo",
  pacote: "base",
  pasta: "Setup Inicial",
  skill_slug: "criar-identidade-visual",
  modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
  avatar_shape: "pill",
  avatar_color: "#42a0ff",
  effort: "baixo",
  ordem_exibicao: 0,
  skills_paths: [
    ".agents/skills/criar-identidade-visual/SKILL.md",
    ".agents/skills/configurar-instagram/SKILL.md",
  ],
  ferramentas: DEFAULT_AGENT_TOOLS.assistente_setup,
  prompt_base:
    "Você é o Assistente de Configuração inicial do CriativoOS. Conduza o usuário em blocos curtos para concluir apenas o que estiver pendente: identidade/perfil da marca (`salvar_identidade_marca`), envio de logo/fotos/referências ou ficha PDF no chat, e teste de credenciais Instagram/Meta (`validar_integracao_meta`). Assim que as pendências estiverem resolvidas ou quando o usuário solicitar encerrar/dispensar, chame `concluir_setup_inicial` para ocultar este assistente da Sidebar.",
};

export const VPS_ASSISTANT_AGENT_DEF: AgenteDefinicao = {
  agente_id: "assistente_servidor_vps",
  nome: "Especialista em Servidor VPS",
  papel: "Instalação, diagnóstico e pareamento de servidores Linux/VPS (auto-ocultável)",
  frente: "conteudo",
  pacote: "base",
  pasta: "Infraestrutura VPS",
  skill_slug: "configurar-instagram",
  modelo_padrao: DEFAULT_FALLBACK_FREE_MODEL,
  avatar_shape: "hex",
  avatar_color: "#2EC4B6",
  effort: "medio",
  ordem_exibicao: 0,
  skills_paths: [],
  ferramentas: DEFAULT_AGENT_TOOLS.assistente_servidor_vps,
  prompt_base:
    "Você é o Especialista em Servidor VPS do CriativoOS (agente oculto sob demanda). Seu objetivo é ajudar o usuário a instalar, diagnosticar e conectar servidores Linux Ubuntu/Debian (compatível com Nginx, Apache ou servidor standalone Node.js na porta 3000 sem conflitar com sites já existentes). Sempre que o usuário informar host/IP + chave SSH (ou quiser testar conexão), use `instalar_parear_servidor_vps`. Se precisar renovar o comando seguro de pareamento em 1 linha, use `gerar_comando_claim_vps`. Explique claramente erros de `apt-get` (como PPAs com Label alterada) e como validar `systemctl status criativo` e `/health`. Assim que a VPS estiver conectada ou quando o usuário pedir para encerrar, chame `concluir_conexao_vps` para ocultar este agente automaticamente.",
};

export const DELETED_NATIVE_AGENTS_CONFIG_KEY = "deleted_native_agents";

export interface DeletedNativeAgentTombstone {
  agente_id: string;
  deleted_at: string;
}

export function getDeletedNativeAgentsMeta(db: CriativoDatabase): DeletedNativeAgentTombstone[] {
  try {
    const row = db.connection
      .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = ? LIMIT 1;`)
      .get(DELETED_NATIVE_AGENTS_CONFIG_KEY) as { valor_json?: string } | undefined;
    if (!row?.valor_json) return [];
    const parsed = JSON.parse(row.valor_json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: DeletedNativeAgentTombstone[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && item.trim()) {
        result.push({ agente_id: item.trim(), deleted_at: "" });
      } else if (
        item &&
        typeof item === "object" &&
        typeof (item as { agente_id?: unknown }).agente_id === "string"
      ) {
        const rec = item as { agente_id: string; deleted_at?: unknown };
        result.push({
          agente_id: rec.agente_id.trim(),
          deleted_at: typeof rec.deleted_at === "string" ? rec.deleted_at : "",
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

export function getDeletedNativeAgentIds(db: CriativoDatabase): Set<string> {
  return new Set(getDeletedNativeAgentsMeta(db).map((t) => t.agente_id));
}

export function setDeletedNativeAgentsMeta(
  db: CriativoDatabase,
  list: DeletedNativeAgentTombstone[],
): void {
  const uniqueMap = new Map<string, DeletedNativeAgentTombstone>();
  for (const item of list) {
    if (!item.agente_id.trim()) continue;
    uniqueMap.set(item.agente_id.trim(), {
      agente_id: item.agente_id.trim(),
      deleted_at: item.deleted_at || new Date().toISOString(),
    });
  }
  const now = new Date().toISOString();
  db.connection
    .prepare(
      `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
       VALUES (?, ?, ?)
       ON CONFLICT(chave) DO UPDATE SET
         valor_json = excluded.valor_json,
         atualizado_em = excluded.atualizado_em;`,
    )
    .run(DELETED_NATIVE_AGENTS_CONFIG_KEY, JSON.stringify(Array.from(uniqueMap.values())), now);
}

export function markNativeAgentDeleted(db: CriativoDatabase, agenteId: string): void {
  const current = getDeletedNativeAgentsMeta(db).filter((t) => t.agente_id !== agenteId);
  current.push({ agente_id: agenteId, deleted_at: new Date().toISOString() });
  setDeletedNativeAgentsMeta(db, current);
}

export function unmarkNativeAgentDeleted(db: CriativoDatabase, agenteId: string): void {
  const next = getDeletedNativeAgentsMeta(db).filter((t) => t.agente_id !== agenteId);
  setDeletedNativeAgentsMeta(db, next);
}

export function getSetupCompatibleRoster(): readonly AgenteDefinicao[] {
  return [SETUP_ASSISTANT_AGENT_DEF, VPS_ASSISTANT_AGENT_DEF, ...ROSTER_15_AGENTES];
}

/**
 * Garante que os agentes padrão (e o assistente temporário de setup) existam na tabela `projecao_agentes`,
 * respeitando exclusões explícitas gravadas em `deleted_native_agents`.
 */
export function seedDefaultAgents(db: CriativoDatabase): number {
  const agora = new Date().toISOString();
  let inseridos = 0;
  const allDefs = getSetupCompatibleRoster();
  const deletedNativeIds = getDeletedNativeAgentIds(db);

  db.runInTransaction(() => {
    const insertStmt = db.connection.prepare(`
      INSERT INTO projecao_agentes (
        agente_id, nome, papel, modelo_padrao, status,
        skills_paths_json, memoria_resumo, ordem_exibicao, config_json, atualizado_em
      ) VALUES (?, ?, ?, ?, 'ocioso', ?, NULL, ?, ?, ?)
      ON CONFLICT(agente_id) DO NOTHING;
    `);

    for (const ag of allDefs) {
      if (deletedNativeIds.has(ag.agente_id)) {
        continue;
      }
      const config = {
        frente: ag.frente,
        pacote: ag.pacote,
        pasta: ag.pasta,
        skill_slug: ag.skill_slug,
        avatar_shape: ag.avatar_shape,
        avatar_color: ag.avatar_color,
        effort: ag.effort,
        ferramentas: ag.ferramentas,
        prompt_base: ag.prompt_base,
        customizado: false,
      };
      const res = insertStmt.run(
        ag.agente_id,
        ag.nome,
        ag.papel,
        ag.modelo_padrao,
        JSON.stringify(ag.skills_paths),
        ag.ordem_exibicao,
        JSON.stringify(config),
        agora
      );
      inseridos += Number(res.changes);
    }

    // Backfill completo: preenche prompt_base, skill_slug, pacote, ferramentas, tema e migra modelos legados/descontinuados
    const existingRows = db.connection
      .prepare(`SELECT agente_id, modelo_padrao, config_json FROM projecao_agentes;`)
      .all() as Array<{ agente_id: string; modelo_padrao: string; config_json: string }>;

    const updateConfigStmt = db.connection.prepare(
      `UPDATE projecao_agentes SET config_json = ? WHERE agente_id = ?;`
    );
    const updateModelStmt = db.connection.prepare(
      `UPDATE projecao_agentes SET modelo_padrao = ?, atualizado_em = ? WHERE agente_id = ?;`
    );

    for (const row of existingRows) {
      const def = allDefs.find((a) => a.agente_id === row.agente_id);
      const theme = DEFAULT_AVATAR_THEMES[row.agente_id];
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
      } catch {
        parsed = {};
      }

      const currentModel = (row.modelo_padrao || "").trim();
      if (
        parsed.modelo_fixado_usuario !== true &&
        (!currentModel || LEGACY_OR_DEPRECATED_DEFAULT_MODELS.has(currentModel))
      ) {
        updateModelStmt.run(DEFAULT_FALLBACK_FREE_MODEL, agora, row.agente_id);
      }

      if (!def && !theme) continue;
      const promptVazio = typeof parsed.prompt_base !== "string" || parsed.prompt_base.trim().length === 0;
      const precisaAtualizar =
        !parsed.avatar_shape ||
        !parsed.avatar_color ||
        promptVazio ||
        !parsed.skill_slug ||
        !parsed.pacote ||
        !Array.isArray(parsed.ferramentas);

      if (precisaAtualizar) {
        const merged = {
          ...parsed,
          frente: parsed.frente ?? def?.frente ?? "conteudo",
          pacote: parsed.pacote ?? def?.pacote ?? "base",
          pasta: parsed.pasta ?? def?.pasta ?? theme?.pasta ?? "Conteúdo Base",
          skill_slug: parsed.skill_slug ?? def?.skill_slug,
          avatar_shape: parsed.avatar_shape ?? def?.avatar_shape ?? theme?.shape ?? "blob",
          avatar_color: parsed.avatar_color ?? def?.avatar_color ?? theme?.color ?? "#38bdf8",
          effort: parsed.effort ?? def?.effort ?? theme?.effort ?? "medio",
          ferramentas: Array.isArray(parsed.ferramentas)
            ? parsed.ferramentas
            : def?.ferramentas ?? ["handoff_agente"],
          prompt_base: promptVazio ? def?.prompt_base ?? "" : parsed.prompt_base,
        };
        updateConfigStmt.run(JSON.stringify(merged), row.agente_id);
      }
    }
  });

  return inseridos;
}

/**
 * Inicializa canal padrão de equipe, workflow inicial opcional e mensagem inicial agnóstica
 * (somente quando as tabelas respectivas estão vazias, preservando anti-contaminação).
 */
export function seedDefaultStudioExperience(db: CriativoDatabase): void {
  const agora = new Date().toISOString();

  const canaisCount = db.connection
    .prepare(`SELECT COUNT(*) as total FROM projecao_grupos_equipe;`)
    .get() as { total: number };

  if (canaisCount.total === 0) {
    db.connection
      .prepare(
        `INSERT INTO projecao_grupos_equipe (canal_id, nome, descricao, pasta, membros_agentes_json, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?);`
      )
      .run(
        "canal-campanha-semanal",
        "#campanha-semanal",
        "Planejamento coordenado de pautas, copy e carrosséis da semana",
        "Canais em Equipe",
        JSON.stringify(["estrategista", "copywriter", "designer_carrossel", "engenheiro_meta"]),
        agora,
        agora
      );
  }

  const chatCount = db.connection
    .prepare(`SELECT COUNT(*) as total FROM projecao_conversas_chat;`)
    .get() as { total: number };

  if (chatCount.total === 0) {
    const welcomeTable = [
      "Pronto para operar o calendário de **[NOME_DA_MARCA]** (`[@SEU_PERFIL]`). Abaixo está a matriz sugerida para começar a produção hoje:",
      "",
      "| Pilar Editorial | Formato Recomendado | Frequência | Meta Principal |",
      "| --- | --- | --- | --- |",
      "| Autoridade & Método | Carrossel 7 lâminas (4:5) | Terça e Quinta | Salvamentos |",
      "| Bastidores & Prova | Reels 9:16 com Legenda Dinâmica | Segunda e Sexta | Alcance |",
      "| Oferta Direta | Post Estático / Stories com Enquete | Quarta e Sábado | Cliques & DMs |",
      "",
      "Envie um tema, anexe suas referências no botão **+** ou peça para eu coordenar Copywriter + Designer de Carrosséis.",
    ].join("\n");

    db.connection
      .prepare(
        `INSERT INTO projecao_conversas_chat (mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown, anexos_json, steps_json, tarefa_id, lida, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?);`
      )
      .run(
        "msg-boas-vindas-estrategista",
        "agente:estrategista",
        "estrategista",
        "agente",
        "Estrategista Editorial",
        welcomeTable,
        "[]",
        JSON.stringify([
          {
            id: "step-init-1",
            ferramenta: "planejar_conteudo",
            titulo: "Carregou matriz inicial de pilares [NOME_DA_MARCA]",
            detalhes: "Equipe de agentes conectada com saída segura para aprovação",
            status: "concluido",
            duracao_ms: 340,
          },
        ]),
        agora
      );
  }

  const wfCount = db.connection
    .prepare(`SELECT COUNT(*) as total FROM projecao_workflows;`)
    .get() as { total: number };

  if (wfCount.total === 0) {
    db.connection
      .prepare(
        `INSERT INTO projecao_workflows (workflow_id, nome, descricao, nos_json, arestas_json, ativo, ultima_execucao_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, 1, NULL, ?);`
      )
      .run(
        "wf-fluxo-em-branco",
        "Fluxo de trabalho sem título",
        "Comece adicionando um gatilho de WhatsApp, agendamento ou webhook",
        "[]",
        "[]",
        agora
      );
  }
}
