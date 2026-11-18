/**
 * Compilador e serviço de pré-visualização de interfaces HTML sandboxed (`ChatVisualPreviewService` — CHAT-01).
 * Injeta variáveis CSS `--openbot-*` / Carbon Dark e a ponte congelada `window.criativoPage`
 * comunicando-se exclusivamente via `window.parent.postMessage` (JSON-RPC 2.0) dentro de `<iframe sandbox="allow-scripts allow-forms">`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { CriativoDatabase } from "../../database/client.ts";

export const CHAT_VISUAL_MAX_HTML_CHARS = 512_000;
export const CHAT_VISUAL_MIN_HEIGHT = 80;
export const CHAT_VISUAL_MAX_HEIGHT = 2000;
export const CHAT_VISUAL_DEFAULT_HEIGHT = 240;

function slugifyTitle(title: string): string {
  const clean = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || "pagina-visual";
}

function buildVisualBaseCss(theme: "dark" | "light"): string {
  if (theme === "light") {
    return `
      :root {
        --openbot-bg: #ffffff;
        --openbot-surface: #f5f5f7;
        --openbot-card: #ffffff;
        --openbot-border: rgba(0, 0, 0, 0.12);
        --openbot-fg: #141414;
        --openbot-muted-fg: #5c5c5c;
        --openbot-accent: #007CF7;
        --openbot-success: #16a34a;
        --openbot-warning: #d97706;
        --openbot-danger: #FD2F3B;
        --background: transparent;
        --foreground: #141414;
        --muted: #f4f4f5;
        --muted-foreground: #5c5c5c;
        --card: #ffffff;
        --card-foreground: #141414;
        --border: rgba(0, 0, 0, 0.12);
        --accent: #007CF7;
        --destructive: #FD2F3B;
        --success: #16a34a;
        --chart-1: #007CF7;
        --chart-2: #31CF76;
        --chart-3: #FF9412;
        --chart-4: #a855f7;
        --chart-5: #ec4899;
        --chart-6: #14b8a6;
        --radius: 12px;
        --font-sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    `;
  }

  return `
    :root {
      --openbot-bg: #141414;
      --openbot-surface: #1A1A1A;
      --openbot-card: #212121;
      --openbot-border: rgba(255, 255, 255, 0.12);
      --openbot-fg: #F0F0F0;
      --openbot-muted-fg: #979797;
      --openbot-accent: #42A0FF;
      --openbot-success: #31CF76;
      --openbot-warning: #FF9412;
      --openbot-danger: #FD2F3B;
      --background: transparent;
      --foreground: #ffffff;
      --muted: #212121;
      --muted-foreground: #979797;
      --card: #212121;
      --card-foreground: #ffffff;
      --border: rgba(255, 255, 255, 0.12);
      --accent: #42a0ff;
      --destructive: #ff6069;
      --success: #31cf76;
      --chart-1: #42a0ff;
      --chart-2: #31cf76;
      --chart-3: #ff9412;
      --chart-4: #c084fc;
      --chart-5: #f472b6;
      --chart-6: #2dd4bf;
      --radius: 12px;
      --font-sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    }
  `;
}

const BOOTSTRAP_SCRIPT = `
(function () {
  var displayModeState = "inline";
  var rpcSeq = 1;

  function postRpc(method, params) {
    try {
      window.parent.postMessage({
        jsonrpc: "2.0",
        id: rpcSeq++,
        method: method,
        params: params || {}
      }, "*");
    } catch (_e) {}
  }

  function postNotify(method, params) {
    try {
      window.parent.postMessage({
        jsonrpc: "2.0",
        method: method,
        params: params || {}
      }, "*");
    } catch (_e) {}
  }

  var bridge = Object.freeze({
    sendMessage: function (text) {
      if (typeof text !== "string" || !text.trim()) return;
      var userActive = !!(navigator.userActivation && navigator.userActivation.isActive);
      postRpc("ui/message", { text: text.slice(0, 8000), userActivated: userActive });
    },
    setContext: function (text) {
      var clean = typeof text === "string" ? text.slice(0, 2000) : "";
      postRpc("ui/update-model-context", { text: clean });
    },
    requestFullscreen: function () {
      displayModeState = "fullscreen";
      postRpc("ui/request-display-mode", { mode: "fullscreen" });
    },
    exitFullscreen: function () {
      displayModeState = "inline";
      postRpc("ui/request-display-mode", { mode: "inline" });
    },
    get displayMode() {
      return displayModeState;
    }
  });

  try {
    Object.defineProperty(window, "criativoPage", { value: bridge, writable: false, configurable: false });
    Object.defineProperty(window, "openbotPage", { value: bridge, writable: false, configurable: false });
  } catch (_e) {
    window.criativoPage = bridge;
    window.openbotPage = bridge;
  }

  function reportHeight() {
    var docEl = document.documentElement;
    var body = document.body;
    var rawH = Math.max(
      docEl ? docEl.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      docEl ? docEl.offsetHeight : 0
    );
    var clamped = Math.max(80, Math.min(2000, Math.ceil(rawH || 240)));
    postNotify("ui/notifications/size-changed", { height: clamped });
  }

  if (typeof ResizeObserver !== "undefined") {
    var ro = new ResizeObserver(function () { reportHeight(); });
    window.addEventListener("DOMContentLoaded", function () {
      if (document.documentElement) ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
      reportHeight();
    });
  }
  window.addEventListener("load", reportHeight);

  document.addEventListener("click", function (ev) {
    var target = ev.target;
    if (!target || !target.closest) return;

    var img = target.closest("img");
    if (img && img.src && !target.closest("a,button")) {
      postNotify("criativo/notifications/image-click", { src: img.src, alt: img.alt || "" });
      return;
    }

    var anchor = target.closest("a[href]");
    if (anchor) {
      var href = anchor.getAttribute("href") || "";
      if (href.startsWith("#")) return;
      if (/^https?:\\/\\//i.test(href)) {
        ev.preventDefault();
        postRpc("ui/open-link", { url: href });
      }
    }
  });

  document.addEventListener("selectionchange", function () {
    try {
      var sel = window.getSelection ? String(window.getSelection()).trim() : "";
      if (sel.length > 0 && sel.length <= 1500) {
        postNotify("criativo/notifications/selection-changed", { text: sel });
      }
    } catch (_e) {}
  });

  if (typeof IntersectionObserver !== "undefined") {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting && entry.target && typeof entry.target.pause === "function") {
          try { entry.target.pause(); } catch (_e) {}
        }
      });
    }, { threshold: 0.05 });

    window.addEventListener("DOMContentLoaded", function () {
      var medias = document.querySelectorAll("video, audio");
      medias.forEach(function (m) { io.observe(m); });
    });
  }
})();
`;

/**
 * Envolve ou injeta no `<head>` do HTML os tokens CSS `--openbot-*` e a ponte `window.criativoPage`.
 */
export function chatVisualDocument(
  rawHtml: string,
  options?: { theme?: "dark" | "light" },
): string {
  const theme = options?.theme ?? "dark";
  const injectedHead = [
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<style id="criativo-visual-base">`,
    buildVisualBaseCss(theme),
    `html, body { margin: 0; padding: 0; font-family: var(--font-sans); color: var(--foreground); background: var(--background); box-sizing: border-box; }`,
    `*, *::before, *::after { box-sizing: inherit; }`,
    `</style>`,
    `<script id="criativo-visual-bootstrap">${BOOTSTRAP_SCRIPT}</script>`,
  ].join("\n");

  const trimmed = rawHtml.trim();
  if (/<head[\s>]/i.test(trimmed)) {
    return trimmed.replace(/<head([^>]*)>/i, `<head$1>\n${injectedHead}\n`);
  }
  if (/<html[\s>]/i.test(trimmed)) {
    return trimmed.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n${injectedHead}\n</head>\n`);
  }

  return `<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n${injectedHead}\n</head>\n<body>\n${trimmed}\n</body>\n</html>`;
}

export interface ChatVisualPreviewServiceDeps {
  db: CriativoDatabase;
  workspaceRoot: string;
}

export class ChatVisualPreviewService {
  private readonly db: CriativoDatabase;
  private readonly workspaceRoot: string;

  constructor(deps: ChatVisualPreviewServiceDeps) {
    this.db = deps.db;
    this.workspaceRoot = resolve(deps.workspaceRoot);
  }

  public renderAndPersistPage(params: {
    agenteId: string;
    canalId: string;
    html: string;
    title?: string;
    height?: number;
    tarefaId?: string | null;
  }): {
    arquivoId: string;
    relPath: string;
    url: string;
    title: string;
    height: number;
    itemType: string;
  } {
    if (typeof params.html !== "string" || params.html.trim().length === 0) {
      throw new Error("O conteúdo HTML de html_render não pode ser vazio.");
    }
    if (params.html.length > CHAT_VISUAL_MAX_HTML_CHARS) {
      throw new Error(
        `O documento HTML excede o limite de ${CHAT_VISUAL_MAX_HTML_CHARS} caracteres.`,
      );
    }

    const cleanTitle = (params.title ?? "Painel Interativo").trim().slice(0, 140) || "Painel Interativo";
    const resolvedHeight =
      typeof params.height === "number" && Number.isFinite(params.height)
        ? Math.max(CHAT_VISUAL_MIN_HEIGHT, Math.min(CHAT_VISUAL_MAX_HEIGHT, Math.round(params.height)))
        : CHAT_VISUAL_DEFAULT_HEIGHT;

    const arquivoId = `vis-${randomUUID().slice(0, 10)}`;
    const filename = `${arquivoId}-${slugifyTitle(cleanTitle)}.html`;
    const absPath = join(this.workspaceRoot, "saidas", "paginas", filename);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, params.html, "utf8");

    const relPath = relative(this.workspaceRoot, absPath).replace(/\\/g, "/");
    const url = `/api/agentes/${encodeURIComponent(params.agenteId)}/visual-pages/${encodeURIComponent(arquivoId)}`;
    const bytes = Buffer.byteLength(params.html, "utf8");
    const agora = new Date().toISOString();

    this.db.connection
      .prepare(
        `INSERT INTO projecao_arquivos (
          arquivo_id, nome_original, caminho_relativo, url, mime_type,
          tamanho_bytes, tipo_uso, agente_id, tarefa_id, criado_em
        ) VALUES (?, ?, ?, ?, 'text/html', ?, 'gerado', ?, ?, ?);`,
      )
      .run(
        arquivoId,
        `${cleanTitle}.html`,
        relPath,
        url,
        bytes,
        params.agenteId,
        params.tarefaId ?? null,
        agora,
      );

    return {
      arquivoId,
      relPath,
      url,
      title: cleanTitle,
      height: resolvedHeight,
      itemType: `visual-reply:${resolvedHeight}`,
    };
  }

  public getCompiledPage(
    arquivoId: string,
    theme: "dark" | "light" = "dark",
  ): { arquivo_id: string; titulo: string; html: string } | null {
    const row = this.db.connection
      .prepare(
        "SELECT arquivo_id, nome_original, caminho_relativo FROM projecao_arquivos WHERE arquivo_id = ? LIMIT 1;",
      )
      .get(arquivoId) as
      | { arquivo_id: string; nome_original: string; caminho_relativo: string }
      | undefined;

    if (!row) return null;

    const absPath = resolve(this.workspaceRoot, row.caminho_relativo);
    const relCheck = relative(this.workspaceRoot, absPath).replace(/\\/g, "/");
    if (relCheck.startsWith("..") || !existsSync(absPath)) {
      return null;
    }

    const rawHtml = readFileSync(absPath, "utf8");
    return {
      arquivo_id: row.arquivo_id,
      titulo: row.nome_original.replace(/\.html$/i, ""),
      html: chatVisualDocument(rawHtml, { theme }),
    };
  }

  public async previewHtmlOffscreen(params: {
    html: string;
    width?: number;
    appearance?: "dark" | "light";
  }): Promise<{
    previewAvailable: boolean;
    width: number;
    contentHeight: number | null;
    screenshotDataUrl?: string;
    console: string[];
    note?: string;
  }> {
    if (typeof params.html !== "string" || !params.html.trim()) {
      throw new Error("Informe o conteúdo HTML em html_preview.");
    }
    if (params.html.length > CHAT_VISUAL_MAX_HTML_CHARS) {
      throw new Error(`O HTML excede o limite de ${CHAT_VISUAL_MAX_HTML_CHARS} caracteres.`);
    }

    const width = Math.max(240, Math.min(1600, Math.round(params.width ?? 728)));
    const theme = params.appearance === "light" ? "light" : "dark";
    const compiled = chatVisualDocument(params.html, { theme });

    if (process.env.CRIATIVO_SKIP_LOCAL_PROBE === "1") {
      return {
        previewAvailable: false,
        width,
        contentHeight: null,
        console: [],
        note: "Sondagem local desativada (CRIATIVO_SKIP_LOCAL_PROBE=1). Publique diretamente com html_render.",
      };
    }

    try {
      // Carregamento dinâmico opcional caso playwright esteja instalado no host
      const dynamicImport = new Function("mod", "return import(mod)") as (
        mod: string,
      ) => Promise<{
        chromium?: {
          launch: (opts: { headless: boolean }) => Promise<{
            newPage: (opts: { viewport: { width: number; height: number } }) => Promise<{
              on: (ev: string, cb: (msg: { text: () => string }) => void) => void;
              setContent: (html: string, opts: { waitUntil: string }) => Promise<void>;
              evaluate: <T>(fn: string) => Promise<T>;
              screenshot: (opts: { type: "png"; fullPage: boolean }) => Promise<Buffer>;
            }>;
            close: () => Promise<void>;
          }>;
        };
      }>;

      const pw = await dynamicImport("playwright").catch(() => null);
      if (!pw?.chromium) {
        return {
          previewAvailable: false,
          width,
          contentHeight: null,
          console: [],
          note: "Chromium headless não detectado neste host para captura prévia; revise a estrutura e publique diretamente com html_render.",
        };
      }

      const browser = await pw.chromium.launch({ headless: true });
      try {
        const logs: string[] = [];
        const page = await browser.newPage({ viewport: { width, height: 600 } });
        page.on("console", (msg) => {
          logs.push(msg.text().slice(0, 300));
        });
        await page.setContent(compiled, { waitUntil: "load" });
        const contentHeight = await page.evaluate<number>(
          "Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)",
        );
        const pngBuf = await page.screenshot({ type: "png", fullPage: true });
        return {
          previewAvailable: true,
          width,
          contentHeight,
          screenshotDataUrl: `data:image/png;base64,${pngBuf.toString("base64")}`,
          console: logs.slice(0, 20),
        };
      } finally {
        await browser.close();
      }
    } catch {
      return {
        previewAvailable: false,
        width,
        contentHeight: null,
        console: [],
        note: "Captura prévia indisponível neste ambiente; publique diretamente com html_render.",
      };
    }
  }
}
