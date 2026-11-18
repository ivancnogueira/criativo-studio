/**
 * Serviço de Auto-Aprendizado de Habilidades (`SkillLearningService` — LRN-02).
 * Suporta modos `off | ask | automatic`, sugestões persistidas em `projecao_skill_sugestoes`
 * para o card `SkillSuggestionChatCard` e geração/revisão segura de `.agents/skills/<slug>/SKILL.md`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  AprendizadoConfig,
  PassoChat,
  SkillLearningMode,
  SkillSugestaoItem,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../../database/client.ts";
import type { ProviderConnectionService } from "../../providers/provider-connection-service.ts";
import type { WebSocketHub } from "../../server/websocket-hub.ts";
import type { ProviderRegistry } from "../providers/provider-registry.ts";
import { DEFAULT_AGENT_MEMORY_LIMIT } from "./memory-manager.ts";
import { DEFAULT_MEMORY_REVIEW_INTERVAL } from "./memory-review-service.ts";
import { parseSkillMarkdown } from "./skill-loader.ts";

export const LEARNED_DESCRIPTION_CHARACTERS = 500;
export const LEARNED_INSTRUCTIONS_CHARACTERS = 12_000;
export const MAX_REVISABLE_SKILL_INSTRUCTIONS = 10_000;
export const MAX_WORK_STEPS_FOR_ANALYSIS = 80;

export interface DetectedSkillSignal {
  acao: "create" | "update";
  skillId?: string | null;
  nomeSkill: string;
  perguntaMarkdown: string;
}

export interface SkillLearningServiceDeps {
  db: CriativoDatabase;
  workspaceRoot: string;
  providers: ProviderRegistry;
  providerConnection?: ProviderConnectionService;
  wsHub?: WebSocketHub;
  redactSecrets?: (text: string) => string;
}

interface SkillSugestaoRow {
  sugestao_id: string;
  mensagem_id: string;
  agente_id: string;
  thread_id: string | null;
  acao: "create" | "update";
  skill_id: string | null;
  nome_skill: string;
  pergunta_markdown: string;
  status: "aberta" | "salva" | "dispensada" | "expirada";
  criado_em: string;
  atualizado_em: string;
}

function slugifySkillName(raw: string): string {
  const ascii = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return ascii || `skill-${randomUUID().slice(0, 8)}`;
}

/**
 * Verifica se o corpo atual de uma habilidade está dentro da margem segura (<= 10.000 chars)
 * para revisão automática sem risco de perda de instruções.
 */
export function writerCanRevise(previousBody: string): boolean {
  return previousBody.length <= MAX_REVISABLE_SKILL_INSTRUCTIONS;
}

/**
 * Impede revisões que apaguem > max(25%, 200 chars) do corpo anterior ou percam acentuação/não-ASCII (pt-br).
 */
export function revisionKeepsSkill(
  previousBody: string,
  nextBody: string,
): { ok: boolean; reason?: string } {
  const prevTrimmed = previousBody.trim();
  const nextTrimmed = nextBody.trim();
  if (!nextTrimmed) {
    return { ok: false, reason: "O corpo revisado da habilidade está vazio." };
  }
  if (!prevTrimmed) {
    return { ok: true };
  }

  const maxAllowedShrink = Math.max(Math.floor(prevTrimmed.length * 0.25), 200);
  const shrunkBy = prevTrimmed.length - nextTrimmed.length;
  if (shrunkBy > maxAllowedShrink) {
    return {
      ok: false,
      reason: `A revisão encurtou excessivamente a habilidade (${shrunkBy} caracteres removidos; máximo permitido: ${maxAllowedShrink}).`,
    };
  }

  const prevNonAscii = (prevTrimmed.match(/[^\x00-\x7F]/g) ?? []).length;
  const nextNonAscii = (nextTrimmed.match(/[^\x00-\x7F]/g) ?? []).length;
  if (prevNonAscii >= 3 && nextNonAscii === 0) {
    return {
      ok: false,
      reason: "A revisão removeu acentuação e caracteres não-ASCII do conteúdo em português.",
    };
  }

  return { ok: true };
}

function extractSkillWriterJson(raw: string): { description: string; instructions: string } | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]!.trim() : raw.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
        description?: unknown;
        instructions?: unknown;
      };
      if (typeof parsed.description === "string" && typeof parsed.instructions === "string") {
        return {
          description: parsed.description.trim(),
          instructions: parsed.instructions.trim(),
        };
      }
    } catch {
      // fallback markdown
    }
  }
  return null;
}

export class SkillLearningService {
  private readonly db: CriativoDatabase;
  private readonly workspaceRoot: string;
  private readonly providers: ProviderRegistry;
  private readonly providerConnection?: ProviderConnectionService;
  private readonly wsHub?: WebSocketHub;
  private readonly redactSecrets: (text: string) => string;

  constructor(deps: SkillLearningServiceDeps) {
    this.db = deps.db;
    this.workspaceRoot = resolve(deps.workspaceRoot);
    this.providers = deps.providers;
    this.providerConnection = deps.providerConnection;
    this.wsHub = deps.wsHub;
    this.redactSecrets = deps.redactSecrets ?? ((t) => t);
  }

  private mapRow(row: SkillSugestaoRow): SkillSugestaoItem {
    return {
      sugestao_id: row.sugestao_id,
      mensagem_id: row.mensagem_id,
      agente_id: row.agente_id,
      thread_id: row.thread_id,
      acao: row.acao,
      skill_id: row.skill_id,
      nome_skill: row.nome_skill,
      pergunta_markdown: row.pergunta_markdown,
      status: row.status,
      criado_em: row.criado_em,
      atualizado_em: row.atualizado_em,
    };
  }

  private readConfigValue<T>(chave: string, fallback: T): T {
    try {
      const row = this.db.connection
        .prepare("SELECT valor_json FROM projecao_studio_config WHERE chave = ? LIMIT 1;")
        .get(chave) as { valor_json?: string } | undefined;
      if (row?.valor_json !== undefined) {
        return JSON.parse(row.valor_json) as T;
      }
    } catch {
      // fallback
    }
    return fallback;
  }

  private writeConfigValue(chave: string, value: unknown): void {
    const agora = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`,
      )
      .run(chave, JSON.stringify(value), agora);
  }

  public getLearningConfig(): AprendizadoConfig {
    const modeRaw = this.readConfigValue<string>("skill_learning_mode", "ask");
    const mode: SkillLearningMode =
      modeRaw === "off" || modeRaw === "automatic" ? modeRaw : "ask";
    const intervalRaw = Number(
      this.readConfigValue<number>("memory_review_interval", DEFAULT_MEMORY_REVIEW_INTERVAL),
    );
    const limitRaw = Number(
      this.readConfigValue<number>("memory_limit", DEFAULT_AGENT_MEMORY_LIMIT),
    );
    const planMsRaw = this.readConfigValue<number | null>("plan_start_after_ms", null);

    return {
      skill_learning_mode: mode,
      memory_review_interval:
        Number.isFinite(intervalRaw) && intervalRaw >= 0 ? Math.floor(intervalRaw) : DEFAULT_MEMORY_REVIEW_INTERVAL,
      memory_limit:
        Number.isFinite(limitRaw) && limitRaw >= 10 ? Math.floor(limitRaw) : DEFAULT_AGENT_MEMORY_LIMIT,
      plan_start_after_ms:
        typeof planMsRaw === "number" && Number.isFinite(planMsRaw) && planMsRaw > 0
          ? Math.floor(planMsRaw)
          : null,
    };
  }

  public updateLearningConfig(patch: Partial<AprendizadoConfig>): AprendizadoConfig {
    this.db.runInTransaction(() => {
      if (
        patch.skill_learning_mode === "off" ||
        patch.skill_learning_mode === "ask" ||
        patch.skill_learning_mode === "automatic"
      ) {
        this.writeConfigValue("skill_learning_mode", patch.skill_learning_mode);
      }
      if (typeof patch.memory_review_interval === "number" && Number.isFinite(patch.memory_review_interval)) {
        this.writeConfigValue(
          "memory_review_interval",
          Math.max(0, Math.min(500, Math.floor(patch.memory_review_interval))),
        );
      }
      if (typeof patch.memory_limit === "number" && Number.isFinite(patch.memory_limit)) {
        this.writeConfigValue(
          "memory_limit",
          Math.max(10, Math.min(5000, Math.floor(patch.memory_limit))),
        );
      }
      if (patch.plan_start_after_ms !== undefined) {
        const val =
          typeof patch.plan_start_after_ms === "number" && patch.plan_start_after_ms > 0
            ? Math.floor(patch.plan_start_after_ms)
            : null;
        this.writeConfigValue("plan_start_after_ms", val);
      }
    });
    return this.getLearningConfig();
  }

  public getEffectiveMode(agenteId?: string): SkillLearningMode {
    if (agenteId) {
      const row = this.db.connection
        .prepare("SELECT config_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
        .get(agenteId) as { config_json?: string } | undefined;
      if (row?.config_json) {
        try {
          const cfg = JSON.parse(row.config_json) as { skill_learning_mode?: unknown };
          if (
            cfg.skill_learning_mode === "off" ||
            cfg.skill_learning_mode === "ask" ||
            cfg.skill_learning_mode === "automatic"
          ) {
            return cfg.skill_learning_mode;
          }
        } catch {
          // fallback global
        }
      }
    }
    return this.getLearningConfig().skill_learning_mode;
  }

  public listRecentSuggestions(agenteId: string, limit = 5): SkillSugestaoItem[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM projecao_skill_sugestoes
         WHERE agente_id = ?
         ORDER BY criado_em DESC
         LIMIT ?;`,
      )
      .all(agenteId, limit) as unknown as SkillSugestaoRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public getSuggestionByMessageId(mensagemId: string): SkillSugestaoItem | null {
    const row = this.db.connection
      .prepare("SELECT * FROM projecao_skill_sugestoes WHERE mensagem_id = ? LIMIT 1;")
      .get(mensagemId) as SkillSugestaoRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  private resolveSkillFilePath(slug: string): string {
    const safeSlug = slugifySkillName(slug);
    return resolve(this.workspaceRoot, ".agents", "skills", safeSlug, "SKILL.md");
  }

  private linkSkillPathToAgent(agenteId: string, skillFilePath: string): void {
    const row = this.db.connection
      .prepare("SELECT skills_paths_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
      .get(agenteId) as { skills_paths_json?: string } | undefined;
    if (!row) return;

    let paths: string[] = [];
    try {
      const parsed = JSON.parse(row.skills_paths_json || "[]");
      if (Array.isArray(parsed)) {
        paths = parsed.filter((p): p is string => typeof p === "string");
      }
    } catch {
      paths = [];
    }

    if (!paths.includes(skillFilePath)) {
      paths.push(skillFilePath);
      this.db.connection
        .prepare("UPDATE projecao_agentes SET skills_paths_json = ?, atualizado_em = ? WHERE agente_id = ?;")
        .run(JSON.stringify(paths), new Date().toISOString(), agenteId);
    }
  }

  private async defaultGenerateSkillText(
    agenteId: string,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string | null> {
    const ag = this.db.connection
      .prepare("SELECT modelo_padrao FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
      .get(agenteId) as { modelo_padrao?: string } | undefined;
    const model = ag?.modelo_padrao ?? "gemini-2.5-pro";
    try {
      if (this.providerConnection) {
        const prov = this.providers.resolveProviderName(model);
        const statuses = await this.providerConnection.getProvidersStatus(false);
        const st = statuses.find((s) => s.provedor === prov);
        if (st && !st.conectado && !st.vault_configurado) {
          return null;
        }
      }
      const client = this.providers.getClientForModel(model);
      return await client.generateText(userPrompt, systemPrompt);
    } catch {
      return null;
    }
  }

  public async writeSkillArtifact(params: {
    agenteId: string;
    acao: "create" | "update";
    skillId?: string | null;
    nomeSkill: string;
    perguntaMarkdown: string;
    workSteps?: PassoChat[];
    generateTextFn?: (systemPrompt: string, userPrompt: string) => Promise<string | null>;
  }): Promise<{ ok: true; slug: string; filePath: string; revision: number } | { ok: false; reason: string }> {
    const slug = slugifySkillName(params.skillId || params.nomeSkill);
    const filePath = this.resolveSkillFilePath(slug);

    let previousBody = "";
    let previousRevision = 0;
    if (existsSync(filePath)) {
      const existingRaw = readFileSync(filePath, "utf8");
      const parsed = parseSkillMarkdown(existingRaw);
      previousBody = parsed.body;
      const revNum = Number(parsed.frontmatter.revision ?? 1);
      previousRevision = Number.isFinite(revNum) && revNum > 0 ? Math.floor(revNum) : 1;

      if (!writerCanRevise(previousBody)) {
        return {
          ok: false,
          reason: `A habilidade atual excede ${MAX_REVISABLE_SKILL_INSTRUCTIONS} caracteres e requer aprovação humana.`,
        };
      }
    }

    const stepsSlice = (params.workSteps ?? []).slice(-MAX_WORK_STEPS_FOR_ANALYSIS);
    const stepsText = stepsSlice
      .map(
        (s) =>
          `- ${s.titulo} [${s.status}]${s.detalhes ? `: ${this.redactSecrets(s.detalhes).slice(0, 280)}` : ""}`,
      )
      .join("\n");

    const systemPrompt = [
      "Você é o redator de habilidades reutilizáveis (SKILL.md) do Criativo AI Studio Online.",
      "Escreva sempre em português (pt-br), de forma imperativa, clara e sem nenhum segredo, token ou nome real.",
      `Retorne APENAS JSON válido no formato: {"description":"até ${LEARNED_DESCRIPTION_CHARACTERS} caracteres","instructions":"markdown conciso até ${LEARNED_INSTRUCTIONS_CHARACTERS} caracteres"}`,
      previousBody
        ? "Preserve integralmente as regras úteis e acentuação da versão existente, incorporando a nova lição sem apagar seções anteriores."
        : "Estruture passos objetivos de execução, verificações e armadilhas evitadas.",
    ].join("\n");

    const userPrompt = [
      `Nome da habilidade: ${this.redactSecrets(params.nomeSkill)}`,
      ` Contexto / Lição detectada: ${this.redactSecrets(params.perguntaMarkdown)}`,
      stepsText ? `<work_steps>\n${stepsText}\n</work_steps>` : "",
      previousBody ? `<current_skill_body>\n${this.redactSecrets(previousBody)}\n</current_skill_body>` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const genFn =
      params.generateTextFn ?? ((sys, usr) => this.defaultGenerateSkillText(params.agenteId, sys, usr));
    const raw = await genFn(systemPrompt, userPrompt);
    if (!raw) {
      return { ok: false, reason: "Provedor de IA indisponível para redigir SKILL.md." };
    }

    const extracted = extractSkillWriterJson(raw);
    if (!extracted) {
      return { ok: false, reason: "Resposta do modelo não pôde ser interpretada como JSON de SKILL.md." };
    }

    const safeDesc = this.redactSecrets(extracted.description)
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, LEARNED_DESCRIPTION_CHARACTERS);
    const safeInstr = this.redactSecrets(extracted.instructions).trim();

    if (!safeDesc || !safeInstr) {
      return { ok: false, reason: "Descrição ou instruções vazias na geração da habilidade." };
    }
    if (safeInstr.length > LEARNED_INSTRUCTIONS_CHARACTERS) {
      return {
        ok: false,
        reason: `Instruções geradas (${safeInstr.length} chars) excedem o limite de ${LEARNED_INSTRUCTIONS_CHARACTERS} caracteres.`,
      };
    }

    if (previousBody) {
      const keepCheck = revisionKeepsSkill(previousBody, safeInstr);
      if (!keepCheck.ok) {
        return { ok: false, reason: keepCheck.reason ?? "Revisão rejeitada pela trava de integridade." };
      }
    }

    const nextRevision = previousRevision + 1;
    const escapedDesc = safeDesc.replace(/"/g, '\\"');
    const markdownContent = [
      "---",
      `name: ${slug}`,
      `description: "${escapedDesc}"`,
      `revision: ${nextRevision}`,
      "---",
      "",
      safeInstr,
      "",
    ].join("\n");

    mkdirSync(dirname(filePath), { recursive: true });
    const tmpFile = `${filePath}.tmp-${randomUUID().slice(0, 6)}`;
    writeFileSync(tmpFile, markdownContent, "utf8");
    renameSync(tmpFile, filePath);

    this.linkSkillPathToAgent(params.agenteId, filePath);
    this.wsHub?.broadcast("loja.skill_atualizada", {
      skill_id: slug,
      acao: params.acao === "update" ? "atualizada" : "criada",
    });

    return { ok: true, slug, filePath, revision: nextRevision };
  }

  private persistAskSuggestion(params: {
    agenteId: string;
    threadId: string | null;
    canalId: string;
    signal: DetectedSkillSignal;
  }): SkillSugestaoItem {
    const sugestaoId = `sksug-${randomUUID().slice(0, 10)}`;
    const mensagemId = `msg-sksug-${randomUUID().slice(0, 10)}`;
    const agora = new Date().toISOString();
    const effectiveThread = params.threadId ?? `main:${params.agenteId}`;
    const itemType =
      params.signal.acao === "update" && params.signal.skillId
        ? `skill-suggestion:update:${params.signal.skillId}`
        : "skill-suggestion:create";

    const sugestaoObj: SkillSugestaoItem = {
      sugestao_id: sugestaoId,
      mensagem_id: mensagemId,
      agente_id: params.agenteId,
      thread_id: params.threadId,
      acao: params.signal.acao,
      skill_id: params.signal.skillId ?? null,
      nome_skill: params.signal.nomeSkill,
      pergunta_markdown: params.signal.perguntaMarkdown,
      status: "aberta",
      criado_em: agora,
      atualizado_em: agora,
    };

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_skill_sugestoes (
            sugestao_id, mensagem_id, agente_id, thread_id, acao, skill_id,
            nome_skill, pergunta_markdown, status, criado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?);`,
        )
        .run(
          sugestaoId,
          mensagemId,
          params.agenteId,
          params.threadId,
          params.signal.acao,
          params.signal.skillId ?? null,
          params.signal.nomeSkill,
          params.signal.perguntaMarkdown,
          agora,
          agora,
        );

      this.db.connection
        .prepare(
          `INSERT INTO projecao_conversas_chat (
            mensagem_id, canal_id, agente_id, autor, autor_nome, conteudo_markdown,
            anexos_json, steps_json, tarefa_id, lida, criado_em,
            thread_id, item_type, metadados_json
          ) VALUES (?, ?, ?, 'sistema', 'Aprendizado de Habilidade', ?, '[]', '[]', NULL, 1, ?, ?, ?, ?);`,
        )
        .run(
          mensagemId,
          params.canalId,
          params.agenteId,
          params.signal.perguntaMarkdown,
          agora,
          effectiveThread,
          itemType,
          JSON.stringify({ skill_sugestao: sugestaoObj }),
        );
    });

    this.wsHub?.broadcast("skill:suggested", {
      agente_id: params.agenteId,
      mensagem_id: mensagemId,
      sugestao_id: sugestaoId,
      acao: params.signal.acao,
      nome_skill: params.signal.nomeSkill,
    });

    return sugestaoObj;
  }

  public async handleDetectedSignal(params: {
    agenteId: string;
    threadId: string | null;
    canalId: string;
    signal: DetectedSkillSignal;
    workSteps?: PassoChat[];
    generateTextFn?: (systemPrompt: string, userPrompt: string) => Promise<string | null>;
  }): Promise<
    | { mode: "off" | "duplicate" }
    | { mode: "ask"; sugestao: SkillSugestaoItem }
    | { mode: "automatic"; slug: string; filePath: string }
  > {
    const mode = this.getEffectiveMode(params.agenteId);
    if (mode === "off") {
      return { mode: "off" };
    }

    const recent = this.listRecentSuggestions(params.agenteId, 5);
    const lowerName = params.signal.nomeSkill.trim().toLowerCase();
    if (
      recent.some(
        (r) =>
          r.nome_skill.trim().toLowerCase() === lowerName &&
          (r.status === "aberta" || r.status === "salva"),
      )
    ) {
      return { mode: "duplicate" };
    }

    if (mode === "automatic") {
      const writeRes = await this.writeSkillArtifact({
        agenteId: params.agenteId,
        acao: params.signal.acao,
        skillId: params.signal.skillId,
        nomeSkill: params.signal.nomeSkill,
        perguntaMarkdown: params.signal.perguntaMarkdown,
        workSteps: params.workSteps,
        generateTextFn: params.generateTextFn,
      });

      if (writeRes.ok) {
        const agora = new Date().toISOString();
        const sugId = `skauto-${randomUUID().slice(0, 10)}`;
        const msgId = `msg-skauto-${randomUUID().slice(0, 10)}`;
        this.db.connection
          .prepare(
            `INSERT INTO projecao_skill_sugestoes (
              sugestao_id, mensagem_id, agente_id, thread_id, acao, skill_id,
              nome_skill, pergunta_markdown, status, criado_em, atualizado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'salva', ?, ?);`,
          )
          .run(
            sugId,
            msgId,
            params.agenteId,
            params.threadId,
            params.signal.acao,
            writeRes.slug,
            params.signal.nomeSkill,
            params.signal.perguntaMarkdown,
            agora,
            agora,
          );
        return { mode: "automatic", slug: writeRes.slug, filePath: writeRes.filePath };
      }

      // Fallback seguro para modo `ask` quando revisão automática viola guarda ou falha
    }

    const sugestao = this.persistAskSuggestion({
      agenteId: params.agenteId,
      threadId: params.threadId,
      canalId: params.canalId,
      signal: params.signal,
    });
    return { mode: "ask", sugestao };
  }

  public async saveSuggestionByMessageId(
    mensagemId: string,
    generateTextFn?: (systemPrompt: string, userPrompt: string) => Promise<string | null>,
  ): Promise<{
    ok: boolean;
    sugestao?: SkillSugestaoItem;
    filePath?: string;
    fallbackToReply?: boolean;
    erro?: string;
  }> {
    const existing = this.getSuggestionByMessageId(mensagemId);
    if (!existing) {
      return { ok: false, erro: "Sugestão de habilidade não encontrada." };
    }
    if (existing.status === "salva") {
      return { ok: true, sugestao: existing };
    }

    const writeRes = await this.writeSkillArtifact({
      agenteId: existing.agente_id,
      acao: existing.acao,
      skillId: existing.skill_id,
      nomeSkill: existing.nome_skill,
      perguntaMarkdown: existing.pergunta_markdown,
      generateTextFn,
    });

    if (!writeRes.ok) {
      return { ok: false, fallbackToReply: true, erro: writeRes.reason };
    }

    const agora = new Date().toISOString();
    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          "UPDATE projecao_skill_sugestoes SET status = 'salva', skill_id = ?, atualizado_em = ? WHERE sugestao_id = ?;",
        )
        .run(writeRes.slug, agora, existing.sugestao_id);

      const updatedItem: SkillSugestaoItem = {
        ...existing,
        skill_id: writeRes.slug,
        status: "salva",
        atualizado_em: agora,
      };
      this.db.connection
        .prepare("UPDATE projecao_conversas_chat SET metadados_json = ? WHERE mensagem_id = ?;")
        .run(JSON.stringify({ skill_sugestao: updatedItem }), mensagemId);
    });

    return {
      ok: true,
      sugestao: this.getSuggestionByMessageId(mensagemId) ?? undefined,
      filePath: writeRes.filePath,
    };
  }

  public dismissSuggestionByMessageId(mensagemId: string): SkillSugestaoItem | null {
    const existing = this.getSuggestionByMessageId(mensagemId);
    if (!existing) return null;

    const agora = new Date().toISOString();
    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          "UPDATE projecao_skill_sugestoes SET status = 'dispensada', atualizado_em = ? WHERE sugestao_id = ?;",
        )
        .run(agora, existing.sugestao_id);

      const updatedItem: SkillSugestaoItem = {
        ...existing,
        status: "dispensada",
        atualizado_em: agora,
      };
      this.db.connection
        .prepare("UPDATE projecao_conversas_chat SET metadados_json = ? WHERE mensagem_id = ?;")
        .run(JSON.stringify({ skill_sugestao: updatedItem }), mensagemId);
    });

    return this.getSuggestionByMessageId(mensagemId);
  }
}
