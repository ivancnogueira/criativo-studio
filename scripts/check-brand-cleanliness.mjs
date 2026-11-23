#!/usr/bin/env node
/**
 * Guardrail anti-regressão de marca CriativoOS.
 * Garante que referências às marcas antigas ("Criativo AI Studio", "Criativo Studio",
 * "Criativo OS" com espaço) não voltem a aparecer no código-fonte de produto.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

const SCAN_ROOTS = [
  "apps/web/src",
  "apps/daemon/src",
  "apps/desktop/src",
  "packages",
  ".agents",
  "scripts",
  "templates",
];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".html",
  ".css",
  ".yml",
  ".yaml",
  ".sh",
  ".py",
  ".service",
]);

const FORBIDDEN_BRAND_RE = /criativo\s+ai\s+studio|criativo\s+studio|\bcriativo\s+os\b/gi;
const SKIP_RELATIVE_PATHS = new Set(["scripts/check-brand-cleanliness.mjs"]);

function walkFiles(dirPath, out) {
  for (const entry of readdirSync(dirPath)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dirPath, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkFiles(full, out);
    } else if (TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) {
      out.push(full);
    }
  }
}

const files = [];
for (const relRoot of SCAN_ROOTS) {
  walkFiles(resolve(rootDir, relRoot), files);
}

const violations = [];
for (const filePath of files) {
  const rel = relative(rootDir, filePath).replaceAll("\\", "/");
  if (SKIP_RELATIVE_PATHS.has(rel)) continue;
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    FORBIDDEN_BRAND_RE.lastIndex = 0;
    const m = FORBIDDEN_BRAND_RE.exec(lines[i]);
    if (m) {
      violations.push(`${rel}:${i + 1} -> "${m[0]}"`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    `[check:brand] Encontrada(s) ${violations.length} referencia(s) residual(is) à marca antiga:\n` +
      violations.map((v) => `  - ${v}`).join("\n"),
  );
  process.exit(1);
}

console.log(`check:brand — OK (${files.length} arquivos escaneados, 0 referências à marca antiga).`);
