#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function diagnosticar() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({ item: "Node.js >= 22", ok: nodeMajor >= 22, detalhe: process.versions.node });

  const envOk = existsSync(join(raiz, ".env"));
  checks.push({ item: "Arquivo .env local", ok: envOk, detalhe: envOk ? "Presente" : "Rode npm run configurar" });

  const daemonBuild = existsSync(join(raiz, "apps", "daemon", "dist", "server", "daemon-server.js"));
  const webBuild = existsSync(join(raiz, "apps", "web", "dist", "index.html"));
  checks.push({ item: "Build Daemon + Web", ok: daemonBuild && webBuild, detalhe: `daemon=${daemonBuild} web=${webBuild}` });

  const skillsDir = join(raiz, ".agents", "skills");
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  const base9 = [
    "planejar-conteudo",
    "copywriter-instagram",
    "criar-post-individual",
    "criar-carrossel",
    "criar-post-anuncio",
    "gerar-stories",
    "criar-identidade-visual",
    "configurar-instagram",
    "analise-metricas",
  ];
  const basePresentes = base9.filter((s) => existsSync(join(skillsDir, s, "SKILL.md")));
  checks.push({
    item: "Pacote Base (9 Skills)",
    ok: basePresentes.length === 9,
    detalhe: `${basePresentes.length}/9 instaladas`,
  });

  const bonusOk = ["gerador-de-entregaveis", "engenharia-reversa-concorrentes", "consistencia-personagem"].every((s) =>
    existsSync(join(skillsDir, s, "SKILL.md"))
  );
  const videoOk = ["criar-video-reels", "roteirista-faceless", "roteirista-talking-head"].every((s) =>
    existsSync(join(skillsDir, s, "SKILL.md"))
  );
  checks.push({ item: "Upgrade Bônus (3 agentes)", ok: bonusOk, detalhe: bonusOk ? "Instalado" : "Não instalado (opcional)" });
  checks.push({ item: "Upgrade Vídeo (3 agentes)", ok: videoOk, detalhe: videoOk ? "Instalado" : "Não instalado (opcional)" });

  const dbPath = process.env.CRIATIVO_DB_PATH || join(raiz, "apps", "daemon", "dados", "criativo.db");
  if (existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const agCount = db.prepare(`SELECT COUNT(*) as total FROM projecao_agentes;`).get();
      const secrets = db.prepare(`SELECT chave_nome FROM cofre_segredos;`).all().map((r) => r.chave_nome);
      const hasMeta =
        (secrets.includes("instagram_access_token") || secrets.includes("META_ACCESS_TOKEN")) &&
        (secrets.includes("instagram_business_account_id") || secrets.includes("META_IG_USER_ID"));
      checks.push({ item: "Banco SQLite (Agentes)", ok: Number(agCount?.total ?? 0) >= 9, detalhe: `${agCount?.total ?? 0} registros` });
      checks.push({ item: "Cofre Meta API", ok: hasMeta, detalhe: hasMeta ? "Configurado" : "Pendente em Conexões" });
    } finally {
      db.close();
    }
  } else {
    checks.push({ item: "Banco SQLite", ok: false, detalhe: "Será criado na 1ª execução do daemon" });
  }

  console.log("\n=== Diagnóstico do Criativo AI Studio Online ===");
  for (const c of checks) {
    console.log(`  ${c.ok ? "✅" : "⚠️"} ${c.item.padEnd(28, " ")} ${c.detalhe}`);
  }
  console.log(`  ℹ️  Total de skills detectadas em .agents/skills/: ${skills.length}\n`);
}

diagnosticar();
