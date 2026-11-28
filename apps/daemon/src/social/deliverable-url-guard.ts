import { isIP } from "node:net";

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * Garante que links públicos enviados via Direct usem exclusivamente HTTPS com domínio público
 * válido — proibindo estritamente http://, localhost e IPs brutos de VPS.
 */
export function assertSafePublicHttpsUrl(rawUrl: string): URL {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) {
    throw new Error("URL pública do entregável é obrigatória.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("URL pública inválida. Informe um endereço HTTPS completo (ex.: https://exemplo-marca.github.io/guia).");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Por segurança do Direct e do usuário, somente URLs HTTPS são permitidas (http:// é bloqueado).");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs com credenciais embutidas não são permitidas no Direct.");
  }

  const hostRaw = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostRaw) {
    throw new Error("Hostname público inválido.");
  }
  if (
    hostRaw === "localhost" ||
    hostRaw.endsWith(".localhost") ||
    hostRaw.endsWith(".local") ||
    hostRaw.endsWith(".internal")
  ) {
    throw new Error("Endereços locais (.localhost / .local / .internal) nunca podem ser enviados em Directs.");
  }

  if (isIP(hostRaw) !== 0 || isPrivateIpv4(hostRaw)) {
    throw new Error(
      "Bloqueado para proteger seu servidor: IPs brutos de VPS ou redes privadas não são permitidos no Direct. Use GitHub Pages ou um domínio HTTPS configurado."
    );
  }

  if (!hostRaw.includes(".")) {
    throw new Error("Informe um domínio HTTPS público completo com extensão (TLD).");
  }

  return parsed;
}
