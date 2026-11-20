/**
 * Snapshot semântico seguro AX+DOM com `ref` + `revision`, mascaramento de campos sensíveis,
 * proteção anti-SSRF em URLs de navegação e confinamento de caminhos em `upload_files` (BRWS-01).
 */
import { existsSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { isAbsolute, relative, resolve } from "node:path";
import type { Locator, Page } from "playwright-core";
import type {
  BrowserSnapshotElement,
  BrowserSnapshotResult,
  BrowserTargetSelector,
} from "@criativo/contracts";

export const MAX_SNAPSHOT_ELEMENTS = 220;

export interface SnapshotRefMeta {
  ref: string;
  role: string;
  tag: string;
  name: string;
  selector: string;
  nth: number;
  isSensitive: boolean;
  disabled: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

function isPrivateOrBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // Loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // Link-local / Cloud Metadata 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1";
}

function isBlockedHostnameOrIp(hostname: string, allowLocalhost: boolean): boolean {
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!clean) return true;

  if (
    clean === "metadata.google.internal" ||
    clean === "metadata" ||
    clean === "169.254.169.254" ||
    clean === "0.0.0.0" ||
    clean.endsWith(".internal")
  ) {
    return true;
  }

  if (isLoopbackHost(clean)) {
    return !allowLocalhost;
  }

  const ipKind = isIP(clean);
  if (ipKind === 4) {
    return isPrivateOrBlockedIpv4(clean);
  }
  if (ipKind === 6) {
    if (clean === "::" || clean === "::1") {
      return !allowLocalhost;
    }
    if (
      clean.startsWith("fc") ||
      clean.startsWith("fd") ||
      clean.startsWith("fe80:") ||
      clean.startsWith("::ffff:127.") ||
      clean.startsWith("::ffff:10.") ||
      clean.startsWith("::ffff:169.254.") ||
      clean.startsWith("::ffff:192.168.")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Valida URL de navegação bloqueando protocolos perigosos (`file:`, `chrome:`, `javascript:`, `data:`)
 * e IPs internos/metadata (SSRF), liberando `localhost`/`127.0.0.1` apenas sob `CRIATIVO_ALLOW_LOCALHOST_BROWSER=1`.
 */
export function assertSafeNavigationUrl(rawUrl: string): URL {
  if (!rawUrl || typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new Error("Informe uma URL HTTP(S) não vazia.");
  }
  if (rawUrl.length > 4096) {
    throw new Error("A URL excede o tamanho máximo permitido de 4096 caracteres.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`URL inválida informada para navegação: '${rawUrl}'.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Protocolo '${parsed.protocol}' bloqueado por política de segurança (permitidos apenas http: e https:).`,
    );
  }

  const allowLocalhost = process.env.CRIATIVO_ALLOW_LOCALHOST_BROWSER === "1";
  if (isBlockedHostnameOrIp(parsed.hostname, allowLocalhost)) {
    throw new Error(
      `Destino de rede interno ou restrito bloqueado pela proteção anti-SSRF: '${parsed.hostname}'.`,
    );
  }

  return parsed;
}

/**
 * Garante que todos os caminhos de `upload_files` residem dentro das pastas autorizadas do workspace.
 */
export function assertSafeUploadPaths(
  paths: string[],
  workspaceRoot: string,
  agentId?: string | null,
): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("Informe ao menos 1 caminho de arquivo em 'paths'.");
  }
  if (paths.length > 10) {
    throw new Error("Máximo de 10 arquivos por chamada em upload_files.");
  }

  const rootAbs = resolve(workspaceRoot);
  const allowedRoots = [
    resolve(rootAbs, "recursos"),
    resolve(rootAbs, "saidas"),
    resolve(rootAbs, "previas"),
    resolve(rootAbs, "conteudos"),
    ...(agentId ? [resolve(rootAbs, "dados", "agentes", agentId)] : []),
  ];

  const resolvedList: string[] = [];
  for (const raw of paths) {
    const clean = String(raw ?? "").trim();
    if (!clean || clean.includes("\0")) {
      throw new Error("Caminho de arquivo vazio ou inválido em upload_files.");
    }
    const candidate = isAbsolute(clean) ? resolve(clean) : resolve(rootAbs, clean);
    const relToWorkspace = relative(rootAbs, candidate);
    if (!relToWorkspace || relToWorkspace.startsWith("..") || isAbsolute(relToWorkspace)) {
      throw new Error(`Upload bloqueado fora do workspace: '${clean}'.`);
    }

    const insideAllowed = allowedRoots.some((allowed) => {
      const r = relative(allowed, candidate);
      return r === "" || (!r.startsWith("..") && !isAbsolute(r));
    });
    if (!insideAllowed) {
      throw new Error(
        `Upload permitido apenas a partir de recursos/, saidas/, previas/, conteudos/ ou dados/agentes/: '${clean}'.`,
      );
    }

    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      throw new Error(`Arquivo não encontrado para upload: '${clean}'.`);
    }
    resolvedList.push(candidate);
  }

  return resolvedList;
}

export function isSensitiveFieldHint(attrs: {
  type?: string;
  autocomplete?: string;
  name?: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
}): boolean {
  const typeLower = (attrs.type ?? "").toLowerCase();
  if (typeLower === "password") return true;

  const autoLower = (attrs.autocomplete ?? "").toLowerCase();
  if (
    autoLower.includes("one-time-code") ||
    autoLower.includes("cc-") ||
    autoLower.includes("current-password") ||
    autoLower.includes("new-password")
  ) {
    return true;
  }

  const combined = [attrs.name, attrs.id, attrs.ariaLabel, attrs.placeholder]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(password|passwd|senha|otp|2fa|totp|token|secret|segredo|cvv|cvc|cardnumber)\b/i.test(
    combined,
  );
}

/**
 * Coleta snapshot semântico dos elementos interativos visíveis na página mascarando campos sensíveis.
 */
export async function buildSemanticSnapshot(
  page: Page,
  tabId: string,
  perfilId: string,
  revision: number,
  includeImage = false,
): Promise<{
  snapshot: BrowserSnapshotResult;
  refMap: Map<string, SnapshotRefMeta>;
}> {
  const url = page.url();
  const title = await page.title().catch(() => "");

  const rawCollected = await page.evaluate((maxItems: number) => {
    interface DomElementLike {
      tagName: string;
      innerText?: string;
      textContent?: string | null;
      value?: string;
      checked?: boolean;
      disabled?: boolean;
      href?: string;
      getAttribute(name: string): string | null;
      getBoundingClientRect(): { x: number; y: number; width: number; height: number };
      closest(selector: string): DomElementLike | null;
    }
    interface BrowserGlobalLike {
      document: {
        body?: { innerText?: string } | null;
        querySelector(selector: string): DomElementLike | null;
        querySelectorAll(selector: string): ArrayLike<DomElementLike>;
      };
      getComputedStyle(el: DomElementLike): {
        display: string;
        visibility: string;
        opacity: string;
      };
      CSS?: { escape(ident: string): string };
    }

    const g = globalThis as unknown as BrowserGlobalLike;
    function escapeCssIdent(val: string): string {
      return g.CSS?.escape ? g.CSS.escape(val) : val.replace(/["\\#.:[\]()]/g, "\\$&");
    }

    const interactiveSelector = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='switch']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='option']",
      "[role='combobox']",
      "[contenteditable='true']",
    ].join(",");

    const nodes = Array.from(g.document.querySelectorAll(interactiveSelector));
    const visibleNodes: Array<{
      role: string;
      tag: string;
      name: string;
      value?: string;
      placeholder?: string;
      href?: string;
      checked?: boolean;
      disabled: boolean;
      typeAttr: string;
      autocomplete: string;
      nameAttr: string;
      idAttr: string;
      ariaLabel: string;
      selector: string;
      nth: number;
      bounds: { x: number; y: number; width: number; height: number };
    }> = [];

    const selectorCounter = new Map<string, number>();

    for (const el of nodes) {
      const style = g.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;

      const tag = el.tagName.toLowerCase();
      const explicitRole = el.getAttribute("role");
      const typeAttr = (el.getAttribute("type") || "").toLowerCase();
      const role =
        explicitRole ||
        (tag === "a"
          ? "link"
          : tag === "button" || typeAttr === "submit" || typeAttr === "button"
            ? "button"
            : tag === "select"
              ? "combobox"
              : typeAttr === "checkbox"
                ? "checkbox"
                : typeAttr === "radio"
                  ? "radio"
                  : tag === "input" || tag === "textarea"
                    ? "textbox"
                    : tag);

      const ariaLabel = el.getAttribute("aria-label") || "";
      const idAttr = el.getAttribute("id") || "";
      const nameAttr = el.getAttribute("name") || "";
      const placeholder = el.getAttribute("placeholder") || "";

      let labelText = "";
      if (idAttr) {
        const lbl = g.document.querySelector(`label[for="${escapeCssIdent(idAttr)}"]`);
        if (lbl) labelText = (lbl.textContent || "").trim();
      }
      if (!labelText) {
        const parentLbl = el.closest("label");
        if (parentLbl) labelText = (parentLbl.textContent || "").trim();
      }

      const rawName = (
        ariaLabel ||
        labelText ||
        (tag === "input" ? (el.value ?? "") : "") ||
        placeholder ||
        el.innerText ||
        el.textContent ||
        nameAttr ||
        idAttr
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);

      let baseSelector = tag;
      if (idAttr) {
        baseSelector = `#${escapeCssIdent(idAttr)}`;
      } else if (nameAttr) {
        baseSelector = `${tag}[name="${escapeCssIdent(nameAttr)}"]`;
      } else if (ariaLabel) {
        baseSelector = `${tag}[aria-label="${escapeCssIdent(ariaLabel)}"]`;
      } else if (explicitRole) {
        baseSelector = `${tag}[role="${escapeCssIdent(explicitRole)}"]`;
      }

      const nth = selectorCounter.get(baseSelector) ?? 0;
      selectorCounter.set(baseSelector, nth + 1);

      const hasValue = tag === "input" || tag === "textarea" || tag === "select";
      const val = hasValue && typeof el.value === "string" ? el.value : undefined;
      const checked =
        typeAttr === "checkbox" || typeAttr === "radio" ? Boolean(el.checked) : undefined;
      const disabled = Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true";
      const href = tag === "a" ? el.href : undefined;

      visibleNodes.push({
        role,
        tag,
        name: rawName,
        value: val,
        placeholder: placeholder || undefined,
        href,
        checked,
        disabled,
        typeAttr,
        autocomplete: el.getAttribute("autocomplete") || "",
        nameAttr,
        idAttr,
        ariaLabel,
        selector: baseSelector,
        nth,
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    }

    const total = visibleNodes.length;
    const bodyText = (g.document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1800);

    return {
      total,
      sliced: visibleNodes.slice(0, maxItems),
      bodyText,
    };
  }, MAX_SNAPSHOT_ELEMENTS);

  const elements: BrowserSnapshotElement[] = [];
  const refMap = new Map<string, SnapshotRefMeta>();

  rawCollected.sliced.forEach((item, index) => {
    const ref = `e${index + 1}`;
    const sensitive = isSensitiveFieldHint({
      type: item.typeAttr,
      autocomplete: item.autocomplete,
      name: item.nameAttr,
      id: item.idAttr,
      ariaLabel: item.ariaLabel,
      placeholder: item.placeholder,
    });

    const safeValue =
      item.value !== undefined
        ? sensitive
          ? "[oculto]"
          : item.value.slice(0, 160)
        : undefined;

    elements.push({
      ref,
      role: item.role,
      tag: item.tag,
      name: item.name,
      ...(safeValue !== undefined ? { value: safeValue } : {}),
      ...(item.placeholder ? { placeholder: item.placeholder.slice(0, 120) } : {}),
      ...(item.href ? { href: item.href.slice(0, 240) } : {}),
      ...(item.checked !== undefined ? { checked: item.checked } : {}),
      ...(item.disabled ? { disabled: true } : {}),
      ...(sensitive ? { isSensitive: true } : {}),
      bounds: item.bounds,
    });

    refMap.set(ref, {
      ref,
      role: item.role,
      tag: item.tag,
      name: item.name,
      selector: item.selector,
      nth: item.nth,
      isSensitive: sensitive,
      disabled: item.disabled,
      bounds: item.bounds,
    });
  });

  let imageDataUrl: string | null = null;
  if (includeImage) {
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 72 });
      imageDataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch {
      imageDataUrl = null;
    }
  }

  const lines = elements.map((el) => {
    const parts = [`[${el.ref}] ${el.role}`];
    if (el.name) parts.push(`"${el.name}"`);
    if (el.value !== undefined && el.value !== "") parts.push(`valor=${JSON.stringify(el.value)}`);
    if (el.isSensitive) parts.push("(campo secreto protegido)");
    if (el.disabled) parts.push("(desabilitado)");
    return parts.join(" ");
  });

  const summaryHeader = `Página: ${title || "(sem título)"} — ${url} (revisão ${revision})`;
  const textSummary = [
    summaryHeader,
    rawCollected.bodyText ? `Resumo visível: ${rawCollected.bodyText}` : "",
    lines.length > 0 ? `Elementos interativos (${lines.length}):\n${lines.join("\n")}` : "Nenhum elemento interativo visível.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    snapshot: {
      tabId,
      perfilId,
      url,
      title,
      revision,
      elements,
      textSummary,
      truncated: rawCollected.total > MAX_SNAPSHOT_ELEMENTS,
      ...(imageDataUrl ? { imageDataUrl } : {}),
    },
    refMap,
  };
}

/**
 * Resolve qualquer um dos 5 seletores semânticos (`ref`, `role`, `text`, `css`, `point`) validando `revision`.
 */
export function resolveBrowserTarget(
  page: Page,
  target: BrowserTargetSelector,
  snapshotMap?: Map<string, SnapshotRefMeta>,
  currentRevision?: number,
): {
  locator?: Locator;
  point?: { x: number; y: number };
  meta?: SnapshotRefMeta;
} {
  switch (target.kind) {
    case "ref": {
      if (
        target.revision !== undefined &&
        currentRevision !== undefined &&
        target.revision !== currentRevision
      ) {
        throw new Error(
          `Referência '${target.ref}' pertence à revisão ${target.revision}, mas a aba está na revisão ${currentRevision}. Execute um novo 'snapshot' antes de agir.`,
        );
      }
      const meta = snapshotMap?.get(target.ref);
      if (!meta) {
        throw new Error(
          `Referência '${target.ref}' não encontrada no snapshot atual. Execute 'snapshot' para atualizar as referências.`,
        );
      }
      return {
        locator: page.locator(meta.selector).nth(meta.nth),
        meta,
      };
    }

    case "role": {
      const loc = page.getByRole(target.role as Parameters<Page["getByRole"]>[0], {
        ...(target.name ? { name: target.name, exact: Boolean(target.exact) } : {}),
      });
      return {
        locator: typeof target.nth === "number" ? loc.nth(target.nth) : loc.first(),
      };
    }

    case "text": {
      const loc = page.getByText(target.text, { exact: Boolean(target.exact) });
      return {
        locator: typeof target.nth === "number" ? loc.nth(target.nth) : loc.first(),
      };
    }

    case "css": {
      const loc = page.locator(target.selector);
      return {
        locator: typeof target.nth === "number" ? loc.nth(target.nth) : loc.first(),
      };
    }

    case "point": {
      return {
        point: { x: Number(target.x), y: Number(target.y) },
      };
    }

    default:
      throw new Error("Tipo de seletor BrowserTargetSelector desconhecido.");
  }
}
