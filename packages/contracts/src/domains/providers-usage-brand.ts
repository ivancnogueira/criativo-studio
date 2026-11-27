/**
 * Contratos de marca, onboarding, provedores de IA, analytics de uso, habilidades, arquivos e Meta API.
 */

import type { McpAcessoAgentes } from "../mcp-contracts.ts";
import type { NivelEsforco, ProviderName } from "./agents-core.ts";

export interface MarcosOnboardingStudio {
  instalacao: "pendente" | "concluido";
  perfil: "pendente" | "concluido";
  identidade_visual: "pendente" | "concluido";
  configuracoes: "pendente" | "concluido";
  primeiro_post: "pendente" | "concluido";
  postagem: "pendente" | "concluido";
}

export interface IdentidadeMarcaStudio {
  marca_nome: string;
  perfil_handle: string;
  nicho: string;
  publico_alvo: string;
  oferta_principal: string;
  tom_voz: string;
  cores: {
    fundo: string;
    texto: string;
    primaria: string;
    secundaria: string;
    acento: string;
  };
  fontes: {
    titulo: string;
    texto: string;
  };
  marcos: MarcosOnboardingStudio;
  atualizado_em: string;
}

export interface PacoteUpgradeInfo {
  id: "bonus" | "video";
  nome: string;
  descricao: string;
  instalado: boolean;
  agentes: string[];
  skills: string[];
  comando_cli: string;
}

export interface OnboardingEstado {
  onboarding_concluido: boolean;
  modo_provedor_inicial: "gratuito" | "assinatura" | null;
  provedor_selecionado: ProviderName | null;
  telemetria_anonima: boolean;
  marca_nome: string;
  perfil_handle: string;
  marcos?: MarcosOnboardingStudio;
  setup_assistant_dismissed?: boolean;
  pendencias_setup?: string[];
  runtime_versao: string;
  atualizado_em: string;
}

export interface ModeloProvedorInfo {
  id: string;
  rotulo: string;
  padrao?: boolean;
  suporta_imagem?: boolean;
  gratuito?: boolean;
  oculto?: boolean;
  restante_percentual?: number | null;
  reseta_em?: string | null;
  esforcos_suportados?: NivelEsforco[];
  grupo_cota?: string | null;
  descoberto_em_conta?: boolean;
}

export interface JanelaCotaConta {
  bucket_id?: string;
  rotulo: string;
  janela: "5h" | "semanal" | "mensal" | "outro";
  duracao_minutos: number;
  restante_percentual: number;
  usado_percentual: number;
  reseta_em: string | null;
  reseta_em_texto: string;
}

export interface GrupoCotaConta {
  nome: string;
  modelos: string[];
  janela_5h: JanelaCotaConta | null;
  janela_semanal: JanelaCotaConta | null;
}

export type PoolEstrategiaContas = "fill_first" | "spread";

export interface ContaProvedorInfo {
  id: string;
  provedor: ProviderName;
  rotulo: string | null;
  email: string | null;
  organizacao?: string | null;
  plano?: string | null;
  estado: "conectado" | "verificando" | "desconectado" | "erro";
  padrao?: boolean;
  token_valido?: boolean;
  token_expira_em?: string | null;
  grupos_cota: GrupoCotaConta[];
  modelos_disponiveis?: string[];
  origem?: "sistema" | "externo" | "criativo";
  /** Indica que a conta está aguardando conclusão de turnos ativos antes da remoção definitiva. */
  removendo?: boolean;
  /** Quantidade de turnos ativos em execução nesta conta. */
  turnos_ativos?: number;
}

export interface PoolContasConfig {
  habilitado: boolean;
  contas_excluidas: string[];
  conta_em_uso: string | null;
  /** Estratégia de roteamento entre contas no pool: preenchimento sequencial ou distribuição equilibrada. */
  estrategia?: PoolEstrategiaContas;
}

export interface ProvedorStatusInfo {
  provedor: ProviderName;
  rotulo: string;
  subtitulo: string;
  conectado: boolean;
  cli_detectado: boolean;
  cli_versao: string | null;
  cli_executavel?: string | null;
  runtime_host?: string | null;
  runtime_platform?: string | null;
  vault_configurado: boolean;
  modo_conexao: "cli" | "api_key" | "local" | "assinatura" | "nenhum";
  modelos: ModeloProvedorInfo[];
  contas?: ContaProvedorInfo[];
  pool?: PoolContasConfig | null;
  usado_por_agentes?: string[];
  reporta_cota?: boolean;
}

export interface JanelaCotaUso {
  janela: string;
  rotulo: string;
  restante_percentual: number;
  usado_tokens: number;
  limite_tokens: number;
  reseta_em_texto: string;
  reseta_em?: string | null;
}

export interface UsoProvedoresSnapshot {
  total_execucoes_24h: number;
  total_tokens_estimados: number;
  contas?: ContaProvedorInfo[];
  provedores: Array<{
    provedor: ProviderName;
    rotulo: string;
    conectado: boolean;
    email?: string | null;
    janelas: JanelaCotaUso[];
    grupos?: GrupoCotaConta[];
  }>;
  atualizado_em: string;
}

export interface TotaisAnalyticsUso {
  sessoes: number;
  turnos: number;
  turnos_sem_uso: number;
  registros_sem_preco: number;
  registros_incompletos: number;
  tokens_sem_cache: number;
  tokens_processados: number;
  entrada_cache: number;
  entrada_sem_cache: number;
  criacao_cache: number;
  saida: number;
  custo_estimado_usd: number | null;
}

export interface LinhaDetalheUso extends TotaisAnalyticsUso {
  chave: string;
  nome: string;
  provedor?: string | null;
  participacao_percentual: number | null;
}

export type GranularidadeAnalyticsUso = "diario" | "semanal" | "mensal";

export interface PontoSerieUsoPorProvedor {
  provedor: string;
  rotulo: string;
  tokens: number;
  custo_usd: number;
}

export interface PontoSerieTemporalUso {
  chave: string;
  rotulo: string;
  inicio_iso: string;
  fim_iso: string;
  tokens: number;
  custo_usd: number;
  turnos: number;
  por_provedor: PontoSerieUsoPorProvedor[];
}

export interface PontoDiarioUso {
  data: string;
  rotulo: string;
  custo_usd: number;
  tokens: number;
  turnos: number;
}

export interface RelatorioAnalyticsHost {
  periodo_dias: number;
  agente_id: string | null;
  coleta_iniciada_em: string;
  atualizado_em: string;
  granularidade?: GranularidadeAnalyticsUso;
  totais: TotaisAnalyticsUso;
  provedores: Array<{
    provedor: string;
    rotulo: string;
    tokens: number;
    custo_estimado_usd: number | null;
    participacao_percentual: number | null;
  }>;
  por_modelo: LinhaDetalheUso[];
  por_agente: LinhaDetalheUso[];
  por_dia: PontoDiarioUso[];
  serie_empilhada?: PontoSerieTemporalUso[];
  por_habilidade: Array<{
    habilidade: string;
    carregamentos: number;
    tokens: number;
    custo_estimado_usd: number | null;
    participacao_percentual: number | null;
  }>;
}

export interface HabilidadeInstaladaInfo {
  id: string;
  nome: string;
  descricao: string;
  categoria: "conteudo" | "video" | "estrategia" | "sistema" | "outros";
  caminho: string;
  agentes_vinculados: string[];
  conteudo_preview: string;
}

export interface ConectorIntegracaoInfo {
  id:
    | "whatsapp"
    | "instagram"
    | "telegram"
    | "elevenlabs"
    | "fish_audio"
    | "mcp"
    | "slack"
    | "discord"
    | "github";
  nome: string;
  categoria: "mensageria" | "publicacao" | "voz" | "sistema";
  descricao: string;
  subtitulo: string;
  status: "conectado" | "atencao" | "desconectado";
  resumo_estado: string;
  cor_marca: string;
  agente_orquestrador_id?: string | null;
  detalhes: Array<{ chave: string; rotulo: string; configurado: boolean; valor_mascarado?: string | null }>;
}

export interface ArquivoStudio {
  arquivo_id: string;
  nome_original: string;
  caminho_relativo: string;
  url: string;
  mime_type: string;
  tamanho_bytes: number;
  tipo_uso: "referencia" | "logo" | "personagem" | "gerado" | "video" | "documento";
  agente_id: string | null;
  tarefa_id: string | null;
  pasta_id?: string | null;
  folder_path?: string | null;
  criado_em: string;
}

export type StorageUsageCategory =
  | "uploads"
  | "artes_geradas"
  | "videos"
  | "perfis_navegador"
  | "banco_dados";

export interface StorageUsageItem {
  categoria: StorageUsageCategory;
  rotulo: string;
  cor_hex: string;
  bytes: number;
  arquivos_count: number;
}

export interface StorageUsageSnapshot {
  totalBytes: number;
  categorias: StorageUsageItem[];
  topFiles: Array<{
    arquivo_id: string;
    nome: string;
    caminho_relativo: string;
    bytes: number;
    agente_id: string | null;
    criado_em: string;
  }>;
  porAgente: Record<string, number>;
  atualizado_em: string;
}

export interface ShowcaseSiteSummary {
  site_id: string;
  slug: string;
  titulo: string;
  descricao: string;
  source_dir: string;
  public_dir: string;
  url_local: string;
  spa_fallback: boolean;
  agente_id: string | null;
  aprovado_por_humano: boolean;
  ativo: boolean;
  arquivos_count?: number;
  tamanho_bytes?: number;
  criado_em: string;
  atualizado_em: string;
}

export interface OptionalConnectorWebhookEvent {
  conector_id: "slack" | "discord" | "github";
  evento: string;
  canal_ou_repo?: string | null;
  autor?: string | null;
  texto?: string | null;
  dados: Record<string, unknown>;
  recebido_em: string;
}

export const META_GRAPH_API_VERSION = "v27.0" as const;

export function resolveMetaGraphApiVersion(overrideVersion?: string | null): string {
  const candidate =
    overrideVersion?.trim() ||
    (typeof process !== "undefined" ? process.env?.META_API_VERSION?.trim() : "") ||
    META_GRAPH_API_VERSION;
  return /^v\d+\.\d+$/i.test(candidate) ? candidate : META_GRAPH_API_VERSION;
}

export function resolveMetaGraphApiBase(overrideVersion?: string | null): string {
  return `https://graph.facebook.com/${resolveMetaGraphApiVersion(overrideVersion)}`;
}

export interface NativeAppAccountSummary {
  conta_id: string;
  app_slug: string;
  conta_rotulo: string;
  campos_mascarados: Record<string, string>;
  campos_visiveis: Record<string, string>;
  configurado: boolean;
  testado_ok: boolean;
  ultimo_teste_em: string | null;
  ultimo_erro: string | null;
  perfil_conectado?: {
    username?: string | null;
    account_id?: string | null;
    followers_count?: number | null;
    media_count?: number | null;
  } | null;
  acesso: McpAcessoAgentes;
  atualizado_em: string;
}
