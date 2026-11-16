/**
 * Definições DDL completas do banco SQLite (criativo.db) conforme API-SPEC.md.
 * Segue o padrão Event Sourcing + Projeções materializadas com integridade referencial.
 */

export const SCHEMA_TABLES: readonly { nome: string; sql: string }[] = [
  {
    nome: "eventos_orquestracao",
    sql: `
      CREATE TABLE IF NOT EXISTS eventos_orquestracao (
        sequencia INTEGER PRIMARY KEY AUTOINCREMENT,
        evento_id TEXT NOT NULL UNIQUE,
        comando_id TEXT NOT NULL,
        tipo_agregado TEXT NOT NULL,
        agregado_id TEXT NOT NULL,
        tipo_evento TEXT NOT NULL,
        ocorrido_em TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
      );
    `,
  },
  {
    nome: "idx_eventos_agregado",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_eventos_agregado
      ON eventos_orquestracao(tipo_agregado, agregado_id, sequencia);
    `,
  },
  {
    nome: "projecao_agentes",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_agentes (
        agente_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        papel TEXT NOT NULL,
        modelo_padrao TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ocioso',
        skills_paths_json TEXT NOT NULL DEFAULT '[]',
        memoria_resumo TEXT,
        ordem_exibicao INTEGER NOT NULL DEFAULT 0,
        config_json TEXT NOT NULL DEFAULT '{}',
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_agente_memorias",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_agente_memorias (
        memoria_id TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL REFERENCES projecao_agentes(agente_id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        origem TEXT NOT NULL CHECK(origem IN ('automatica', 'manual')),
        criado_em TEXT NOT NULL,
        UNIQUE(agente_id, texto)
      );
    `,
  },
  {
    nome: "projecao_tarefas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_tarefas (
        tarefa_id TEXT PRIMARY KEY,
        agente_id TEXT REFERENCES projecao_agentes(agente_id),
        canal_origem TEXT NOT NULL DEFAULT 'web',
        tipo TEXT NOT NULL,
        titulo TEXT NOT NULL,
        prioridade INTEGER NOT NULL DEFAULT 5,
        status TEXT NOT NULL CHECK(status IN ('pendente', 'executando', 'aguardando_aprovacao', 'concluido', 'falha', 'cancelado')),
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        resultado_json TEXT CHECK(resultado_json IS NULL OR json_valid(resultado_json)),
        erro_detalhes TEXT,
        tentativas INTEGER NOT NULL DEFAULT 0,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        concluido_em TEXT
      );
    `,
  },
  {
    nome: "idx_tarefas_fila",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_tarefas_fila
      ON projecao_tarefas(status, prioridade, criado_em);
    `,
  },
  {
    nome: "projecao_canal_mensagens",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_canal_mensagens (
        mensagem_id TEXT PRIMARY KEY,
        tarefa_id TEXT REFERENCES projecao_tarefas(tarefa_id) ON DELETE CASCADE,
        de_agente_id TEXT NOT NULL,
        para_agente_id TEXT,
        tipo_mensagem TEXT NOT NULL,
        conteudo TEXT NOT NULL,
        artefatos_json TEXT NOT NULL DEFAULT '[]',
        enviado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_rotinas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_rotinas (
        rotina_id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        expressao_cron TEXT NOT NULL,
        tipo_tarefa TEXT NOT NULL,
        ativa INTEGER NOT NULL DEFAULT 1 CHECK(ativa IN (0, 1)),
        timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
        payload_modelo_json TEXT NOT NULL,
        proxima_execucao_em TEXT NOT NULL,
        criado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_webhooks",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_webhooks (
        webhook_id TEXT PRIMARY KEY,
        chave_secreta_hash TEXT NOT NULL,
        tipo_evento TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 1,
        ultimo_disparo_em TEXT
      );
    `,
  },
  {
    nome: "projecao_conexoes_mensageria",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_conexoes_mensageria (
        tipo_servico TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        qrcode_base64 TEXT,
        sessao_dados_json TEXT,
        notificar_aprovacoes INTEGER NOT NULL DEFAULT 1,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "cofre_segredos",
    sql: `
      CREATE TABLE IF NOT EXISTS cofre_segredos (
        chave_nome TEXT PRIMARY KEY,
        valor_criptografado TEXT NOT NULL,
        iv TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_mcp_servidores",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_mcp_servidores (
        mcp_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        comando TEXT NOT NULL,
        args_json TEXT NOT NULL DEFAULT '[]',
        env_json TEXT NOT NULL DEFAULT '{}',
        ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0, 1)),
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_perfis_navegador",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_perfis_navegador (
        perfil_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        user_data_dir TEXT NOT NULL,
        proxy_url TEXT,
        ultimo_uso_em TEXT
      );
    `,
  },
  {
    nome: "projecao_studio_config",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_studio_config (
        chave TEXT PRIMARY KEY,
        valor_json TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_grupos_equipe",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_grupos_equipe (
        canal_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        descricao TEXT,
        pasta TEXT NOT NULL DEFAULT 'Canais em Equipe',
        membros_agentes_json TEXT NOT NULL,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_conversas_chat",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_conversas_chat (
        mensagem_id TEXT PRIMARY KEY,
        canal_id TEXT NOT NULL,
        agente_id TEXT,
        autor TEXT NOT NULL,
        autor_nome TEXT,
        conteudo_markdown TEXT NOT NULL,
        anexos_json TEXT,
        steps_json TEXT,
        tarefa_id TEXT,
        lida INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_canal_data ON projecao_conversas_chat (canal_id, criado_em);
      CREATE INDEX IF NOT EXISTS idx_chat_agente_lida ON projecao_conversas_chat (agente_id, lida);
    `,
  },
  {
    nome: "projecao_workflows",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_workflows (
        workflow_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        descricao TEXT,
        nos_json TEXT NOT NULL,
        arestas_json TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 1,
        ultima_execucao_em TEXT,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_arquivos",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_arquivos (
        arquivo_id TEXT PRIMARY KEY,
        nome_original TEXT NOT NULL,
        caminho_relativo TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        tamanho_bytes INTEGER NOT NULL,
        tipo_uso TEXT NOT NULL,
        agente_id TEXT,
        tarefa_id TEXT,
        criado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_arquivos_data ON projecao_arquivos (criado_em DESC);
    `,
  },
  {
    nome: "projecao_uso_registros",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_uso_registros (
        record_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        uncached_input INTEGER NOT NULL DEFAULT 0,
        cached_input INTEGER NOT NULL DEFAULT 0,
        cache_creation INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL,
        rate_basis TEXT,
        origem TEXT NOT NULL DEFAULT 'criativo',
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_uso_registros_data ON projecao_uso_registros (occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_uso_registros_agente ON projecao_uso_registros (agent_id, occurred_at DESC);
    `,
  },
  {
    nome: "projecao_uso_skills",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_uso_skills (
        load_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        skill TEXT NOT NULL,
        tokens INTEGER,
        estimated_cost_usd REAL,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_uso_skills_data ON projecao_uso_skills (occurred_at DESC);
    `,
  },
];

export const SCHEMA_TABLE_NAMES = [
  "eventos_orquestracao",
  "projecao_agentes",
  "projecao_agente_memorias",
  "projecao_tarefas",
  "projecao_canal_mensagens",
  "projecao_rotinas",
  "projecao_webhooks",
  "projecao_conexoes_mensageria",
  "cofre_segredos",
  "projecao_mcp_servidores",
  "projecao_perfis_navegador",
  "projecao_studio_config",
  "projecao_grupos_equipe",
  "projecao_conversas_chat",
  "projecao_workflows",
  "projecao_arquivos",
  "projecao_uso_registros",
  "projecao_uso_skills",
] as const;
