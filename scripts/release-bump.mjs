#!/usr/bin/env node
/**
 * CriativoOS — Motor de Versionamento Semântico Base-10 (`npm run release:bump`)
 *
 * Regra Base-10 (REL40-01):
 * - Modo padrão (patch):
 *   - Se `patch < 9`: incrementa `patch + 1` (ex.: 1.0.0 -> 1.0.1, 1.0.8 -> 1.0.9)
 *   - Se `patch >= 9`: faz rollover Base-10 para `${major}.${minor + 1}.0` (ex.: 1.0.9 -> 1.1.0, 1.9.9 -> 1.10.0)
 * - Flag `--minor`: incrementa `minor + 1` e zera `patch` (ex.: 1.0.3 -> 1.1.0)
 * - Flag `--major`: incrementa `major + 1` e zera `minor` e `patch` (ex.: 1.4.2 -> 2.0.0)
 * - Flag `--set <X.Y.Z>`: define versão explícita
 * - Flag `--dry-run`: calcula e exibe os arquivos sincronizados sem gravar em disco
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const MONOREPO_PACKAGE_PATHS = [
  "package.json",
  "apps/daemon/package.json",
  "apps/web/package.json",
  "apps/desktop/package.json",
  "packages/contracts/package.json",
  "packages/i18n/package.json",
  "packages/whatsapp/package.json",
];

export function parseVersion(rawVersion) {
  const cleaned = String(rawVersion ?? "")
    .trim()
    .replace(/^v/i, "");
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Versão inválida "${rawVersion}". Use o formato MAJOR.MINOR.PATCH (ex.: 1.0.0).`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function computeNextVersion(currentVersion, options = {}) {
  if (options.setVersion) {
    const parsedSet = parseVersion(options.setVersion);
    return `${parsedSet.major}.${parsedSet.minor}.${parsedSet.patch}`;
  }

  const { major, minor, patch } = parseVersion(currentVersion);
  const mode = options.mode ?? "patch";

  if (mode === "major") {
    return `${major + 1}.0.0`;
  }
  if (mode === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  if (mode !== "patch") {
    throw new Error(`Modo de incremento desconhecido: "${mode}". Use "patch", "minor" ou "major".`);
  }

  // Rollover Base-10 no dígito patch (0..9)
  if (patch < 9) {
    return `${major}.${minor}.${patch + 1}`;
  }
  return `${major}.${minor + 1}.0`;
}

export function readCurrentVersion(rootDir) {
  const produtoPath = resolve(rootDir, "produto.json");
  if (existsSync(produtoPath)) {
    const produto = JSON.parse(readFileSync(produtoPath, "utf8"));
    if (produto.versao) return String(produto.versao).trim();
  }
  const rootPkgPath = resolve(rootDir, "package.json");
  if (existsSync(rootPkgPath)) {
    const pkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
    if (pkg.version) return String(pkg.version).trim();
  }
  throw new Error(`Não foi possível localizar produto.json ou package.json em ${rootDir}`);
}

export function syncWorkspaceVersions(rootDir, targetVersion, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const includePainel = options.includePainel !== false;
  const painelDir = options.painelDir ?? resolve(rootDir, "../criativo-ai-studio-painel");
  const updatedFiles = [];

  // 1. produto.json
  const produtoPath = resolve(rootDir, "produto.json");
  if (existsSync(produtoPath)) {
    const raw = readFileSync(produtoPath, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const parsed = JSON.parse(raw);
    const previousVersion = parsed.versao ?? null;
    parsed.versao = targetVersion;
    if (!dryRun) {
      writeFileSync(produtoPath, `${JSON.stringify(parsed, null, 2)}${eol}`, "utf8");
    }
    updatedFiles.push({
      file: "produto.json",
      absolutePath: produtoPath,
      from: previousVersion,
      to: targetVersion,
    });
  }

  // 2. Monorepo package.json files
  const packageRelPaths = options.packagePaths ?? MONOREPO_PACKAGE_PATHS;
  for (const relPath of packageRelPaths) {
    const pkgPath = resolve(rootDir, relPath);
    if (!existsSync(pkgPath)) continue;
    const raw = readFileSync(pkgPath, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const parsed = JSON.parse(raw);
    const previousVersion = parsed.version ?? null;
    parsed.version = targetVersion;
    if (!dryRun) {
      writeFileSync(pkgPath, `${JSON.stringify(parsed, null, 2)}${eol}`, "utf8");
    }
    updatedFiles.push({
      file: relPath,
      absolutePath: pkgPath,
      from: previousVersion,
      to: targetVersion,
    });
  }

  // 3. Painel Administrativo (repositório irmão opcional)
  if (includePainel) {
    const painelPkgPath = resolve(painelDir, "package.json");
    if (existsSync(painelPkgPath)) {
      const raw = readFileSync(painelPkgPath, "utf8");
      const eol = raw.includes("\r\n") ? "\r\n" : "\n";
      const parsed = JSON.parse(raw);
      const previousVersion = parsed.version ?? null;
      parsed.version = targetVersion;
      if (!dryRun) {
        writeFileSync(painelPkgPath, `${JSON.stringify(parsed, null, 2)}${eol}`, "utf8");
      }
      updatedFiles.push({
        file: "../criativo-ai-studio-painel/package.json",
        absolutePath: painelPkgPath,
        from: previousVersion,
        to: targetVersion,
      });
    }
  }

  return {
    version: targetVersion,
    tag: `v${targetVersion}`,
    dryRun,
    updatedFiles,
  };
}

export function parseCliArgs(argv) {
  let mode = "patch";
  let setVersion = null;
  let dryRun = false;
  let jsonOutput = false;
  let noPainel = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--major") {
      mode = "major";
    } else if (arg === "--minor") {
      mode = "minor";
    } else if (arg === "--patch") {
      mode = "patch";
    } else if (arg === "--dry-run" || arg === "-n") {
      dryRun = true;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--no-painel") {
      noPainel = true;
    } else if (arg === "--set" && argv[i + 1]) {
      setVersion = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--set=")) {
      setVersion = arg.slice("--set=".length);
    }
  }

  return { mode, setVersion, dryRun, jsonOutput, includePainel: !noPainel };
}

function main() {
  const rootDir = resolve(__dirname, "..");
  const cli = parseCliArgs(process.argv.slice(2));
  const currentVersion = readCurrentVersion(rootDir);
  const nextVersion = computeNextVersion(currentVersion, {
    mode: cli.mode,
    setVersion: cli.setVersion,
  });

  const result = syncWorkspaceVersions(rootDir, nextVersion, {
    dryRun: cli.dryRun,
    includePainel: cli.includePainel,
  });

  if (cli.jsonOutput) {
    console.log(JSON.stringify({ previousVersion: currentVersion, ...result }, null, 2));
    return;
  }

  const prefix = cli.dryRun ? "[DRY-RUN] " : "";
  console.log(
    `${prefix}CriativoOS Release Bump (Base-10): ${currentVersion} -> ${result.version} (${result.tag})`,
  );
  for (const item of result.updatedFiles) {
    console.log(`  - ${item.file}: ${item.from} -> ${item.to}`);
  }
  const anchor = `v${result.version.replace(/\./g, "-")}`;
  console.log("");
  console.log("Checklist obrigatorio da release:");
  console.log(
    `  [OBRIGATORIO] Atualizar changelog publico em ../criativoos-site/src/data/changelogData.ts (ancora #${anchor}) + npm run verify + push do site`,
  );
  console.log(
    "  [OBRIGATORIO] Atualizar notas da versao em apps/daemon/src/server/release-notes-catalog.ts para o banner de novidades no CriativoOS",
  );
}

const isEntryPoint =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(__filename);

if (isEntryPoint) {
  main();
}
