#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const RATCHETS_PATH = path.join(ROOT_DIR, ".planning", "quality-ratchets.json");

if (!fs.existsSync(RATCHETS_PATH)) {
  console.error("ERRO: .planning/quality-ratchets.json não encontrado.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(RATCHETS_PATH, "utf8"));
const violations = [];

for (const [relPath, maxLines] of Object.entries(config.modularizedMaxLines ?? {})) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) {
    violations.push(`Arquivo monitorado ausente: ${relPath}`);
    continue;
  }
  const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/).length;
  if (lines > Number(maxLines)) {
    violations.push(
      `Monolito voltou a crescer: ${relPath} tem ${lines} linhas (teto permitido: ${maxLines})`,
    );
  }
}

let tsSuppressions = 0;
let asAnyCount = 0;
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "release-dist", ".git", "dados", "logs", "tests"]);

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      const content = fs.readFileSync(full, "utf8");
      tsSuppressions += (content.match(/@ts-(ignore|expect-error|nocheck)/g) ?? []).length;
      asAnyCount += (content.match(/\bas\s+any\b/g) ?? []).length;
    }
  }
}

scanDir(path.join(ROOT_DIR, "apps"));
scanDir(path.join(ROOT_DIR, "packages"));

if (tsSuppressions > Number(config.maxTsSuppressions ?? 0)) {
  violations.push(
    `Regressão de tipagem: ${tsSuppressions} @ts-ignore/@ts-expect-error/@ts-nocheck encontrados (máx ${config.maxTsSuppressions})`,
  );
}
if (asAnyCount > Number(config.maxAsAny ?? 0)) {
  violations.push(
    `Regressão de tipagem: ${asAnyCount} ocorrências de "as any" encontradas (máx ${config.maxAsAny})`,
  );
}

if (violations.length > 0) {
  console.error("check:ratchets — FALHOU:");
  for (const v of violations) {
    console.error(`  x ${v}`);
  }
  process.exit(1);
}

console.log(
  `check:ratchets — OK (monolitos dentro do teto, @ts-* = ${tsSuppressions}/${config.maxTsSuppressions}, as any = ${asAnyCount}/${config.maxAsAny}).`,
);
