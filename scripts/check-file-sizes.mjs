#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'file-size-baseline.json');

const HARD_MAX_LINES = 750;
const SOFT_TARGET_LINES = 500;
const TARGET_ROOTS = ['apps', 'packages'];
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.cts']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'release-dist', '.git', 'dados', 'logs']);

function walkSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Ignora suites de testes no teto rigido apenas se nao estiverem em src/
      if (entry.name === 'tests' || entry.name === 'scripts') continue;
      walkSourceFiles(fullPath, out);
    } else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
  return out;
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function toPosixRel(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

const args = new Set(process.argv.slice(2));
const writeBaseline = args.has('--write-baseline');

const files = [];
for (const root of TARGET_ROOTS) {
  walkSourceFiles(path.join(ROOT_DIR, root), files);
}

const currentCounts = new Map();
for (const file of files) {
  const rel = toPosixRel(file);
  currentCounts.set(rel, countLines(file));
}

if (writeBaseline) {
  const legacyAboveLimit = {};
  const sorted = [...currentCounts.entries()]
    .filter(([, lines]) => lines > HARD_MAX_LINES)
    .sort((a, b) => b[1] - a[1]);
  for (const [rel, lines] of sorted) {
    legacyAboveLimit[rel] = lines;
  }
  const payload = {
    meta: {
      softTargetLines: SOFT_TARGET_LINES,
      hardMaxLines: HARD_MAX_LINES,
      updatedAt: new Date().toISOString().slice(0, 10),
      note: 'Ratchet de tamanho de arquivos de codigo-fonte. Arquivos fora desta lista nao podem exceder 750 linhas; arquivos listados nunca podem crescer acima do valor registrado.',
    },
    legacyMaxLines: legacyAboveLimit,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Baseline gravado em ${toPosixRel(BASELINE_PATH)} com ${sorted.length} arquivos legados > ${HARD_MAX_LINES} linhas.`);
  process.exit(0);
}

let baseline = { legacyMaxLines: {} };
if (fs.existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}
const legacyMap = baseline.legacyMaxLines ?? {};

const violations = [];
const warnings = [];
const shrunkUnderLimit = [];

for (const [rel, lines] of [...currentCounts.entries()].sort((a, b) => b[1] - a[1])) {
  const legacyCap = legacyMap[rel];
  if (typeof legacyCap === 'number') {
    if (lines > legacyCap) {
      violations.push(`[RATCHET VIOLADO] ${rel}: ${lines} linhas (teto legado era ${legacyCap})`);
    } else if (lines <= HARD_MAX_LINES) {
      shrunkUnderLimit.push(`${rel}: ${lines} linhas (antes ${legacyCap} — pode sair do baseline!)`);
    }
    continue;
  }

  if (lines > HARD_MAX_LINES) {
    violations.push(`[LIMITE ${HARD_MAX_LINES}L EXCEDIDO] ${rel}: ${lines} linhas`);
  } else if (lines > SOFT_TARGET_LINES) {
    warnings.push(`[AVISO >${SOFT_TARGET_LINES}L] ${rel}: ${lines} linhas`);
  }
}

console.log(`check:sizes — ${currentCounts.size} arquivos analisados (alvo <= ${SOFT_TARGET_LINES}L, teto = ${HARD_MAX_LINES}L).`);
if (shrunkUnderLimit.length > 0) {
  console.log(`\nArquivos reduzidos abaixo de ${HARD_MAX_LINES}L (${shrunkUnderLimit.length}):`);
  for (const item of shrunkUnderLimit) console.log(`  - ${item}`);
}
if (warnings.length > 0) {
  console.log(`\nAvisos entre ${SOFT_TARGET_LINES + 1} e ${HARD_MAX_LINES}L (${warnings.length}):`);
  for (const item of warnings.slice(0, 15)) console.log(`  - ${item}`);
  if (warnings.length > 15) console.log(`  ... e mais ${warnings.length - 15} arquivo(s).`);
}
if (violations.length > 0) {
  console.error(`\nVIOLACOES DE CONTRATO DE TAMANHO (${violations.length}):`);
  for (const item of violations) console.error(`  x ${item}`);
  process.exit(1);
}

console.log('\nOK: Nenhuma violacao de contrato de tamanho.');
