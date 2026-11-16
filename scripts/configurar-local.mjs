#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { instalarSkills } from "./instalar-skills.mjs";
import { homePadrao, interpretarPlataformas, opcao } from "./lib/plataformas.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function garantirPasta(caminho) {
  await mkdir(caminho, { recursive: true });
}

async function copiarTemplateSeAusente(origem, destino) {
  if (existsSync(destino)) return false;
  await garantirPasta(dirname(destino));
  await copyFile(origem, destino);
  return true;
}

function lerVersaoProduto(diretorioRaiz) {
  try {
    const raw = readFileSync(join(diretorioRaiz, "produto.json"), "utf8");
    return JSON.parse(raw).versao || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

export async function configurarLocal({
  diretorioRaiz = raiz,
  semSkills = false,
  plataformas,
  home = homePadrao(),
  semBuild = process.argv.includes("--sem-build"),
  forcarBuild = process.argv.includes("--forcar-build"),
} = {}) {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    throw new Error(`Node.js >= 22 é obrigatório (versão detectada: ${process.versions.node}).`);
  }

  const pastas = [
    "conteudos",
    "conteudos/relatorios",
    "recursos/brand",
    "recursos/fotos",
    "recursos/logos",
    "recursos/referencias",
    "recursos/referencias/carrosseis",
    "recursos/referencias/individual",
    "recursos/referencias/anuncios",
    "recursos/referencias/stories",
    "recursos/personagens",
    "recursos/uploads",
    "saidas/artes",
    "saidas/carrosseis",
    "saidas/posts-individuais",
    "saidas/stories",
    "previas",
    "logs",
    "apps/daemon/dados",
  ];
  await Promise.all(pastas.map((p) => garantirPasta(join(diretorioRaiz, p))));

  const templates = [
    ["templates/marca/perfil-da-marca.md", "conteudos/perfil-da-marca.md"],
    ["templates/marca/identidade-visual.yml", "conteudos/identidade-visual.yml"],
    ["templates/marca/estado-do-studio.yml", "conteudos/estado-do-studio.yml"],
    ["templates/marca/brandbook.md", "recursos/brand/brandbook.md"],
    ["templates/marca/design-system.md", "recursos/brand/design-system.md"],
    ["templates/marca/tokens.css", "recursos/brand/tokens.css"],
  ];

  let templatesCriados = 0;
  for (const [srcRel, dstRel] of templates) {
    const src = join(diretorioRaiz, srcRel);
    const dst = join(diretorioRaiz, dstRel);
    if (existsSync(src)) {
      const criou = await copiarTemplateSeAusente(src, dst);
      if (criou) templatesCriados += 1;
    }
  }

  // Cria .env se não existir e gera CRIATIVO_VAULT_KEY segura (sem quebrar cofre pré-existente)
  const envPath = join(diretorioRaiz, ".env");
  const envExamplePath = join(diretorioRaiz, ".env.example");
  const dbPath = join(diretorioRaiz, "apps", "daemon", "dados", "criativo.db");
  let cofreExistente = false;
  if (existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const row = db.prepare(`SELECT COUNT(*) as total FROM cofre_segredos;`).get();
      cofreExistente = Number(row?.total ?? 0) > 0;
      db.close();
    } catch {
      cofreExistente = false;
    }
  }

  if (!existsSync(envPath)) {
    const baseEnv = existsSync(envExamplePath)
      ? await readFile(envExamplePath, "utf8")
      : "NODE_ENV=development\nPORT=3000\nHOST=127.0.0.1\nCRIATIVO_VAULT_KEY=\n";
    if (cofreExistente) {
      await writeFile(envPath, baseEnv, "utf8");
      console.log("  ⚠️ .env criado preservando CRIATIVO_VAULT_KEY vazia por haver cofre_segredos pré-existente.");
    } else {
      const key = randomBytes(32).toString("hex");
      const filled = baseEnv.includes("CRIATIVO_VAULT_KEY=")
        ? baseEnv.replace(/CRIATIVO_VAULT_KEY=.*/g, `CRIATIVO_VAULT_KEY=${key}`)
        : `${baseEnv}\nCRIATIVO_VAULT_KEY=${key}\n`;
      await writeFile(envPath, filled, "utf8");
      console.log("  ✅ .env criado com chave mestra CRIATIVO_VAULT_KEY segura.");
    }
  } else {
    console.log("  ✅ .env preservado (nenhuma credencial alterada).");
  }

  let skillsResult = { total: 0, nomes: [], plataformas: [], destinos: [] };
  if (!semSkills) {
    console.log("\nSincronizando skills do pacote instalado:");
    skillsResult = await instalarSkills({ diretorioRaiz, plataformas, home });
  }

  const daemonDistOk = existsSync(join(diretorioRaiz, "apps", "daemon", "dist", "server", "daemon-server.js"));
  const webDistOk = existsSync(join(diretorioRaiz, "apps", "web", "dist", "index.html"));

  if (!semBuild && (forcarBuild || !daemonDistOk || !webDistOk)) {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    console.log("\nCompilando daemon e Cockpit Web (primeira execução)...");
    execFileSync(npmCmd, ["run", "build"], { cwd: diretorioRaiz, stdio: "inherit", shell: process.platform === "win32" });
    execFileSync(npmCmd, ["run", "build", "--workspace=apps/web"], {
      cwd: diretorioRaiz,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }

  // Registra recibo local da instalação (pasta logs/ é ignorada pelo Git)
  const instalacaoResumo = {
    em: new Date().toISOString(),
    versao: lerVersaoProduto(diretorioRaiz),
    plataformas: skillsResult.plataformas,
    destinos: skillsResult.destinos,
    totalSkills: skillsResult.total,
    templatesCriados,
  };
  await writeFile(
    join(diretorioRaiz, "logs", "instalacao.json"),
    JSON.stringify(instalacaoResumo, null, 2) + "\n",
    "utf8"
  );

  console.log(`\n✅ Ambiente local preparado (${templatesCriados} template(s) inicializado(s)).`);
  console.log("Próximos passos:");
  console.log("  1. npm start   (inicia Daemon + Cockpit Web em http://127.0.0.1:3000)");
  console.log("  2. npm run diagnosticar");
  console.log("  3. Acesse http://127.0.0.1:3000 para concluir o onboarding.\n");

  return {
    ok: true,
    templatesCriados,
    skillsInstaladas: skillsResult.total,
    plataformas: skillsResult.plataformas,
    destinos: skillsResult.destinos,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const homeArg = opcao(args, "--home");
  const home = homeArg ? resolve(homeArg) : homePadrao();
  const escolha = opcao(args, "--plataforma");
  const plataformas = escolha ? interpretarPlataformas(escolha, home) : undefined;

  configurarLocal({ home, plataformas }).catch((err) => {
    console.error(`Falha na configuração local: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
