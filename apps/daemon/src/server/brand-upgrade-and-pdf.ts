import {
  existsSync,
} from "node:fs";
import {
  join,
} from "node:path";
import {
  inflateRawSync,
  inflateSync,
} from "node:zlib";
import type {
  IdentidadeMarcaStudio,
  PacoteUpgradeInfo,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import {
  ROSTER_15_AGENTES,
} from "../engine/runner/roster-defaults.ts";
import type {
  ProviderConnectionService,
} from "../providers/provider-connection-service.ts";
import {
  LicenseValidationError,
  type LicenseClientService,
} from "../license/license-service.ts";
import {
  isUpgradeUnlocked,
  UPGRADE_PACKAGE_SLUGS,
} from "./studio-tools-bridge.ts";
import { getBrandIdentity, saveBrandIdentity } from "./brand-identity-service.ts";

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

export function unescapePdfLiteral(raw: string): string {
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

export function decodePdfHexString(hex: string): string {
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

export function extractTextFromPdfSegment(segment: string): string[] {
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

export function isPlaceholderField(val: string | undefined | null): boolean {
  if (!val) return true;
  const clean = val.trim();
  return (
    clean.length === 0 ||
    clean.includes("[A PREENCHER]") ||
    clean.includes("[NOME_DA_MARCA]") ||
    clean.includes("[@SEU_PERFIL]")
  );
}

export function extractLabeledField(text: string, labels: string[]): string | null {
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
  buf: Buffer,
  db?: CriativoDatabase
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
      ? await saveBrandIdentity(providerConnection, workspaceRoot, safePatch, db)
      : atual;

  return {
    ok: extracted.length > 0,
    extracted_chars: extracted.length,
    extracted_text_preview: extracted.slice(0, 400),
    patch: safePatch,
    identidade,
  };
}

