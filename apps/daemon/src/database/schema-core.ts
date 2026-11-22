export interface SchemaTableDefinition {
  nome: string;
  sql: string;
  requiresFts5?: boolean;
}

export const SCHEMA_CORE_TABLES: readonly SchemaTableDefinition[] = [
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
        numero_telefone TEXT,
        rotulo TEXT,
        modo_operacao TEXT NOT NULL DEFAULT 'dedicated' CHECK(modo_operacao IN ('ownNumber', 'dedicated')),
        pairing_code TEXT,
        codigo_autorizacao_obrigatorio INTEGER NOT NULL DEFAULT 1 CHECK(codigo_autorizacao_obrigatorio IN (0, 1)),
        grupo_auto_responder INTEGER NOT NULL DEFAULT 0 CHECK(grupo_auto_responder IN (0, 1)),
        ultimo_erro TEXT,
        conectado_em TEXT,
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
        transporte TEXT NOT NULL DEFAULT 'stdio' CHECK(transporte IN ('stdio', 'http')),
        comando TEXT NOT NULL DEFAULT '',
        args_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(args_json)),
        env_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(env_json)),
        env_passthrough_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(env_passthrough_json)),
        working_directory TEXT,
        url TEXT,
        headers_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(headers_json)),
        acesso_json TEXT NOT NULL DEFAULT '{"mode":"everyone","agentIds":[]}' CHECK(json_valid(acesso_json)),
        origem_app_slug TEXT,
        conta_rotulo TEXT,
        posicao INTEGER NOT NULL DEFAULT 0,
        ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0, 1)),
        ultimo_teste_em TEXT,
        ultimo_erro TEXT,
        qtd_ferramentas INTEGER NOT NULL DEFAULT 0,
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
        instrucoes TEXT NOT NULL DEFAULT '',
        pasta TEXT NOT NULL DEFAULT 'Canais em Equipe',
        membros_agentes_json TEXT NOT NULL,
        lider_agente_id TEXT,
        navegador_modo TEXT NOT NULL DEFAULT 'all',
        manter_memorias INTEGER NOT NULL DEFAULT 0 CHECK(manter_memorias IN (0, 1)),
        context_cutoff_at TEXT,
        context_summary TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_canal_memorias",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_canal_memorias (
        memoria_id TEXT PRIMARY KEY,
        canal_id TEXT NOT NULL REFERENCES projecao_grupos_equipe(canal_id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        origem TEXT NOT NULL CHECK(origem IN ('automatica', 'manual')),
        criado_em TEXT NOT NULL,
        UNIQUE(canal_id, texto)
      );
      CREATE INDEX IF NOT EXISTS idx_canal_memorias_canal
        ON projecao_canal_memorias(canal_id, criado_em DESC);
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
  {
    nome: "whatsapp_contas",
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_contas (
        conta_id TEXT PRIMARY KEY,
        rotulo TEXT NOT NULL DEFAULT 'Número Principal',
        numero_telefone TEXT,
        jid_proprio TEXT,
        modo_operacao TEXT NOT NULL DEFAULT 'dedicated' CHECK(modo_operacao IN ('ownNumber', 'dedicated')),
        status TEXT NOT NULL DEFAULT 'desconectado',
        qrcode_base64 TEXT,
        pairing_code TEXT,
        sessao_dados_json TEXT,
        notificar_aprovacoes INTEGER NOT NULL DEFAULT 1 CHECK(notificar_aprovacoes IN (0, 1)),
        codigo_autorizacao_obrigatorio INTEGER NOT NULL DEFAULT 1 CHECK(codigo_autorizacao_obrigatorio IN (0, 1)),
        grupo_auto_responder INTEGER NOT NULL DEFAULT 0 CHECK(grupo_auto_responder IN (0, 1)),
        agente_orquestrador_id TEXT DEFAULT 'estrategista',
        regras_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(regras_json)),
        ultimo_erro TEXT,
        conectado_em TEXT,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "whatsapp_contatos_autorizados",
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_contatos_autorizados (
        autorizacao_id TEXT PRIMARY KEY,
        conta_id TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK(tipo IN ('contato', 'grupo')),
        identificador_jid TEXT NOT NULL,
        telefone_normalizado TEXT,
        variantes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(variantes_json)),
        nome_exibicao TEXT,
        permitido INTEGER NOT NULL DEFAULT 1 CHECK(permitido IN (0, 1)),
        somente_mencao INTEGER NOT NULL DEFAULT 1 CHECK(somente_mencao IN (0, 1)),
        origem TEXT NOT NULL DEFAULT 'manual' CHECK(origem IN ('manual', 'pareamento', 'auto_chat')),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        UNIQUE (conta_id, identificador_jid),
        FOREIGN KEY (conta_id) REFERENCES whatsapp_contas(conta_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_wpp_contatos_conta_tel
        ON whatsapp_contatos_autorizados(conta_id, telefone_normalizado);
    `,
  },
  {
    nome: "whatsapp_pairing_requests",
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_pairing_requests (
        request_id TEXT PRIMARY KEY,
        conta_id TEXT NOT NULL,
        codigo TEXT NOT NULL,
        remetente_jid TEXT NOT NULL,
        remetente_pn TEXT,
        nome_contato TEXT,
        status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente', 'aprovado', 'recusado', 'expirado')),
        criado_em TEXT NOT NULL,
        expira_em TEXT NOT NULL,
        resolvido_em TEXT,
        FOREIGN KEY (conta_id) REFERENCES whatsapp_contas(conta_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_wpp_pairing_pendentes
        ON whatsapp_pairing_requests(conta_id, status, expira_em);
    `,
  },
  {
    nome: "whatsapp_historico_mensagens",
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_historico_mensagens (
        mensagem_id TEXT PRIMARY KEY,
        conta_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        remetente_jid TEXT NOT NULL,
        remetente_nome TEXT,
        direcao TEXT NOT NULL CHECK(direcao IN ('entrada', 'saida')),
        tipo_conteudo TEXT NOT NULL DEFAULT 'texto' CHECK(tipo_conteudo IN ('texto', 'imagem', 'documento', 'audio', 'video', 'sistema')),
        texto TEXT,
        midia_caminho TEXT,
        midia_mime TEXT,
        midia_tamanho_bytes INTEGER DEFAULT 0,
        eh_grupo INTEGER NOT NULL DEFAULT 0 CHECK(eh_grupo IN (0, 1)),
        ack_status TEXT DEFAULT 'enviado',
        metadados_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadados_json)),
        ocorrido_em TEXT NOT NULL,
        expira_em TEXT NOT NULL,
        FOREIGN KEY (conta_id) REFERENCES whatsapp_contas(conta_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_wpp_hist_chat_data
        ON whatsapp_historico_mensagens(conta_id, chat_jid, ocorrido_em DESC);
      CREATE INDEX IF NOT EXISTS idx_wpp_hist_expira
        ON whatsapp_historico_mensagens(expira_em);
    `,
  },
  {
    nome: "projecao_mcp_oauth_tokens",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_mcp_oauth_tokens (
        conta_chave TEXT PRIMARY KEY,
        mcp_id TEXT NOT NULL,
        app_slug TEXT,
        servidor_url TEXT NOT NULL,
        issuer_url TEXT,
        escopos_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(escopos_json)),
        discovery_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(discovery_json)),
        payload_criptografado TEXT NOT NULL,
        iv TEXT NOT NULL,
        expira_em TEXT,
        obtido_em TEXT NOT NULL,
        perdido_em TEXT,
        atualizado_em TEXT NOT NULL,
        FOREIGN KEY (mcp_id) REFERENCES projecao_mcp_servidores(mcp_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_oauth_mcp_id
        ON projecao_mcp_oauth_tokens(mcp_id);
    `,
  },
  {
    nome: "projecao_habilidades_catalogo",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_habilidades_catalogo (
        skill_id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        nome TEXT NOT NULL,
        descricao TEXT NOT NULL,
        categoria TEXT NOT NULL DEFAULT 'operacoes',
        origem TEXT NOT NULL CHECK(origem IN ('nativa', 'loja', 'github', 'personalizada')),
        fonte_rotulo TEXT,
        repositorio_url TEXT,
        commit_sha TEXT,
        caminho_pasta TEXT NOT NULL,
        verificada INTEGER NOT NULL DEFAULT 0 CHECK(verificada IN (0, 1)),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_agente_habilidades",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_agente_habilidades (
        agente_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        habilitada INTEGER NOT NULL DEFAULT 1 CHECK(habilitada IN (0, 1)),
        instalada_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        PRIMARY KEY (agente_id, skill_id),
        FOREIGN KEY (agente_id) REFERENCES projecao_agentes(agente_id) ON DELETE CASCADE,
        FOREIGN KEY (skill_id) REFERENCES projecao_habilidades_catalogo(skill_id) ON DELETE CASCADE
      );
    `,
  },
];
