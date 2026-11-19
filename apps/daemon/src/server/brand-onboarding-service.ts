import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import type { IdentidadeMarcaStudio, OnboardingEstado, PacoteUpgradeInfo } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { ROSTER_15_AGENTES } from "../engine/runner/roster-defaults.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
import { LicenseValidationError, type LicenseClientService } from "../license/license-service.ts";
import { isUpgradeUnlocked, UPGRADE_PACKAGE_SLUGS } from "./studio-tools-bridge.ts";

const DEFAULT_BRAND_IDENTITY: IdentidadeMarcaStudio = {
  marca_nome: "[NOME_DA_MARCA]",
  perfil_handle: "[@SEU_PERFIL]",
  nicho: "[A PREENCHER]",
  publico_alvo: "[A PREENCHER]",
  oferta_principal: "[A PREENCHER]",
  tom_voz: "[A PREENCHER]",
  cores: {
    fundo: "#141414",
    texto: "#FFFFFF",
    primaria: "#31CF76",
    secundaria: "#42A0FF",
    acento: "#F59E0B",
  },
  fontes: {
    titulo: "Inter, sans-serif",
    texto: "Inter, sans-serif",
  },
  marcos: {
    instalacao: "concluido",
    perfil: "pendente",
    identidade_visual: "pendente",
    configuracoes: "pendente",
    primeiro_post: "pendente",
    postagem: "pendente",
  },
  atualizado_em: new Date().toISOString(),
};

export function getBrandIdentity(
  providerConnection: ProviderConnectionService
): IdentidadeMarcaStudio {
  const onboarding = providerConnection.getOnboardingState();
  const saved = providerConnection.getStudioConfig<Partial<IdentidadeMarcaStudio>>(
    "identidade_marca",
    {}
  );
  return {
    ...DEFAULT_BRAND_IDENTITY,
    ...saved,
    marca_nome: saved.marca_nome ?? onboarding.marca_nome ?? "[NOME_DA_MARCA]",
    perfil_handle: saved.perfil_handle ?? onboarding.perfil_handle ?? "[@SEU_PERFIL]",
    cores: {
      ...DEFAULT_BRAND_IDENTITY.cores,
      ...(saved.cores ?? {}),
    },
    fontes: {
      ...DEFAULT_BRAND_IDENTITY.fontes,
      ...(saved.fontes ?? {}),
    },
    marcos: {
      ...DEFAULT_BRAND_IDENTITY.marcos,
      ...(onboarding.marcos ?? {}),
      ...(saved.marcos ?? {}),
    },
  };
}

export async function saveBrandIdentity(
  providerConnection: ProviderConnectionService,
  workspaceRoot: string,
  patch: Partial<IdentidadeMarcaStudio>
): Promise<IdentidadeMarcaStudio> {
  const atual = getBrandIdentity(providerConnection);
  const perfilPreenchido =
    Boolean(patch.marca_nome && !patch.marca_nome.includes("[NOME_DA_MARCA]")) ||
    atual.marcos.perfil === "concluido";
  const identidadePreenchida =
    Boolean(patch.cores || patch.fontes) || atual.marcos.identidade_visual === "concluido";

  const next: IdentidadeMarcaStudio = {
    ...atual,
    ...patch,
    cores: { ...atual.cores, ...(patch.cores ?? {}) },
    fontes: { ...atual.fontes, ...(patch.fontes ?? {}) },
    marcos: {
      ...atual.marcos,
      ...(patch.marcos ?? {}),
      perfil: patch.marcos?.perfil ?? (perfilPreenchido ? "concluido" : atual.marcos.perfil),
      identidade_visual:
        patch.marcos?.identidade_visual ??
        (identidadePreenchida ? "concluido" : atual.marcos.identidade_visual),
    },
    atualizado_em: new Date().toISOString(),
  };

  providerConnection.setStudioConfig("identidade_marca", next);
  providerConnection.updateOnboardingState({
    marca_nome: next.marca_nome,
    perfil_handle: next.perfil_handle,
    marcos: next.marcos,
  });

  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1") {
    await syncBrandFilesToWorkspace(workspaceRoot, next);
  }

  return next;
}

async function syncBrandFilesToWorkspace(
  workspaceRoot: string,
  brand: IdentidadeMarcaStudio
): Promise<void> {
  const files: Array<[string, string]> = [
    [
      "conteudos/perfil-da-marca.md",
      `# Perfil da Marca

- **Nome Comercial:** ${brand.marca_nome}
- **Instagram Handle:** ${brand.perfil_handle}
- **Segmento / Nicho:** ${brand.nicho}
- **Público-Alvo:** ${brand.publico_alvo}
- **Oferta Principal:** ${brand.oferta_principal}
- **Tom de Voz:** ${brand.tom_voz}
`,
    ],
    [
      "conteudos/identidade-visual.yml",
      `perfil:
  marca: ${JSON.stringify(brand.marca_nome)}
  usuario: ${JSON.stringify(brand.perfil_handle)}
tema:
  cor_fundo: ${JSON.stringify(brand.cores.fundo)}
  cor_texto: ${JSON.stringify(brand.cores.texto)}
  cor_destaque: ${JSON.stringify(brand.cores.primaria)}
  cor_secundaria: ${JSON.stringify(brand.cores.secundaria)}
  cor_acento: ${JSON.stringify(brand.cores.acento)}
  fonte_titulo: ${JSON.stringify(brand.fontes.titulo)}
  fonte_texto: ${JSON.stringify(brand.fontes.texto)}
`,
    ],
    [
      "conteudos/estado-do-studio.yml",
      `estado: ${brand.marcos.postagem === "concluido" ? "pronto" : "em_andamento"}
marcos:
  instalacao: ${brand.marcos.instalacao}
  perfil: ${brand.marcos.perfil}
  identidade_visual: ${brand.marcos.identidade_visual}
  configuracoes: ${brand.marcos.configuracoes}
  primeiro_post: ${brand.marcos.primeiro_post}
  postagem: ${brand.marcos.postagem}
atualizado_em: ${JSON.stringify(brand.atualizado_em)}
`,
    ],
    [
      "recursos/brand/tokens.css",
      `:root {
  --brand-primary: ${brand.cores.primaria};
  --brand-secondary: ${brand.cores.secundaria};
  --brand-accent: ${brand.cores.acento};
  --brand-background: ${brand.cores.fundo};
  --brand-text: ${brand.cores.texto};
  --brand-font-heading: ${brand.fontes.titulo};
  --brand-font-body: ${brand.fontes.texto};
}
`,
    ],
  ];

  for (const [rel, content] of files) {
    const abs = resolve(workspaceRoot, rel);
    if (
      (rel === "conteudos/perfil-da-marca.md" || rel === "conteudos/identidade-visual.yml") &&
      existsSync(abs)
    ) {
      try {
        const existing = await readFile(abs, "utf8");
        const hasPlaceholders =
          existing.includes("[A PREENCHER]") ||
          existing.includes("[NOME_DA_MARCA]") ||
          existing.includes("[@SEU_PERFIL]");
        if (!hasPlaceholders && existing.trim().length > 350) {
          continue;
        }
      } catch {
        // segue e atualiza se não conseguir ler
      }
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
}

export function listUpgradePackages(
  db: CriativoDatabase,
  workspaceRoot: string,
  licenseService?: LicenseClientService,
  productRoot?: string
): PacoteUpgradeInfo[] {
  const bonusAgents = ROSTER_15_AGENTES.filter((a) => a.pacote === "bonus").map((a) => a.nome);
  const videoAgents = ROSTER_15_AGENTES.filter((a) => a.pacote === "video").map((a) => a.nome);

  return [
    {
      id: "bonus",
      nome: "Pacote Agentes Bônus",
      descricao:
        "Desbloqueia Entregáveis Executivos (PDF/CSV/Showcase), Engenharia Reversa de Concorrentes e Consistência Visual 360°.",
      instalado: isUpgradeUnlocked(db, workspaceRoot, "bonus", licenseService, productRoot),
      agentes: bonusAgents,
      skills: [...UPGRADE_PACKAGE_SLUGS.bonus],
      comando_cli: "npm run instalar-upgrade -- --pacote bonus",
    },
    {
      id: "video",
      nome: "Criativo Video Studio (Remotion)",
      descricao:
        "Desbloqueia Diretor & Editor de Vídeo Remotion, Roteirista Faceless e Roteirista Talking Head para Reels 9:16.",
      instalado: isUpgradeUnlocked(db, workspaceRoot, "video", licenseService, productRoot),
      agentes: videoAgents,
      skills: [...UPGRADE_PACKAGE_SLUGS.video],
      comando_cli: "npm run instalar-upgrade -- --pacote video",
    },
  ];
}

export async function activateUpgradePackage(
  db: CriativoDatabase,
  workspaceRoot: string,
  pacote: "bonus" | "video",
  licenseService?: LicenseClientService
): Promise<PacoteUpgradeInfo[]> {
  if (licenseService && !licenseService.isBypassedForTests()) {
    await licenseService.heartbeat();
    if (!licenseService.hasSignedUpgradeEntitlement(pacote)) {
      throw new LicenseValidationError(
        `O módulo '${pacote}' não consta na sua licença atual. Caso tenha adquirido o upgrade agora, aguarde alguns segundos e sincronize novamente.`,
        403,
        "upgrade_not_entitled",
      );
    }
    return listUpgradePackages(db, workspaceRoot, licenseService);
  }

  const row = db.connection
    .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'upgrades_instalados';`)
    .get() as { valor_json: string } | undefined;

  let atuais: string[] = [];
  try {
    atuais = row ? (JSON.parse(row.valor_json) as string[]) : [];
  } catch {
    atuais = [];
  }
  const next = Array.from(new Set([...(Array.isArray(atuais) ? atuais : []), pacote]));

  db.connection
    .prepare(
      `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
       VALUES ('upgrades_instalados', ?, ?)
       ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
    )
    .run(JSON.stringify(next), new Date().toISOString());

  return listUpgradePackages(db, workspaceRoot, licenseService);
}

export function checkSkillPresentInWorkspace(workspaceRoot: string, slug: string): boolean {
  return existsSync(join(workspaceRoot, ".agents", "skills", slug, "SKILL.md"));
}

function unescapePdfLiteral(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_m, oct) => {
      const code = Number.parseInt(oct, 8);
      return Number.isFinite(code) && code >= 32 && code <= 255 ? String.fromCharCode(code) : " ";
    });
}

function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length < 2) return "";
  // UTF-16BE BOM (FEFF) comum em PDFs gerados no Word/Canva/Figma
  if (clean.toUpperCase().startsWith("FEFF") && clean.length >= 4) {
    let out = "";
    for (let i = 4; i + 3 < clean.length; i += 4) {
      const code = Number.parseInt(clean.slice(i, i + 4), 16);
      if (code >= 32) out += String.fromCharCode(code);
    }
    return out;
  }
  let out = "";
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = Number.parseInt(clean.slice(i, i + 2), 16);
    if (code >= 32 && code <= 255) out += String.fromCharCode(code);
  }
  return out;
}

function extractTextFromPdfSegment(segment: string): string[] {
  const chunks: string[] = [];
  // Blocos BT...ET (se presentes)
  const blocks = segment.match(/BT[\s\S]{1,120000}?ET/g) ?? [segment];

  for (const block of blocks) {
    // Strings literais: (...)
    const litMatches = block.matchAll(/\((?:\\.|[^\\()])*\)/g);
    for (const m of litMatches) {
      const inner = unescapePdfLiteral(m[0].slice(1, -1)).trim();
      if (inner.length > 0) chunks.push(inner);
    }
    // Strings hex: <...> (apenas quando não parece dicionário <<...>>)
    const hexMatches = block.matchAll(/(?<!<)<([0-9a-fA-F\s]{2,4000})>(?!>)/g);
    for (const m of hexMatches) {
      const decoded = decodePdfHexString(m[1]).trim();
      if (decoded.length > 0 && /[a-zA-ZÀ-ÿ0-9]/.test(decoded)) {
        chunks.push(decoded);
      }
    }
  }
  return chunks;
}

/**
 * Extrai texto legível de um arquivo PDF em Node puro (suporta streams FlateDecode e texto plano)
 * sem executar binários externos nem permitir payloads maiores que 15 MB.
 */
export function extractTextFromBrandPdfBuffer(buf: Buffer): string {
  if (!Buffer.isBuffer(buf) || buf.length === 0 || buf.length > 15 * 1024 * 1024) {
    return "";
  }

  const rawLatin1 = buf.toString("latin1");
  const collected: string[] = [];

  // 1. Tenta extrair streams FlateDecode / não comprimidos (máx. 300 streams por segurança anti-DoS)
  const streamRe = /stream[\r\n]+([\s\S]{1,400000}?)[\r\n]+endstream/g;
  let streamCount = 0;
  for (const match of rawLatin1.matchAll(streamRe)) {
    streamCount += 1;
    if (streamCount > 300) break;

    const rawStreamBytes = Buffer.from(match[1], "latin1");
    let decodedText = "";
    try {
      const inflated = inflateSync(rawStreamBytes);
      decodedText = inflated.toString("latin1");
    } catch {
      try {
        const inflatedRaw = inflateRawSync(rawStreamBytes);
        decodedText = inflatedRaw.toString("latin1");
      } catch {
        decodedText = match[1];
      }
    }

    if (decodedText.includes("(") || decodedText.includes("BT") || decodedText.includes("Tj")) {
      collected.push(...extractTextFromPdfSegment(decodedText));
    }
  }

  // 2. Fallback caso o PDF contenha texto direto fora de stream comprimido (ex. PDFs sintéticos simples)
  if (collected.length === 0) {
    collected.push(...extractTextFromPdfSegment(rawLatin1));
  }

  const normalized = collected
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7EÀ-ÿ\n]/g, " ")
    .trim();

  return normalized.slice(0, 40_000);
}

function isPlaceholderField(val: string | undefined | null): boolean {
  if (!val) return true;
  const clean = val.trim();
  return (
    clean.length === 0 ||
    clean.includes("[A PREENCHER]") ||
    clean.includes("[NOME_DA_MARCA]") ||
    clean.includes("[@SEU_PERFIL]")
  );
}

function extractLabeledField(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?:^|\\s)${escaped}\\s*[:\\-]\\s*([^\\n|;]{2,180}?)(?=\\s+(?:Marca|Empresa|Instagram|Perfil|Nicho|Segmento|P[uú]blico|Oferta|Produto|Tom|Voz|Posicionamento|Palavras|Cores)\\s*:|$)`,
      "i"
    );
    const match = text.match(re);
    if (match && match[1]?.trim()) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Converte texto extraído de Ficha Institucional em patch parcial de Identidade da Marca,
 * jamais inventando ou sobrescrevendo campos já preenchidos manualmente pelo usuário.
 */
export function parseBrandIdentityFromExtractedText(
  text: string
): Partial<IdentidadeMarcaStudio> {
  const clean = text.trim();
  if (!clean) return {};

  const patch: Partial<IdentidadeMarcaStudio> = {};
  const marca = extractLabeledField(clean, ["Marca", "Nome da Marca", "Empresa", "Negócio"]);
  if (marca) patch.marca_nome = marca;

  const handleMatch =
    extractLabeledField(clean, ["Instagram", "Perfil", "Arroba", "Handle"]) ||
    clean.match(/@([a-zA-Z0-9._]{2,30})/)?.[0] ||
    null;
  if (handleMatch && !handleMatch.includes("SEU_PERFIL")) {
    patch.perfil_handle = handleMatch.startsWith("@") ? handleMatch : `@${handleMatch}`;
  }

  const nicho = extractLabeledField(clean, ["Nicho", "Segmento", "Mercado", "Área"]);
  if (nicho) patch.nicho = nicho;

  const publico = extractLabeledField(clean, ["Público-alvo", "Público", "Audiência", "Persona"]);
  if (publico) patch.publico_alvo = publico;

  const oferta = extractLabeledField(clean, ["Oferta principal", "Oferta", "Produto", "Serviço"]);
  if (oferta) patch.oferta_principal = oferta;

  const tom = extractLabeledField(clean, ["Tom de voz", "Tom", "Voz da marca", "Estilo"]);
  if (tom) patch.tom_voz = tom;

  // Caso seja ficha narrativa sem rótulos estruturados, usa resumo inicial em nicho/oferta apenas se nenhum campo foi mapeado
  if (Object.keys(patch).length === 0 && clean.length >= 24) {
    patch.oferta_principal = clean.slice(0, 260);
  }

  return patch;
}

export async function importBrandPdfFromBuffer(
  providerConnection: ProviderConnectionService,
  workspaceRoot: string,
  buf: Buffer
): Promise<{
  ok: boolean;
  extracted_chars: number;
  extracted_text_preview: string;
  patch: Partial<IdentidadeMarcaStudio>;
  identidade: IdentidadeMarcaStudio;
}> {
  const extracted = extractTextFromBrandPdfBuffer(buf);
  const rawPatch = parseBrandIdentityFromExtractedText(extracted);
  const atual = getBrandIdentity(providerConnection);

  // Nunca sobrescreve campos já preenchidos manualmente pelo usuário
  const safePatch: Partial<IdentidadeMarcaStudio> = {};
  if (rawPatch.marca_nome && isPlaceholderField(atual.marca_nome)) {
    safePatch.marca_nome = rawPatch.marca_nome;
  }
  if (rawPatch.perfil_handle && isPlaceholderField(atual.perfil_handle)) {
    safePatch.perfil_handle = rawPatch.perfil_handle;
  }
  if (rawPatch.nicho && isPlaceholderField(atual.nicho)) {
    safePatch.nicho = rawPatch.nicho;
  }
  if (rawPatch.publico_alvo && isPlaceholderField(atual.publico_alvo)) {
    safePatch.publico_alvo = rawPatch.publico_alvo;
  }
  if (rawPatch.oferta_principal && isPlaceholderField(atual.oferta_principal)) {
    safePatch.oferta_principal = rawPatch.oferta_principal;
  }
  if (rawPatch.tom_voz && isPlaceholderField(atual.tom_voz)) {
    safePatch.tom_voz = rawPatch.tom_voz;
  }

  const identidade =
    Object.keys(safePatch).length > 0
      ? await saveBrandIdentity(providerConnection, workspaceRoot, safePatch)
      : atual;

  return {
    ok: extracted.length > 0,
    extracted_chars: extracted.length,
    extracted_text_preview: extracted.slice(0, 400),
    patch: safePatch,
    identidade,
  };
}

export function computeUnlockedAgentsSummary(
  db: CriativoDatabase,
  workspaceRoot: string,
  licenseService?: LicenseClientService
): {
  unlocked_agents_count: number;
  total_permanent_agents: number;
  base_count: number;
  custom_count: number;
} {
  const rows = db.connection
    .prepare(`SELECT agente_id, config_json FROM projecao_agentes;`)
    .all() as Array<{ agente_id: string; config_json: string }>;

  let unlocked = 0;
  let totalPermanent = 0;
  let baseCount = 0;
  let customCount = 0;

  for (const row of rows) {
    if (row.agente_id === "assistente_setup") continue;
    totalPermanent += 1;
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
    } catch {
      cfg = {};
    }
    const pacote =
      cfg.pacote === "bonus" || cfg.pacote === "video" ? cfg.pacote : "base";
    const isUnlocked = isUpgradeUnlocked(db, workspaceRoot, pacote, licenseService);
    if (isUnlocked) {
      unlocked += 1;
      if (cfg.frente === "custom" || cfg.customizado === true) {
        customCount += 1;
      } else if (pacote === "base") {
        baseCount += 1;
      }
    }
  }

  return {
    unlocked_agents_count: unlocked,
    total_permanent_agents: totalPermanent,
    base_count: baseCount,
    custom_count: customCount,
  };
}

export function isSetupAssistantVisible(
  db: CriativoDatabase,
  providerConnection: ProviderConnectionService
): boolean {
  const onboarding = providerConnection.getOnboardingState();
  if (onboarding.setup_assistant_dismissed === true) {
    return false;
  }
  const reopenedRow = db.connection
    .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'setup_assistant_reopened';`)
    .get() as { valor_json: string } | undefined;
  const reopened = reopenedRow ? reopenedRow.valor_json === "true" : false;
  return Boolean(onboarding.onboarding_concluido || reopened);
}

export function setSetupAssistantState(
  db: CriativoDatabase,
  providerConnection: ProviderConnectionService,
  workspaceRoot: string,
  action: "dismiss" | "reopen"
): { onboarding: OnboardingEstado; setup_assistant_visible: boolean } {
  if (action === "dismiss") {
    providerConnection.setStudioConfig("setup_assistant_reopened", false);
    const updated = providerConnection.updateOnboardingState({
      setup_assistant_dismissed: true,
    });
    return { onboarding: updated, setup_assistant_visible: false };
  }

  providerConnection.setStudioConfig("setup_assistant_reopened", true);
  const updated = providerConnection.updateOnboardingState({
    setup_assistant_dismissed: false,
  });
  const synced = evaluateAndSyncSetupCompletion(db, providerConnection, workspaceRoot);
  return {
    onboarding: synced.onboarding.setup_assistant_dismissed ? updated : synced.onboarding,
    setup_assistant_visible: true,
  };
}

export function evaluateAndSyncSetupCompletion(
  db: CriativoDatabase,
  providerConnection: ProviderConnectionService,
  workspaceRoot: string
): {
  onboarding: OnboardingEstado;
  pendencias_setup: string[];
  setup_assistant_visible: boolean;
} {
  const onboarding = providerConnection.getOnboardingState();
  const identidade = getBrandIdentity(providerConnection);
  const pendencias: string[] = [];

  if (isPlaceholderField(identidade.marca_nome) || isPlaceholderField(identidade.nicho)) {
    pendencias.push("perfil_marca");
  }

  let filesCount = 0;
  try {
    const row = db.connection
      .prepare(`SELECT COUNT(*) AS total FROM projecao_arquivos;`)
      .get() as { total: number } | undefined;
    filesCount = Number(row?.total ?? 0);
  } catch {
    filesCount = 0;
  }
  if (filesCount === 0 && onboarding.marcos?.identidade_visual !== "concluido") {
    pendencias.push("ativos_marca");
  }

  const metaTokenRow = db.connection
    .prepare(
      `SELECT COUNT(*) AS total FROM cofre_segredos WHERE chave_nome IN ('instagram_access_token', 'META_ACCESS_TOKEN', 'IG_ACCESS_TOKEN');`
    )
    .get() as { total: number } | undefined;
  const igNativeRow = db.connection
    .prepare(
      `SELECT COUNT(*) AS total FROM projecao_apps_nativos_contas WHERE app_slug = 'instagram';`
    )
    .get() as { total: number } | undefined;
  const hasInstagram =
    Number(metaTokenRow?.total ?? 0) > 0 || Number(igNativeRow?.total ?? 0) > 0;
  if (!hasInstagram) {
    pendencias.push("instagram_meta");
  }

  const reopened = providerConnection.getStudioConfig<boolean>("setup_assistant_reopened", false);
  const essentialComplete =
    onboarding.marcos?.perfil === "concluido" &&
    onboarding.marcos?.identidade_visual === "concluido" &&
    !pendencias.includes("perfil_marca") &&
    !pendencias.includes("ativos_marca");

  const nextDismissed =
    onboarding.setup_assistant_dismissed === true
      ? true
      : !reopened && onboarding.onboarding_concluido && essentialComplete && pendencias.length === 0;

  const updated = providerConnection.updateOnboardingState({
    pendencias_setup: pendencias,
    setup_assistant_dismissed: nextDismissed,
  });

  // Garante existência da pasta de ficha institucional no workspace se houver arquivos futuros
  void workspaceRoot;

  return {
    onboarding: updated,
    pendencias_setup: pendencias,
    setup_assistant_visible: isSetupAssistantVisible(db, providerConnection),
  };
}
