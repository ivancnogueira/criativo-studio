import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { IdentidadeMarcaStudio, PacoteUpgradeInfo } from "@criativo/contracts";
import type { CriativoDatabase } from "../database/client.ts";
import { ROSTER_15_AGENTES } from "../engine/runner/roster-defaults.ts";
import type { ProviderConnectionService } from "../providers/provider-connection-service.ts";
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
  workspaceRoot: string
): PacoteUpgradeInfo[] {
  const bonusAgents = ROSTER_15_AGENTES.filter((a) => a.pacote === "bonus").map((a) => a.nome);
  const videoAgents = ROSTER_15_AGENTES.filter((a) => a.pacote === "video").map((a) => a.nome);

  return [
    {
      id: "bonus",
      nome: "Pacote Agentes Bônus",
      descricao:
        "Desbloqueia Entregáveis Executivos (PDF/CSV/Showcase), Engenharia Reversa de Concorrentes e Consistência Visual 360°.",
      instalado: isUpgradeUnlocked(db, workspaceRoot, "bonus"),
      agentes: bonusAgents,
      skills: [...UPGRADE_PACKAGE_SLUGS.bonus],
      comando_cli: "npm run instalar-upgrade -- --pacote bonus",
    },
    {
      id: "video",
      nome: "Criativo Video Studio (Remotion)",
      descricao:
        "Desbloqueia Diretor & Editor de Vídeo Remotion, Roteirista Faceless e Roteirista Talking Head para Reels 9:16.",
      instalado: isUpgradeUnlocked(db, workspaceRoot, "video"),
      agentes: videoAgents,
      skills: [...UPGRADE_PACKAGE_SLUGS.video],
      comando_cli: "npm run instalar-upgrade -- --pacote video",
    },
  ];
}

export function activateUpgradePackage(
  db: CriativoDatabase,
  workspaceRoot: string,
  pacote: "bonus" | "video"
): PacoteUpgradeInfo[] {
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

  return listUpgradePackages(db, workspaceRoot);
}

export function checkSkillPresentInWorkspace(workspaceRoot: string, slug: string): boolean {
  return existsSync(join(workspaceRoot, ".agents", "skills", slug, "SKILL.md"));
}
