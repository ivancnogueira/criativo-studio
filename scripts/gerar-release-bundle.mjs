#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_ROOT_PREFIXES = [
  ".env",
  "dados/",
  "conteudos/",
  "saidas/",
  "previas/",
  "logs/",
  "servidores/",
  "recursos/",
  "atualizacoes/",
];

const UTF8_TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".svg",
  ".md",
  ".txt",
  ".sh",
  ".yml",
  ".yaml",
  ".xml",
]);

function printUsage() {
  console.info(
    [
      "Uso: node scripts/gerar-release-bundle.mjs [opções]",
      "",
      "Opções:",
      "  --version <semver>    Versão da release (ex: 1.1.0). Padrão: produto.json/package.json.",
      "  --format <v1|v2>      v1 = Record UTF-8 compatível com v1.0.0 (padrão); v2 = array utf8+base64.",
      "  --channel <ch>        stable (padrão) ou beta.",
      "  --changelog <texto>   Notas da atualização.",
      "  --source <dir>        Diretório base (padrão: apps/desktop/build-product).",
      "  --out <arquivo.json>  Caminho de saída do JSON (padrão: pasta temporária do SO).",
      "  --publish             Publica direto via POST /api/admin/releases.",
      "  --hub-url <url>       URL do Painel (padrão: env CRIATIVO_HUB_URL ou https://painel.criativoaistudio.com.br).",
      "  --help                Exibe esta ajuda.",
      "",
      "Variáveis de ambiente para --publish:",
      "  CRIATIVO_PAINEL_ADMIN_TOKEN (ou CRIATIVO_ADMIN_TOKEN)",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const opts = {
    version: "",
    format: "v1",
    channel: "stable",
    changelog: "",
    source: "",
    out: "",
    publish: false,
    hubUrl: process.env.CRIATIVO_HUB_URL || "https://painel.criativoaistudio.com.br",
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--publish") opts.publish = true;
    else if (arg === "--version" && argv[i + 1]) opts.version = argv[++i];
    else if (arg === "--format" && argv[i + 1]) opts.format = argv[++i];
    else if (arg === "--channel" && argv[i + 1]) opts.channel = argv[++i];
    else if (arg === "--changelog" && argv[i + 1]) opts.changelog = argv[++i];
    else if (arg === "--source" && argv[i + 1]) opts.source = argv[++i];
    else if (arg === "--out" && argv[i + 1]) opts.out = argv[++i];
    else if (arg === "--hub-url" && argv[i + 1]) opts.hubUrl = argv[++i];
  }
  return opts;
}

function isProtectedPath(relPath) {
  const norm = relPath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!norm || norm.includes("..")) return true;
  if (norm === ".env" || norm.endsWith("/.env") || norm.endsWith(".db") || norm.endsWith(".db-wal") || norm.endsWith(".db-shm")) {
    return true;
  }
  return FORBIDDEN_ROOT_PREFIXES.some((prefix) => norm === prefix.replace(/\/$/, "") || norm.startsWith(prefix));
}

function hasUtf8Extension(relPath) {
  const lower = relPath.toLowerCase();
  for (const ext of UTF8_TEXT_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function walkFiles(baseDir, currentDir = baseDir, acc = []) {
  for (const name of readdirSync(currentDir)) {
    const abs = join(currentDir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walkFiles(baseDir, abs, acc);
    } else if (st.isFile()) {
      const rel = relative(baseDir, abs).replaceAll("\\", "/");
      if (!isProtectedPath(rel)) {
        acc.push({ abs, rel });
      }
    }
  }
  return acc;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const defaultProdutoPath = join(repoRoot, "produto.json");
  let fallbackVersion = "1.0.0";
  if (existsSync(defaultProdutoPath)) {
    try {
      const parsed = JSON.parse(readFileSync(defaultProdutoPath, "utf8"));
      if (parsed.versao) fallbackVersion = String(parsed.versao);
    } catch {
      // ignora
    }
  }

  const cleanVersion = String(opts.version || fallbackVersion)
    .trim()
    .replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(cleanVersion)) {
    throw new Error(`Versão semver inválida: '${cleanVersion}'.`);
  }

  const formatMode = opts.format === "v2" ? "v2" : "v1";
  const channel = opts.channel === "beta" ? "beta" : "stable";
  const sourceDir = resolve(repoRoot, opts.source || "apps/desktop/build-product");

  if (!existsSync(sourceDir)) {
    throw new Error(
      `Diretório fonte não encontrado em '${sourceDir}'. Execute antes: npm run build; npm run build:web; npm run prepare:desktop-bundle`,
    );
  }

  const entries = walkFiles(sourceDir);
  if (entries.length === 0) {
    throw new Error(`Nenhum arquivo elegível encontrado em '${sourceDir}'.`);
  }

  let bundleObj;
  if (formatMode === "v1") {
    const filesMap = {};
    for (const item of entries) {
      if (!hasUtf8Extension(item.rel)) continue;
      let content = readFileSync(item.abs, "utf8");
      if (item.rel === "produto.json") {
        try {
          const parsed = JSON.parse(content);
          parsed.versao = cleanVersion;
          content = JSON.stringify(parsed, null, 2) + "\n";
        } catch {
          // mantém original se inválido
        }
      }
      filesMap[item.rel] = content;
    }
    bundleObj = {
      format: "criativo-update-bundle-v1",
      version: cleanVersion,
      files: filesMap,
    };
  } else {
    const filesArr = [];
    for (const item of entries) {
      const buf = readFileSync(item.abs);
      if (hasUtf8Extension(item.rel)) {
        let text = buf.toString("utf8");
        if (item.rel === "produto.json") {
          try {
            const parsed = JSON.parse(text);
            parsed.versao = cleanVersion;
            text = JSON.stringify(parsed, null, 2) + "\n";
          } catch {
            // mantém
          }
        }
        filesArr.push({ path: item.rel, encoding: "utf8", content: text });
      } else {
        filesArr.push({ path: item.rel, encoding: "base64", content: buf.toString("base64") });
      }
    }
    bundleObj = {
      format: "criativo-update-bundle-v2",
      version: cleanVersion,
      files: filesArr,
    };
  }

  const defaultOutDir = join(tmpdir(), "criativo-releases");
  const outPath = resolve(
    opts.out || join(defaultOutDir, `criativo-update-${cleanVersion}.json`),
  );
  mkdirSync(dirname(outPath), { recursive: true });
  const serialized = JSON.stringify(bundleObj);
  const outBuffer = Buffer.from(serialized, "utf8");
  writeFileSync(outPath, outBuffer);

  const sha256 = createHash("sha256").update(outBuffer).digest("hex");
  const fileCount =
    formatMode === "v1" ? Object.keys(bundleObj.files).length : bundleObj.files.length;

  const summary = {
    ok: true,
    version: cleanVersion,
    channel,
    format: bundleObj.format,
    files_count: fileCount,
    size_bytes: outBuffer.length,
    sha256,
    bundle_path: outPath,
  };

  if (opts.publish) {
    const adminToken =
      process.env.CRIATIVO_PAINEL_ADMIN_TOKEN || process.env.CRIATIVO_ADMIN_TOKEN || "";
    if (!adminToken) {
      throw new Error(
        "CRIATIVO_PAINEL_ADMIN_TOKEN (ou CRIATIVO_ADMIN_TOKEN) não definido no ambiente para --publish.",
      );
    }
    const endpoint = `${opts.hubUrl.replace(/\/+$/, "")}/api/admin/releases`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        version: cleanVersion,
        channel,
        changelog_markdown: opts.changelog || `Atualização v${cleanVersion}`,
        hot_bundle: bundleObj,
      }),
    });
    const resText = await res.text();
    if (!res.ok) {
      throw new Error(`Falha ao publicar no Painel (${res.status}): ${resText}`);
    }
    summary.published = true;
    summary.hub_url = endpoint;
  }

  console.info(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(`[gerar-release-bundle] Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
