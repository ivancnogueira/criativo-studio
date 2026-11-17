import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type {
  ContaProvedorInfo,
  GrupoCotaConta,
  JanelaCotaConta,
  ModeloProvedorInfo,
  NivelEsforco,
  PoolContasConfig,
} from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import type { McpGateway } from "../mcp/mcp-gateway.ts";
import { AntigravityAcpService, type AcpDiscoveredModel } from "./antigravity-acp-service.ts";
import {
  formatResetCountdownPtBr,
  refreshCachedQuotaGroupCountdowns,
} from "./provider-quota-utils.ts";

const CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal";
const DAILY_CODE_ASSIST_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal";
const DESKTOP_VERSION = "2.31.0";
const QUOTA_TIMEOUT_MS = 10_000;
const GENERATE_TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 45_000;
const ACP_MODELS_CACHE_TTL_MS = 10 * 60_000;

interface TokenFilePayload {
  token?: {
    access_token?: string;
    refresh_token?: string;
    expiry?: string;
  };
  id_token_email?: string;
  auth_method?: string;
}

interface StudioAccountRecord {
  id: string;
  geminiDir: string;
  label: string | null;
  email: string | null;
}

interface DiscoveredTokenEntry {
  id: string;
  label: string | null;
  geminiDir: string;
  tokenPath: string;
  email: string | null;
  accessToken: string | null;
  hasRefreshToken: boolean;
  expiryIso: string | null;
  tokenValid: boolean;
}

interface CodeAssistQuotaBucket {
  bucketId?: string;
  displayName?: string;
  window?: string;
  resetTime?: string;
  remainingFraction?: number;
}

interface CodeAssistQuotaGroup {
  displayName?: string;
  description?: string;
  buckets?: CodeAssistQuotaBucket[];
}

interface FetchAvailableModelEntry {
  displayName?: string;
  supportsImages?: boolean;
  supportsThinking?: boolean;
  recommended?: boolean;
  thinkingLevel?: number;
  modelProvider?: string;
  quotaInfo?: {
    remainingFraction?: number;
    resetTime?: string;
  };
}

export interface AntigravityLiveSnapshot {
  contas: ContaProvedorInfo[];
  pool: PoolContasConfig | null;
  modelos: ModeloProvedorInfo[];
  defaultModelId: string | null;
  imageGenerationModelIds: string[];
  atualizado_em: string;
}

export interface CodeAssistGenerateInput {
  model: string;
  systemPrompt?: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  imagePaths?: string[];
  generateImage?: boolean;
  preferredAccountId?: string | null;
  agentId?: string | null;
  onDelta?: (chunk: string) => void;
}

export interface CodeAssistGenerateOutput {
  text: string;
  images: Array<{ mimeType: string; dataBase64: string }>;
  modelUsed: string;
  accountId: string;
  accountEmail: string | null;
  usage: {
    uncachedInput: number;
    cachedInput: number;
    output: number;
  };
}

function getAntigravityUserAgent(): string {
  const osName = process.platform === "win32" ? "windows" : process.platform;
  const archName = process.arch === "x64" ? "amd64" : process.arch;
  return `antigravity/${DESKTOP_VERSION} ${osName}/${archName}`;
}

function inferImageMimeFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function mapAcpEffortSuffix(rawId: string): NivelEsforco | null {
  const lower = rawId.toLowerCase();
  if (lower.endsWith("-low")) return "baixo";
  if (lower.endsWith("-medium")) return "medio";
  if (lower.endsWith("-high") || lower.endsWith("-xhigh")) return "alto";
  return null;
}

function cleanAcpDisplayName(rawName: string): string {
  return rawName
    .replace(/\s*\((?:Low|Medium|High|XHigh|Extra|Standard)\)\s*$/i, "")
    .replace(/\s+(?:Low|Medium|High|XHigh|Extra)\s*$/i, "")
    .trim();
}

function buildGroupedAcpModels(
  acpModels: AcpDiscoveredModel[],
  defaultAcpId: string | null,
  grupos: GrupoCotaConta[],
  httpModels: ModeloProvedorInfo[]
): ModeloProvedorInfo[] {
  const remainingByGroup = new Map<string, { pct: number | null; resetaEm: string | null }>();
  for (const g of grupos) {
    const pct = g.janela_5h?.restante_percentual ?? g.janela_semanal?.restante_percentual ?? null;
    const resetaEm = g.janela_5h?.reseta_em ?? g.janela_semanal?.reseta_em ?? null;
    remainingByGroup.set(g.nome, { pct, resetaEm });
  }

  const grouped = new Map<string, ModeloProvedorInfo>();
  for (const raw of acpModels) {
    const rawId = raw.modelId.trim();
    if (!rawId) continue;

    // Preserva identificadores sem família variável ("gpt-oss-120b-medium", "orchestrator")
    const isFixedVariant = rawId === "gpt-oss-120b-medium" || rawId.includes("orchestrator");
    const familyId = isFixedVariant
      ? rawId
      : rawId.replace(/-(low|medium|high|xhigh)$/i, "");
    const rotulo = isFixedVariant ? raw.name : cleanAcpDisplayName(raw.name || familyId);

    const lowerFamily = familyId.toLowerCase();
    const grupoCota =
      lowerFamily.startsWith("claude") || lowerFamily.startsWith("gpt")
        ? "Claude and GPT models"
        : "Gemini Models";
    const quotaInfo = remainingByGroup.get(grupoCota);
    const effort = mapAcpEffortSuffix(rawId);
    const isDefault =
      Boolean(raw.isDefault) ||
      Boolean(defaultAcpId && (defaultAcpId === rawId || defaultAcpId.startsWith(`${familyId}-`)));

    const existing = grouped.get(familyId);
    if (!existing) {
      grouped.set(familyId, {
        id: familyId,
        rotulo: rotulo || familyId,
        padrao: isDefault,
        suporta_imagem: lowerFamily.includes("gemini"),
        restante_percentual: quotaInfo?.pct ?? null,
        reseta_em: quotaInfo?.resetaEm ?? null,
        esforcos_suportados: effort ? [effort] : ["medio"],
        grupo_cota: grupoCota,
        descoberto_em_conta: true,
      });
    } else {
      existing.padrao = Boolean(existing.padrao || isDefault);
      if (effort && !existing.esforcos_suportados?.includes(effort)) {
        existing.esforcos_suportados = [...(existing.esforcos_suportados ?? []), effort];
      }
    }
  }

  // Preserva modelos dedicados de geração de imagem (ex.: Nano Banana) vindos do Code Assist HTTP
  for (const httpMod of httpModels) {
    const lowerId = httpMod.id.toLowerCase();
    if ((lowerId.includes("-image") || lowerId.includes("imagen")) && !grouped.has(httpMod.id)) {
      grouped.set(httpMod.id, httpMod);
    }
  }

  return [...grouped.values()];
}

function parseGroupModelsDescription(desc: string | undefined): string[] {
  if (!desc) return [];
  const match = /^Models within this group:\s*(.+?)\.?$/iu.exec(desc.trim());
  const raw = match?.[1] ?? "";
  return raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

function normalizeWindowBucket(bucket: CodeAssistQuotaBucket): JanelaCotaConta | null {
  if (typeof bucket.remainingFraction !== "number") return null;
  const remainingPct = Math.max(0, Math.min(100, Math.round(bucket.remainingFraction * 100)));
  const usedPct = 100 - remainingPct;
  const descriptor = `${bucket.window ?? ""} ${bucket.displayName ?? ""}`.toLowerCase();
  const isWeekly = /week|semanal|7\s*d/.test(descriptor);
  const is5h = /\b5\s*-?\s*h|five.?hour/.test(descriptor);
  const janela: JanelaCotaConta["janela"] = isWeekly ? "semanal" : is5h ? "5h" : "outro";
  const duracaoMinutos = isWeekly ? 10_080 : is5h ? 300 : 0;
  const resetIso = bucket.resetTime ?? null;

  return {
    bucket_id: bucket.bucketId,
    rotulo: bucket.displayName?.trim() || (isWeekly ? "Limite semanal" : is5h ? "Limite de 5 horas" : "Cota"),
    janela,
    duracao_minutos: duracaoMinutos,
    restante_percentual: remainingPct,
    usado_percentual: usedPct,
    reseta_em: resetIso,
    reseta_em_texto: formatResetCountdownPtBr(resetIso),
  };
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isInternalHiddenModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith("tab_") || lower.startsWith("chat_") || lower.includes("_tiered");
}

function normalizeModelFamilyAndEffort(
  rawId: string,
  meta: FetchAvailableModelEntry,
  imageGenIds: Set<string>,
  defaultId: string | null
): ModeloProvedorInfo | null {
  if (isInternalHiddenModelId(rawId)) return null;

  const baseName = meta.displayName?.trim() || rawId;
  const remainingPct =
    typeof meta.quotaInfo?.remainingFraction === "number"
      ? Math.max(0, Math.min(100, Math.round(meta.quotaInfo.remainingFraction * 100)))
      : null;

  const isImage =
    imageGenIds.has(rawId) || rawId.toLowerCase().includes("-image") || rawId.toLowerCase().includes("imagen");

  let grupoCota: string | null = null;
  if (meta.modelProvider === "MODEL_PROVIDER_ANTHROPIC" || meta.modelProvider === "MODEL_PROVIDER_OPENAI") {
    grupoCota = "Claude and GPT models";
  } else if (meta.modelProvider === "MODEL_PROVIDER_GOOGLE") {
    grupoCota = "Gemini Models";
  }

  let esforcos: NivelEsforco[] = ["medio"];
  if (meta.supportsThinking) {
    esforcos = ["baixo", "medio", "alto"];
  }

  return {
    id: rawId,
    rotulo: baseName,
    padrao: defaultId === rawId || Boolean(meta.recommended && rawId.includes("flash-high")),
    suporta_imagem: isImage || Boolean(meta.supportsImages),
    restante_percentual: remainingPct,
    reseta_em: meta.quotaInfo?.resetTime ?? null,
    esforcos_suportados: esforcos,
    grupo_cota: grupoCota,
    descoberto_em_conta: true,
  };
}

/**
 * Gerencia exclusivamente as conexões Google/Antigravity reais criadas pelo usuário
 * dentro do Criativo AI Studio (em `dados/contas/gemini/<id>`), com login oficial
 * no navegador via protocolo ACP, renovação silenciosa de token e consulta de cotas/modelos.
 */
export class AntigravityLiveService {
  private readonly db?: CriativoDatabase;
  private readonly accountsRootDir: string;
  private readonly workspaceCwd: string;
  private readonly fetchImpl: typeof fetch;
  private readonly acpService: AntigravityAcpService;
  private readonly allowAutoAcpDiscovery: boolean;
  private mcpGateway?: McpGateway;
  private snapshotCache: { expiresAt: number; data: AntigravityLiveSnapshot } | null = null;
  private acpModelsCache: {
    accountId: string;
    expiresAt: number;
    models: AcpDiscoveredModel[];
    defaultModelId: string | null;
  } | null = null;

  constructor(options?: {
    db?: CriativoDatabase;
    accountsRootDir?: string;
    appDataDir?: string;
    workspaceCwd?: string;
    fetchImpl?: typeof fetch;
    acpService?: AntigravityAcpService;
    mcpGateway?: McpGateway;
  }) {
    this.db = options?.db;
    this.workspaceCwd = resolve(options?.workspaceCwd ?? process.cwd());
    this.accountsRootDir = resolve(
      options?.accountsRootDir ?? join(this.workspaceCwd, "dados", "contas", "gemini")
    );
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.allowAutoAcpDiscovery = Boolean(options?.acpService || !options?.fetchImpl);
    this.mcpGateway = options?.mcpGateway;
    this.acpService =
      options?.acpService ??
      new AntigravityAcpService({
        appDataDir: options?.appDataDir,
        mcpServersResolver: (agentId) => this.mcpGateway?.getAcpMcpServers(agentId) ?? [],
      });
    if (options?.mcpGateway && options?.acpService) {
      this.acpService.setMcpServersResolver(
        (agentId) => this.mcpGateway?.getAcpMcpServers(agentId) ?? []
      );
    }
  }

  public setMcpGateway(gateway: McpGateway): void {
    this.mcpGateway = gateway;
    this.acpService.setMcpServersResolver(
      (agentId) => this.mcpGateway?.getAcpMcpServers(agentId) ?? []
    );
  }

  public getCliExecutable(): string | null {
    return this.acpService.getCliExecutable();
  }

  private getStudioRecords(): {
    accounts: StudioAccountRecord[];
    poolOverride?: { habilitado?: boolean; contas_excluidas?: string[]; conta_em_uso?: string | null };
  } {
    if (!this.db) return { accounts: [] };
    try {
      const rowAcc = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'antigravity_contas_studio';`)
        .get() as { valor_json: string } | undefined;
      const rowPool = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'antigravity_pool';`)
        .get() as { valor_json: string } | undefined;

      const parsedAcc = rowAcc ? (JSON.parse(rowAcc.valor_json) as StudioAccountRecord[]) : [];
      const parsedPool = rowPool
        ? (JSON.parse(rowPool.valor_json) as {
            habilitado?: boolean;
            contas_excluidas?: string[];
            conta_em_uso?: string | null;
          })
        : undefined;

      return { accounts: Array.isArray(parsedAcc) ? parsedAcc : [], poolOverride: parsedPool };
    } catch {
      return { accounts: [] };
    }
  }

  private saveStudioRecords(accounts: StudioAccountRecord[]): void {
    if (!this.db) return;
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES ('antigravity_contas_studio', ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(JSON.stringify(accounts), new Date().toISOString());
    this.snapshotCache = null;
    this.acpModelsCache = null;
  }

  private saveLastSnapshotCache(data: {
    contas: ContaProvedorInfo[];
    modelos: ModeloProvedorInfo[];
    defaultModelId: string | null;
    imageGenerationModelIds: string[];
  }): void {
    if (!this.db) return;
    try {
      this.db.connection
        .prepare(
          `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
           VALUES ('antigravity_last_snapshot', ?, ?)
           ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
        )
        .run(JSON.stringify(data), new Date().toISOString());
    } catch {
      // ignora erro ao gravar cache local
    }
  }

  private loadLastSnapshotCache(): {
    contas?: ContaProvedorInfo[];
    modelos?: ModeloProvedorInfo[];
    defaultModelId?: string | null;
    imageGenerationModelIds?: string[];
  } | null {
    if (!this.db) return null;
    try {
      const row = this.db.connection
        .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'antigravity_last_snapshot';`)
        .get() as { valor_json: string } | undefined;
      return row
        ? (JSON.parse(row.valor_json) as {
            contas?: ContaProvedorInfo[];
            modelos?: ModeloProvedorInfo[];
            defaultModelId?: string | null;
            imageGenerationModelIds?: string[];
          })
        : null;
    } catch {
      return null;
    }
  }

  private deduplicateModels(models: ModeloProvedorInfo[]): ModeloProvedorInfo[] {
    const byLabel = new Map<string, ModeloProvedorInfo>();
    for (const m of models) {
      const key = `${m.rotulo.trim().toLowerCase()}::${m.grupo_cota ?? ""}`;
      const existing = byLabel.get(key);
      if (!existing) {
        byLabel.set(key, { ...m });
        continue;
      }
      const existingScore =
        (existing.padrao ? 4 : 0) +
        (existing.id.includes("-high") ? 2 : existing.id.includes("-medium") ? 1 : 0);
      const nextScore =
        (m.padrao ? 4 : 0) + (m.id.includes("-high") ? 2 : m.id.includes("-medium") ? 1 : 0);
      const mergedEfforts = Array.from(
        new Set([...(existing.esforcos_suportados ?? []), ...(m.esforcos_suportados ?? []), "baixo", "medio", "alto"])
      ) as NivelEsforco[];

      if (nextScore > existingScore) {
        byLabel.set(key, {
          ...m,
          padrao: Boolean(existing.padrao || m.padrao),
          suporta_imagem: Boolean(existing.suporta_imagem || m.suporta_imagem),
          esforcos_suportados: mergedEfforts,
        });
      } else {
        existing.padrao = Boolean(existing.padrao || m.padrao);
        existing.suporta_imagem = Boolean(existing.suporta_imagem || m.suporta_imagem);
        existing.esforcos_suportados = mergedEfforts;
        if (
          typeof m.restante_percentual === "number" &&
          (existing.restante_percentual === null ||
            existing.restante_percentual === undefined ||
            m.restante_percentual > existing.restante_percentual)
        ) {
          existing.restante_percentual = m.restante_percentual;
        }
      }
    }
    return [...byLabel.values()].sort((a, b) => {
      if (a.padrao && !b.padrao) return -1;
      if (!a.padrao && b.padrao) return 1;
      return a.rotulo.localeCompare(b.rotulo, "pt-BR");
    });
  }

  private discoverStudioTokenEntries(): {
    entries: DiscoveredTokenEntry[];
    poolOverride?: { habilitado?: boolean; contas_excluidas?: string[]; conta_em_uso?: string | null };
  } {
    const { accounts, poolOverride } = this.getStudioRecords();
    const entries: DiscoveredTokenEntry[] = [];
    const seenEmails = new Set<string>();

    for (const acc of accounts) {
      if (!acc.geminiDir) continue;
      const absDir = resolve(acc.geminiDir);
      const tokenPath = join(absDir, "antigravity-acp", "antigravity-oauth-token");
      if (!existsSync(tokenPath)) continue;

      const payload = safeReadJson<TokenFilePayload>(tokenPath);
      const email = payload?.id_token_email?.trim() || acc.email || null;
      if (email) {
        const lowerEmail = email.toLowerCase();
        if (seenEmails.has(lowerEmail)) continue;
        seenEmails.add(lowerEmail);
      }

      const accessToken = payload?.token?.access_token?.trim() || null;
      const expiryIso = payload?.token?.expiry ?? null;
      const expiryMs = expiryIso ? Date.parse(expiryIso) : Number.NaN;
      const tokenValid = Boolean(accessToken && (!expiryIso || expiryMs > Date.now() + 60_000));

      entries.push({
        id: acc.id,
        label: acc.label ?? null,
        geminiDir: absDir,
        tokenPath,
        email,
        accessToken,
        hasRefreshToken: Boolean(payload?.token?.refresh_token?.trim()),
        expiryIso,
        tokenValid,
      });
    }

    return { entries, poolOverride };
  }

  private async callCodeAssist<T>(
    endpoint: string,
    method: string,
    accessToken: string,
    body: unknown,
    timeoutMs = QUOTA_TIMEOUT_MS
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${endpoint}:${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": getAntigravityUserAgent(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Code Assist (${method}) respondeu HTTP ${response.status}: ${errText.slice(0, 180)}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  public async getLiveSnapshot(forceRefresh = false): Promise<AntigravityLiveSnapshot> {
    const now = Date.now();
    if (!forceRefresh && this.snapshotCache && this.snapshotCache.expiresAt > now) {
      return this.snapshotCache.data;
    }

    const { entries, poolOverride } = this.discoverStudioTokenEntries();
    if (entries.length === 0) {
      const emptySnap: AntigravityLiveSnapshot = {
        contas: [],
        pool: null,
        modelos: [],
        defaultModelId: null,
        imageGenerationModelIds: [],
        atualizado_em: new Date().toISOString(),
      };
      this.snapshotCache = { expiresAt: now + CACHE_TTL_MS, data: emptySnap };
      return emptySnap;
    }

    const cliExe = this.acpService.getCliExecutable();
    const cachedPrev = this.loadLastSnapshotCache();

    const contas: ContaProvedorInfo[] = [];
    const modelMap = new Map<string, ModeloProvedorInfo>();
    let defaultModelId: string | null = cachedPrev?.defaultModelId ?? null;
    const imageGenerationModelIds = new Set<string>(cachedPrev?.imageGenerationModelIds ?? []);
    let anyFreshLiveSuccess = false;

    await Promise.all(
      entries.map(async (entry) => {
        const cachedAccount = cachedPrev?.contas?.find(
          (c) => c.id === entry.id || (entry.email && c.email === entry.email)
        );
        const grupos: GrupoCotaConta[] = [];
        let modelosConta: string[] = [];
        let activeAccessToken = entry.accessToken;
        let tokenValidNow = entry.tokenValid;
        let expiryIsoNow = entry.expiryIso;

        // Se o token JWT em disco venceu e o motor ACP está disponível, renova silenciosamente
        if (!tokenValidNow && entry.hasRefreshToken && cliExe && forceRefresh) {
          try {
            const refreshed = await this.acpService.refreshAccountToken(entry.id, entry.geminiDir);
            if (refreshed?.accessToken) {
              activeAccessToken = refreshed.accessToken;
              expiryIsoNow = refreshed.expiryIso;
              tokenValidNow = true;
            }
          } catch {
            // fallback para cache ou estado autenticado via ACP
          }
        }

        const estado: ContaProvedorInfo["estado"] =
          tokenValidNow || (entry.hasRefreshToken && Boolean(cliExe)) ? "conectado" : "desconectado";
        let plano: string | null = cachedAccount?.plano ?? null;

        if (activeAccessToken && tokenValidNow) {
          try {
            const codeAssistInfo = await this.callCodeAssist<{
              cloudaicompanionProject?: string;
              currentTier?: { name?: string };
            }>(CODE_ASSIST_URL, "loadCodeAssist", activeAccessToken, {});

            if (codeAssistInfo.currentTier?.name) {
              plano = codeAssistInfo.currentTier.name;
            }

            if (codeAssistInfo.cloudaicompanionProject) {
              anyFreshLiveSuccess = true;
              const [quotaRes, modelsRes] = await Promise.all([
                this.callCodeAssist<{ groups?: CodeAssistQuotaGroup[] }>(
                  DAILY_CODE_ASSIST_URL,
                  "retrieveUserQuotaSummary",
                  activeAccessToken,
                  { project: codeAssistInfo.cloudaicompanionProject }
                ).catch(() => ({ groups: [] as CodeAssistQuotaGroup[] })),
                this.callCodeAssist<{
                  models?: Record<string, FetchAvailableModelEntry>;
                  defaultAgentModelId?: string;
                  imageGenerationModelIds?: string[];
                }>(
                  DAILY_CODE_ASSIST_URL,
                  "fetchAvailableModels",
                  activeAccessToken,
                  { project: codeAssistInfo.cloudaicompanionProject }
                ).catch(() => null),
              ]);

              for (const rawGroup of quotaRes.groups ?? []) {
                const nome = rawGroup.displayName?.trim();
                if (!nome) continue;
                let janela5h: JanelaCotaConta | null = null;
                let janelaSemanal: JanelaCotaConta | null = null;
                for (const b of rawGroup.buckets ?? []) {
                  const win = normalizeWindowBucket(b);
                  if (!win) continue;
                  if (win.janela === "5h") {
                    if (!janela5h || win.restante_percentual < janela5h.restante_percentual) janela5h = win;
                  } else if (win.janela === "semanal") {
                    if (!janelaSemanal || win.restante_percentual < janelaSemanal.restante_percentual) janelaSemanal = win;
                  }
                }
                if (janela5h || janelaSemanal) {
                  grupos.push({
                    nome,
                    modelos: parseGroupModelsDescription(rawGroup.description),
                    janela_5h: janela5h,
                    janela_semanal: janelaSemanal,
                  });
                }
              }

              if (modelsRes?.models) {
                if (modelsRes.defaultAgentModelId) {
                  defaultModelId = modelsRes.defaultAgentModelId;
                }
                for (const imgId of modelsRes.imageGenerationModelIds ?? []) {
                  imageGenerationModelIds.add(imgId);
                }
                for (const [mId, mMeta] of Object.entries(modelsRes.models)) {
                  const normalized = normalizeModelFamilyAndEffort(
                    mId,
                    mMeta,
                    imageGenerationModelIds,
                    defaultModelId
                  );
                  if (!normalized) continue;
                  modelosConta.push(normalized.id);
                  const existing = modelMap.get(normalized.id);
                  if (
                    !existing ||
                    (normalized.restante_percentual ?? 0) > (existing.restante_percentual ?? -1)
                  ) {
                    modelMap.set(normalized.id, normalized);
                  }
                }
              }
            }
          } catch {
            // preserva último snapshot da conta caso chamada temporariamente falhe
          }
        }

        if (grupos.length === 0 && cachedAccount?.grupos_cota?.length) {
          grupos.push(...refreshCachedQuotaGroupCountdowns(cachedAccount.grupos_cota));
        }
        if (modelosConta.length === 0 && cachedAccount?.modelos_disponiveis?.length) {
          modelosConta = cachedAccount.modelos_disponiveis;
        }

        contas.push({
          id: entry.id,
          provedor: "gemini",
          rotulo: entry.label,
          email: entry.email,
          plano: plano ?? "Google AI",
          estado,
          padrao: contas.length === 0,
          token_valido: tokenValidNow,
          token_expira_em: expiryIsoNow,
          grupos_cota: grupos,
          modelos_disponiveis: modelosConta,
          origem: "criativo",
        });
      })
    );

    // Garante que somente a primeira conta conectada tenha flag padrao: true
    contas.forEach((c, idx) => {
      c.padrao = idx === 0;
    });

    const excluidas = poolOverride?.contas_excluidas ?? [];
    const habilitado =
      poolOverride?.habilitado !== undefined ? poolOverride.habilitado : contas.length > 1;

    const contaElegivel =
      contas.find((c) => poolOverride?.conta_em_uso && c.id === poolOverride.conta_em_uso && c.estado === "conectado") ??
      contas
        .filter((c) => c.estado === "conectado" && !excluidas.includes(c.id))
        .sort((a, b) => {
          const minA = Math.min(
            ...a.grupos_cota.flatMap((g) => [g.janela_5h?.restante_percentual ?? 100, g.janela_semanal?.restante_percentual ?? 100])
          );
          const minB = Math.min(
            ...b.grupos_cota.flatMap((g) => [g.janela_5h?.restante_percentual ?? 100, g.janela_semanal?.restante_percentual ?? 100])
          );
          return minB - minA;
        })[0] ??
      contas[0] ??
      null;

    const pool: PoolContasConfig | null =
      contas.length > 0
        ? {
            habilitado,
            contas_excluidas: excluidas,
            conta_em_uso: contaElegivel?.id ?? null,
          }
        : null;

    const eligibleEntry = entries.find(
      (e) => e.id === (contaElegivel?.id ?? "") && e.hasRefreshToken
    );
    const acpTargetEntry = eligibleEntry ?? entries.find((e) => e.hasRefreshToken) ?? null;

    if (this.allowAutoAcpDiscovery && cliExe && acpTargetEntry) {
      const cacheValid =
        !forceRefresh &&
        this.acpModelsCache &&
        this.acpModelsCache.accountId === acpTargetEntry.id &&
        this.acpModelsCache.expiresAt > now &&
        this.acpModelsCache.models.length > 0;

      if (!cacheValid) {
        const acpResult = await this.acpService
          .listAvailableModels(acpTargetEntry.id, acpTargetEntry.geminiDir)
          .catch(() => null);
        if (acpResult && acpResult.models.length > 0) {
          this.acpModelsCache = {
            accountId: acpTargetEntry.id,
            expiresAt: now + ACP_MODELS_CACHE_TTL_MS,
            models: acpResult.models,
            defaultModelId: acpResult.defaultModelId,
          };
          anyFreshLiveSuccess = true;
        }
      }
    }

    if (modelMap.size === 0 && cachedPrev?.modelos?.length) {
      for (const m of cachedPrev.modelos) {
        modelMap.set(m.id, m);
      }
    }

    let modelos: ModeloProvedorInfo[];
    if (this.acpModelsCache && this.acpModelsCache.models.length > 0) {
      const targetGrupos = contaElegivel?.grupos_cota?.length
        ? contaElegivel.grupos_cota
        : contas.find((c) => c.grupos_cota.length > 0)?.grupos_cota ?? [];
      modelos = buildGroupedAcpModels(
        this.acpModelsCache.models,
        this.acpModelsCache.defaultModelId,
        targetGrupos,
        [...modelMap.values()]
      );
      if (this.acpModelsCache.defaultModelId) {
        defaultModelId =
          modelos.find((m) => m.padrao)?.id ??
          this.acpModelsCache.defaultModelId.replace(/-(low|medium|high|xhigh)$/i, "");
      }
      const acpIds = modelos.map((m) => m.id);
      for (const conta of contas) {
        conta.modelos_disponiveis = acpIds;
      }
    } else {
      modelos = this.deduplicateModels([...modelMap.values()]);
    }

    if (anyFreshLiveSuccess) {
      this.saveLastSnapshotCache({
        contas,
        modelos,
        defaultModelId,
        imageGenerationModelIds: [...imageGenerationModelIds],
      });
    }

    const snapshot: AntigravityLiveSnapshot = {
      contas,
      pool,
      modelos,
      defaultModelId,
      imageGenerationModelIds: [...imageGenerationModelIds],
      atualizado_em: new Date().toISOString(),
    };
    this.snapshotCache = { expiresAt: now + CACHE_TTL_MS, data: snapshot };
    return snapshot;
  }

  public setPoolSettings(patch: {
    habilitado?: boolean;
    contas_excluidas?: string[];
    conta_em_uso?: string | null;
  }): void {
    if (!this.db) return;
    const { poolOverride } = this.getStudioRecords();
    const next = {
      habilitado: patch.habilitado ?? poolOverride?.habilitado ?? true,
      contas_excluidas: patch.contas_excluidas ?? poolOverride?.contas_excluidas ?? [],
      conta_em_uso: patch.conta_em_uso !== undefined ? patch.conta_em_uso : poolOverride?.conta_em_uso ?? null,
    };
    this.db.connection
      .prepare(
        `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
         VALUES ('antigravity_pool', ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
      )
      .run(JSON.stringify(next), new Date().toISOString());
    this.snapshotCache = null;
    this.acpModelsCache = null;
  }

  public cancelPendingSignIn(): boolean {
    return this.acpService.cancelPendingSignIn();
  }

  /**
   * Abre o fluxo oficial Google OAuth no navegador via `antigravity acp --gemini-dir=<pasta_isolada>`
   * e salva a conta exclusivamente no armazenamento local do Criativo AI Studio.
   */
  public async connectGoogleViaBrowser(
    label?: string,
    onAuthUrl?: (url: string) => void
  ): Promise<ContaProvedorInfo> {
    const id = `ag-${randomUUID().slice(0, 8)}`;
    const geminiDir = resolve(this.accountsRootDir, id);

    try {
      const tokenSnap = await this.acpService.signInWithGoogleBrowser({
        geminiDir,
        onAuthUrl,
      });
      const email = tokenSnap.email;
      const { accounts } = this.getStudioRecords();

      // Deduplica automaticamente se o usuário reautenticar com o mesmo e-mail Google
      const dupIdx = email
        ? accounts.findIndex((a) => a.email && a.email.toLowerCase() === email.toLowerCase())
        : -1;

      if (dupIdx >= 0) {
        const old = accounts[dupIdx];
        this.acpService.disposeAccount(old.id);
        if (old.geminiDir && resolve(old.geminiDir) !== geminiDir) {
          try {
            rmSync(resolve(old.geminiDir), { recursive: true, force: true });
          } catch {
            // ignora remoção da pasta antiga
          }
        }
        accounts.splice(dupIdx, 1);
      }

      const nextAccounts: StudioAccountRecord[] = [
        ...accounts,
        {
          id,
          geminiDir,
          label: label?.trim() || null,
          email,
        },
      ];
      this.saveStudioRecords(nextAccounts);

      const snapshot = await this.getLiveSnapshot(true);
      const found = snapshot.contas.find((c) => c.id === id);
      return (
        found ?? {
          id,
          provedor: "gemini",
          rotulo: label?.trim() || null,
          email,
          estado: "conectado",
          padrao: nextAccounts.length === 1,
          token_valido: true,
          token_expira_em: tokenSnap.expiryIso,
          grupos_cota: [],
          origem: "criativo",
        }
      );
    } catch (err) {
      try {
        rmSync(geminiDir, { recursive: true, force: true });
      } catch {
        // ignora limpeza em erro
      }
      throw err;
    }
  }

  public addManualTokenAccount(input: {
    email: string;
    label?: string;
    accessToken: string;
    refreshToken?: string;
  }): ContaProvedorInfo {
    if (!this.db) throw new Error("Banco indisponível para salvar conta.");
    const id = `ag-${Date.now().toString(36)}`;
    const geminiDir = resolve(this.accountsRootDir, id);
    const acpDir = join(geminiDir, "antigravity-acp");
    mkdirSync(acpDir, { recursive: true });
    const tokenPath = join(acpDir, "antigravity-oauth-token");
    const expiry = new Date(Date.now() + 55 * 60_000).toISOString();

    writeFileSync(
      tokenPath,
      JSON.stringify(
        {
          token: {
            access_token: input.accessToken.trim(),
            token_type: "Bearer",
            refresh_token: input.refreshToken?.trim() || "",
            expiry,
          },
          auth_method: "consumer",
          id_token_email: input.email.trim(),
        },
        null,
        2
      ),
      "utf8"
    );

    const { accounts } = this.getStudioRecords();
    const filtered = accounts.filter(
      (a) => !a.email || a.email.toLowerCase() !== input.email.trim().toLowerCase()
    );
    const nextAccounts: StudioAccountRecord[] = [
      ...filtered,
      {
        id,
        geminiDir,
        label: input.label?.trim() || null,
        email: input.email.trim(),
      },
    ];
    this.saveStudioRecords(nextAccounts);

    return {
      id,
      provedor: "gemini",
      rotulo: input.label?.trim() || null,
      email: input.email.trim(),
      estado: "conectado",
      padrao: nextAccounts.length === 1,
      token_valido: true,
      token_expira_em: expiry,
      grupos_cota: [],
      origem: "criativo",
    };
  }

  public removeAccount(accountId: string): boolean {
    if (!this.db) return false;
    const { accounts } = this.getStudioRecords();
    const target = accounts.find((a) => a.id === accountId);
    if (!target) return false;

    this.acpService.disposeAccount(accountId);
    try {
      rmSync(resolve(target.geminiDir), { recursive: true, force: true });
    } catch {
      // ignora erro ao apagar pasta da conta
    }

    const next = accounts.filter((a) => a.id !== accountId);
    this.saveStudioRecords(next);
    if (next.length === 0) {
      this.db.connection.prepare(`DELETE FROM projecao_studio_config WHERE chave = 'antigravity_last_snapshot';`).run();
    }
    return true;
  }

  public removeExtraAccount(accountId: string): boolean {
    return this.removeAccount(accountId);
  }

  public async executeCodeAssistGenerate(input: CodeAssistGenerateInput): Promise<CodeAssistGenerateOutput> {
    const snapshot = await this.getLiveSnapshot(false);
    const { entries } = this.discoverStudioTokenEntries();

    if (entries.length === 0) {
      throw new Error("Nenhuma conta Google conectada no Studio.");
    }

    const poolExcluded = new Set(snapshot.pool?.contas_excluidas ?? []);
    const candidateAccountIds = [
      input.preferredAccountId,
      snapshot.pool?.conta_em_uso,
      ...snapshot.contas.filter((c) => !poolExcluded.has(c.id)).map((c) => c.id),
      ...snapshot.contas.map((c) => c.id),
    ].filter((v): v is string => Boolean(v));

    const uniqueAccountIds = [...new Set(candidateAccountIds)];
    const chosenEntry =
      uniqueAccountIds
        .map((id) => entries.find((e) => e.id === id))
        .find((e): e is DiscoveredTokenEntry => Boolean(e)) ?? entries[0];

    const cliAvailable = Boolean(this.acpService.getCliExecutable());

    // 1. Chamadas de TEXTO/CHAT preferem o protocolo ACP aquecido (renova token sozinho e injeta MCPs autorizados ao agente)
    //    com retry automático e fallback transparente para Code Assist REST se a sessão ACP oscilar.
    let acpLastError: unknown = null;
    if (!input.generateImage && cliAvailable && (chosenEntry.hasRefreshToken || !chosenEntry.tokenValid)) {
      const promptParts: string[] = [];
      if (input.systemPrompt) {
        promptParts.push(input.systemPrompt);
      }
      if (input.messages.length > 1) {
        promptParts.push(
          `[Contexto recente da conversa]\n${input.messages
            .slice(-7, -1)
            .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.text}`)
            .join("\n")}`
        );
      }
      promptParts.push(input.messages[input.messages.length - 1]?.text ?? "");

      const sandboxCwd = resolve(this.workspaceCwd, "dados", "agent-sandbox");
      mkdirSync(sandboxCwd, { recursive: true });
      const combinedPrompt = promptParts.join("\n\n");

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const acpOut = await this.acpService.executePrompt(chosenEntry.id, {
            geminiDir: chosenEntry.geminiDir,
            cwd: sandboxCwd,
            promptText: combinedPrompt,
            modelId: attempt === 0 ? input.model : undefined,
            imagePaths: input.imagePaths,
            agentId: input.agentId,
            onDelta: attempt === 0 ? input.onDelta : undefined,
          });

          if (acpOut.text && acpOut.text.trim().length > 0) {
            this.snapshotCache = null;
            return {
              text: acpOut.text,
              images: [],
              modelUsed: acpOut.modelUsed,
              accountId: chosenEntry.id,
              accountEmail: chosenEntry.email,
              usage: acpOut.usage,
            };
          }
          acpLastError = new Error("Sessão ACP retornou resposta vazia.");
        } catch (err) {
          acpLastError = err;
        }
        this.acpService.disposeAccount(chosenEntry.id);
      }
    }

    // 2. Geração de IMAGEM ou ambientes HTTP puros (e.g. testes unitários sem CLI) via Code Assist REST
    let accessToken = chosenEntry.accessToken;
    if ((!chosenEntry.tokenValid || !accessToken) && cliAvailable && chosenEntry.hasRefreshToken) {
      const refreshed = await this.acpService.refreshAccountToken(chosenEntry.id, chosenEntry.geminiDir);
      accessToken = refreshed?.accessToken ?? null;
    }
    if (!accessToken) {
      throw new Error("Token OAuth da conta Google expirou e precisa ser reautenticado em Conexões.");
    }

    const codeAssistInfo = await this.callCodeAssist<{ cloudaicompanionProject?: string }>(
      CODE_ASSIST_URL,
      "loadCodeAssist",
      accessToken,
      {}
    );
    const project = codeAssistInfo.cloudaicompanionProject;
    if (!project) {
      throw new Error("Projeto Code Assist indisponível para a conta Google conectada.");
    }

    const contents = input.messages.map((msg, idx) => {
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        { text: msg.text },
      ];
      if (idx === input.messages.length - 1 && input.imagePaths && input.imagePaths.length > 0) {
        for (const p of input.imagePaths) {
          try {
            if (existsSync(p)) {
              parts.push({
                inlineData: {
                  mimeType: inferImageMimeFromPath(p),
                  data: readFileSync(p).toString("base64"),
                },
              });
            }
          } catch {
            // ignora arquivo ilegível
          }
        }
      }
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts,
      };
    });

    const normalizeRestCandidates = (requested: string, defModel: string | null): string[] => {
      const isInternalAcp = /orchestrator|argon|g1-pro/i.test(requested);
      const list = isInternalAcp
        ? ["gemini-2.5-pro", "gemini-2.5-flash", defModel || "gemini-3.8-flash-high"]
        : [requested, defModel || "gemini-3.8-flash-high", "gemini-2.5-pro", "gemini-2.5-flash"];
      return [...new Set(list.filter(Boolean))];
    };

    const candidateModels = input.generateImage
      ? [
          ...(snapshot.imageGenerationModelIds.length > 0
            ? snapshot.imageGenerationModelIds
            : ["gemini-3.1-flash-image"]),
        ]
      : normalizeRestCandidates(input.model, snapshot.defaultModelId);

    let lastError: unknown = acpLastError;
    for (const modelToTry of candidateModels) {
      try {
        const requestBody: Record<string, unknown> = {
          model: modelToTry,
          project,
          request: {
            ...(input.systemPrompt
              ? { systemInstruction: { parts: [{ text: input.systemPrompt }] } }
              : {}),
            contents,
            ...(input.generateImage
              ? { generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }
              : {}),
          },
        };

        const result = await this.callCodeAssist<{
          response?: {
            candidates?: Array<{
              content?: {
                parts?: Array<{
                  text?: string;
                  thought?: boolean;
                  inlineData?: { mimeType?: string; data?: string };
                }>;
              };
            }>;
            usageMetadata?: {
              promptTokenCount?: number;
              cachedContentTokenCount?: number;
              candidatesTokenCount?: number;
              thoughtsTokenCount?: number;
              totalTokenCount?: number;
            };
          };
        }>(DAILY_CODE_ASSIST_URL, "generateContent", accessToken, requestBody, GENERATE_TIMEOUT_MS);

        const parts = result.response?.candidates?.[0]?.content?.parts ?? [];
        const textParts = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text!);
        const images = parts
          .filter((p) => p.inlineData?.data && p.inlineData?.mimeType)
          .map((p) => ({
            mimeType: p.inlineData!.mimeType!,
            dataBase64: p.inlineData!.data!,
          }));

        const um = result.response?.usageMetadata;
        const promptTokens = Number(um?.promptTokenCount ?? 0);
        const cachedInput = Number(um?.cachedContentTokenCount ?? 0);
        const uncachedInput = Math.max(0, promptTokens - cachedInput);
        const output = Number(um?.candidatesTokenCount ?? 0) + Number(um?.thoughtsTokenCount ?? 0);

        return {
          text: textParts.join("\n").trim(),
          images,
          modelUsed: modelToTry,
          accountId: chosenEntry.id,
          accountEmail: chosenEntry.email,
          usage: {
            uncachedInput,
            cachedInput,
            output,
          },
        };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Falha ao executar Code Assist.");
  }

  public close(): void {
    this.acpService.closeAll();
  }
}
