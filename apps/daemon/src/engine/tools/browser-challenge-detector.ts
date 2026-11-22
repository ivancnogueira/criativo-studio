export type BrowserChallengeKind =
  | "recaptcha"
  | "hcaptcha"
  | "turnstile"
  | "2fa"
  | "login_wall"
  | "anti_bot";

export interface BrowserChallengeInspectionInput {
  url: string;
  title?: string;
  textSnippet?: string;
  selectorHits?: string[];
}

export interface BrowserChallengeDetectionResult {
  detected: boolean;
  kind?: BrowserChallengeKind;
  action: "continue" | "pause_for_human";
  bypassAttempted: false;
  reason?: string;
  url: string;
  title: string;
}

const CHALLENGE_PATTERNS: Array<{
  kind: BrowserChallengeKind;
  reason: string;
  urlPatterns: RegExp[];
  textPatterns: RegExp[];
  selectors: string[];
}> = [
  {
    kind: "turnstile",
    reason: "Cloudflare Turnstile / verificação anti-bot detectada. Intervenção humana necessária.",
    urlPatterns: [/\/cdn-cgi\/challenge-platform/i, /challenges\.cloudflare\.com/i],
    textPatterns: [/just a moment\.\.\./i, /verify you are human/i, /checking your browser before accessing/i],
    selectors: ['iframe[src*="challenges.cloudflare.com"]', ".cf-turnstile", "#cf-challenge-running"],
  },
  {
    kind: "recaptcha",
    reason: "Google reCAPTCHA detectado na página. Pausado para resolução humana.",
    urlPatterns: [/google\.com\/recaptcha/i, /sorry\/index/i],
    textPatterns: [/i'?m not a robot/i, /não sou um robô/i],
    selectors: ['iframe[src*="recaptcha"]', ".g-recaptcha", "#recaptcha"],
  },
  {
    kind: "hcaptcha",
    reason: "hCaptcha detectado na página. Pausado para resolução humana.",
    urlPatterns: [/hcaptcha\.com/i],
    textPatterns: [/hcaptcha/i, /please complete the security check/i],
    selectors: ['iframe[src*="hcaptcha.com"]', ".h-captcha"],
  },
  {
    kind: "2fa",
    reason: "Solicitação de autenticação em duas etapas (2FA/OTP) detectada.",
    urlPatterns: [/two[-_]?factor|2fa|otp|verification[-_]?code|checkpoint/i],
    textPatterns: [/two[- ]factor authentication/i, /código de verificação/i, /autenticação em duas etapas/i],
    selectors: ['input[autocomplete="one-time-code"]', 'input[name*="totp"]', 'input[name*="otp"]'],
  },
  {
    kind: "login_wall",
    reason: "Tela de login obrigatória ou sessão expirada detectada.",
    urlPatterns: [/\/accounts\/login/i, /\/login\?/i, /checkpoint\/challenge/i],
    textPatterns: [],
    selectors: ['input[type="password"]'],
  },
];

/**
 * Inspeciona passivamente sinais de desafios anti-bot/CAPTCHA/2FA.
 * REGRA DE SEGURANÇA: nunca clica, resolve, aguarda ou tenta burlar nenhum desafio;
 * apenas detecta e sinaliza pausa limpa para takeover humano.
 */
export function inspectBrowserChallenge(
  input: BrowserChallengeInspectionInput
): BrowserChallengeDetectionResult {
  const url = String(input.url ?? "");
  const title = String(input.title ?? "");
  const textSnippet = String(input.textSnippet ?? "");
  const selectorHits = new Set((input.selectorHits ?? []).map((s) => s.toLowerCase()));
  const combinedText = `${title}\n${textSnippet}`;

  for (const rule of CHALLENGE_PATTERNS) {
    if (rule.urlPatterns.some((re) => re.test(url))) {
      return {
        detected: true,
        kind: rule.kind,
        action: "pause_for_human",
        bypassAttempted: false,
        reason: rule.reason,
        url,
        title,
      };
    }
    if (rule.selectors.some((sel) => selectorHits.has(sel.toLowerCase()))) {
      return {
        detected: true,
        kind: rule.kind,
        action: "pause_for_human",
        bypassAttempted: false,
        reason: rule.reason,
        url,
        title,
      };
    }
    if (rule.textPatterns.some((re) => re.test(combinedText))) {
      return {
        detected: true,
        kind: rule.kind,
        action: "pause_for_human",
        bypassAttempted: false,
        reason: rule.reason,
        url,
        title,
      };
    }
  }

  return {
    detected: false,
    action: "continue",
    bypassAttempted: false,
    url,
    title,
  };
}

/**
 * Lê passivamente URL, título e seletores conhecidos de uma página CDP/Playwright para detectar desafios.
 */
export async function detectPageChallenge(page: {
  url?: () => string;
  title?: () => Promise<string>;
  evaluate?: <T>(fn: (sels: string[]) => T, arg: string[]) => Promise<T>;
}): Promise<BrowserChallengeDetectionResult> {
  const url = typeof page.url === "function" ? page.url() : "";
  const title = typeof page.title === "function" ? await page.title().catch(() => "") : "";
  const candidateSelectors = CHALLENGE_PATTERNS.flatMap((r) => r.selectors);
  let textSnippet = "";
  let selectorHits: string[] = [];

  if (typeof page.evaluate === "function") {
    try {
      const domProbe = await page.evaluate((sels: string[]) => {
        const doc = (globalThis as unknown as {
          document?: {
            body?: { innerText?: string };
            querySelector?: (q: string) => unknown;
          };
        }).document;
        if (!doc) return { text: "", hits: [] as string[] };
        const hits: string[] = [];
        for (const s of sels) {
          try {
            if (doc.querySelector?.(s)) hits.push(s);
          } catch {
            // seletor inválido ignorado
          }
        }
        return {
          text: String(doc.body?.innerText ?? "").slice(0, 1200),
          hits,
        };
      }, candidateSelectors);
      textSnippet = domProbe?.text ?? "";
      selectorHits = Array.isArray(domProbe?.hits) ? domProbe.hits : [];
    } catch {
      // falha passiva de inspeção nunca quebra o runtime
    }
  }

  return inspectBrowserChallenge({
    url,
    title,
    textSnippet,
    selectorHits,
  });
}
