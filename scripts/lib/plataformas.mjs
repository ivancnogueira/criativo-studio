// Onde cada plataforma procura skills globais (comandos de barra e catálogo de agentes).
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function resolveCodexHome(home) {
  if (resolve(home) === resolve(homePadrao()) && process.env.CODEX_HOME) {
    return resolve(process.env.CODEX_HOME);
  }
  return join(home, ".codex");
}

export const PLATAFORMAS = {
  claude: {
    nome: "Claude Code",
    sinal: (home) => [join(home, ".claude")],
    destinos: (home) => [join(home, ".claude", "skills")],
  },
  codex: {
    nome: "Codex",
    sinal: (home) => [resolveCodexHome(home)],
    destinos: (home) => [join(resolveCodexHome(home), "skills")],
  },
  antigravity: {
    nome: "Antigravity",
    sinal: (home) => [join(home, ".gemini")],
    // config/skills é a pasta principal no Windows; antigravity/skills entra quando existir e for distinta
    destinos: (home) => [
      join(home, ".gemini", "config", "skills"),
      join(home, ".gemini", "antigravity", "skills"),
    ],
  },
};

export const homePadrao = () => homedir();

export function opcao(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}

export function detectar(home = homePadrao()) {
  return Object.keys(PLATAFORMAS).filter((id) =>
    PLATAFORMAS[id].sinal(home).some((p) => existsSync(p))
  );
}

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

// Pastas de destino de uma plataforma, sem duplicar atalhos físicos.
// Destino secundário só entra se já existir; o primeiro é criado se faltar.
export function destinosDe(id, home = homePadrao()) {
  const def = PLATAFORMAS[id];
  if (!def) {
    throw new Error(`Plataforma desconhecida: ${id}`);
  }
  const vistos = new Set();
  const saida = [];
  def.destinos(home).forEach((d, i) => {
    if (i > 0 && !existsSync(d)) return;
    const r = real(d);
    if (vistos.has(r)) return;
    vistos.add(r);
    saida.push(d);
  });
  return saida;
}

export function interpretarPlataformas(valor, home = homePadrao()) {
  if (!valor) {
    const detectadas = detectar(home);
    return detectadas.length > 0 ? detectadas : ["antigravity"];
  }
  const normalizado = String(valor).trim().toLowerCase();
  if (normalizado === "todas" || normalizado === "all") {
    return Object.keys(PLATAFORMAS);
  }
  const ids = normalizado
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ruins = ids.filter((id) => !PLATAFORMAS[id]);
  if (ruins.length > 0) {
    throw new Error(
      `Plataforma desconhecida: ${ruins.join(", ")}. Opções válidas: ${Object.keys(PLATAFORMAS).join(", ")}, todas`
    );
  }
  return [...new Set(ids)];
}
