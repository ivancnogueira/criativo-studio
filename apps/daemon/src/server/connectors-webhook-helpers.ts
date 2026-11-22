import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function maskSecretValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function safeEqualStrings(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifySlackHmacSignature(
  secret: string | null,
  rawBody: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!secret || !timestampHeader || !signatureHeader) return false;
  const tsSeconds = Number(timestampHeader.trim());
  if (!Number.isFinite(tsSeconds)) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - tsSeconds) > 300) return false;
  const sig = signatureHeader.trim();
  if (!sig.startsWith("v0=")) return false;
  const baseString = `v0:${timestampHeader.trim()}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(baseString, "utf8").digest("hex")}`;
  return safeEqualStrings(expected, sig);
}

export function verifyDiscordEd25519Signature(
  pubKeyRaw: string | null,
  rawBody: string,
  signatureHex: string | undefined,
  timestamp: string | undefined,
): boolean {
  if (!pubKeyRaw || !signatureHex || !timestamp) return false;
  try {
    const keyObj = pubKeyRaw.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(pubKeyRaw)
      : createPublicKey({
          key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubKeyRaw.trim(), "hex")]),
          format: "der",
          type: "spki",
        });
    const message = Buffer.from(`${timestamp}${rawBody}`, "utf8");
    const signature = Buffer.from(signatureHex.trim(), "hex");
    return cryptoVerify(null, message, keyObj, signature);
  } catch {
    return false;
  }
}

export async function postSlackChatMessage(params: {
  token: string;
  channel: string;
  text: string;
  threadTs?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; ts?: string; erro?: string }> {
  const fetchFn = params.fetchImpl ?? fetch;
  const payload: Record<string, unknown> = { channel: params.channel, text: params.text };
  if (params.threadTs) {
    payload.thread_ts = params.threadTs;
  }
  const resp = await fetchFn("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await resp.json()) as { ok?: boolean; ts?: string; error?: string };
  return data.ok
    ? { ok: true, ts: data.ts }
    : { ok: false, erro: data.error ?? `HTTP ${resp.status}` };
}

export async function postDiscordChannelMessage(params: {
  token: string;
  channelId: string;
  content: string;
  replyToMessageId?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; erro?: string }> {
  const fetchFn = params.fetchImpl ?? fetch;
  const bodyPayload: Record<string, unknown> = {
    content: params.content.slice(0, 2000),
  };
  if (params.replyToMessageId) {
    bodyPayload.message_reference = { message_id: params.replyToMessageId };
  }
  const resp = await fetchFn(
    `https://discord.com/api/v10/channels/${encodeURIComponent(params.channelId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${params.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(10_000),
    },
  );
  return resp.ok ? { ok: true } : { ok: false, erro: `Discord HTTP ${resp.status}` };
}
