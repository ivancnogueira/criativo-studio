export interface BrowserNavigationPolicy {
  allowedDomains?: string[];
  blockedDomains?: string[];
  blockSensitiveActions?: boolean;
}

export type SensitiveBrowserActionKind = "upload" | "download" | "payment_submit";

function matchDomainPattern(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase().trim();
  const pat = pattern.toLowerCase().trim().replace(/^\*\./, "");
  if (!host || !pat) return false;
  return host === pat || host.endsWith(`.${pat}`);
}

/**
 * Valida regras de domínio (`allowedDomains`, `blockedDomains`) e ações sensíveis
 * antes da execução automática do agente no navegador.
 */
export class BrowserPolicyGuard {
  private readonly policy: BrowserNavigationPolicy;

  constructor(policy: BrowserNavigationPolicy = {}) {
    this.policy = policy;
  }

  public assertUrlAllowed(rawUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`[CRV-AUTH-002] URL inválida para política de navegador: '${rawUrl}'.`);
    }

    const host = parsed.hostname.toLowerCase();
    const blocked = this.policy.blockedDomains ?? [];
    if (blocked.some((pat) => matchDomainPattern(host, pat))) {
      throw new Error(
        `[CRV-AUTH-002] Navegação bloqueada pela política de segurança do agente: domínio '${host}' está na lista de bloqueio.`
      );
    }

    const allowed = (this.policy.allowedDomains ?? []).filter((d) => d.trim().length > 0);
    if (allowed.length > 0 && !allowed.some((pat) => matchDomainPattern(host, pat))) {
      throw new Error(
        `[CRV-AUTH-002] Domínio '${host}' não está na lista de domínios autorizados deste agente.`
      );
    }
  }

  public assertSensitiveActionAllowed(
    kind: SensitiveBrowserActionKind,
    hintText?: string
  ): void {
    if (this.policy.blockSensitiveActions === false) return;
    if (kind === "payment_submit") {
      throw new Error(
        `[CRV-AUTH-002] Ação sensível '${kind}' (${hintText ?? "checkout/pagamento"}) bloqueada para automação autônoma. Solicite confirmação humana.`
      );
    }
  }
}

export function looksLikePaymentSubmitHint(rawHint: string): boolean {
  const lower = String(rawHint ?? "").toLowerCase();
  return /(finalizar compra|pagar agora|confirmar pagamento|credit.?card|cvv|checkout|place order|pay now)/i.test(
    lower
  );
}
