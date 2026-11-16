#!/usr/bin/env node
import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destinoGlobal = join(homedir(), ".gemini", "config", "skills");

export async function instalarSkills({ diretorioRaiz = raiz, destino = destinoGlobal } = {}) {
  const skillsDir = join(diretorioRaiz, ".agents", "skills");
  let entradas = [];
  try {
    entradas = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    console.warn("Nenhuma pasta .agents/skills encontrada no workspace.");
    return { total: 0, nomes: [] };
  }

  const dirs = entradas.filter((e) => e.isDirectory()).map((e) => e.name);
  await mkdir(destino, { recursive: true });

  const instaladas = [];
  for (const nome of dirs) {
    const src = join(skillsDir, nome);
    try {
      await readFile(join(src, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const dst = join(destino, nome);
    await cp(src, dst, { recursive: true, force: true });
    instaladas.push(nome);
    console.log(`  ✅ /${nome}`);
  }

  console.log(`\n${instaladas.length} skill(s) sincronizada(s) em ${destino}.`);
  return { total: instaladas.length, nomes: instaladas };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  instalarSkills().catch((err) => {
    console.error(`Erro ao instalar skills: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
