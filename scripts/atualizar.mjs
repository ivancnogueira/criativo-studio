#!/usr/bin/env node
// Atualiza o CriativoOS sem tocar nos dados da instância do cliente.
// Uso:
//   npm run atualizar                                    (clone Git: git pull --ff-only)
//   npm run atualizar -- --zip <arquivo.zip>             (pacote ZIP baixado)
//   npm run atualizar -- --pasta <caminho>               (pacote já extraído)
//   Opções: --simular, --forcar, --sem-instalar, --plataforma <claude|codex|antigravity|todas>

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homePadrao, interpretarPlataformas, opcao } from "./lib/plataformas.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DADOS_DA_INSTANCIA =
  ".env, apps/daemon/dados/ (SQLite + Cofre), conteudos/, recursos/, saidas/, previas/, logs/, video/ e skills de upgrade";

const SKILLS_UPGRADE = new Set([
  "gerador-de-entregaveis",
  "engenharia-reversa-concorrentes",
  "consistencia-personagem",
  "criar-video-reels",
  "roteirista-faceless",
  "roteirista-talking-head",
]);

const PREFIXOS_IGNORADOS = [
  ".git/",
  ".planning/",
  ".documentos/",
  "node_modules/",
  "dados/",
  "apps/daemon/dados/",
  "apps/daemon/dist/",
  "apps/web/dist/",
  "packages/contracts/dist/",
  "packages/whatsapp/dist/",
  "dist/",
  "build/",
  ".cache/",
  "saidas/",
  "previas/",
  "logs/",
  "runtime/",
  "conteudos/",
  "recursos/fotos/",
  "recursos/logos/",
  "recursos/referencias/",
  "recursos/personagens/",
  "recursos/brand/",
  "recursos/uploads/",
  "video/",
];

export function pertenceAoProduto(relPath) {
  const norm = relPath.replaceAll("\\", "/");
  if (!norm) return false;
  if (norm === ".env" || norm.startsWith(".env.") && norm !== ".env.example") return false;
  if (norm.endsWith(".db") || norm.endsWith(".db-wal") || norm.endsWith(".db-shm") || norm.endsWith(".tsbuildinfo")) {
    return false;
  }
  if (PREFIXOS_IGNORADOS.some((p) => norm === p.slice(0, -1) || norm.startsWith(p))) {
    return false;
  }
  if (norm.startsWith(".agents/skills/")) {
    const slug = norm.slice(".agents/skills/".length).split("/")[0];
    if (SKILLS_UPGRADE.has(slug)) return false;
  }
  return true;
}

export function listarArquivosProduto(base) {
  const saida = [];
  function caminhar(dir, prefixo) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefixo ? `${prefixo}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!pertenceAoProduto(`${rel}/`)) continue;
        caminhar(join(dir, entry.name), rel);
      } else if (pertenceAoProduto(rel)) {
        saida.push(rel);
      }
    }
  }
  caminhar(base, "");
  return saida.sort();
}

const versaoNum = (v) => String(v || "0").split(".").map((n) => parseInt(n, 10) || 0);

export function compararVersoes(a, b) {
  const x = versaoNum(a);
  const y = versaoNum(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) {
      return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
    }
  }
  return 0;
}

function lerMeta(dir) {
  const arq = join(dir, "produto.json");
  if (existsSync(arq)) {
    const json = JSON.parse(readFileSync(arq, "utf8"));
    return { nome: json.nome || "CriativoOS", versao: json.versao || "1.0.0" };
  }
  const pkg = join(dir, "package.json");
  if (existsSync(pkg)) {
    const json = JSON.parse(readFileSync(pkg, "utf8"));
    return { nome: json.name || "CriativoOS", versao: json.version || "1.0.0" };
  }
  throw new Error(`Diretório inválido: produto.json e package.json ausentes em ${dir}`);
}

export function localizarRaiz(dir) {
  if (existsSync(join(dir, "produto.json"))) return dir;
  const sub = readdirSync(dir, { withFileTypes: true }).filter(
    (d) => d.isDirectory() && existsSync(join(dir, d.name, "produto.json"))
  );
  if (sub.length === 1) return join(dir, sub[0].name);
  throw new Error("Este arquivo não parece um pacote do CriativoOS (produto.json ausente).");
}

function mesmoConteudo(a, b) {
  const x = readFileSync(a);
  const y = readFileSync(b);
  return x.length === y.length && x.equals(y);
}

export function planejar(origem, base = raiz, { forcar = false } = {}) {
  const novo = lerMeta(origem);
  const atual = lerMeta(base);
  const cmp = compararVersoes(novo.versao, atual.versao);
  if (!forcar && cmp < 0) {
    throw new Error(
      `O pacote (${novo.versao}) é mais antigo que o instalado (${atual.versao}). Use --forcar se for intencional.`
    );
  }
  if (!forcar && cmp === 0) {
    throw new Error(`Você já está na versão ${atual.versao}. Use --forcar para reaplicar os arquivos do produto.`);
  }

  const doPacote = listarArquivosProduto(origem);
  const noPacote = new Set(doPacote);
  const novos = [];
  const alterados = [];
  let iguais = 0;

  for (const rel of doPacote) {
    const dst = join(base, rel);
    if (!existsSync(dst)) novos.push(rel);
    else if (!mesmoConteudo(join(origem, rel), dst)) alterados.push(rel);
    else iguais += 1;
  }

  const obsoletos = listarArquivosProduto(base).filter((rel) => !noPacote.has(rel));
  return { de: atual.versao, para: novo.versao, origem, novos, alterados, iguais, obsoletos };
}

export function aplicar(plano, base = raiz) {
  for (const rel of [...plano.novos, ...plano.alterados]) {
    if (!pertenceAoProduto(rel)) {
      throw new Error(`Recusado por segurança: ${rel} não pertence aos arquivos distribuídos do produto.`);
    }
    const dst = join(base, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(join(plano.origem, rel), dst, { force: true });
  }
  return plano.novos.length + plano.alterados.length;
}

// Compara apenas nomes de variáveis (nunca valores) entre .env.example e .env
export function chavesNovasDoEnv(base = raiz) {
  const lerChaves = (arq) => {
    try {
      return readFileSync(join(base, arq), "utf8")
        .split(/\r?\n/)
        .map((linha) => /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(linha)?.[1])
        .filter(Boolean);
    } catch {
      return null;
    }
  };
  const modelo = lerChaves(".env.example");
  const meu = lerChaves(".env");
  if (!modelo || !meu) return [];
  return [...new Set(modelo)].filter((nome) => !meu.includes(nome));
}

function extrairZip(zipPath, destino) {
  const tentativas = [];
  if (process.platform === "win32") {
    tentativas.push([join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", zipPath, "-C", destino]]);
  } else {
    tentativas.push(["unzip", ["-q", "-o", zipPath, "-d", destino]]);
  }
  tentativas.push(["tar", ["-xf", zipPath, "-C", destino]]);

  for (const [cmd, args] of tentativas) {
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    if (r.status === 0) return;
  }
  throw new Error("Não consegui extrair o ZIP. Verifique se 'tar' ou 'unzip' está disponível.");
}

function rodarGit(args, base = raiz) {
  return spawnSync("git", args, {
    cwd: base,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: 180000,
  });
}

function atualizarPorGit(base = raiz) {
  const alterados = (rodarGit(["status", "--porcelain", "--untracked-files=no"], base).stdout || "").trim();
  if (alterados) {
    throw new Error(
      `Existem arquivos do produto modificados localmente, e eles não serão sobrescritos:\n${alterados}\n` +
        `Salve ou reverta antes (ex.: git stash). Seus dados (${DADOS_DA_INSTANCIA}) não são afetados.`
    );
  }
  const antes = lerMeta(base).versao;
  const pull = rodarGit(["pull", "--ff-only"], base);
  const saida = ((pull.stdout || "") + (pull.stderr || "")).trim();
  if (pull.status !== 0) {
    const erroAuth = /could not read|Authentication|denied|403|404|terminal prompts/i.test(saida);
    throw new Error(
      "O git pull não conseguiu atualizar.\n" +
        saida +
        (erroAuth
          ? "\nFaça login no Git/GitHub ou baixe o ZIP atualizado e rode: npm run atualizar -- --zip <arquivo.zip>."
          : "")
    );
  }
  console.log(saida || "git pull concluído.");
  return { de: antes, para: lerMeta(base).versao };
}

function imprimirRelatorio(plano, simular) {
  console.log(`\nVersão instalada: ${plano.de}   Pacote: ${plano.para}`);
  console.log(
    `${simular ? "Mudaria" : "Atualizados"}: ${plano.alterados.length} alterado(s), ${plano.novos.length} novo(s), ${plano.iguais} igual(is).`
  );
  for (const rel of plano.novos) console.log(`  + ${rel}`);
  for (const rel of plano.alterados) console.log(`  ~ ${rel}`);
  if (plano.obsoletos.length > 0) {
    console.log("\nArquivos antigos do produto (mantidos localmente; você pode remover se desejar):");
    for (const rel of plano.obsoletos) console.log(`  - ${rel}`);
  }
  console.log(`\nPreservados integralmente: ${DADOS_DA_INSTANCIA}.`);
}

export async function principal(args = process.argv.slice(2), base = raiz) {
  const simular = args.includes("--simular");
  const forcar = args.includes("--forcar");
  const semInstalar = args.includes("--sem-instalar");
  const zip = opcao(args, "--zip");
  const pasta = opcao(args, "--pasta");
  const escolhaPlataforma = opcao(args, "--plataforma");
  const homeArg = opcao(args, "--home");
  const home = homeArg ? resolve(homeArg) : homePadrao();
  const temGit = existsSync(join(base, ".git"));

  let versoes;
  if (!zip && !pasta) {
    if (!temGit) {
      throw new Error(
        "Esta pasta não é um clone do Git. Informe o ZIP atualizado:\n  npm run atualizar -- --zip <caminho-do-arquivo.zip>"
      );
    }
    if (simular) {
      throw new Error("--simular aplica-se apenas a --zip ou --pasta. No Git use: git fetch && git log HEAD..origin/main.");
    }
    versoes = atualizarPorGit(base);
  } else {
    const temp = mkdtempSync(join(tmpdir(), "criativo-atualizar-"));
    try {
      let origem;
      if (pasta) {
        origem = localizarRaiz(resolve(pasta));
      } else {
        const arqZip = resolve(zip);
        if (!existsSync(arqZip)) throw new Error(`Arquivo ZIP não encontrado: ${arqZip}`);
        const aberto = join(temp, "pacote");
        mkdirSync(aberto, { recursive: true });
        extrairZip(arqZip, aberto);
        origem = localizarRaiz(aberto);
      }
      const plano = planejar(origem, base, { forcar });
      imprimirRelatorio(plano, simular);
      if (simular) return { ok: true, simulado: true, ...plano };
      aplicar(plano, base);
      versoes = { de: plano.de, para: plano.para };
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }

  if (!semInstalar) {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    console.log("\nReinstalando dependências (se necessário), recompilando e sincronizando skills...");
    const instArgs = ["scripts/configurar-local.mjs", "--forcar-build"];
    if (escolhaPlataforma) {
      interpretarPlataformas(escolhaPlataforma, home); // valida entrada antes de repassar
      instArgs.push("--plataforma", escolhaPlataforma);
    }
    if (homeArg) instArgs.push("--home", home);

    const depRun = spawnSync(npmCmd, ["install"], { cwd: base, stdio: "inherit", shell: process.platform === "win32" });
    if (depRun.status !== 0) {
      throw new Error("Falha ao atualizar dependências npm. Rode 'npm install' manualmente.");
    }
    const cfgRun = spawnSync(process.execPath, instArgs, { cwd: base, stdio: "inherit" });
    if (cfgRun.status !== 0) {
      throw new Error("Arquivos atualizados, mas a sincronização final falhou. Rode 'npm run instalar'.");
    }
  }

  const novas = chavesNovasDoEnv(base);
  if (novas.length > 0) {
    console.log(`\nNovas chaves opcionais disponíveis no .env.example (nomes apenas): ${novas.join(", ")}.`);
  }

  console.log(`\n✅ Atualização concluída (${versoes.de} → ${versoes.para}). Reinicie o daemon se estiver rodando.`);
  return { ok: true, ...versoes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal(process.argv.slice(2)).catch((err) => {
    console.error(`Erro ao atualizar: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
