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
  {
    nome: "projecao_agente_rotinas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_agente_rotinas (
        rotina_id TEXT PRIMARY KEY,
        owner_kind TEXT NOT NULL CHECK(owner_kind IN ('agente', 'canal')),
        owner_id TEXT NOT NULL,
        nome TEXT NOT NULL,
        instrucao TEXT NOT NULL,
        ativa INTEGER NOT NULL DEFAULT 1 CHECK(ativa IN (0, 1)),
        timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
        trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('schedule', 'webhook')),
        schedule_json TEXT CHECK(schedule_json IS NULL OR json_valid(schedule_json)),
        next_run_at TEXT,
        limit_policy TEXT NOT NULL DEFAULT 'wait' CHECK(limit_policy IN ('wait', 'skip')),
        missed_policy TEXT NOT NULL DEFAULT 'skip' CHECK(missed_policy IN ('skip', 'run-once')),
        run_in TEXT NOT NULL DEFAULT 'chat' CHECK(run_in IN ('chat', 'side_thread')),
        destino_resultado_json TEXT CHECK(destino_resultado_json IS NULL OR json_valid(destino_resultado_json)),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agente_rotinas_owner
        ON projecao_agente_rotinas(owner_kind, owner_id, atualizado_em DESC, rotina_id);
      CREATE INDEX IF NOT EXISTS idx_agente_rotinas_due
        ON projecao_agente_rotinas(ativa, trigger_kind, next_run_at)
        WHERE ativa = 1 AND trigger_kind = 'schedule' AND next_run_at IS NOT NULL;
    `,
  },
  {
    nome: "projecao_rotina_execucoes",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_rotina_execucoes (
        execucao_id TEXT PRIMARY KEY,
        rotina_id TEXT NOT NULL REFERENCES projecao_agente_rotinas(rotina_id) ON DELETE CASCADE,
        owner_kind TEXT NOT NULL CHECK(owner_kind IN ('agente', 'canal')),
        owner_id TEXT NOT NULL,
        run_kind TEXT NOT NULL CHECK(run_kind IN ('scheduled', 'manual')),
        run_source TEXT CHECK(run_source IS NULL OR run_source IN ('test', 'script', 'webhook')),
        scheduled_for TEXT NOT NULL,
        rotina_nome TEXT NOT NULL,
        instrucao TEXT NOT NULL,
        tarefa_id TEXT,
        thread_id TEXT,
        status TEXT NOT NULL CHECK(status IN (
          'queued', 'running', 'needs-attention', 'succeeded', 'failed', 'interrupted', 'cancelled'
        )),
        silenciada INTEGER NOT NULL DEFAULT 0 CHECK(silenciada IN (0, 1)),
        erro TEXT,
        missed_count INTEGER CHECK(missed_count IS NULL OR missed_count >= 1),
        missed_until TEXT,
        resultado_resumo TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rotina_execucoes_rotina
        ON projecao_rotina_execucoes(rotina_id, criado_em DESC, execucao_id DESC);
      CREATE INDEX IF NOT EXISTS idx_rotina_execucoes_agenda
        ON projecao_rotina_execucoes(scheduled_for, rotina_id);
      CREATE INDEX IF NOT EXISTS idx_rotina_execucoes_status
        ON projecao_rotina_execucoes(status, atualizado_em);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rotina_execucoes_idempotency
        ON projecao_rotina_execucoes(rotina_id, run_kind, scheduled_for)
        WHERE run_kind = 'scheduled' AND missed_count IS NULL;
    `,
  },
  {
    nome: "projecao_rotina_webhooks",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_rotina_webhooks (
        webhook_id TEXT PRIMARY KEY,
        rotina_id TEXT NOT NULL UNIQUE REFERENCES projecao_agente_rotinas(rotina_id) ON DELETE CASCADE,
        owner_kind TEXT NOT NULL CHECK(owner_kind IN ('agente', 'canal')),
        owner_id TEXT NOT NULL,
        route_token TEXT NOT NULL UNIQUE,
        event_type TEXT,
        filters_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(filters_json)),
        vault_secret_key TEXT NOT NULL,
        ultimo_disparo_em TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rotina_webhooks_token
        ON projecao_rotina_webhooks(route_token);
    `,
  },
  {
    nome: "projecao_webhook_recibos",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_webhook_recibos (
        recibo_id TEXT PRIMARY KEY,
        rotina_id TEXT NOT NULL REFERENCES projecao_agente_rotinas(rotina_id) ON DELETE CASCADE,
        owner_kind TEXT NOT NULL CHECK(owner_kind IN ('agente', 'canal')),
        delivery_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('started', 'ignored')),
        reason TEXT CHECK(reason IS NULL OR reason IN ('event-type', 'filter', 'inactive')),
        execucao_id TEXT,
        recebido_em TEXT NOT NULL,
        UNIQUE(owner_kind, rotina_id, delivery_id)
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_recibos_recentes
        ON projecao_webhook_recibos(owner_kind, rotina_id, recebido_em DESC, recibo_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_recibos_retencao
        ON projecao_webhook_recibos(recebido_em);
    `,
  },
  {
    nome: "projecao_rotina_entregas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_rotina_entregas (
        execucao_id TEXT PRIMARY KEY REFERENCES projecao_rotina_execucoes(execucao_id) ON DELETE CASCADE,
        rotina_id TEXT NOT NULL REFERENCES projecao_agente_rotinas(rotina_id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        destino_tipo TEXT NOT NULL CHECK(destino_tipo IN ('canal', 'whatsapp', 'telegram', 'notificacao')),
        destino_id TEXT NOT NULL,
        destino_nome TEXT NOT NULL,
        conteudo_texto TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'sending', 'sent', 'failed', 'uncertain', 'quiet')),
        motivo_falha TEXT,
        tentativas INTEGER NOT NULL DEFAULT 0 CHECK(tentativas >= 0),
        proximo_envio_em TEXT,
        expira_em TEXT,
        enviado_em TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rotina_entregas_rotina
        ON projecao_rotina_entregas(rotina_id, criado_em DESC);
    `,
  },
  {
    nome: "projecao_routine_flow_links",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_routine_flow_links (
        link_id TEXT PRIMARY KEY,
        rotina_id TEXT NOT NULL REFERENCES projecao_agente_rotinas(rotina_id) ON DELETE CASCADE,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        instrucao TEXT NOT NULL DEFAULT '',
        criado_em TEXT NOT NULL,
        CHECK(from_agent_id <> to_agent_id),
        UNIQUE(rotina_id, from_agent_id, to_agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_routine_flow_links_to
        ON projecao_routine_flow_links(to_agent_id);
    `,
  },
  {
    nome: "projecao_routine_flow_posicoes",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_routine_flow_posicoes (
        canvas_agent_id TEXT NOT NULL,
        node_key TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        atualizado_em TEXT NOT NULL,
        PRIMARY KEY(canvas_agent_id, node_key)
      );
    `,
  },
  {
    nome: "projecao_routine_flow_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_routine_flow_runs (
        flow_run_id TEXT PRIMARY KEY,
        execucao_id TEXT NOT NULL UNIQUE REFERENCES projecao_rotina_execucoes(execucao_id) ON DELETE CASCADE,
        rotina_id TEXT NOT NULL REFERENCES projecao_agente_rotinas(rotina_id) ON DELETE CASCADE,
        root_agent_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'cancelled')),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_routine_flow_runs_rotina
        ON projecao_routine_flow_runs(rotina_id, criado_em DESC);
    `,
  },
  {
    nome: "projecao_routine_flow_etapas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_routine_flow_etapas (
        step_id TEXT PRIMARY KEY,
        flow_run_id TEXT NOT NULL REFERENCES projecao_routine_flow_runs(flow_run_id) ON DELETE CASCADE,
        execucao_id TEXT NOT NULL REFERENCES projecao_rotina_execucoes(execucao_id) ON DELETE CASCADE,
        agente_id TEXT NOT NULL,
        tarefa_id TEXT,
        input TEXT NOT NULL,
        output TEXT,
        status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'skipped', 'cancelled')),
        erro TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        UNIQUE(execucao_id, agente_id)
      );
      CREATE INDEX IF NOT EXISTS idx_routine_flow_etapas_agent
        ON projecao_routine_flow_etapas(agente_id);
      CREATE INDEX IF NOT EXISTS idx_routine_flow_etapas_running
        ON projecao_routine_flow_etapas(criado_em, step_id)
        WHERE status = 'running';
    `,
  },
  {
    nome: "projecao_workflow_versoes",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_workflow_versoes (
        version_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES projecao_workflows(workflow_id) ON DELETE CASCADE,
        revisao_grafo INTEGER NOT NULL CHECK(revisao_grafo >= 0),
        kind TEXT NOT NULL CHECK(kind IN ('auto', 'restore', 'run')),
        grafo_json TEXT NOT NULL CHECK(json_valid(grafo_json)),
        criado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_versoes_recentes
        ON projecao_workflow_versoes(workflow_id, criado_em DESC, version_id);
    `,
  },
  {
    nome: "projecao_workflow_gatilhos",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_workflow_gatilhos (
        workflow_id TEXT NOT NULL REFERENCES projecao_workflows(workflow_id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK(tipo IN ('manual', 'schedule', 'webhook', 'whatsapp', 'telegram', 'conector')),
        timezone TEXT,
        schedule_json TEXT CHECK(schedule_json IS NULL OR json_valid(schedule_json)),
        filtro_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(filtro_json)),
        webhook_route_id TEXT UNIQUE,
        webhook_secret_vault_key TEXT,
        proxima_execucao_em TEXT,
        atualizado_em TEXT NOT NULL,
        PRIMARY KEY(workflow_id, node_id)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_gatilhos_due
        ON projecao_workflow_gatilhos(proxima_execucao_em)
        WHERE proxima_execucao_em IS NOT NULL;
    `,
  },
  {
    nome: "projecao_workflow_webhook_recibos",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_workflow_webhook_recibos (
        receipt_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES projecao_workflows(workflow_id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        delivery_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('started', 'ignored')),
        motivo TEXT CHECK(motivo IS NULL OR motivo IN ('busy', 'refused', 'unauthorized')),
        run_id TEXT,
        recebido_em TEXT NOT NULL,
        UNIQUE(workflow_id, node_id, delivery_id)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_webhook_recibos_data
        ON projecao_workflow_webhook_recibos(recebido_em);
    `,
  },
  {
    nome: "projecao_workflow_execucoes",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_workflow_execucoes (
        run_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES projecao_workflows(workflow_id) ON DELETE CASCADE,
        numero INTEGER NOT NULL CHECK(numero >= 1),
        trigger_node_id TEXT,
        from_node_id TEXT,
        origem TEXT NOT NULL CHECK(origem IN ('manual', 'schedule', 'webhook', 'whatsapp', 'telegram', 'conector', 'agente')),
        agendado_para TEXT,
        chave_idempotencia TEXT NOT NULL,
        revisao_grafo INTEGER NOT NULL CHECK(revisao_grafo >= 0),
        grafo_json TEXT NOT NULL CHECK(json_valid(grafo_json)),
        payload TEXT,
        status TEXT NOT NULL CHECK(status IN ('running', 'approval', 'stopping', 'done', 'failed', 'stopped')),
        erro TEXT,
        iniciado_em TEXT NOT NULL,
        encerrado_em TEXT,
        atualizado_em TEXT NOT NULL,
        UNIQUE(workflow_id, numero),
        UNIQUE(workflow_id, chave_idempotencia)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_execucoes_recentes
        ON projecao_workflow_execucoes(workflow_id, iniciado_em DESC, run_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_execucoes_abertas
        ON projecao_workflow_execucoes(status)
        WHERE status IN ('running', 'approval', 'stopping');
    `,
  },
  {
    nome: "projecao_workflow_etapas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_workflow_etapas (
        step_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES projecao_workflows(workflow_id) ON DELETE CASCADE,
        run_id TEXT REFERENCES projecao_workflow_execucoes(run_id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        tentativa INTEGER NOT NULL CHECK(tentativa >= 1),
        request_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        agente_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('running', 'approval', 'done', 'failed', 'stopped', 'skipped')),
        tarefa_id TEXT,
        input TEXT NOT NULL DEFAULT '',
        output TEXT,
        output_tipo TEXT CHECK(output_tipo IS NULL OR output_tipo IN ('text', 'image', 'file')),
        artefatos_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(artefatos_json)),
        branch TEXT CHECK(branch IS NULL OR branch IN ('yes', 'no')),
        erro TEXT,
        iniciado_em TEXT,
        encerrado_em TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        UNIQUE(workflow_id, request_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_etapas_tentativa
        ON projecao_workflow_etapas(run_id, node_id, tentativa)
        WHERE run_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_workflow_etapas_solo
        ON projecao_workflow_etapas(workflow_id, criado_em DESC, step_id)
        WHERE run_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_workflow_etapas_abertas
        ON projecao_workflow_etapas(status)
        WHERE status IN ('running', 'approval');
    `,
  },
  {
    nome: "projecao_workflow_entregas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_workflow_entregas (
        step_id TEXT PRIMARY KEY REFERENCES projecao_workflow_etapas(step_id) ON DELETE CASCADE,
        destino TEXT NOT NULL CHECK(destino IN ('canal', 'whatsapp', 'telegram', 'arquivo', 'instagram', 'notificacao')),
        destino_ref TEXT NOT NULL,
        texto TEXT NOT NULL,
        anexos_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(anexos_json)),
        status TEXT NOT NULL CHECK(status IN ('pending', 'sending', 'sent', 'failed', 'uncertain')),
        motivo TEXT,
        tentativas INTEGER NOT NULL DEFAULT 0 CHECK(tentativas >= 0),
        enviado_em TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_agente_threads",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_agente_threads (
        thread_id TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL REFERENCES projecao_agentes(agente_id) ON DELETE CASCADE,
        tarefa_id TEXT UNIQUE REFERENCES projecao_tarefas(tarefa_id) ON DELETE SET NULL,
        origem TEXT NOT NULL CHECK(origem IN ('usuario', 'agente')),
        titulo TEXT NOT NULL,
        titulo_origem TEXT NOT NULL DEFAULT 'auto' CHECK(titulo_origem IN ('auto', 'agente', 'usuario')),
        estado TEXT NOT NULL DEFAULT 'ociosa' CHECK(estado IN ('executando', 'enfileirada', 'ociosa', 'arquivada')),
        desfecho TEXT CHECK(desfecho IS NULL OR desfecho IN ('concluida', 'falha', 'interrompida')),
        erro TEXT,
        progresso_atual TEXT,
        turno_ativo_id TEXT,
        sessao_provedor_id TEXT,
        branch_origem_thread_id TEXT,
        branch_origem_mensagem_id TEXT,
        branch_ate_mensagem_id TEXT,
        rotina_id TEXT,
        ultima_mensagem_lida_id TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        arquivada_em TEXT,
        ultima_sequencia_evento INTEGER NOT NULL DEFAULT 0,
        CHECK(
          (branch_origem_thread_id IS NULL AND branch_origem_mensagem_id IS NULL AND branch_ate_mensagem_id IS NULL) OR
          (branch_origem_thread_id IS NOT NULL AND branch_origem_mensagem_id IS NOT NULL AND branch_ate_mensagem_id IS NOT NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_agente_threads_abertas
        ON projecao_agente_threads(agente_id, atualizado_em DESC)
        WHERE arquivada_em IS NULL;
      CREATE INDEX IF NOT EXISTS idx_agente_threads_agente
        ON projecao_agente_threads(agente_id, criado_em DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agente_threads_rotina
        ON projecao_agente_threads(agente_id, rotina_id)
        WHERE rotina_id IS NOT NULL;
    `,
  },
  {
    nome: "projecao_agente_esperas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_agente_esperas (
        espera_id TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL REFERENCES projecao_agentes(agente_id) ON DELETE CASCADE,
        entrega_origem_id TEXT NOT NULL,
        pedido_texto TEXT NOT NULL,
        nota TEXT NOT NULL,
        rotina_id TEXT,
        criado_em TEXT NOT NULL,
        despertada_em TEXT,
        entrega_despertar_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_esperas_agente
        ON projecao_agente_esperas(agente_id, criado_em ASC);
      CREATE INDEX IF NOT EXISTS idx_esperas_rotina
        ON projecao_agente_esperas(rotina_id)
        WHERE rotina_id IS NOT NULL;
    `,
  },
  {
    nome: "projecao_fila_chat",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_fila_chat (
        entrega_id TEXT PRIMARY KEY,
        mensagem_id TEXT NOT NULL,
        agente_id TEXT NOT NULL REFERENCES projecao_agentes(agente_id) ON DELETE CASCADE,
        thread_id TEXT,
        remetente_tipo TEXT NOT NULL CHECK(remetente_tipo IN ('usuario', 'agente', 'rotina', 'webhook')),
        remetente_agente_id TEXT,
        rotina_id TEXT,
        run_id TEXT,
        conteudo_markdown TEXT NOT NULL,
        anexos_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(anexos_json)),
        resposta_para_mensagem_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('enfileirada', 'iniciando', 'executando', 'concluida', 'falha', 'interrompida', 'cancelada')),
        posicao INTEGER,
        turno_id TEXT,
        erro TEXT,
        editando INTEGER NOT NULL DEFAULT 0 CHECK(editando IN (0, 1)),
        edit_id TEXT,
        espera_resposta INTEGER NOT NULL DEFAULT 1 CHECK(espera_resposta IN (0, 1)),
        steer_fallback TEXT CHECK(steer_fallback IS NULL OR steer_fallback IN ('provedor_nao_suporta', 'falha_steer')),
        chave_idempotencia TEXT UNIQUE,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fila_chat_lane
        ON projecao_fila_chat(agente_id, thread_id, status, posicao ASC, criado_em ASC);
      CREATE INDEX IF NOT EXISTS idx_fila_chat_turno
        ON projecao_fila_chat(agente_id, turno_id)
        WHERE turno_id IS NOT NULL;
    `,
  },
  {
    nome: "projecao_mensagens_fixadas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_mensagens_fixadas (
        thread_id TEXT NOT NULL,
        agente_id TEXT NOT NULL REFERENCES projecao_agentes(agente_id) ON DELETE CASCADE,
        mensagem_id TEXT NOT NULL CHECK(length(mensagem_id) > 0),
        fixado_em TEXT NOT NULL,
        fixado_por_tipo TEXT NOT NULL CHECK(fixado_por_tipo IN ('usuario', 'agente')),
        fixado_por_id TEXT,
        fixado_por_nome TEXT,
        PRIMARY KEY (thread_id, mensagem_id),
        CHECK(
          (fixado_por_tipo = 'agente' AND fixado_por_id IS NOT NULL AND fixado_por_nome IS NULL) OR
          (fixado_por_tipo = 'usuario' AND (fixado_por_id IS NULL) = (fixado_por_nome IS NULL))
        )
      );
      CREATE INDEX IF NOT EXISTS idx_mensagens_fixadas_agente
        ON projecao_mensagens_fixadas(agente_id, fixado_em DESC);
    `,
  },
  // =========================================================================
  // Fase 14 — Aprendizado Autônomo, FTS5, Pastas da Biblioteca & UI Blocks
  // =========================================================================
  {
    nome: "projecao_memory_review_cursores",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_memory_review_cursores (
        chave TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL REFERENCES projecao_agentes(agente_id) ON DELETE CASCADE,
        thread_id TEXT,
        ultimo_mensagem_id TEXT NOT NULL,
        turnos_desde_revisao INTEGER NOT NULL DEFAULT 0,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_review_agente
        ON projecao_memory_review_cursores(agente_id);
    `,
  },
  {
    nome: "projecao_skill_sugestoes",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_skill_sugestoes (
        sugestao_id TEXT PRIMARY KEY,
        mensagem_id TEXT NOT NULL,
        agente_id TEXT NOT NULL REFERENCES projecao_agentes(agente_id) ON DELETE CASCADE,
        thread_id TEXT,
        acao TEXT NOT NULL CHECK(acao IN ('create', 'update')),
        skill_id TEXT,
        nome_skill TEXT NOT NULL,
        pergunta_markdown TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta', 'salva', 'dispensada', 'expirada')),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_skill_sugestoes_agente_status
        ON projecao_skill_sugestoes(agente_id, status, criado_em DESC);
    `,
  },
  {
    nome: "agente_memorias_fts",
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS agente_memorias_fts USING fts5(
        texto,
        memoria_id UNINDEXED,
        agente_id UNINDEXED,
        tokenize = 'unicode61'
      );
    `,
  },
  {
    nome: "projecao_biblioteca_pastas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_biblioteca_pastas (
        pasta_id TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL REFERENCES projecao_agentes(agente_id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES projecao_biblioteca_pastas(pasta_id) ON DELETE CASCADE,
        nome TEXT NOT NULL,
        caminho_completo TEXT NOT NULL,
        nivel INTEGER NOT NULL CHECK(nivel >= 1 AND nivel <= 4),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_biblioteca_pastas_agente_parent
        ON projecao_biblioteca_pastas(agente_id, parent_id, nome);
    `,
  },
  {
    nome: "projecao_chat_ui_blocos",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_chat_ui_blocos (
        bloco_id TEXT PRIMARY KEY,
        mensagem_id TEXT NOT NULL,
        canal_id TEXT NOT NULL,
        agente_id TEXT NOT NULL,
        turno_id TEXT NOT NULL,
        tipo_ferramenta TEXT NOT NULL CHECK(tipo_ferramenta IN ('ask_user', 'ask_ui', 'acknowledge_request', 'request_api_key')),
        versao INTEGER NOT NULL DEFAULT 1,
        spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
        estado_json TEXT NOT NULL CHECK(json_valid(estado_json)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'answered', 'expired', 'closed')),
        auto_responder_em TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_ui_blocos_canal_status
        ON projecao_chat_ui_blocos(canal_id, status, criado_em DESC);
    `,
  },
  {
    nome: "projecao_browser_proxies",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_browser_proxies (
        proxy_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        servidor TEXT NOT NULL,
        usuario TEXT,
        senha_vault_chave TEXT,
        ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0, 1)),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
    `,
  },
  {
    nome: "projecao_agent_browsing_log",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_agent_browsing_log (
        log_id TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL REFERENCES projecao_agentes(agente_id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('page', 'click')),
        host TEXT NOT NULL,
        path TEXT NOT NULL,
        title TEXT,
        role TEXT,
        name TEXT,
        revisado INTEGER NOT NULL DEFAULT 0 CHECK(revisado IN (0, 1)),
        criado_em INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browsing_log_agente
        ON projecao_agent_browsing_log(agente_id, revisado, criado_em);
    `,
  },
  {
    nome: "projecao_sidebar_secoes",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_sidebar_secoes (
        section_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        parent_id TEXT REFERENCES projecao_sidebar_secoes(section_id) ON DELETE SET NULL,
        ordem INTEGER NOT NULL DEFAULT 0,
        colapsada INTEGER NOT NULL DEFAULT 0 CHECK(colapsada IN (0, 1)),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sidebar_secoes_ordem
        ON projecao_sidebar_secoes(ordem ASC);
    `,
  },
  {
    nome: "projecao_showcase_sites",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_showcase_sites (
        site_id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        titulo TEXT NOT NULL,
        descricao TEXT NOT NULL DEFAULT '',
        source_dir TEXT NOT NULL,
        public_dir TEXT NOT NULL,
        spa_fallback INTEGER NOT NULL DEFAULT 1 CHECK(spa_fallback IN (0, 1)),
        agente_id TEXT REFERENCES projecao_agentes(agente_id) ON DELETE SET NULL,
        aprovado_por_humano INTEGER NOT NULL DEFAULT 0 CHECK(aprovado_por_humano IN (0, 1)),
        ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0, 1)),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_showcase_slug
        ON projecao_showcase_sites(slug);
    `,
  },
  {
    nome: "projecao_servidores_conectados",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_servidores_conectados (
        server_id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('primary', 'local_child', 'remote_vps', 'joined')),
        cor_hex TEXT NOT NULL DEFAULT '#F59E0B',
        base_url TEXT NOT NULL,
        workspace_path TEXT,
        port INTEGER,
        remote_ip TEXT,
        access_token_vault_key TEXT,
        version TEXT,
        is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_servidores_kind
        ON projecao_servidores_conectados(kind, is_active);
    `,
  },
  {
    nome: "projecao_apps_nativos_contas",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_apps_nativos_contas (
        conta_id TEXT PRIMARY KEY,
        app_slug TEXT NOT NULL,
        conta_rotulo TEXT NOT NULL,
        campos_visiveis_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(campos_visiveis_json)),
        vault_keys_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(vault_keys_json)),
        acesso_json TEXT NOT NULL DEFAULT '{"mode":"everyone","agentIds":[]}' CHECK(json_valid(acesso_json)),
        testado_ok INTEGER NOT NULL DEFAULT 0 CHECK(testado_ok IN (0, 1)),
        ultimo_teste_em TEXT,
        ultimo_erro TEXT,
        perfil_conectado_json TEXT,
        padrao INTEGER NOT NULL DEFAULT 0 CHECK(padrao IN (0, 1)),
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_apps_nativos_slug
        ON projecao_apps_nativos_contas(app_slug, padrao DESC, atualizado_em DESC);
    `,
  },
  {
    nome: "projecao_agente_wakeups",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_agente_wakeups (
        wakeup_id TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        canal_id TEXT NOT NULL,
        channel_origin TEXT NOT NULL DEFAULT 'web',
        whatsapp_conta_id TEXT,
        whatsapp_chat_jid TEXT,
        instrucao TEXT NOT NULL,
        intervalo_segundos INTEGER NOT NULL,
        recorrente INTEGER NOT NULL DEFAULT 0 CHECK(recorrente IN (0, 1)),
        max_iteracoes INTEGER NOT NULL DEFAULT 1,
        iteracao_atual INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'agendado' CHECK(status IN ('agendado', 'executando', 'concluido', 'cancelado', 'falha')),
        proximo_disparo_em TEXT NOT NULL,
        ultimo_disparo_em TEXT,
        ultimo_erro TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agente_wakeups_due
        ON projecao_agente_wakeups(status, proximo_disparo_em);
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
  "whatsapp_contas",
  "whatsapp_contatos_autorizados",
  "whatsapp_pairing_requests",
  "whatsapp_historico_mensagens",
  "projecao_mcp_oauth_tokens",
  "projecao_habilidades_catalogo",
  "projecao_agente_habilidades",
  "projecao_agente_rotinas",
  "projecao_rotina_execucoes",
  "projecao_rotina_webhooks",
  "projecao_webhook_recibos",
  "projecao_rotina_entregas",
  "projecao_routine_flow_links",
  "projecao_routine_flow_posicoes",
  "projecao_routine_flow_runs",
  "projecao_routine_flow_etapas",
  "projecao_workflow_versoes",
  "projecao_workflow_gatilhos",
  "projecao_workflow_webhook_recibos",
  "projecao_workflow_execucoes",
  "projecao_workflow_etapas",
  "projecao_workflow_entregas",
  "projecao_agente_threads",
  "projecao_agente_esperas",
  "projecao_fila_chat",
  "projecao_mensagens_fixadas",
  "projecao_memory_review_cursores",
  "projecao_skill_sugestoes",
  "agente_memorias_fts",
  "projecao_biblioteca_pastas",
  "projecao_chat_ui_blocos",
  "projecao_browser_proxies",
  "projecao_agent_browsing_log",
  "projecao_sidebar_secoes",
  "projecao_showcase_sites",
  "projecao_servidores_conectados",
  "projecao_apps_nativos_contas",
  "projecao_agente_wakeups",
] as const;
