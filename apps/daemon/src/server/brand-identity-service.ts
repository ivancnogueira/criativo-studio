import {
  existsSync,
} from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  resolve,
} from "node:path";
import type {
  IdentidadeMarcaStudio,
} from "@criativo/contracts";
import type {
  CriativoDatabase,
} from "../database/client.ts";
import type {
  ProviderConnectionService,
} from "../providers/provider-connection-service.ts";

export const DEFAULT_BRAND_IDENTITY: IdentidadeMarcaStudio = {
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

export function isRealBrandValue(
  value: string | null | undefined,
  ...placeholders: string[]
): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("[A PREENCHER]")) return false;
  for (const ph of placeholders) {
    if (ph && trimmed.includes(ph)) return false;
  }
  return true;
}

export function hasConfiguredBrand(
  brand: Pick<IdentidadeMarcaStudio, "marca_nome" | "perfil_handle"> | null | undefined
): boolean {
  if (!brand) return false;
  return (
    isRealBrandValue(brand.marca_nome, "[NOME_DA_MARCA]") ||
    isRealBrandValue(brand.perfil_handle, "[@SEU_PERFIL]")
  );
}

export function interpolateBrandPlaceholders(
  text: string,
  brand: Pick<IdentidadeMarcaStudio, "marca_nome" | "perfil_handle">
): string {
  if (!text || (!text.includes("[NOME_DA_MARCA]") && !text.includes("[@SEU_PERFIL]"))) {
    return text;
  }
  const realBrand = isRealBrandValue(brand.marca_nome, "[NOME_DA_MARCA]")
    ? brand.marca_nome.trim()
    : "sua marca";
  const rawHandle = isRealBrandValue(brand.perfil_handle, "[@SEU_PERFIL]")
    ? brand.perfil_handle.trim()
    : null;
  const realHandle = rawHandle
    ? rawHandle.startsWith("@")
      ? rawHandle
      : `@${rawHandle}`
    : "seu perfil";

  return text
    .replaceAll("[NOME_DA_MARCA]", realBrand)
    .replaceAll("[@SEU_PERFIL]", realHandle);
}

export function interpolateJsonStringValuesRecursively(
  value: unknown,
  brand: Pick<IdentidadeMarcaStudio, "marca_nome" | "perfil_handle">
): unknown {
  if (typeof value === "string") {
    return interpolateBrandPlaceholders(value, brand);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateJsonStringValuesRecursively(item, brand));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      next[k] = interpolateJsonStringValuesRecursively(v, brand);
    }
    return next;
  }
  return value;
}

export function syncBrandPlaceholdersInDatabase(
  db: CriativoDatabase,
  brand: Pick<IdentidadeMarcaStudio, "marca_nome" | "perfil_handle">
): number {
  if (!hasConfiguredBrand(brand)) {
    return 0;
  }

  let updatedCount = 0;

  const chatRows = db.connection
    .prepare(
      `SELECT mensagem_id, conteudo_markdown, steps_json
       FROM projecao_conversas_chat
       WHERE autor = 'agente'
         AND (
           conteudo_markdown LIKE '%[NOME_DA_MARCA]%'
           OR conteudo_markdown LIKE '%[@SEU_PERFIL]%'
           OR steps_json LIKE '%[NOME_DA_MARCA]%'
           OR steps_json LIKE '%[@SEU_PERFIL]%'
         );`
    )
    .all() as Array<{
    mensagem_id: string;
    conteudo_markdown: string;
    steps_json: string | null;
  }>;

  const updateChatStmt = db.connection.prepare(
    `UPDATE projecao_conversas_chat
     SET conteudo_markdown = ?, steps_json = ?
     WHERE mensagem_id = ?;`
  );

  for (const row of chatRows) {
    const nextContent = interpolateBrandPlaceholders(row.conteudo_markdown, brand);
    const nextSteps =
      typeof row.steps_json === "string"
        ? interpolateBrandPlaceholders(row.steps_json, brand)
        : row.steps_json;
    if (nextContent !== row.conteudo_markdown || nextSteps !== row.steps_json) {
      updateChatStmt.run(nextContent, nextSteps, row.mensagem_id);
      updatedCount += 1;
    }
  }

  const agentRows = db.connection
    .prepare(
      `SELECT agente_id, papel, config_json
       FROM projecao_agentes
       WHERE config_json LIKE '%[NOME_DA_MARCA]%'
          OR config_json LIKE '%[@SEU_PERFIL]%'
          OR papel LIKE '%[NOME_DA_MARCA]%'
          OR papel LIKE '%[@SEU_PERFIL]%';`
    )
    .all() as Array<{ agente_id: string; papel: string; config_json: string }>;

  const updateAgentStmt = db.connection.prepare(
    `UPDATE projecao_agentes
     SET papel = ?, config_json = ?
     WHERE agente_id = ?;`
  );

  for (const row of agentRows) {
    const nextPapel = interpolateBrandPlaceholders(row.papel, brand);
    let nextConfigJson = row.config_json;
    try {
      const parsed = JSON.parse(row.config_json) as Record<string, unknown>;
      nextConfigJson = JSON.stringify(interpolateJsonStringValuesRecursively(parsed, brand));
    } catch {
      nextConfigJson = interpolateBrandPlaceholders(row.config_json, brand);
    }
    if (nextPapel !== row.papel || nextConfigJson !== row.config_json) {
      updateAgentStmt.run(nextPapel, nextConfigJson, row.agente_id);
      updatedCount += 1;
    }
  }

  return updatedCount;
}

export async function saveBrandIdentity(
  providerConnection: ProviderConnectionService,
  workspaceRoot: string,
  patch: Partial<IdentidadeMarcaStudio>,
  db?: CriativoDatabase
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

  if (db) {
    syncBrandPlaceholdersInDatabase(db, next);
  }

  if (process.env.CRIATIVO_SKIP_LOCAL_PROBE !== "1") {
    await syncBrandFilesToWorkspace(workspaceRoot, next);
  }

  return next;
}

export async function syncBrandFilesToWorkspace(
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

