import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ConectorIntegracaoInfo,
  HabilidadeInstaladaInfo,
  LinhaDetalheUso,
  PontoDiarioUso,
  RelatorioAnalyticsHost,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { VaultService } from "../vault/vault-service.ts";

function parseSkillFrontmatter(content: string): { name?: string; description?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(content);
  if (!match) {
    return { body: content };
  }
  const yamlBlock = match[1];
  const body = match[2];
  let name: string | undefined;
  let description: string | undefined;
  for (const line of yamlBlock.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name") name = val;
    if (key === "description") description = val;
  }
  return { name, description, body };
}

function inferSkillCategory(slug: string): HabilidadeInstaladaInfo["categoria"] {
  const s = slug.toLowerCase();
  if (s.includes("video") || s.includes("reels") || s.includes("roteirista") || s.includes("story") || s.includes("stories")) {
    return s.includes("video") || s.includes("reels") || s.includes("roteirista") ? "video" : "conteudo";
  }
  if (
    s.includes("carrossel") ||
    s.includes("post") ||
    s.includes("copy") ||
    s.includes("consistencia") ||
    s.includes("identidade")
  ) {
    return "conteudo";
  }
  if (s.includes("planejar") || s.includes("metricas") || s.includes("concorrentes") || s.includes("entregaveis")) {
    return "estrategia";
  }
  if (s.includes("configurar") || s.includes("instagram") || s.includes("wp-")) {
    return "sistema";
  }
  return "outros";
}

function getSkillsRootCandidates(workspaceRoot?: string): string[] {
  const home = homedir();
  const baseCwd = workspaceRoot ?? process.cwd();
  return Array.from(
    new Set([
      join(baseCwd, ".agents", "skills"),
      join(baseCwd, "..", "..", ".agents", "skills"),
      join(home, ".gemini", "config", "skills"),
      join(home, ".agents", "skills"),
    ])
  );
}

export function loadSkillPromptBySlug(
  slug: string,
  customRoot?: string,
  workspaceRoot?: string
): { path: string; body: string; tokensEst: number } | null {
  if (!slug || slug.includes("..") || slug.includes("/") || slug.includes("\\")) return null;
  const roots = customRoot ? [customRoot] : getSkillsRootCandidates(workspaceRoot);
  for (const root of roots) {
    const filePath = join(root, slug, "SKILL.md");
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf8");
        return {
          path: filePath,
          body: content,
          tokensEst: Math.max(80, Math.round(content.length / 4)),
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function listInstalledSkills(
  db: CriativoDatabase,
  customRoot?: string,
  workspaceRoot?: string
): HabilidadeInstaladaInfo[] {
  const roots = customRoot
    ? [customRoot]
    : process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1"
      ? []
      : getSkillsRootCandidates(workspaceRoot);

  const agentsRows = db.connection
    .prepare(`SELECT agente_id, nome, config_json FROM projecao_agentes ORDER BY ordem_exibicao ASC;`)
    .all() as Array<{ agente_id: string; nome: string; config_json: string }>;

  const agentNameById = new Map<string, string>();
  const agentsBySkill = new Map<string, Set<string>>();
  for (const a of agentsRows) {
    agentNameById.set(a.agente_id, a.nome);
    try {
      const cfg = JSON.parse(a.config_json) as { skill_slug?: string };
      if (cfg.skill_slug) {
        const set = agentsBySkill.get(cfg.skill_slug) ?? new Set<string>();
        set.add(a.nome);
        agentsBySkill.set(cfg.skill_slug, set);
      }
    } catch {
      // ignora config inválida
    }
  }

  // Mescla vínculos persistidos em projecao_agente_habilidades (Fase 10)
  const linkedBySlugOrId = new Map<string, Set<string>>();
  try {
    const linkRows = db.connection
      .prepare(
        `SELECT ah.agente_id, ah.skill_id, c.slug
         FROM projecao_agente_habilidades ah
         JOIN projecao_habilidades_catalogo c ON c.skill_id = ah.skill_id
         WHERE ah.habilitada = 1;`
      )
      .all() as Array<{ agente_id: string; skill_id: string; slug: string }>;
    for (const link of linkRows) {
      const agentLabel = agentNameById.get(link.agente_id) ?? link.agente_id;
      for (const key of [link.slug, link.skill_id]) {
        const set = linkedBySlugOrId.get(key) ?? new Set<string>();
        set.add(agentLabel);
        linkedBySlugOrId.set(key, set);
      }
    }
  } catch {
    // tabela pode não existir em instâncias antigas
  }

  const getAgentsForSkill = (slug: string, skillId?: string): string[] => {
    const merged = new Set<string>(agentsBySkill.get(slug) ?? []);
    for (const name of linkedBySlugOrId.get(slug) ?? []) merged.add(name);
    if (skillId) {
      for (const name of linkedBySlugOrId.get(skillId) ?? []) merged.add(name);
    }
    return Array.from(merged);
  };

  const skillsMap = new Map<string, HabilidadeInstaladaInfo>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const dir of dirs) {
        if (skillsMap.has(dir.name)) continue;
        const skillFile = join(root, dir.name, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        try {
          const content = readFileSync(skillFile, "utf8");
          const parsed = parseSkillFrontmatter(content);
          const id = parsed.name || dir.name;
          skillsMap.set(id, {
            id,
            nome: id,
            descricao: parsed.description || "Habilidade de especialista configurada em SKILL.md.",
            categoria: inferSkillCategory(id),
            caminho: skillFile,
            agentes_vinculados: getAgentsForSkill(id),
            conteudo_preview: parsed.body.trim().slice(0, 650),
          });
        } catch {
          // ignora arquivo ilegível
        }
      }
    } catch {
      // ignora pasta ilegível
    }
  }

  // Quando não está em modo diretório customizado isolado, mescla skills da Loja / dados/skills-loja/
  if (!customRoot) {
    try {
      const catalogRows = db.connection
        .prepare(
          `SELECT skill_id, slug, nome, descricao, categoria, origem, caminho_pasta
           FROM projecao_habilidades_catalogo
           ORDER BY nome ASC;`
        )
        .all() as Array<{
        skill_id: string;
        slug: string;
        nome: string;
        descricao: string;
        categoria: string;
        origem: string;
        caminho_pasta: string;
      }>;

      for (const row of catalogRows) {
        const existing = skillsMap.get(row.slug);
        if (existing) {
          const mergedAgents = new Set([
            ...existing.agentes_vinculados,
            ...getAgentsForSkill(row.slug, row.skill_id),
          ]);
          existing.agentes_vinculados = Array.from(mergedAgents);
          continue;
        }

        const skillFile = join(row.caminho_pasta, "SKILL.md");
        let preview = row.descricao;
        if (existsSync(skillFile)) {
          try {
            const parsed = parseSkillFrontmatter(readFileSync(skillFile, "utf8"));
            if (parsed.body.trim()) {
              preview = parsed.body.trim().slice(0, 650);
            }
          } catch {
            // fallback para descrição do catálogo
          }
        }

        skillsMap.set(row.slug, {
          id: row.slug,
          nome: row.nome || row.slug,
          descricao: row.descricao || "Habilidade instalada via Loja.",
          categoria: inferSkillCategory(row.slug || row.categoria),
          caminho: skillFile,
          agentes_vinculados: getAgentsForSkill(row.slug, row.skill_id),
          conteudo_preview: preview,
        });
      }
    } catch {
      // tabela pode estar ausente em bancos antigos
    }
  }

  return [...skillsMap.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function recordChatTurnUsage(
  db: CriativoDatabase,
  input: {
    agentId: string;
    sessionId: string;
    turnId: string;
    provider: string;
    model: string;
    uncachedInput: number;
    cachedInput: number;
    cacheCreation?: number;
    output: number;
    estimatedCostUsd?: number | null;
    rateBasis?: string | null;
    occurredAt?: string;
  }
): void {
  const nowIso = input.occurredAt ?? new Date().toISOString();
  const recordId = `criativo:${randomUUID()}`;
  db.connection
    .prepare(
      `INSERT OR IGNORE INTO projecao_uso_registros
       (record_id, agent_id, session_id, turn_id, provider, model, occurred_at, uncached_input, cached_input, cache_creation, output_tokens, estimated_cost_usd, rate_basis, origem, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'criativo', ?);`
    )
    .run(
      recordId,
      input.agentId,
      input.sessionId,
      input.turnId,
      input.provider,
      input.model,
      nowIso,
      Math.max(0, Math.round(input.uncachedInput)),
      Math.max(0, Math.round(input.cachedInput)),
      Math.max(0, Math.round(input.cacheCreation ?? 0)),
      Math.max(0, Math.round(input.output)),
      input.estimatedCostUsd ?? null,
      input.rateBasis ?? null,
      new Date().toISOString()
    );
}

export function recordSkillLoadUsage(
  db: CriativoDatabase,
  input: {
    agentId: string;
    sessionId: string;
    turnId: string;
    provider: string;
    model: string;
    skill: string;
    tokens: number | null;
  }
): void {
  const loadId = `skill:${randomUUID().slice(0, 12)}`;
  db.connection
    .prepare(
      `INSERT OR IGNORE INTO projecao_uso_skills
       (load_id, agent_id, session_id, turn_id, provider, model, skill, tokens, estimated_cost_usd, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?);`
    )
    .run(
      loadId,
      input.agentId,
      input.sessionId,
      input.turnId,
      input.provider,
      input.model,
      input.skill,
      input.tokens,
      new Date().toISOString()
    );
}

export function importOpenBotTelemetryIfAvailable(db: CriativoDatabase, customOpenBotDbPath?: string): number {
  if (!customOpenBotDbPath && process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
    return 0;
  }
  const appDataDir = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const openBotDbPath = customOpenBotDbPath ?? join(appDataDir, "OpenBot", "openbot.db");
  if (!existsSync(openBotDbPath)) {
    return 0;
  }

  let imported = 0;
  try {
    const extDb = new DatabaseSync(openBotDbPath, { readOnly: true });
    try {
      const records = extDb
        .prepare(
          `SELECT agent_id, record_id, session_id, turn_id, provider, model, occurred_at, tokens_json, estimated_cost_usd, rate_basis, recorded_at
           FROM agent_usage_records;`
        )
        .all() as Array<{
        agent_id: string;
        record_id: string;
        session_id: string;
        turn_id: string;
        provider: string;
        model: string;
        occurred_at: string;
        tokens_json: string;
        estimated_cost_usd: number | null;
        rate_basis: string | null;
        recorded_at: string;
      }>;

      const insertStmt = db.connection.prepare(
        `INSERT OR IGNORE INTO projecao_uso_registros
         (record_id, agent_id, session_id, turn_id, provider, model, occurred_at, uncached_input, cached_input, cache_creation, output_tokens, estimated_cost_usd, rate_basis, origem, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'openbot_importado', ?);`
      );

      for (const r of records) {
        let parsed = { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
        try {
          const obj = JSON.parse(r.tokens_json) as Record<string, unknown>;
          parsed = {
            uncachedInput: Number(obj.uncachedInput ?? 0) || 0,
            cachedInput: Number(obj.cachedInput ?? 0) || 0,
            cacheCreation: Number(obj.cacheCreation ?? 0) || 0,
            output: Number(obj.output ?? 0) || 0,
          };
        } catch {
          // ignora erro de parse
        }
        const res = insertStmt.run(
          `ob:${r.record_id}`,
          r.agent_id,
          r.session_id,
          r.turn_id,
          r.provider,
          r.model,
          r.occurred_at,
          parsed.uncachedInput,
          parsed.cachedInput,
          parsed.cacheCreation,
          parsed.output,
          r.estimated_cost_usd,
          r.rate_basis,
          r.recorded_at
        );
        if (Number(res.changes ?? 0) > 0) imported += 1;
      }

      // Importa nomes dos agentes externos do OpenBot para exibição amigável
      try {
        const extAgents = extDb
          .prepare(`SELECT agent_id, agent_json FROM projection_agents;`)
          .all() as Array<{ agent_id: string; agent_json: string }>;
        const nameMap: Record<string, string> = {};
        for (const a of extAgents) {
          try {
            const parsed = JSON.parse(a.agent_json) as { name?: string };
            if (parsed.name) nameMap[a.agent_id] = parsed.name;
          } catch {
            // ignora
          }
        }
        if (Object.keys(nameMap).length > 0) {
          db.connection
            .prepare(
              `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
               VALUES ('analytics_nomes_externos', ?, ?)
               ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
            )
            .run(JSON.stringify(nameMap), new Date().toISOString());
        }
      } catch {
        // tabela pode não existir em versões antigas
      }

      // Importa skill loads se existir
      try {
        const skillRows = extDb
          .prepare(
            `SELECT agent_id, load_id, session_id, turn_id, provider, model, skill, tokens, estimated_cost_usd, occurred_at
             FROM agent_usage_skill_loads;`
          )
          .all() as Array<{
          agent_id: string;
          load_id: string;
          session_id: string;
          turn_id: string;
          provider: string;
          model: string;
          skill: string;
          tokens: number | null;
          estimated_cost_usd: number | null;
          occurred_at: string;
        }>;
        const insertSkillStmt = db.connection.prepare(
          `INSERT OR IGNORE INTO projecao_uso_skills
           (load_id, agent_id, session_id, turn_id, provider, model, skill, tokens, estimated_cost_usd, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
        );
        for (const s of skillRows) {
          insertSkillStmt.run(
            `ob:${s.load_id}`,
            s.agent_id,
            s.session_id,
            s.turn_id,
            s.provider,
            s.model,
            s.skill,
            s.tokens,
            s.estimated_cost_usd,
            s.occurred_at
          );
        }
      } catch {
        // ignora se ausente
      }
    } finally {
      extDb.close();
    }
  } catch {
    // banco externo bloqueado ou indisponível
  }
  return imported;
}

function formatProviderDisplayLabel(provider: string): string {
  const p = provider.toLowerCase();
  if (p === "antigravity" || p === "gemini") return "Antigravity CLI";
  if (p === "claude") return "Claude Code";
  if (p === "codex" || p === "openai") return "Codex / ChatGPT";
  if (p === "opencode") return "OpenCode CLI";
  if (p === "grok") return "Grok CLI";
  if (p === "ollama") return "Ollama Local";
  return provider;
}

function emptyMetricAccumulator() {
  return {
    sessions: new Set<string>(),
    turns: 0,
    unpriced: 0,
    incomplete: 0,
    uncachedInput: 0,
    cachedInput: 0,
    cacheCreation: 0,
    output: 0,
    costSum: 0,
    hasPriced: false,
  };
}

export function computeHostAnalytics(
  db: CriativoDatabase,
  options: { dias?: number; agenteId?: string | null }
): RelatorioAnalyticsHost {
  const dias = Math.max(1, Math.min(365, options.dias ?? 30));
  const agenteId = options.agenteId || null;
  const cutoffIso = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  const rows = agenteId
    ? (db.connection
        .prepare(
          `SELECT * FROM projecao_uso_registros WHERE occurred_at >= ? AND agent_id = ? ORDER BY occurred_at ASC;`
        )
        .all(cutoffIso, agenteId) as Array<{
        record_id: string;
        agent_id: string;
        session_id: string;
        turn_id: string;
        provider: string;
        model: string;
        occurred_at: string;
        uncached_input: number;
        cached_input: number;
        cache_creation: number;
        output_tokens: number;
        estimated_cost_usd: number | null;
        recorded_at: string;
      }>)
    : (db.connection
        .prepare(`SELECT * FROM projecao_uso_registros WHERE occurred_at >= ? ORDER BY occurred_at ASC;`)
        .all(cutoffIso) as Array<{
        record_id: string;
        agent_id: string;
        session_id: string;
        turn_id: string;
        provider: string;
        model: string;
        occurred_at: string;
        uncached_input: number;
        cached_input: number;
        cache_creation: number;
        output_tokens: number;
        estimated_cost_usd: number | null;
        recorded_at: string;
      }>);

  // Mapa de nomes dos agentes internos + externos importados
  const agentNameMap = new Map<string, { nome: string; provedor: string }>();
  const internalAgents = db.connection
    .prepare(`SELECT agente_id, nome, modelo_padrao FROM projecao_agentes;`)
    .all() as Array<{ agente_id: string; nome: string; modelo_padrao: string }>;
  for (const a of internalAgents) {
    agentNameMap.set(a.agente_id, { nome: a.nome, provedor: a.modelo_padrao });
  }
  const extNamesRow = db.connection
    .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'analytics_nomes_externos';`)
    .get() as { valor_json: string } | undefined;
  if (extNamesRow) {
    try {
      const parsed = JSON.parse(extNamesRow.valor_json) as Record<string, string>;
      for (const [id, name] of Object.entries(parsed)) {
        if (!agentNameMap.has(id)) agentNameMap.set(id, { nome: name, provedor: "antigravity" });
      }
    } catch {
      // ignora
    }
  }

  const tot = emptyMetricAccumulator();
  const byProvider = new Map<string, ReturnType<typeof emptyMetricAccumulator>>();
  const byModel = new Map<string, { acc: ReturnType<typeof emptyMetricAccumulator>; provider: string }>();
  const byAgent = new Map<string, { acc: ReturnType<typeof emptyMetricAccumulator>; provider: string }>();
  const byDay = new Map<string, ReturnType<typeof emptyMetricAccumulator>>();

  let earliestIso = rows[0]?.occurred_at ?? new Date().toISOString();
  let latestIso = rows[rows.length - 1]?.recorded_at ?? rows[rows.length - 1]?.occurred_at ?? new Date().toISOString();

  for (const r of rows) {
    if (r.occurred_at < earliestIso) earliestIso = r.occurred_at;
    if (r.occurred_at > latestIso) latestIso = r.occurred_at;

    const add = (acc: ReturnType<typeof emptyMetricAccumulator>) => {
      acc.sessions.add(r.session_id);
      acc.turns += 1;
      acc.uncachedInput += r.uncached_input;
      acc.cachedInput += r.cached_input;
      acc.cacheCreation += r.cache_creation;
      acc.output += r.output_tokens;
      if (r.estimated_cost_usd === null || r.estimated_cost_usd === undefined) {
        acc.unpriced += 1;
      } else {
        acc.costSum += r.estimated_cost_usd;
        acc.hasPriced = true;
      }
    };

    add(tot);

    const pKey = r.provider.toLowerCase();
    if (!byProvider.has(pKey)) byProvider.set(pKey, emptyMetricAccumulator());
    add(byProvider.get(pKey)!);

    if (!byModel.has(r.model)) byModel.set(r.model, { acc: emptyMetricAccumulator(), provider: pKey });
    add(byModel.get(r.model)!.acc);

    if (!byAgent.has(r.agent_id)) byAgent.set(r.agent_id, { acc: emptyMetricAccumulator(), provider: pKey });
    add(byAgent.get(r.agent_id)!.acc);

    const dayKey = r.occurred_at.slice(0, 10);
    if (!byDay.has(dayKey)) byDay.set(dayKey, emptyMetricAccumulator());
    add(byDay.get(dayKey)!);
  }

  const totalTokensWithoutCache = tot.uncachedInput + tot.cacheCreation + tot.output;
  const totalProcessed = totalTokensWithoutCache + tot.cachedInput;

  const toLine = (
    chave: string,
    nome: string,
    provedor: string | null,
    acc: ReturnType<typeof emptyMetricAccumulator>
  ): LinhaDetalheUso => {
    const tokensSemCache = acc.uncachedInput + acc.cacheCreation + acc.output;
    const processados = tokensSemCache + acc.cachedInput;
    const custo = acc.hasPriced ? Number(acc.costSum.toFixed(4)) : null;
    const share =
      totalTokensWithoutCache > 0
        ? Number(((tokensSemCache / totalTokensWithoutCache) * 100).toFixed(1))
        : null;
    return {
      chave,
      nome,
      provedor,
      sessoes: acc.sessions.size,
      turnos: acc.turns,
      turnos_sem_uso: 0,
      registros_sem_preco: acc.unpriced,
      registros_incompletos: acc.incomplete,
      tokens_sem_cache: tokensSemCache,
      tokens_processados: processados,
      entrada_cache: acc.cachedInput,
      entrada_sem_cache: acc.uncachedInput,
      criacao_cache: acc.cacheCreation,
      saida: acc.output,
      custo_estimado_usd: custo,
      participacao_percentual: share,
    };
  };

  // Preenche pontos diários
  const porDia: LinhaDetalheUso[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, acc]) => toLine(day, day, null, acc));

  const pontosDiarios: PontoDiarioUso[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, acc]) => ({
      data: day,
      rotulo: day,
      custo_usd: acc.hasPriced ? Number(acc.costSum.toFixed(4)) : 0,
      tokens: acc.uncachedInput + acc.cacheCreation + acc.output,
      turnos: acc.turns,
    }));

  // Skill loads
  const skillRows = (
    agenteId
      ? db.connection
          .prepare(`SELECT * FROM projecao_uso_skills WHERE occurred_at >= ? AND agent_id = ?;`)
          .all(cutoffIso, agenteId)
      : db.connection.prepare(`SELECT * FROM projecao_uso_skills WHERE occurred_at >= ?;`).all(cutoffIso)
  ) as Array<{ skill: string; tokens: number | null; estimated_cost_usd: number | null }>;

  const skillAgg = new Map<string, { loads: number; tokens: number; cost: number; hasCost: boolean }>();
  let totalSkillTokens = 0;
  for (const s of skillRows) {
    const cur = skillAgg.get(s.skill) ?? { loads: 0, tokens: 0, cost: 0, hasCost: false };
    cur.loads += 1;
    cur.tokens += s.tokens ?? 0;
    totalSkillTokens += s.tokens ?? 0;
    if (s.estimated_cost_usd !== null) {
      cur.cost += s.estimated_cost_usd;
      cur.hasCost = true;
    }
    skillAgg.set(s.skill, cur);
  }

  return {
    periodo_dias: dias,
    agente_id: agenteId,
    coleta_iniciada_em: earliestIso,
    atualizado_em: latestIso,
    totais: {
      sessoes: tot.sessions.size,
      turnos: tot.turns,
      turnos_sem_uso: 0,
      registros_sem_preco: tot.unpriced,
      registros_incompletos: tot.incomplete,
      tokens_sem_cache: totalTokensWithoutCache,
      tokens_processados: totalProcessed,
      entrada_cache: tot.cachedInput,
      entrada_sem_cache: tot.uncachedInput,
      criacao_cache: tot.cacheCreation,
      saida: tot.output,
      custo_estimado_usd: tot.hasPriced ? Number(tot.costSum.toFixed(4)) : null,
    },
    provedores: [...byProvider.entries()].map(([prov, acc]) => {
      const tokens = acc.uncachedInput + acc.cacheCreation + acc.output;
      return {
        provedor: prov,
        rotulo: formatProviderDisplayLabel(prov),
        tokens,
        custo_estimado_usd: acc.hasPriced ? Number(acc.costSum.toFixed(4)) : null,
        participacao_percentual:
          totalTokensWithoutCache > 0 ? Number(((tokens / totalTokensWithoutCache) * 100).toFixed(1)) : null,
      };
    }),
    por_modelo: [...byModel.entries()]
      .map(([model, v]) => toLine(model, model, v.provider, v.acc))
      .sort((a, b) => b.tokens_sem_cache - a.tokens_sem_cache),
    por_agente: [...byAgent.entries()]
      .map(([id, v]) => {
        const meta = agentNameMap.get(id);
        return toLine(id, meta?.nome ?? id, v.provider, v.acc);
      })
      .sort((a, b) => b.tokens_sem_cache - a.tokens_sem_cache),
    por_dia: pontosDiarios,
    por_habilidade: [...skillAgg.entries()]
      .map(([hab, v]) => ({
        habilidade: hab,
        carregamentos: v.loads,
        tokens: v.tokens,
        custo_estimado_usd: v.hasCost ? Number(v.cost.toFixed(4)) : null,
        participacao_percentual:
          totalSkillTokens > 0 ? Number(((v.tokens / totalSkillTokens) * 100).toFixed(1)) : null,
      }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

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
  ];
}
