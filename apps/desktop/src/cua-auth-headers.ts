/**
 * Helpers puros (sem dependência do Electron) para resolução e propagação do
 * token Bearer do Daemon nas chamadas do runtime CUA Desktop → Daemon.
 */

export function resolveCuaServerToken(explicitToken?: string | null): string | null {
  const candidate = (
    explicitToken ??
    process.env.CRIATIVO_SERVER_ACCESS_TOKEN ??
    process.env.CRIATIVO_SERVER_TOKEN ??
    ""
  ).trim();
  return candidate.length > 0 ? candidate : null;
}

export function buildCuaDaemonHeaders(
  token?: string | null,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
  const resolved = resolveCuaServerToken(token);
  if (resolved) {
    headers.Authorization = `Bearer ${resolved}`;
  }
  return headers;
}
