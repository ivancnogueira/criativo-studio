import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  apiFetch,
  DEFAULT_MUTATION_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../src/services/http-client.ts";

const WEB_ROOT = resolve(import.meta.dirname, "..");

test("DM47-07: apiFetch aborta leituras em 15s e preserva 180s para mutacoes POST", async () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 15_000);
  assert.equal(DEFAULT_MUTATION_TIMEOUT_MS, 180_000);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    return new Promise((resolveFetch, rejectFetch) => {
      init?.signal?.addEventListener("abort", () => {
        rejectFetch(init.signal?.reason ?? new Error("aborted"));
      });
      if (init?.method === "POST") {
        setTimeout(() => resolveFetch(new Response("ok", { status: 200 })), 35);
      }
    });
  };

  try {
    await assert.rejects(
      () => apiFetch("/api/ping", { timeoutMs: 40 }),
      /Tempo limite|aborted/i
    );
    const mutRes = await apiFetch("/api/rotinas", { method: "POST" });
    assert.equal(mutRes.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DM47-07: useStudioBootstrap desacopla probes de CLI/uso do bloqueio inicial e tem teto de seguranca", () => {
  const src = readFileSync(resolve(WEB_ROOT, "src/hooks/useStudioBootstrap.ts"), "utf8");
  assert.match(src, /setTimeout\(\s*\(\)\s*=>\s*\{\s*setBootLoading\(false\);/s);

  const mainPromiseAllMatch = src.match(/\]\s*=\s*await\s+Promise\.all\(\[([\s\S]*?)\]\);/);
  assert.ok(mainPromiseAllMatch, "Promise.all principal de hydrateAll deve existir");
  const blockingBlock = mainPromiseAllMatch[1] ?? "";
  assert.doesNotMatch(blockingBlock, /listProvidersStatus/);
  assert.doesNotMatch(blockingBlock, /getProvidersUsage/);
  assert.doesNotMatch(blockingBlock, /getUsageAnalytics/);
});

test("DM47-07: StudioSplashPreloader possui instancia unica no App.tsx e nao duplica no gate", () => {
  const appSrc = readFileSync(resolve(WEB_ROOT, "src/App.tsx"), "utf8");
  const gateSrc = readFileSync(
    resolve(WEB_ROOT, "src/components/studio/StudioAuthAndOnboardingGate.tsx"),
    "utf8"
  );

  const appMatches = appSrc.match(/<StudioSplashPreloader\b/g) ?? [];
  assert.equal(appMatches.length, 1, "App.tsx deve renderizar exatamente uma instancia de StudioSplashPreloader");
  assert.doesNotMatch(
    gateSrc,
    /<StudioSplashPreloader\b/,
    "StudioAuthAndOnboardingGate.tsx nao deve duplicar StudioSplashPreloader"
  );
});
