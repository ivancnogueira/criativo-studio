#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  destinosDe,
  homePadrao,
  interpretarPlataformas,
  opcao,
  PLATAFORMAS,
} from "./lib/plataformas.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARCA = ".instalado-por.json";
const PRODUTO_SLUG = "criativo-studio-online";

function lerMetaProduto(diretorioRaiz) {
  try {
    const raw = readFileSync(join(diretorioRaiz, "produto.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
      slug: parsed.slug || PRODUTO_SLUG,
      versao: parsed.versao || "1.0.0",
    };
  } catch {
    return { slug: PRODUTO_SLUG, versao: "1.0.0" };
  }
}

async function lerMarca(pasta) {
  try {
    const raw = await readFile(join(pasta, MARCA), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listarSkillsValidas(diretorioRaiz) {
  const skillsDir = join(diretorioRaiz, ".agents", "skills");
  let entradas = [];
  try {
    entradas = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    console.warn("Nenhuma pasta .agents/skills encontrada no workspace.");
    return { skillsDir, nomes: [] };
  }

  const dirs = entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const validas = [];
  for (const nome of dirs) {
    try {
      await readFile(join(skillsDir, nome, "SKILL.md"), "utf8");
      validas.push(nome);
    } catch {
      // ignora diretórios sem SKILL.md
    }
  }
  return { skillsDir, nomes: validas };
}

async function copiarParaDestino({ skillsDir, nomes, pastaDestino, metaProduto, diretorioRaiz }) {
  await mkdir(pastaDestino, { recursive: true });
  const instaladas = [];
  const puladas = [];

  for (const nome of nomes) {
    const src = join(skillsDir, nome);
    const dst = join(pastaDestino, nome);
    const marcaExistente = existsSync(dst) ? await lerMarca(dst) : null;
    if (marcaExistente?.produto && marcaExistente.produto !== metaProduto.slug) {
      console.log(`  ⚠️ /${nome} pulada (pertence a outro produto: ${marcaExistente.produto})`);
      puladas.push(dst);
      continue;
    }

    await cp(src, dst, { recursive: true, force: true });
    await writeFile(
      join(dst, MARCA),
      JSON.stringify(
        {
          produto: metaProduto.slug,
          versao: metaProduto.versao,
          origem: diretorioRaiz,
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    instaladas.push(nome);
    console.log(`  ✅ /${nome}`);
  }

  return { instaladas, puladas };
}

export async function instalarSkills({
  diretorioRaiz = raiz,
  destino,
  plataformas,
  home = homePadrao(),
} = {}) {
  const { skillsDir, nomes } = await listarSkillsValidas(diretorioRaiz);
  if (nomes.length === 0) {
    return { total: 0, nomes: [], plataformas: [], destinos: [], puladas: [] };
  }

  const metaProduto = lerMetaProduto(diretorioRaiz);

  // Retrocompatibilidade para chamadas diretas com `destino` explícito (ex.: testes)
  if (destino) {
    const { instaladas, puladas } = await copiarParaDestino({
      skillsDir,
      nomes,
      pastaDestino: destino,
      metaProduto,
      diretorioRaiz,
    });
    console.log(`\n${instaladas.length} skill(s) sincronizada(s) em ${destino}.`);
    return {
      total: instaladas.length,
      nomes: instaladas,
      plataformas: ["custom"],
      destinos: [destino],
      puladas,
    };
  }

  const ids = plataformas ?? interpretarPlataformas(null, home);
  const destinosUsados = [];
  const puladasTotais = [];
  const nomesInstalados = new Set();

  for (const id of ids) {
    const destinos = destinosDe(id, home);
    for (const pastaDestino of destinos) {
      console.log(`\n${PLATAFORMAS[id].nome} → ${pastaDestino}`);
      const { instaladas, puladas } = await copiarParaDestino({
        skillsDir,
        nomes,
        pastaDestino,
        metaProduto,
        diretorioRaiz,
      });
      instaladas.forEach((n) => nomesInstalados.add(n));
      puladasTotais.push(...puladas);
      destinosUsados.push(pastaDestino);
    }
  }

  console.log(
    `\n${nomesInstalados.size} skill(s) sincronizada(s) em ${ids.map((id) => PLATAFORMAS[id].nome).join(", ")}.`
  );
  return {
    total: nomesInstalados.size,
    nomes: [...nomesInstalados],
    plataformas: ids,
    destinos: destinosUsados,
    puladas: puladasTotais,
  };
}

export async function removerSkills({
  diretorioRaiz = raiz,
  plataformas,
  home = homePadrao(),
} = {}) {
  const metaProduto = lerMetaProduto(diretorioRaiz);
  const ids = plataformas ?? Object.keys(PLATAFORMAS);
  const removidas = [];

  for (const id of ids) {
    for (const pastaDestino of destinosDe(id, home)) {
      if (!existsSync(pastaDestino)) continue;
      const entradas = await readdir(pastaDestino, { withFileTypes: true });
      for (const e of entradas) {
        if (!e.isDirectory()) continue;
        const alvo = join(pastaDestino, e.name);
        const marca = await lerMarca(alvo);
        if (marca?.produto !== metaProduto.slug) continue;
        await rm(alvo, { recursive: true, force: true });
        removidas.push(alvo);
        console.log(`  🗑️ Removida ${alvo}`);
      }
    }
  }

  if (removidas.length === 0) {
    console.log("Nenhuma skill instalada por este produto foi encontrada para remoção.");
  }
  return { removidas };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const homeArg = opcao(args, "--home");
  const home = homeArg ? resolve(homeArg) : homePadrao();
  const escolha = opcao(args, "--plataforma");
  const plataformas = escolha ? interpretarPlataformas(escolha, home) : undefined;

  const acao = args.includes("--remover")
    ? removerSkills({ home, plataformas })
    : instalarSkills({ home, plataformas });

  acao.catch((err) => {
    console.error(`Erro ao gerenciar skills: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
