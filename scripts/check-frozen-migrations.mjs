#!/usr/bin/env node
import { createHash } from "node:crypto";
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
const entries = Array.isArray(config.frozenMigrations) ? config.frozenMigrations : [];

let failures = 0;
for (const entry of entries) {
  const fullPath = path.join(ROOT_DIR, entry.path);
  if (!fs.existsSync(fullPath)) {
    console.error(`[CONGELAMENTO VIOLADO] Arquivo de migração ausente: ${entry.path}`);
    failures += 1;
    continue;
  }
  const actualSha = createHash("sha256")
    .update(fs.readFileSync(fullPath))
    .digest("hex");
  if (actualSha !== entry.sha256) {
    console.error(
      `[CONGELAMENTO VIOLADO] ${entry.path} foi modificado retroativamente!\n  Esperado: ${entry.sha256}\n  Atual:    ${actualSha}`,
    );
    failures += 1;
  }
}

if (failures > 0) {
  process.exit(1);
}

console.log(`check:migrations — OK (${entries.length} arquivo(s) de migração histórica preservado(s) sem alteração).`);
