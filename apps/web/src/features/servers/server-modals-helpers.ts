import type { ServerQuotaSummary } from "@criativo/contracts";

export const SERVER_ACCENT_COLORS = [
  { hex: "#E88B2D", label: "Âmbar" },
  { hex: "#31CF76", label: "Esmeralda" },
  { hex: "#4E8DFF", label: "Cobalto" },
  { hex: "#9B6DFF", label: "Violeta" },
  { hex: "#EC5C8D", label: "Magenta" },
  { hex: "#2EC4B6", label: "Turquesa" },
  { hex: "#F2555A", label: "Coral" },
  { hex: "#DDA100", label: "Ouro" },
  { hex: "#04A9D8", label: "Ciano" },
  { hex: "#7689FC", label: "Índigo" },
  { hex: "#CD5BD8", label: "Orquídea" },
  { hex: "#0BFF5C", label: "Verde Neon" },
] as const;

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Segue para fallback clássico em textarea (ex.: contexto Electron/iframe sem foco)
    }
  }
  if (typeof document !== "undefined" && document.body) {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const copied = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
  return false;
}

export function formatCountdownMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function isLocalQuotaBlocked(quota: ServerQuotaSummary | null): {
  blocked: boolean;
  message: string | null;
} {
  if (!quota) return { blocked: false, message: null };
  if (quota.max_local_servers === 0) {
    return {
      blocked: true,
      message:
        quota.reason ||
        "Seu plano Individual inclui o servidor principal neste computador e 1 servidor VPS remoto. Para múltiplos servidores locais isolados, faça upgrade para Agência 10 ou Agência Ilimitada.",
    };
  }
  if (quota.max_local_servers > 0 && quota.local_used >= quota.max_local_servers) {
    return {
      blocked: true,
      message:
        quota.reason ||
        `Limite local atingido (${quota.local_used} de ${quota.max_local_servers} servidores locais permitidos neste plano).`,
    };
  }
  if (!quota.allowed) {
    return {
      blocked: true,
      message:
        quota.reason ||
        `Cota de servidores atingida (${quota.servers_used} de ${quota.max_servers} no plano atual).`,
    };
  }
  return { blocked: false, message: null };
}

export function isRemoteQuotaBlocked(quota: ServerQuotaSummary | null): {
  blocked: boolean;
  message: string | null;
} {
  if (!quota) return { blocked: false, message: null };
  if (quota.max_remote_servers >= 0 && quota.remote_used >= quota.max_remote_servers) {
    return {
      blocked: true,
      message:
        quota.reason ||
        `Limite de servidores remotos atingido (${quota.remote_used} de ${quota.max_remote_servers} no plano atual).`,
    };
  }
  if (!quota.allowed) {
    return {
      blocked: true,
      message:
        quota.reason ||
        `Cota de servidores atingida (${quota.servers_used} de ${quota.max_servers} no plano atual).`,
    };
  }
  return { blocked: false, message: null };
}

/* ============================================================================
 * MODAL 1: Novo servidor neste computador (Print 3)
 * ============================================================================ */
