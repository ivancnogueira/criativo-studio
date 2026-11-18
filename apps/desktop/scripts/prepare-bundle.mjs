#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const FORBIDDEN_TOP_PATHS = new Set([
  ".env",
  "dados",
  "conteudos",
  "saidas",
  "previas",
  "logs",
  "servidores",
]);

function walkCheckNoContamination(dir, relBase = "") {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    const st = statSync(abs);

    if (
      name === ".env" ||
      name.endsWith(".db") ||
      name.endsWith(".db-wal") ||
      name.endsWith(".db-shm") ||
      rel.startsWith("recursos/fotos") ||
      rel.startsWith("recursos/logos") ||
      rel.startsWith("recursos/referencias") ||
      rel.startsWith("recursos/personagens") ||
      rel.startsWith("conteudos/")
    ) {
      throw new Error(`Violação Anti-Contaminação detectada no bundle de produto: '${rel}'`);
    }

    if (st.isDirectory()) {
      walkCheckNoContamination(abs, rel);
    }
  }
}

function copyDirClean(src, dst, filterFn) {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    force: true,
    filter: filterFn,
  });
}

export function prepareDesktopBundle(options = {}) {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = resolve(options.repoRoot ?? resolve(desktopRoot, "../.."));
  const outDir = resolve(options.outDir ?? join(desktopRoot, "build-product"));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const mustExistFiles = [
    ["apps/daemon/dist/server/daemon-server.js", "apps/daemon/dist/server/daemon-server.js"],
    ["apps/web/dist/index.html", "apps/web/dist/index.html"],
    ["produto.json", "produto.json"],
    [".env.example", ".env.example"],
  ];

  for (const [srcRel] of mustExistFiles) {
    if (!existsSync(join(repoRoot, srcRel))) {
      throw new Error(
        `Artefato obrigatório ausente para empacotar desktop: '${srcRel}'. Execute o build do monorepo e do web antes.`,
      );
    }
  }

  // Copia builds compilados sem .ts nem .map
  const skipDevSources = (srcPath) => {
    const norm = srcPath.replaceAll("\\", "/");
    if (norm.endsWith(".ts") && !norm.endsWith(".d.ts")) return false;
    if (norm.endsWith(".map")) return false;
    if (norm.includes("/dados/") || norm.endsWith("/.env")) return false;
    return true;
  };

  copyDirClean(join(repoRoot, "apps/daemon/dist"), join(outDir, "apps/daemon/dist"), skipDevSources);
  copyDirClean(join(repoRoot, "apps/web/dist"), join(outDir, "apps/web/dist"));
  copyDirClean(join(repoRoot, "packages/contracts/dist"), join(outDir, "packages/contracts/dist"), skipDevSources);
  copyDirClean(join(repoRoot, "packages/whatsapp/dist"), join(outDir, "packages/whatsapp/dist"), skipDevSources);
  copyDirClean(join(repoRoot, "templates/marca"), join(outDir, "templates/marca"));
  copyDirClean(join(repoRoot, ".agents/skills"), join(outDir, ".agents/skills"));

  const catalogSrc = join(repoRoot, "apps/daemon/src/marketplace/catalog/catalog-bundle.json");
  if (existsSync(catalogSrc)) {
    const catalogDstA = join(outDir, "apps/daemon/dist/marketplace/catalog/catalog-bundle.json");
    const catalogDstB = join(outDir, "apps/daemon/src/marketplace/catalog/catalog-bundle.json");
    mkdirSync(dirname(catalogDstA), { recursive: true });
    mkdirSync(dirname(catalogDstB), { recursive: true });
    cpSync(catalogSrc, catalogDstA);
    cpSync(catalogSrc, catalogDstB);
  }

  const singleFiles = [
    "produto.json",
    ".env.example",
    "package.json",
    "apps/daemon/package.json",
    "packages/contracts/package.json",
    "packages/whatsapp/package.json",
    "scripts/install-server.sh",
  ];
  for (const rel of singleFiles) {
    const src = join(repoRoot, rel);
    if (existsSync(src)) {
      const dst = join(outDir, rel);
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst);
    }
  }

  for (const forbidden of FORBIDDEN_TOP_PATHS) {
    if (existsSync(join(outDir, forbidden))) {
      rmSync(join(outDir, forbidden), { recursive: true, force: true });
    }
  }

  // ─── Fase opcional de bundling com esbuild ────────────────────────────────
  if (options.bundleWithEsbuild) {
    bundleDaemonSync(outDir, repoRoot);
  }

  walkCheckNoContamination(outDir);
  return outDir;
}

function bundleEntrySync(entryFile, outFile, repoRoot, outDir) {
  const contractsDist = join(outDir, "packages/contracts/dist");
  const whatsappDist = join(outDir, "packages/whatsapp/dist");

  buildSync({
    entryPoints: [entryFile],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: outFile,
    minify: false,
    sourcemap: false,
    keepNames: true,
    nodePaths: [
      join(repoRoot, "node_modules"),
      join(repoRoot, "apps/daemon/node_modules"),
      join(repoRoot, "packages/whatsapp/node_modules"),
    ],
    external: ["node:*", "playwright-core"],
    alias: {
      "@criativo/contracts/license-crypto-node": join(contractsDist, "license-crypto-node.js"),
      "@criativo/contracts": join(contractsDist, "index.js"),
      "@criativo/whatsapp": join(whatsappDist, "index.js"),
    },
    banner: {
      js: [
        "// Criativo AI Studio — Bundle autossuficiente (gerado por esbuild)",
        'import { createRequire as __createRequire } from "node:module";',
        "const require = __createRequire(import.meta.url);",
      ].join("\n"),
    },
    logLevel: "warning",
  });
}

function bundleDaemonSync(outDir, repoRoot) {
  const targets = [
    "apps/daemon/dist/server/daemon-server.js",
    "apps/daemon/dist/servers/local-child-entry.js",
    "apps/daemon/dist/agent-data/shared-tables-host.js",
  ];

  const daemonEntry = join(outDir, targets[0]);
  if (!existsSync(daemonEntry)) return;

  console.info("[esbuild] Bundling entrypoints do daemon com dependências incluídas...");

  const tempOutputs = [];
  for (const rel of targets) {
    const entry = join(outDir, rel);
    if (!existsSync(entry)) continue;
    const tmpOut = `${entry}.bundled.js`;
    bundleEntrySync(entry, tmpOut, repoRoot, outDir);
    if (!existsSync(tmpOut)) {
      throw new Error(`[esbuild] Falha ao gerar bundle para '${rel}'.`);
    }
    const mb = (statSync(tmpOut).size / 1024 / 1024).toFixed(2);
    console.info(`[esbuild] ${rel}: ${mb} MB`);
    tempOutputs.push({ entry, tmpOut, rel });
  }

  for (const item of tempOutputs) {
    rmSync(item.entry, { force: true });
    cpSync(item.tmpOut, item.entry);
    rmSync(item.tmpOut, { force: true });
  }

  rmSync(join(outDir, "packages"), { recursive: true, force: true });

  const keepDirs = new Set(["server", "servers", "agent-data"]);
  const keepFilesByDir = new Map([
    ["server", "daemon-server.js"],
    ["servers", "local-child-entry.js"],
    ["agent-data", "shared-tables-host.js"],
  ]);

  const daemonDist = join(outDir, "apps/daemon/dist");
  for (const sub of readdirSync(daemonDist)) {
    const subPath = join(daemonDist, sub);
    if (!statSync(subPath).isDirectory()) continue;
    if (!keepDirs.has(sub)) {
      rmSync(subPath, { recursive: true, force: true });
      continue;
    }
    const keepFile = keepFilesByDir.get(sub);
    for (const f of readdirSync(subPath)) {
      if (f === keepFile) continue;
      rmSync(join(subPath, f), { recursive: true, force: true });
    }
  }

  console.info("[esbuild] ✅ Bundles autossuficientes prontos (qrcode e baileys incluídos).");
}

const isCli =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isCli) {
  try {
    const out = prepareDesktopBundle({ bundleWithEsbuild: true });
    console.info(`[Criativo Desktop] Bundle de produto agnóstico preparado em: ${out}`);
  } catch (err) {
    console.error("[Criativo Desktop] Falha ao preparar bundle:", err);
    process.exit(1);
  }
}
