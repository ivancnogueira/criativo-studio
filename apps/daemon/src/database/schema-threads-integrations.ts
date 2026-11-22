import type { SchemaTableDefinition } from "./schema-core.ts";

export const SCHEMA_THREADS_INTEGRATIONS_TABLES: readonly SchemaTableDefinition[] = [
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
    requiresFts5: true,
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
  {
    nome: "calendario_editorial_posts",
    sql: `
      CREATE TABLE IF NOT EXISTS calendario_editorial_posts (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        formato TEXT NOT NULL CHECK(formato IN ('feed_4_5', 'carrossel', 'reels', 'story')),
        status TEXT NOT NULL DEFAULT 'ideia' CHECK(status IN ('ideia', 'rascunho', 'em_producao', 'aprovacao', 'agendado', 'publicado')),
        pilar TEXT,
        data_agendada TEXT,
        agente_id TEXT,
        tarefa_id TEXT,
        legenda TEXT NOT NULL DEFAULT '',
        slides_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(slides_json)),
        meta_media_id TEXT,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_editorial_posts_data
        ON calendario_editorial_posts(data_agendada, atualizado_em DESC);
      CREATE INDEX IF NOT EXISTS idx_editorial_posts_status
        ON calendario_editorial_posts(status, formato);
      CREATE INDEX IF NOT EXISTS idx_editorial_posts_meta_media
        ON calendario_editorial_posts(meta_media_id)
        WHERE meta_media_id IS NOT NULL;
    `,
  },
  {
    nome: "meta_posts_cache",
    sql: `
      CREATE TABLE IF NOT EXISTS meta_posts_cache (
        media_id TEXT PRIMARY KEY,
        conta_id TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        sincronizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meta_posts_cache_sync
        ON meta_posts_cache(conta_id, sincronizado_em DESC);
    `,
  },
  {
    nome: "projecao_agent_mailbox",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_agent_mailbox (
        mailbox_id TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('handoff', 'wakeup', 'wait_event', 'webhook', 'channel_message')),
        idempotency_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        priority INTEGER NOT NULL DEFAULT 5,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'leased', 'delivered', 'acked', 'dead_letter')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        lease_owner TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        acked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent_mailbox_claim
        ON projecao_agent_mailbox(agente_id, status, priority ASC, created_at ASC);
    `,
  },
  {
    nome: "projecao_custom_providers",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_custom_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        models_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(models_json)),
        vault_secret_key TEXT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        headers_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_custom_providers_enabled
        ON projecao_custom_providers(enabled, name);
    `,
  },
  {
    nome: "projecao_messaging_policies",
    sql: `
      CREATE TABLE IF NOT EXISTS projecao_messaging_policies (
        channel_kind TEXT PRIMARY KEY CHECK(channel_kind IN ('telegram', 'slack', 'discord')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        orchestrator_agent_id TEXT NOT NULL DEFAULT 'estrategista',
        reply_in_threads INTEGER NOT NULL DEFAULT 1 CHECK(reply_in_threads IN (0, 1)),
        allowlist_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(allowlist_json)),
        allowed_channels_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(allowed_channels_json)),
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    nome: "cofre_logins",
    sql: `
      CREATE TABLE IF NOT EXISTS cofre_logins (
        login_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        domain TEXT NOT NULL,
        username TEXT NOT NULL,
        password_encrypted TEXT NOT NULL,
        iv_envelope TEXT NOT NULL,
        totp_encrypted TEXT,
        totp_iv TEXT,
        autofill_policy TEXT NOT NULL DEFAULT 'exact' CHECK(autofill_policy IN ('anywhere', 'exact', 'never')),
        notes_encrypted TEXT,
        notes_iv TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cofre_logins_domain
        ON cofre_logins(domain, username);
    `,
  },
  {
    nome: "mcp_tool_consents",
    sql: `
      CREATE TABLE IF NOT EXISTS mcp_tool_consents (
        consent_id TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL,
        mcp_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('ask', 'allow_once', 'always_allow', 'deny')),
        arg_pattern TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(agente_id, mcp_id, tool_name)
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_consents_lookup
        ON mcp_tool_consents(agente_id, mcp_id, tool_name);
    `,
  },
  {
    nome: "mcp_approval_audit",
    sql: `
      CREATE TABLE IF NOT EXISTS mcp_approval_audit (
        audit_id TEXT PRIMARY KEY,
        agente_id TEXT NOT NULL,
        mcp_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('ask', 'allow_once', 'always_allow', 'deny')),
        outcome TEXT NOT NULL CHECK(outcome IN ('allowed', 'blocked', 'prompted')),
        reason TEXT NOT NULL,
        args_preview TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_audit_agent_date
        ON mcp_approval_audit(agente_id, created_at DESC);
    `,
  },
];
