import type { SchemaTableDefinition } from "./schema-core.ts";

export const SCHEMA_ROUTINES_WORKFLOWS_TABLES: readonly SchemaTableDefinition[] = [
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
];
