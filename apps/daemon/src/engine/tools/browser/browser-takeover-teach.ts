import { randomUUID } from "node:crypto";
import type {
  BrowserProfileInfo,
  BrowserProfileProxyPayload,
  BrowserProxyConfig,
  BrowserProxyProtocol,
  BrowserSnapshotResult,
  BrowserStatusReport,
  BrowserTabSummary,
  BrowserTakeoverReason,
  BrowserTakeoverSession,
  BrowserTargetSelector,
  PermissionLevel,
  UserBrowsingStep,
} from "@criativo/contracts";
import {
  BrowserCdpSessionManager,
  type HumanCdpInputEvent,
  type ManagedTabEntry,
} from "../browser-cdp-session.ts";
import {
  assertSafeNavigationUrl,
  assertSafeUploadPaths,
  buildSemanticSnapshot,
  isSensitiveFieldHint,
  resolveBrowserTarget,
} from "../browser-snapshot.ts";
import { SHARED_BROWSER_PROFILE_ID, type BrowserAutomationRuntimeContext, type PendingTakeoverEntry } from "./browser-types.ts";

export function createVirtualBrowserTabForSession(
  ctx: BrowserAutomationRuntimeContext,
params: {
    perfilId?: string;
    agenteId?: string | null;
    url: string;
    title?: string;
  }): ManagedTabEntry {
    const safeUrl = assertSafeNavigationUrl(params.url);
    return ctx.sessionManager.createVirtualTab({
      perfilId: params.perfilId ?? SHARED_BROWSER_PROFILE_ID,
      agenteId: params.agenteId ?? null,
      url: safeUrl.toString(),
      title: params.title,
    });
  }

export async function requestBrowserTakeover(
  ctx: BrowserAutomationRuntimeContext,
params: {
    tabId: string;
    agenteId: string | null;
    canalId?: string | null;
    reason: BrowserTakeoverReason;
    waitForResolution?: boolean;
    timeoutMs?: number;
  }): Promise<
    | BrowserTakeoverSession
    | {
        decision: "complete" | "cancel" | "timeout";
        takeoverId: string;
        tabId: string;
        snapshot?: BrowserSnapshotResult;
        note?: string;
      }
  > {
    let tab = ctx.sessionManager.getTab(params.tabId);
    if (!tab) {
      throw new Error(`Aba '${params.tabId}' não encontrada para iniciar BrowserTakeover.`);
    }
    if (tab.unloaded) {
      tab = await ctx.ensureRealTabLoaded(tab.tabId);
    }

    tab.userControl = true;
    tab.lastActivityAt = Date.now();

    let previewDataUrl: string | null = null;
    if (tab.page) {
      try {
        const buf = await tab.page.screenshot({ type: "jpeg", quality: 68 });
        previewDataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
      } catch {
        previewDataUrl = null;
      }
    }

    const existing = ctx.activeTakeovers.get(params.tabId);
    const session: BrowserTakeoverSession = existing?.session ?? {
      takeoverId: `tkv-${randomUUID().slice(0, 8)}`,
      tabId: tab.tabId,
      perfilId: tab.perfilId,
      agenteId: params.agenteId ?? tab.agenteId,
      canalId: params.canalId ?? null,
      reason: params.reason,
      url: tab.page ? tab.page.url() : tab.virtualUrl,
      title: tab.virtualTitle || "Sessão do Navegador",
      status: "active",
      previewDataUrl,
      criadoEm: new Date().toISOString(),
    };

    const pendingEntry: PendingTakeoverEntry = existing ?? { session, resolvers: [] };
    ctx.activeTakeovers.set(params.tabId, pendingEntry);

    ctx.ensureTabPreviewStream(tab);
    ctx.getWsHub()?.broadcast("browser:tabs_updated", {
      tabs: ctx.sessionManager.listTabSummaries(),
      activeTabId: tab.tabId,
      agenteId: session.agenteId,
    });
    ctx.getWsHub()?.broadcast("browser:takeover_requested", session);

    if (!params.waitForResolution) {
      return session;
    }

    const waitTimeoutMs = Math.min(Math.max(1_000, params.timeoutMs ?? 60_000), 120_000);

    return await new Promise((resolvePromise) => {
      let settled = false;
      const onResolved = (res: { decision: "complete" | "cancel"; snapshot?: BrowserSnapshotResult }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          decision: res.decision,
          takeoverId: session.takeoverId,
          tabId: tab.tabId,
          snapshot: res.snapshot,
        });
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        pendingEntry.resolvers = pendingEntry.resolvers.filter((fn) => fn !== onResolved);
        resolvePromise({
          decision: "timeout",
          takeoverId: session.takeoverId,
          tabId: tab.tabId,
          note: "O usuário ainda está interagindo no navegador integrado. Aguarde a confirmação do usuário ou que ele clique em 'Terminei'.",
        });
      }, waitTimeoutMs);
      timer.unref?.();

      pendingEntry.resolvers.push(onResolved);
    });
  }

export async function resolveBrowserTakeover(
  ctx: BrowserAutomationRuntimeContext,

    tabId: string,
    decision: "complete" | "cancel",
  ): Promise<{
    ok: boolean;
    takeoverId: string | null;
    tabId: string;
    decision: "complete" | "cancel";
    snapshot: BrowserSnapshotResult;
  }> {
    const tab = ctx.sessionManager.getTab(tabId);
    if (!tab) {
      throw new Error(`Aba '${tabId}' não encontrada.`);
    }

    tab.userControl = false;
    if (tab.teachRecording) {
      stopBrowserTeachRecording(ctx, tabId, "save");
    }

    tab.revision += 1;
    const snapshot = await ctx.captureTabSnapshot(tab, false);

    const pending = ctx.activeTakeovers.get(tabId);
    ctx.activeTakeovers.delete(tabId);
    const takeoverId = pending?.session.takeoverId ?? null;

    if (pending) {
      pending.session.status = decision === "complete" ? "completed" : "cancelled";
      for (const fn of pending.resolvers) {
        fn({ decision, snapshot });
      }
    }

    ctx.getWsHub()?.broadcast("browser:takeover_resolved", {
      takeoverId: takeoverId ?? `tkv-${tabId}`,
      tabId,
      agenteId: tab.agenteId,
      decision,
      url: snapshot.url,
      title: snapshot.title,
    });
    ctx.broadcastTabsAndFrame(tab);

    return {
      ok: true,
      takeoverId,
      tabId,
      decision,
      snapshot,
    };
  }

export async function dispatchBrowserTakeoverInput(
  ctx: BrowserAutomationRuntimeContext,

    tabId: string,
    event: HumanCdpInputEvent,
    options?: { autoAssume?: boolean },
  ): Promise<{ ok: boolean }> {
    let tab = ctx.sessionManager.getTab(tabId);
    if (!tab) {
      throw new Error(`Aba '${tabId}' não encontrada.`);
    }
    if (tab.unloaded && !tab.userControl) {
      tab = await ctx.ensureRealTabLoaded(tab.tabId);
    } else if (tab.unloaded && tab.userControl) {
      tab.userControl = false;
      tab = await ctx.ensureRealTabLoaded(tab.tabId);
      tab.userControl = true;
    }
    if (!tab.userControl) {
      if (options?.autoAssume) {
        await requestBrowserTakeover(ctx, {
          tabId,
          agenteId: tab.agenteId,
          reason: "manual",
          waitForResolution: false,
        });
      } else {
        throw new Error(
          `Input humano recusado: a aba '${tabId}' não está em modo de controle humano ativo (BrowserTakeover).`,
        );
      }
    }

    await ctx.sessionManager.dispatchHumanInput(tabId, event);
    if (event.type === "mousePressed" || event.type === "wheel" || event.type === "insertText") {
      ctx.ensureTabPreviewStream(tab);
    }

    // Durante gravação BrowserTeachBar, registra cliques resolvendo role/name sem gravar teclas digitadas
    if (tab.teachRecording && tab.agenteId && event.type === "mousePressed") {
      let clickedRole = "elemento";
      let clickedName: string | null = null;
      if (tab.page && typeof event.x === "number" && typeof event.y === "number") {
        try {
          const hit = await tab.page.evaluate(
            ({ x, y }) => {
              const g = globalThis as unknown as {
                document: {
                  elementFromPoint(px: number, py: number): {
                    tagName: string;
                    innerText?: string;
                    getAttribute(attr: string): string | null;
                  } | null;
                };
              };
              const el = g.document.elementFromPoint(x, y);
              if (!el) return null;
              const role = el.getAttribute("role") || el.tagName.toLowerCase();
              const name = (
                el.getAttribute("aria-label") ||
                el.innerText ||
                el.getAttribute("placeholder") ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80);
              return { role, name };
            },
            { x: event.x, y: event.y },
          );
          if (hit) {
            clickedRole = hit.role;
            clickedName = hit.name || null;
          }
        } catch {
          // ignora falha de inspeção puntual
        }
      }

      ctx.browsingLog.recordStep(tab.agenteId, {
        kind: "click",
        url: tab.page ? tab.page.url() : tab.virtualUrl,
        role: clickedRole,
        name: clickedName,
      });
      broadcastBrowserTeachStatus(ctx, tab);
    }

    return { ok: true };
  }

  /**
   * Injeta senha/OTP diretamente via CDP/DOM sem jamais retornar ou logar o valor em claro.
   */
export async function submitBrowserSecret(
  ctx: BrowserAutomationRuntimeContext,
params: {
    tabId: string;
    method: "password" | "otp" | "authenticator";
    targets: BrowserTargetSelector[];
    loginId?: string | null;
    username?: string | null;
    secret?: string | null;
    saveToVault?: boolean;
    loginLabel?: string | null;
    submission?: "enter" | "click" | "none";
    submitTarget?: BrowserTargetSelector | null;
  }): Promise<{
    ok: boolean;
    tabId: string;
    filledFields: number;
    savedLoginId: string | null;
  }> {
    const tab = ctx.sessionManager.getTab(params.tabId);
    if (!tab) {
      throw new Error(`Aba '${params.tabId}' não encontrada.`);
    }

    let plainSecret = typeof params.secret === "string" ? params.secret : null;
    let resolvedUsername = typeof params.username === "string" ? params.username : null;

    if (!plainSecret && params.loginId && ctx.vault) {
      const rawStored = ctx.vault.getSecret(`vault_login:${params.loginId}`);
      if (rawStored) {
        try {
          const parsed = JSON.parse(rawStored) as { username?: string; secret?: string };
          plainSecret = parsed.secret ?? null;
          if (!resolvedUsername && parsed.username) resolvedUsername = parsed.username;
        } catch {
          plainSecret = rawStored;
        }
      }
    }

    if (!plainSecret) {
      throw new Error("Nenhuma credencial fornecida ou encontrada no Cofre para preenchimento.");
    }

    let savedLoginId: string | null = null;
    if (params.saveToVault && ctx.vault) {
      savedLoginId = params.loginId?.trim() || `login-${randomUUID().slice(0, 8)}`;
      ctx.vault.setSecret(
        `vault_login:${savedLoginId}`,
        JSON.stringify({
          label: params.loginLabel ?? tab.virtualUrl,
          username: resolvedUsername ?? "",
          secret: plainSecret,
          updatedAt: new Date().toISOString(),
        }),
      );
    }

    let filledFields = 0;
    if (tab.page && params.targets.length > 0) {
      if (params.method !== "password" && params.targets.length > 1) {
        const chars = Array.from(plainSecret);
        for (let idx = 0; idx < params.targets.length && idx < chars.length; idx += 1) {
          const resolved = resolveBrowserTarget(
            tab.page,
            params.targets[idx]!,
            tab.snapshotRefs,
            tab.revision,
          );
          if (resolved.locator) {
            await resolved.locator.fill(chars[idx]!, { timeout: 6_000 });
            filledFields += 1;
          }
        }
      } else {
        const primary = resolveBrowserTarget(
          tab.page,
          params.targets[0]!,
          tab.snapshotRefs,
          tab.revision,
        );
        if (primary.locator) {
          await primary.locator.fill(plainSecret, { timeout: 8_000 });
          filledFields += 1;
          if (params.submission === "enter") {
            await primary.locator.press("Enter");
          }
        }
      }

      if (params.submission === "click" && params.submitTarget) {
        const btn = resolveBrowserTarget(
          tab.page,
          params.submitTarget,
          tab.snapshotRefs,
          tab.revision,
        );
        await btn.locator?.click({ timeout: 8_000 });
      }
      tab.revision += 1;
    } else {
      filledFields = Math.max(1, params.targets.length);
    }

    return {
      ok: true,
      tabId: tab.tabId,
      filledFields,
      savedLoginId,
    };
  }

export function broadcastBrowserTeachStatus(
  ctx: BrowserAutomationRuntimeContext,
tab: ManagedTabEntry): void {
    if (!tab.agenteId) return;
    const steps = ctx.browsingLog.listSteps(tab.agenteId, { onlyUnreviewed: true });
    ctx.getWsHub()?.broadcast("browser:teach_status", {
      tabId: tab.tabId,
      agenteId: tab.agenteId,
      recording: tab.teachRecording,
      startedAt: tab.teachStartedAt,
      stepsCount: steps.length,
    });
  }

export async function startBrowserTeachRecording(
  ctx: BrowserAutomationRuntimeContext,

    tabId: string,
    agenteId?: string | null,
  ): Promise<{ ok: boolean; tabId: string; agenteId: string; startedAt: number }> {
    let tab = ctx.sessionManager.getTab(tabId);
    if (!tab) {
      throw new Error(`Aba '${tabId}' não encontrada.`);
    }
    if (tab.unloaded && !tab.userControl) {
      tab = await ctx.ensureRealTabLoaded(tab.tabId);
    } else if (tab.unloaded && tab.userControl) {
      tab.userControl = false;
      tab = await ctx.ensureRealTabLoaded(tab.tabId);
      tab.userControl = true;
    }
    const effectiveAgent = agenteId?.trim() || tab.agenteId || "estrategista";
    tab.agenteId = effectiveAgent;
    tab.teachRecording = true;
    tab.teachStartedAt = Date.now();

    ctx.browsingLog.recordStep(effectiveAgent, {
      kind: "page",
      url: tab.page ? tab.page.url() : tab.virtualUrl,
      title: tab.virtualTitle,
    });
    broadcastBrowserTeachStatus(ctx, tab);

    return {
      ok: true,
      tabId: tab.tabId,
      agenteId: effectiveAgent,
      startedAt: tab.teachStartedAt,
    };
  }

export function stopBrowserTeachRecording(
  ctx: BrowserAutomationRuntimeContext,

    tabId: string,
    action: "save" | "discard",
  ): {
    ok: boolean;
    action: "save" | "discard";
    steps: UserBrowsingStep[];
    recordedTaskText: string;
  } {
    const tab = ctx.sessionManager.getTab(tabId);
    if (!tab) {
      throw new Error(`Aba '${tabId}' não encontrada.`);
    }
    const effectiveAgent = tab.agenteId ?? "estrategista";
    tab.teachRecording = false;
    tab.teachStartedAt = null;

    if (action === "discard") {
      ctx.browsingLog.clearSteps(effectiveAgent);
      broadcastBrowserTeachStatus(ctx, tab);
      return {
        ok: true,
        action: "discard",
        steps: [],
        recordedTaskText: ctx.browsingLog.formatRecordedTaskFile([]),
      };
    }

    const steps = ctx.browsingLog.listSteps(effectiveAgent, { onlyUnreviewed: true });
    broadcastBrowserTeachStatus(ctx, tab);
    return {
      ok: true,
      action: "save",
      steps,
      recordedTaskText: ctx.browsingLog.formatRecordedTaskFile(steps),
    };
  }
