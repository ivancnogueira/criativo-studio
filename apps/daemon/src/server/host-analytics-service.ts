import type {
  GranularidadeAnalyticsUso,
  LinhaDetalheUso,
  PontoDiarioUso,
  RelatorioAnalyticsHost,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import {
  buildStackedUsageSeries,
  resolveAnalyticsGranularity,
} from "./host-analytics-buckets.ts";

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
  options: {
    dias?: number;
    agenteId?: string | null;
    granularidade?: "auto" | GranularidadeAnalyticsUso;
  }
): RelatorioAnalyticsHost {
  const dias = Math.max(1, Math.min(3650, options.dias ?? 30));
  const granularidade = resolveAnalyticsGranularity(dias, options.granularidade);
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

  const serieEmpilhada = buildStackedUsageSeries(rows, {
    dias,
    granularidade,
    formatProviderLabel: formatProviderDisplayLabel,
  });

  return {
    periodo_dias: dias,
    agente_id: agenteId,
    coleta_iniciada_em: earliestIso,
    atualizado_em: latestIso,
    granularidade,
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
    serie_empilhada: serieEmpilhada,
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

