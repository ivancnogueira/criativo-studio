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

function bundleDaemonSync(outDir, repoRoot) {
  const daemonEntry = join(outDir, "apps/daemon/dist/server/daemon-server.js");
  if (!existsSync(daemonEntry)) return;

  const contractsDist = join(outDir, "packages/contracts/dist");
  const whatsappDist = join(outDir, "packages/whatsapp/dist");
  const bundledFile = join(outDir, "apps/daemon/dist/server/daemon-server.bundled.js");

  console.info("[esbuild] Bundling daemon-server.js (síncrono)...");

  buildSync({
    entryPoints: [daemonEntry],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: bundledFile,
    minify: false,
    sourcemap: false,
    keepNames: true,
    external: [
      "node:*",
      "qrcode",
      "@whiskeysockets/baileys",
      "playwright-core",
    ],
    alias: {
      "@criativo/contracts/license-crypto-node": join(contractsDist, "license-crypto-node.js"),
      "@criativo/contracts": join(contractsDist, "index.js"),
      "@criativo/whatsapp": join(whatsappDist, "index.js"),
    },
    banner: {
      js: [
        '// Criativo AI Studio — Daemon Bundle (gerado por esbuild)',
        'import { createRequire as __createRequire } from "node:module";',
        'const require = __createRequire(import.meta.url);',
      ].join("\n"),
    },
    logLevel: "warning",
  });

  if (!existsSync(bundledFile)) {
    throw new Error("[esbuild] Falha ao gerar bundle: arquivo de saída ausente.");
  }

  const bundleSize = statSync(bundledFile).size;
  console.info(`[esbuild] Bundle gerado: ${(bundleSize / 1024 / 1024).toFixed(2)} MB`);

  rmSync(daemonEntry);
  cpSync(bundledFile, daemonEntry);
  rmSync(bundledFile);

  rmSync(join(outDir, "packages"), { recursive: true, force: true });

  const daemonDist = join(outDir, "apps/daemon/dist");
  for (const sub of readdirSync(daemonDist)) {
    if (sub === "server") continue;
    const subPath = join(daemonDist, sub);
    if (statSync(subPath).isDirectory()) {
      rmSync(subPath, { recursive: true, force: true });
    }
  }

  const serverDir = join(daemonDist, "server");
  for (const f of readdirSync(serverDir)) {
    if (f === "daemon-server.js") continue;
    const fPath = join(serverDir, f);
    if (statSync(fPath).isFile() && f.endsWith(".js")) {
      rmSync(fPath, { force: true });
    }
  }

  console.info("[esbuild] ✅ Bundle do daemon pronto — node_modules não necessário.");
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
