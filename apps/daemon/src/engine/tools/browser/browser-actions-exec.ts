import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertSafeNavigationUrl,
  assertSafeUploadPaths,
  buildSemanticSnapshot,
  isSensitiveFieldHint,
  resolveBrowserTarget,
} from "../browser-snapshot.ts";
import { detectPageChallenge } from "../browser-challenge-detector.ts";
import {
  BrowserPolicyGuard,
  looksLikePaymentSubmitHint,
  type BrowserNavigationPolicy,
} from "../browser-policy-guard.ts";
import { BROWSER_FILL_FIELDS_MAX_FIELDS, BROWSER_FILL_FIELDS_MAX_TEXT_BYTES, type BrowserAutomationRuntimeContext, type BrowserExecuteActionInput } from "./browser-types.ts";

function loadAgentBrowserPolicy(
  db: BrowserAutomationRuntimeContext["db"],
  agenteId?: string | null
): BrowserPolicyGuard {
  if (!agenteId) return new BrowserPolicyGuard();
  try {
    const row = db.connection
      .prepare("SELECT config_json FROM projecao_agentes WHERE agente_id = ? LIMIT 1;")
      .get(agenteId) as { config_json?: string } | undefined;
    if (!row?.config_json) return new BrowserPolicyGuard();
    const cfg = JSON.parse(row.config_json) as { browser_policy?: BrowserNavigationPolicy };
    return new BrowserPolicyGuard(cfg.browser_policy ?? {});
  } catch {
    return new BrowserPolicyGuard();
  }
}

async function pauseIfChallengeDetected(
  ctx: BrowserAutomationRuntimeContext,
  entry: Parameters<BrowserAutomationRuntimeContext["captureTabSnapshot"]>[0],
  snap: Awaited<ReturnType<BrowserAutomationRuntimeContext["captureTabSnapshot"]>>
) {
  if (!entry.page) return snap;
  const challenge = await detectPageChallenge(entry.page);
  if (!challenge.detected) return snap;

  entry.userControl = true;
  ctx.getWsHub()?.broadcast("browser:challenge_detected", {
    tabId: entry.tabId,
    agenteId: entry.agenteId,
    kind: challenge.kind ?? "anti_bot",
    url: challenge.url,
    title: challenge.title,
    reason: challenge.reason ?? "Verificação anti-bot/CAPTCHA detectada.",
    detectedAt: new Date().toISOString(),
  });
  ctx.broadcastTabsAndFrame(entry);
  return {
    ...snap,
    challengeDetected: true,
    pausedForHuman: true,
    challenge,
  };
}

export async function executeBrowserCdpAction(
  ctx: BrowserAutomationRuntimeContext,
input: BrowserExecuteActionInput): Promise<unknown> {
    const action = input.action;

    switch (action) {
      case "status":
        return ctx.getStatus(input.agenteId ?? undefined);

      case "list_tabs":
        return { tabs: ctx.sessionManager.listTabSummaries(input.agenteId ?? undefined) };

      case "open": {
        const safeUrl = assertSafeNavigationUrl(input.url ?? "");
        loadAgentBrowserPolicy(ctx.db, input.agenteId).assertUrlAllowed(safeUrl.toString());
        const { profile, proxy } = ctx.resolveProfileAndLaunchProxy(input.perfilId, input.agenteId);

        const tab = await ctx.sessionManager.openTab({
          perfilId: profile.perfil_id,
          userDataDir: profile.user_data_dir,
          agenteId: input.agenteId ?? null,
          url: safeUrl.toString(),
          cdpUrl: profile.cdp_porta ? `http://127.0.0.1:${profile.cdp_porta}` : null,
          proxy,
          onPageNavigated: (t, navUrl, navTitle) => {
            if (t.teachRecording && t.agenteId) {
              ctx.browsingLog.recordStep(t.agenteId, {
                kind: "page",
                url: navUrl,
                title: navTitle,
              });
              ctx.broadcastTeachStatus(t);
            }
            ctx.broadcastTabsAndFrame(t);
          },
        });

        ctx.db.connection
          .prepare("UPDATE projecao_perfis_navegador SET ultimo_uso_em = ? WHERE perfil_id = ?;")
          .run(new Date().toISOString(), profile.perfil_id);

        const snap = await ctx.captureTabSnapshot(tab, Boolean(input.image));
        ctx.broadcastTabsAndFrame(tab);
        return await pauseIfChallengeDetected(ctx, tab, snap);
      }

      case "navigate": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        const safeUrl = assertSafeNavigationUrl(input.url ?? "");
        loadAgentBrowserPolicy(ctx.db, input.agenteId ?? entry.agenteId).assertUrlAllowed(safeUrl.toString());
        await entry.page!.goto(safeUrl.toString(), {
          waitUntil: "domcontentloaded",
          timeout: Math.min(Math.max(input.timeoutMs ?? 25_000, 1000), 60_000),
        });
        entry.revision += 1;
        const snap = await ctx.captureTabSnapshot(entry, Boolean(input.image));
        ctx.broadcastTabsAndFrame(entry);
        return await pauseIfChallengeDetected(ctx, entry, snap);
      }

      case "go_back": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        const pageAny = entry.page as unknown as { goBack?: () => Promise<unknown> };
        if (typeof pageAny.goBack === "function") {
          await pageAny.goBack().catch(() => {});
        } else {
          await entry.page!.evaluate(() => {
            (globalThis as unknown as { history?: { back?: () => void } }).history?.back?.();
          });
        }
        entry.revision += 1;
        const snap = await ctx.captureTabSnapshot(entry, Boolean(input.image));
        ctx.broadcastTabsAndFrame(entry);
        return snap;
      }

      case "go_forward": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        const pageAny = entry.page as unknown as { goForward?: () => Promise<unknown> };
        if (typeof pageAny.goForward === "function") {
          await pageAny.goForward().catch(() => {});
        } else {
          await entry.page!.evaluate(() => {
            (globalThis as unknown as { history?: { forward?: () => void } }).history?.forward?.();
          });
        }
        entry.revision += 1;
        const snap = await ctx.captureTabSnapshot(entry, Boolean(input.image));
        ctx.broadcastTabsAndFrame(entry);
        return snap;
      }

      case "reload": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        const pageAny = entry.page as unknown as { reload?: () => Promise<unknown> };
        if (typeof pageAny.reload === "function") {
          await pageAny.reload().catch(() => {});
        } else {
          await entry.page!.evaluate(() => {
            (globalThis as unknown as { location?: { reload?: () => void } }).location?.reload?.();
          });
        }
        entry.revision += 1;
        const snap = await ctx.captureTabSnapshot(entry, Boolean(input.image));
        ctx.broadcastTabsAndFrame(entry);
        return snap;
      }

      case "snapshot": {
        let tab = input.tabId ? ctx.sessionManager.getTab(input.tabId) : null;
        if (!tab) {
          throw new Error(`Aba '${input.tabId ?? ""}' não encontrada.`);
        }
        if (tab.unloaded) {
          tab = await ctx.ensureRealTabLoaded(tab.tabId);
        }
        return await ctx.captureTabSnapshot(tab, Boolean(input.image));
      }

      case "click": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em click.");
        const targetHint = JSON.stringify(input.target);
        if (looksLikePaymentSubmitHint(targetHint)) {
          loadAgentBrowserPolicy(ctx.db, input.agenteId ?? entry.agenteId).assertSensitiveActionAllowed(
            "payment_submit",
            targetHint
          );
        }
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        if (resolved.point) {
          await entry.page!.mouse.click(resolved.point.x, resolved.point.y);
        } else if (resolved.locator) {
          await resolved.locator.click({ timeout: 10_000 });
        }
        entry.revision += 1;
        const snap = await ctx.captureTabSnapshot(entry, false);
        ctx.broadcastTabsAndFrame(entry);
        return await pauseIfChallengeDetected(ctx, entry, snap);
      }

      case "type": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em type.");
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        if (resolved.meta?.isSensitive) {
          throw new Error(
            "Campo classificado como sensível (senha/OTP/cartão). Utilize 'submit_secret' ou 'request_takeover' para proteger a credencial.",
          );
        }
        const text = String(input.text ?? "");
        if (resolved.locator) {
          if (input.clear !== false) {
            await resolved.locator.fill(text, { timeout: 10_000 });
          } else {
            await resolved.locator.pressSequentially(text, { timeout: 10_000 });
          }
          if (input.pressEnter) {
            await resolved.locator.press("Enter");
          }
        }
        entry.revision += 1;
        const snap = await ctx.captureTabSnapshot(entry, false);
        ctx.broadcastTabsAndFrame(entry);
        return snap;
      }

      case "fill_fields": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        const fields = Array.isArray(input.fields) ? input.fields : [];
        if (fields.length < 1 || fields.length > BROWSER_FILL_FIELDS_MAX_FIELDS) {
          throw new Error(
            `fill_fields aceita entre 1 e ${BROWSER_FILL_FIELDS_MAX_FIELDS} campos por chamada.`,
          );
        }

        let totalBytes = 0;
        for (const f of fields) {
          totalBytes += Buffer.byteLength(String(f.value ?? ""), "utf8");
        }
        if (totalBytes > BROWSER_FILL_FIELDS_MAX_TEXT_BYTES) {
          throw new Error(
            `O volume combinado de texto em fill_fields (${totalBytes} bytes) excede o limite de ${BROWSER_FILL_FIELDS_MAX_TEXT_BYTES} bytes.`,
          );
        }

        for (const f of fields) {
          const resolved = resolveBrowserTarget(
            entry.page!,
            f.target,
            entry.snapshotRefs,
            entry.revision,
          );
          if (resolved.meta?.isSensitive) {
            throw new Error(
              `fill_fields recusou o campo sensível '${resolved.meta.ref}'. Use 'submit_secret' ou 'request_takeover'.`,
            );
          }
          if (!resolved.locator) {
            throw new Error("fill_fields requer seletores de elemento (ref, role, text ou css).");
          }
          const elAttrs = await resolved.locator.evaluate((el) => {
            const node = el as unknown as { getAttribute(attr: string): string | null };
            return {
              type: node.getAttribute("type") || "",
              autocomplete: node.getAttribute("autocomplete") || "",
              name: node.getAttribute("name") || "",
              id: node.getAttribute("id") || "",
              ariaLabel: node.getAttribute("aria-label") || "",
            };
          });
          if (isSensitiveFieldHint(elAttrs)) {
            throw new Error(
              "fill_fields detectou campo de senha/OTP/cartão no DOM e abortou o preenchimento por segurança.",
            );
          }
          await resolved.locator.fill(String(f.value ?? ""), { timeout: 10_000 });
        }

        entry.revision += 1;
        return await ctx.captureTabSnapshot(entry, false);
      }

      case "press": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        const key = input.key?.trim();
        if (!key) throw new Error("Informe a tecla em 'key' (ex.: 'Enter', 'Escape', 'Tab').");
        if (input.target) {
          const resolved = resolveBrowserTarget(
            entry.page!,
            input.target,
            entry.snapshotRefs,
            entry.revision,
          );
          await resolved.locator?.press(key, { timeout: 8_000 });
        } else {
          await entry.page!.keyboard.press(key);
        }
        entry.revision += 1;
        const snap = await ctx.captureTabSnapshot(entry, false);
        ctx.broadcastTabsAndFrame(entry);
        return snap;
      }

      case "hover": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em hover.");
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        if (resolved.point) {
          await entry.page!.mouse.move(resolved.point.x, resolved.point.y);
        } else {
          await resolved.locator?.hover({ timeout: 8_000 });
        }
        return await ctx.captureTabSnapshot(entry, false);
      }

      case "scroll": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        if (input.target && input.target.kind !== "point") {
          const resolved = resolveBrowserTarget(
            entry.page!,
            input.target,
            entry.snapshotRefs,
            entry.revision,
          );
          await resolved.locator?.scrollIntoViewIfNeeded({ timeout: 8_000 });
        } else {
          await entry.page!.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 480);
        }
        entry.revision += 1;
        const snap = await ctx.captureTabSnapshot(entry, false);
        ctx.broadcastTabsAndFrame(entry);
        return snap;
      }

      case "select_option": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em select_option.");
        const vals = Array.isArray(input.values) ? input.values : [];
        if (vals.length === 0) throw new Error("Informe 'values' em select_option.");
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        await resolved.locator?.selectOption(vals, { timeout: 8_000 });
        entry.revision += 1;
        return await ctx.captureTabSnapshot(entry, false);
      }

      case "set_checked": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em set_checked.");
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        await resolved.locator?.setChecked(Boolean(input.checked), { timeout: 8_000 });
        entry.revision += 1;
        return await ctx.captureTabSnapshot(entry, false);
      }

      case "drag": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        if (!input.target || !input.toTarget) {
          throw new Error("Informe 'target' e 'toTarget' em drag.");
        }
        const from = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        const to = resolveBrowserTarget(
          entry.page!,
          input.toTarget,
          entry.snapshotRefs,
          entry.revision,
        );
        if (from.locator && to.locator) {
          await from.locator.dragTo(to.locator, { timeout: 10_000 });
        } else if (from.point && to.point) {
          await entry.page!.mouse.move(from.point.x, from.point.y);
          await entry.page!.mouse.down();
          await entry.page!.mouse.move(to.point.x, to.point.y, { steps: 8 });
          await entry.page!.mouse.up();
        }
        entry.revision += 1;
        return await ctx.captureTabSnapshot(entry, false);
      }

      case "upload_files": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        if (!input.target) throw new Error("Informe 'target' em upload_files.");
        const safeFiles = assertSafeUploadPaths(
          input.paths ?? [],
          ctx.workspaceRoot,
          input.agenteId ?? entry.agenteId,
        );
        const resolved = resolveBrowserTarget(
          entry.page!,
          input.target,
          entry.snapshotRefs,
          entry.revision,
        );
        await resolved.locator?.setInputFiles(safeFiles, { timeout: 10_000 });
        entry.revision += 1;
        return await ctx.captureTabSnapshot(entry, false);
      }

      case "wait_for": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        const timeout = Math.min(Math.max(input.timeoutMs ?? 10_000, 200), 30_000);
        const kind = input.waitKind ?? "load";
        if (kind === "text" && input.waitValue) {
          await entry.page!.getByText(input.waitValue).first().waitFor({ timeout });
        } else if (kind === "selector" && input.waitValue) {
          await entry.page!.locator(input.waitValue).first().waitFor({ timeout });
        } else if (kind === "url" && input.waitValue) {
          await entry.page!.waitForURL(`**/*${input.waitValue}*`, { timeout });
        } else {
          await entry.page!.waitForLoadState("networkidle", { timeout }).catch(() => {});
        }
        entry.revision += 1;
        return await ctx.captureTabSnapshot(entry, false);
      }

      case "screenshot": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        const buf = await entry.page!.screenshot({ type: "png" });
        const shotsDir = resolve(ctx.workspaceRoot, "dados", "browser-screenshots");
        mkdirSync(shotsDir, { recursive: true });
        const fileName = `shot-${entry.tabId}-${Date.now()}.png`;
        const absPath = resolve(shotsDir, fileName);
        writeFileSync(absPath, buf);
        return {
          ok: true,
          tabId: entry.tabId,
          path: absPath,
          dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
        };
      }

      case "evaluate": {
        if (input.permissionLevel === "workspace") {
          throw new Error(
            "A ação 'evaluate' requer nível de permissão 'ask' ou 'full' no agente para executar scripts arbitrários.",
          );
        }
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        const expr = input.expression?.trim();
        if (!expr) throw new Error("Informe 'expression' em evaluate.");
        const rawOut = await Promise.race([
          entry.page!.evaluate((code: string) => {
            // Avaliação confinada ao contexto isolado da página remota
            return (0, eval)(code);
          }, expr),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout de 5s atingido em evaluate.")), 5_000),
          ),
        ]);
        const serialized = JSON.stringify(rawOut ?? null)?.slice(0, 16_000) ?? "null";
        return { ok: true, tabId: entry.tabId, result: JSON.parse(serialized) };
      }

      case "handle_dialog": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        if (!entry.pendingDialogObj) {
          return { ok: false, note: "Nenhum diálogo nativo pendente nesta aba." };
        }
        const dlg = entry.pendingDialogObj;
        entry.pendingDialogObj = null;
        if (input.accept !== false) {
          await dlg.accept(input.promptText);
        } else {
          await dlg.dismiss();
        }
        return { ok: true, handled: entry.lastDialog };
      }

      case "set_environment": {
        const entry = await ctx.ensureRealTabLoaded(input.tabId);
        if (input.viewport) {
          await entry.page!.setViewportSize({
            width: Math.min(Math.max(320, Math.round(input.viewport.width)), 2560),
            height: Math.min(Math.max(320, Math.round(input.viewport.height)), 1600),
          });
        }
        if (input.colorScheme) {
          await entry.page!.emulateMedia({ colorScheme: input.colorScheme });
        }
        if (input.userAgent && entry.cdpSession) {
          await entry.cdpSession.send("Network.setUserAgentOverride", {
            userAgent: input.userAgent.slice(0, 300),
            ...(input.locale ? { acceptLanguage: input.locale.slice(0, 32) } : {}),
          });
        }
        if (input.timezoneId && entry.cdpSession) {
          await entry.cdpSession
            .send("Emulation.setTimezoneOverride", { timezoneId: input.timezoneId })
            .catch(() => {});
        }
        entry.revision += 1;
        return await ctx.captureTabSnapshot(entry, false);
      }

      case "close_tab": {
        if (!input.tabId) throw new Error("Informe 'tabId' em close_tab.");
        const closed = await ctx.sessionManager.closeTab(input.tabId);
        ctx.activeTakeovers.delete(input.tabId);
        ctx.broadcastTabsAndFrame(null);
        return { ok: closed, tabId: input.tabId };
      }

      case "request_takeover": {
        if (!input.tabId) throw new Error("Informe 'tabId' em request_takeover.");
        return await ctx.requestTakeover({
          tabId: input.tabId,
          agenteId: input.agenteId ?? null,
          canalId: input.canalId ?? null,
          reason: input.reason ?? "manual",
          waitForResolution: Boolean(input.waitForTakeover),
          timeoutMs: input.timeoutMs,
        });
      }

      case "release_takeover": {
        if (!input.tabId) throw new Error("Informe 'tabId' em release_takeover.");
        return await ctx.resolveTakeover(input.tabId, "complete");
      }

      default:
        throw new Error(`Ação CDP desconhecida: '${String(action)}'.`);
    }
  }
