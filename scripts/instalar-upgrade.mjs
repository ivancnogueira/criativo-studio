#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cp, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { cp as cpAsync, mkdir, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { instalarSkills } from "./instalar-skills.mjs";
import { homePadrao, interpretarPlataformas, opcao } from "./lib/plataformas.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PACOTES_UPGRADE = {
  bonus: {
    id: "bonus",
    nome: "Skills Agents Bônus",
    repoPadrao: "https://github.com/ivancnogueira/criativo-ai-studio-bonus.git",
    skills: [
      "gerador-de-entregaveis",
      "engenharia-reversa-concorrentes",
      "consistencia-personagem",
    ],
  },
  video: {
    id: "video",
    nome: "Criativo Video Studio",
    repoPadrao: "https://github.com/ivancnogueira/criativo-video-studio.git",
    skills: [
      "criar-video-reels",
      "roteirista-faceless",
      "roteirista-talking-head",
    ],
  },
};

function parseArgs(argv) {
  let pacote = "";
  let fonte = "";
  let dbPath = "";
  const escolha = opcao(argv, "--plataforma");
  const homeArg = opcao(argv, "--home");
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--pacote" && argv[i + 1]) {
      pacote = argv[++i].trim().toLowerCase();
    } else if (argv[i] === "--fonte" && argv[i + 1]) {
      fonte = argv[++i].trim();
    } else if (argv[i] === "--db" && argv[i + 1]) {
      dbPath = argv[++i].trim();
    }
  }
  return { pacote, fonte, dbPath, escolha, homeArg };
}

async function encontrarPastaSkill(origemBase, slug) {
  const candidatos = [
    join(origemBase, slug),
    join(origemBase, "skill", slug),
    join(origemBase, "skills", slug),
    join(origemBase, ".agents", "skills", slug),
  ];
  for (const cand of candidatos) {
    if (existsSync(join(cand, "SKILL.md"))) {
      return cand;
    }
  }
  return null;
}

export async function instalarPacoteUpgrade({
  pacoteId,
  fonte,
  diretorioRaiz = raiz,
  dbPath,
  plataformas,
  home,
} = {}) {
  const def = PACOTES_UPGRADE[pacoteId];
  if (!def) {
    throw new Error(`Pacote de upgrade inválido: '${pacoteId}'. Use 'bonus' ou 'video'.`);
  }

  let origemLocal = fonte ? resolve(diretorioRaiz, fonte) : "";
  let tempDir = null;

  try {
    if (fonte && (/^https?:\/\//i.test(fonte) || /^git@/i.test(fonte))) {
      tempDir = mkdtempSync(join(tmpdir(), `criativo-upgrade-${pacoteId}-`));
      execFileSync("git", ["clone", "--depth", "1", fonte, tempDir], { stdio: "inherit" });
      origemLocal = tempDir;
    } else if (!fonte) {
      const irmaoBonus = resolve(diretorioRaiz, "..", "skills-agents-bonus");
      const irmaoVideo = resolve(diretorioRaiz, "..", "criativo-video-studio");
      const fallbackIrmao = pacoteId === "bonus" ? irmaoBonus : irmaoVideo;
      if (existsSync(fallbackIrmao)) {
        origemLocal = fallbackIrmao;
      } else {
        tempDir = mkdtempSync(join(tmpdir(), `criativo-upgrade-${pacoteId}-`));
        execFileSync("git", ["clone", "--depth", "1", def.repoPadrao, tempDir], { stdio: "inherit" });
        origemLocal = tempDir;
      }
    }

    if (!origemLocal || !existsSync(origemLocal)) {
      throw new Error(`Fonte do pacote '${pacoteId}' não encontrada em: ${fonte || def.repoPadrao}`);
    }

    const destinoSkills = join(diretorioRaiz, ".agents", "skills");
    await mkdir(destinoSkills, { recursive: true });

    const instaladas = [];
    for (const slug of def.skills) {
      const pastaSkill = await encontrarPastaSkill(origemLocal, slug);
      if (!pastaSkill) continue;
      await cpAsync(pastaSkill, join(destinoSkills, slug), { recursive: true, force: true });
      instaladas.push(slug);
    }

    if (instaladas.length === 0) {
      throw new Error(`Nenhuma skill esperada (${def.skills.join(", ")}) encontrada na fonte informada.`);
    }

    if (pacoteId === "video") {
      await mkdir(join(diretorioRaiz, "conteudos", "audios"), { recursive: true });
      await mkdir(join(diretorioRaiz, "conteudos", "gravacoes"), { recursive: true });
      await mkdir(join(diretorioRaiz, "saidas", "videos"), { recursive: true });
      const moduloVideo = join(origemLocal, "modulo-video");
      if (existsSync(moduloVideo)) {
        await cpAsync(moduloVideo, join(diretorioRaiz, "video"), { recursive: true, force: true });
      }
    }

    // Sincroniza no banco SQLite se já inicializado
    const resolvedDbPath =
      dbPath ||
      process.env.CRIATIVO_DB_PATH ||
      join(diretorioRaiz, "apps", "daemon", "dados", "criativo.db");

    if (existsSync(resolvedDbPath)) {
      const db = new DatabaseSync(resolvedDbPath);
      try {
        db.exec(
          `CREATE TABLE IF NOT EXISTS projecao_studio_config (
             chave TEXT PRIMARY KEY,
             valor_json TEXT NOT NULL,
             atualizado_em TEXT NOT NULL
           );`
        );
        const row = db
          .prepare(`SELECT valor_json FROM projecao_studio_config WHERE chave = 'upgrades_instalados';`)
          .get();
        let atuais = [];
        try {
          atuais = row ? JSON.parse(row.valor_json) : [];
        } catch {
          atuais = [];
        }
        const conjunto = Array.from(new Set([...(Array.isArray(atuais) ? atuais : []), pacoteId]));
        db.prepare(
          `INSERT INTO projecao_studio_config (chave, valor_json, atualizado_em)
           VALUES ('upgrades_instalados', ?, ?)
           ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em;`
        ).run(JSON.stringify(conjunto), new Date().toISOString());
      } finally {
        db.close();
      }
    }

    await instalarSkills({ diretorioRaiz, plataformas, home });

    console.log(`\n✅ Upgrade '${def.nome}' instalado com sucesso (${instaladas.join(", ")}).`);
    return { ok: true, pacote: pacoteId, skills: instaladas };
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignora limpeza temporária
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pacote, fonte, dbPath, escolha, homeArg } = parseArgs(process.argv.slice(2));
  if (!pacote) {
    console.log(
      "Uso: npm run instalar-upgrade -- --pacote <bonus|video> [--fonte <caminho_ou_git>] [--plataforma <claude|codex|antigravity|todas>]"
    );
    process.exitCode = 1;
  } else {
    const home = homeArg ? resolve(homeArg) : homePadrao();
    const plataformas = escolha ? interpretarPlataformas(escolha, home) : undefined;
    instalarPacoteUpgrade({
      pacoteId: pacote,
      fonte: fonte || undefined,
      dbPath: dbPath || undefined,
      plataformas,
      home,
    }).catch((err) => {
      console.error(`Falha ao instalar upgrade: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
  }
}
