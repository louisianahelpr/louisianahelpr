/**
 * A Playwright stand-in that runs press-every-control's REAL main() against the
 * jsdom document of a vitest run, so a test can drive the harness's own press
 * loop (enumerate, gate, record check, click, outcome) instead of a copy of it.
 *
 * Why it exists: ready/reds-1017-9 shipped a press-time record check that read
 * `target` before its `let` in the same block. Every unit test of the new
 * helpers was green, because none of them ran the loop; on a real sweep every
 * gate-approved write would have died as "HARNESS ERROR: Cannot access 'target'
 * before initialization". Only running main() catches that class.
 *
 * Scope: what main() calls on Browser / BrowserContext / Page / Locator, no
 * more. `page.evaluate(fn, arg)` runs `fn(arg)` in this document (the harness's
 * page-side functions only touch `document`/`window`), and a string probe is
 * evaluated as an expression. Time is virtual (see `clock`): every
 * `waitForTimeout` advances it, so the harness's settle and stillness loops end
 * without real waiting.
 */

export type Fixture = (body: HTMLElement) => () => void;

export const clock = { now: 0 };

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const BOX = { x: 0, y: 0, width: 120, height: 44 };

class FakeLocator {
  constructor(private readonly resolveAll: () => Element[]) {}
  private one(): Element {
    const el = this.resolveAll()[0];
    if (!el) throw new Error("fake locator: no element");
    return el;
  }
  async count() { return this.resolveAll().length; }
  first() { return new FakeLocator(() => this.resolveAll().slice(0, 1)); }
  last() { return new FakeLocator(() => this.resolveAll().slice(-1)); }
  locator(sel: string) { return new FakeLocator(() => this.resolveAll().flatMap((el) => [...el.querySelectorAll(sel)])); }
  async evaluate<A, R>(fn: (el: Element, arg: A) => R, arg?: A) { return fn(this.one(), arg as A); }
  async isDisabled() {
    const el = this.one();
    return el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
  }
  async boundingBox() { this.one(); return { ...BOX }; }
  async scrollIntoViewIfNeeded() { this.one(); }
  async click() {
    const el = this.one() as HTMLElement;
    el.click();
    for (let i = 0; i < 5; i++) await tick();
  }
}

export function makeFakeBrowser({ base, fixtures }: { base: string; fixtures: Record<string, Fixture> }) {
  let unmount: (() => void) | null = null;
  const makePage = (ctx: unknown) => {
    let url = "about:blank";
    const page = {
      async goto(to: string) {
        unmount?.();
        unmount = null;
        document.body.innerHTML = "";
        url = to;
        const path = new URL(to).pathname;
        const fixture = fixtures[path];
        if (!fixture) throw new Error(`fake page: no fixture for ${path} (base ${base})`);
        unmount = fixture(document.body);
        for (let i = 0; i < 10; i++) await tick();
        return null;
      },
      async reload() { return page.goto(url); },
      url: () => url,
      on() { /* no browser events in jsdom */ },
      context: () => ctx,
      async evaluate(fn: unknown, arg?: unknown) {
         
        if (typeof fn === "string") return (0, eval)(fn);
        return (fn as (a: unknown) => unknown)(arg);
      },
      async waitForFunction(fn: (a: unknown) => unknown, arg?: unknown, opts?: { timeout?: number }) {
        const until = clock.now + (opts?.timeout ?? 30_000);
        while (clock.now < until) {
          if (fn(arg)) return true;
          await page.waitForTimeout(100);
        }
        throw new Error("fake page: waitForFunction timed out");
      },
      async waitForTimeout(ms: number) { clock.now += ms; await tick(); },
      async waitForLoadState() { /* already loaded */ },
      locator: (sel: string) => new FakeLocator(() => [...document.querySelectorAll(sel)]),
      keyboard: {
        async press(key: string) {
          const t = (document.activeElement as HTMLElement | null) ?? document.body;
          t.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
          await tick();
        },
      },
      viewportSize: () => ({ width: 375, height: 812 }),
      async screenshot() { /* nothing to capture */ },
      async close() { unmount?.(); unmount = null; },
    };
    return page;
  };
  const browser = {
    async newContext() {
      const pages: unknown[] = [];
      const ctx = {
        async addInitScript() { /* no storage to seed */ },
        async route() { /* no network in the fixture */ },
        on() { /* no popups */ },
        pages: () => pages,
        async newPage() { const p = makePage(ctx); pages.push(p); return p; },
        async close() { for (const p of pages) await (p as { close: () => Promise<void> }).close(); },
      };
      return ctx;
    },
    async newPage() { return (await browser.newContext()).newPage(); },
    async close() { /* nothing held */ },
  };
  return browser;
}

/** jsdom has no layout and no innerText; the harness's visibility and record reads need both. */
export function installLayoutShims() {
  const hadInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText");
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) { return this.textContent ?? ""; },
  });
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return { ...BOX, top: 0, left: 0, right: BOX.width, bottom: BOX.height, toJSON() { return this; } } as DOMRect;
  };
  return () => {
    if (hadInnerText) Object.defineProperty(HTMLElement.prototype, "innerText", hadInnerText);
    else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
    Element.prototype.getBoundingClientRect = rect;
  };
}
