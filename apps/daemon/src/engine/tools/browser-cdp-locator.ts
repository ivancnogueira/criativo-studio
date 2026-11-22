import type { NativeCdpPage } from "./browser-cdp-page.ts";

export interface NativeLocatorSpec {
  kind: "css" | "role" | "text";
  selector?: string;
  role?: string;
  name?: string;
  exact?: boolean;
  text?: string;
  nth: number;
}

export class NativeCdpLocator {
  private readonly page: NativeCdpPage;
  private readonly spec: NativeLocatorSpec;

  constructor(page: NativeCdpPage, spec: NativeLocatorSpec) {
    this.page = page;
    this.spec = spec;
  }

  public nth(index: number): NativeCdpLocator {
    return new NativeCdpLocator(this.page, { ...this.spec, nth: Math.max(0, index) });
  }

  public first(): NativeCdpLocator {
    return this.nth(0);
  }

  private async resolveElementCenter(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    tag: string;
  }> {
    return await this.page.evaluate(
      ({ spec }) => {
        const g = globalThis as unknown as {
          document: {
            querySelectorAll(s: string): ArrayLike<any>;
          };
          getComputedStyle(el: any): { display: string; visibility: string; opacity: string };
        };

        const isVisible = (el: any): boolean => {
          const st = g.getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) {
            return false;
          }
          const r = el.getBoundingClientRect();
          return r.width > 0 || r.height > 0;
        };

        const inferRole = (el: any): string => {
          const explicit = el.getAttribute?.("role");
          if (explicit) return explicit;
          const tag = String(el.tagName || "").toLowerCase();
          if (tag === "a") return "link";
          if (tag === "button") return "button";
          if (tag === "select") return "combobox";
          if (tag === "textarea") return "textbox";
          if (tag === "input") {
            const tp = (el.getAttribute?.("type") || "text").toLowerCase();
            if (tp === "checkbox") return "checkbox";
            if (tp === "radio") return "radio";
            if (tp === "submit" || tp === "button") return "button";
            return "textbox";
          }
          return tag;
        };

        const accessibleName = (el: any): string =>
          String(
            el.getAttribute?.("aria-label") ||
              el.innerText ||
              el.textContent ||
              el.getAttribute?.("placeholder") ||
              el.getAttribute?.("title") ||
              el.value ||
              "",
          )
            .replace(/\s+/g, " ")
            .trim();

        let matches: any[] = [];
        if (spec.kind === "css" && spec.selector) {
          matches = Array.from(g.document.querySelectorAll(spec.selector));
        } else if (spec.kind === "role" && spec.role) {
          const candidates = Array.from(
            g.document.querySelectorAll(
              "a,button,input,select,textarea,[role],[contenteditable='true'],h1,h2,h3,h4,summary",
            ),
          );
          const wantedRole = spec.role.toLowerCase();
          matches = candidates.filter((el) => {
            if (inferRole(el).toLowerCase() !== wantedRole) return false;
            if (!spec.name) return true;
            const n = accessibleName(el).toLowerCase();
            const q = spec.name.toLowerCase();
            return spec.exact ? n === q : n.includes(q);
          });
        } else if (spec.kind === "text" && spec.text) {
          const all = Array.from(g.document.querySelectorAll("*")).filter((el) => {
            if (!isVisible(el)) return false;
            const txt = accessibleName(el).toLowerCase();
            const q = spec.text!.toLowerCase();
            return spec.exact ? txt === q : txt.includes(q);
          });
          // Prefere o elemento folha mais específico
          matches = all.filter((el) => !all.some((other) => other !== el && el.contains?.(other)));
          if (matches.length === 0) matches = all;
        }

        const picked = matches[spec.nth] ?? null;
        if (!picked) {
          throw new Error(
            `Elemento não encontrado no DOM (${spec.kind}:${spec.selector || spec.role || spec.text}[${spec.nth}]).`,
          );
        }

        picked.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
        const rect = picked.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          tag: String(picked.tagName || "").toLowerCase(),
        };
      },
      { spec: this.spec },
    );
  }

  private async runOnElement<R>(actionFn: (el: any, payload: any) => R, payload?: unknown): Promise<R> {
    const fnStr = actionFn.toString();
    return await this.page.evaluate(
      ({ spec, serializedFn, extraPayload }) => {
        const g = globalThis as unknown as {
          document: { querySelectorAll(s: string): ArrayLike<any> };
          getComputedStyle(el: any): { display: string; visibility: string; opacity: string };
        };
        const inferRole = (el: any): string => {
          const explicit = el.getAttribute?.("role");
          if (explicit) return explicit;
          const tag = String(el.tagName || "").toLowerCase();
          if (tag === "a") return "link";
          if (tag === "button") return "button";
          if (tag === "select") return "combobox";
          if (tag === "textarea") return "textbox";
          if (tag === "input") {
            const tp = (el.getAttribute?.("type") || "text").toLowerCase();
            if (tp === "checkbox") return "checkbox";
            if (tp === "radio") return "radio";
            if (tp === "submit" || tp === "button") return "button";
            return "textbox";
          }
          return tag;
        };
        const accessibleName = (el: any): string =>
          String(
            el.getAttribute?.("aria-label") ||
              el.innerText ||
              el.textContent ||
              el.getAttribute?.("placeholder") ||
              el.getAttribute?.("title") ||
              el.value ||
              "",
          )
            .replace(/\s+/g, " ")
            .trim();

        let matches: any[] = [];
        if (spec.kind === "css" && spec.selector) {
          matches = Array.from(g.document.querySelectorAll(spec.selector));
        } else if (spec.kind === "role" && spec.role) {
          const candidates = Array.from(
            g.document.querySelectorAll(
              "a,button,input,select,textarea,[role],[contenteditable='true'],h1,h2,h3,h4,summary",
            ),
          );
          const wantedRole = spec.role.toLowerCase();
          matches = candidates.filter((el) => {
            if (inferRole(el).toLowerCase() !== wantedRole) return false;
            if (!spec.name) return true;
            const n = accessibleName(el).toLowerCase();
            const q = spec.name.toLowerCase();
            return spec.exact ? n === q : n.includes(q);
          });
        } else if (spec.kind === "text" && spec.text) {
          const all = Array.from(g.document.querySelectorAll("*")).filter((el) => {
            const st = g.getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) {
              return false;
            }
            const txt = accessibleName(el).toLowerCase();
            const q = spec.text!.toLowerCase();
            return spec.exact ? txt === q : txt.includes(q);
          });
          matches = all.filter((el) => !all.some((other) => other !== el && el.contains?.(other)));
          if (matches.length === 0) matches = all;
        }

        const el = matches[spec.nth] ?? null;
        if (!el) {
          throw new Error(
            `Elemento não encontrado (${spec.kind}:${spec.selector || spec.role || spec.text}[${spec.nth}]).`,
          );
        }
        el.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
        const fn = (0, eval)(`(function(){ var __name = function(f){ return f; }; return (${serializedFn}); })()`);
        return fn(el, extraPayload);
      },
      { spec: this.spec, serializedFn: fnStr, extraPayload: payload ?? null },
    );
  }

  public async click(_opts?: { timeout?: number }): Promise<void> {
    const pt = await this.resolveElementCenter();
    if (pt.width > 0 && pt.height > 0) {
      await this.page.mouse.click(pt.x, pt.y);
      return;
    }
    await this.runOnElement((el) => {
      el.click?.();
    });
  }

  public async hover(_opts?: { timeout?: number }): Promise<void> {
    const pt = await this.resolveElementCenter();
    await this.page.mouse.move(pt.x, pt.y);
  }

  public async scrollIntoViewIfNeeded(_opts?: { timeout?: number }): Promise<void> {
    await this.resolveElementCenter();
  }

  public async fill(value: string, _opts?: { timeout?: number }): Promise<void> {
    await this.runOnElement((el, val: string) => {
      el.focus?.();
      const g = globalThis as unknown as {
        Event: new (t: string, o?: { bubbles?: boolean }) => unknown;
        HTMLInputElement?: { prototype?: object };
        HTMLTextAreaElement?: { prototype?: object };
      };
      if (el.isContentEditable) {
        el.textContent = val;
        el.dispatchEvent?.(new g.Event("input", { bubbles: true }));
        el.dispatchEvent?.(new g.Event("change", { bubbles: true }));
        return;
      }
      const tag = String(el.tagName || "").toLowerCase();
      const proto =
        tag === "textarea"
          ? g.HTMLTextAreaElement?.prototype
          : g.HTMLInputElement?.prototype;
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, "value") : undefined;
      if (descriptor?.set) {
        descriptor.set.call(el, val);
      } else {
        el.value = val;
      }
      el.dispatchEvent?.(new g.Event("input", { bubbles: true }));
      el.dispatchEvent?.(new g.Event("change", { bubbles: true }));
    }, value);
  }

  public async pressSequentially(value: string, _opts?: { timeout?: number }): Promise<void> {
    await this.runOnElement((el) => {
      el.focus?.();
    });
    await this.page.getCdpSession().send("Input.insertText", { text: value });
  }

  public async press(key: string, _opts?: { timeout?: number }): Promise<void> {
    await this.runOnElement((el) => {
      el.focus?.();
    });
    await this.page.keyboard.press(key);
  }

  public async selectOption(values: string | string[], _opts?: { timeout?: number }): Promise<void> {
    const list = Array.isArray(values) ? values : [values];
    await this.runOnElement((el, targetVals: string[]) => {
      const g = globalThis as unknown as {
        Event: new (t: string, o?: { bubbles?: boolean }) => unknown;
      };
      const options = Array.from(el.options ?? []) as Array<{
        value: string;
        text: string;
        selected: boolean;
      }>;
      let matched = false;
      for (const opt of options) {
        const hit = targetVals.includes(opt.value) || targetVals.includes(opt.text?.trim());
        opt.selected = hit;
        if (hit) matched = true;
      }
      if (!matched && targetVals[0] !== undefined) {
        el.value = targetVals[0];
      }
      el.dispatchEvent?.(new g.Event("input", { bubbles: true }));
      el.dispatchEvent?.(new g.Event("change", { bubbles: true }));
    }, list);
  }

  public async setChecked(checked: boolean, _opts?: { timeout?: number }): Promise<void> {
    const currentlyChecked = await this.runOnElement((el) => Boolean(el.checked));
    if (currentlyChecked !== Boolean(checked)) {
      await this.click();
    }
  }

  public async dragTo(target: NativeCdpLocator, _opts?: { timeout?: number }): Promise<void> {
    const fromPt = await this.resolveElementCenter();
    const toPt = await target.resolveElementCenter();
    await this.page.mouse.move(fromPt.x, fromPt.y);
    await this.page.mouse.down();
    await this.page.mouse.move(toPt.x, toPt.y, { steps: 8 });
    await this.page.mouse.up();
  }

  public async setInputFiles(files: string[], _opts?: { timeout?: number }): Promise<void> {
    const cdp = this.page.getCdpSession();
    const markerAttr = `data-criativo-upload-${Date.now()}`;
    await this.runOnElement((el, attr: string) => {
      el.setAttribute(attr, "1");
    }, markerAttr);

    const doc = await cdp.send<{ root?: { nodeId?: number } }>("DOM.getDocument", { depth: -1 });
    const rootNodeId = doc.root?.nodeId;
    if (!rootNodeId) {
      throw new Error("DOM root indisponível para upload_files.");
    }
    const found = await cdp.send<{ nodeId?: number }>("DOM.querySelector", {
      nodeId: rootNodeId,
      selector: `[${markerAttr}="1"]`,
    });
    if (!found.nodeId) {
      throw new Error("Input de arquivo não localizado via CDP DOM.querySelector.");
    }
    await cdp.send("DOM.setFileInputFiles", {
      nodeId: found.nodeId,
      files,
    });
    await this.runOnElement((el, attr: string) => {
      el.removeAttribute(attr);
    }, markerAttr).catch(() => {});
  }

  public async waitFor(opts?: { timeout?: number }): Promise<void> {
    const deadline = Date.now() + Math.max(500, opts?.timeout ?? 10_000);
    while (Date.now() < deadline) {
      try {
        await this.resolveElementCenter();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    throw new Error(
      `Timeout aguardando elemento '${this.spec.selector || this.spec.role || this.spec.text}'.`,
    );
  }

  public async evaluate<R>(fn: (el: unknown, arg?: unknown) => R, arg?: unknown): Promise<R> {
    return await this.runOnElement(fn, arg);
  }
}
