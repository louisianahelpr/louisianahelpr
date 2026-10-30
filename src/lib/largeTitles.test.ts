/**
 * iOS-style large titles (src/lib/largeTitles.ts, owner 2026-10-18 tweak 4):
 * the page-scrolled flag, the compact bar on AppPage screens, and teardown.
 *
 * Added for nightly-red #3415 (main: Vitest, "Coverage floor"): train11 added
 * largeTitles.ts with no test (src/lib/ 81.2% -> 80.18%, floor 81.17%).
 *
 * @mutate src/lib/largeTitles.ts |     if (t.scrollHeight <= t.clientHeight + 1 && t.scrollWidth > t.clientWidth + 1) return; |     void 0;
 * @mutate src/lib/largeTitles.ts |     if (t.scrollHeight <= t.clientHeight + 1 && t.scrollWidth > t.clientWidth + 1) return; |     if (t.scrollHeight <= t.clientHeight + 1) return;
 * @mutate src/pages/post-job/PostJob.tsx |     resetLargeTitles();\n  }, [form.step |     void 0;\n  }, [form.step
 * @mutate src/lib/largeTitles.ts |     doc.documentElement.classList.toggle("page-scrolled", t.scrollTop > 24); |     doc.documentElement.classList.toggle("page-scrolled", t.scrollTop > 0);
 * @mutate src/lib/largeTitles.ts |       b.classList.toggle("on", t.scrollTop > 56 && title !== "" && !desktop && !ownRow); |       b.classList.toggle("on", t.scrollTop > 24 && title !== "" && !desktop && !ownRow);
 * @mutate src/lib/largeTitles.ts |       b.classList.toggle("on", t.scrollTop > 56 && title !== "" && !desktop && !ownRow); |       b.classList.toggle("on", t.scrollTop > 56 && title !== "" && !desktop);
 * @mutate src/lib/largeTitles.ts |     bar?.remove(); |     void bar;
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { installLargeTitles } from "./largeTitles";

function scroller(opts: { appPage?: boolean; title?: string; scrollHeight?: number; clientHeight?: number; scrollWidth?: number }) {
  const el = document.createElement("div");
  if (opts.appPage) el.setAttribute("data-app-page-scroll", "");
  if (opts.title) {
    const h1 = document.createElement("h1");
    h1.className = "text-page-title";
    h1.textContent = opts.title;
    el.appendChild(h1);
  }
  Object.defineProperty(el, "scrollHeight", { value: opts.scrollHeight ?? 2000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: opts.clientHeight ?? 800, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: opts.scrollWidth ?? 390, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 390, configurable: true });
  document.body.appendChild(el);
  return el;
}
function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}
const html = () => document.documentElement.classList;
const bar = () => document.querySelector<HTMLDivElement>(".compact-title-bar");

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.body.innerHTML = "";
});

describe("installLargeTitles", () => {
  it("flags the page scrolled past 24px on any vertical scroller, and clears it back at the top", () => {
    uninstall = installLargeTitles();
    const el = scroller({});
    scrollTo(el, 24);
    expect(html().contains("page-scrolled")).toBe(false);
    scrollTo(el, 25);
    expect(html().contains("page-scrolled")).toBe(true);
    scrollTo(el, 0);
    expect(html().contains("page-scrolled")).toBe(false);
    // Not an AppPage screen: no compact bar.
    expect(bar()).toBeNull();
  });

  it("a sideways scroller (no vertical travel) never resets the page's state", () => {
    uninstall = installLargeTitles();
    const page = scroller({});
    scrollTo(page, 100);
    const chips = scroller({ scrollHeight: 40, clientHeight: 40, scrollWidth: 900 });
    scrollTo(chips, 0);
    expect(html().contains("page-scrolled")).toBe(true);
  });

  it("a page screen too short to scroll still turns the bar off back at the top (owner iPhone 2026-10-26, Post a job)", () => {
    // Screen 2 (the groups list) scrolled past 56px; screen 3 ("What kind of home job?") fits the
    // phone, so its scroller has no vertical travel when it returns to 0. Skipping that event kept the
    // bar on over the back button, with nothing left to scroll to uncover it.
    uninstall = installLargeTitles();
    const el = scroller({ appPage: true, title: "Post a job" });
    scrollTo(el, 300);
    expect(bar()?.classList.contains("on")).toBe(true);
    Object.defineProperty(el, "scrollHeight", { value: 700, configurable: true });
    scrollTo(el, 0);
    expect(bar()?.classList.contains("on")).toBe(false);
    expect(html().contains("page-scrolled")).toBe(false);
  });

  it("Post a job turns the bar off itself when a step change resets the scroll (no scroll event at 0)", () => {
    const src = blankComments(readFileSync("src/pages/post-job/PostJob.tsx", "utf8"));
    const effect = src.slice(src.indexOf("lastStep.current = key;"), src.indexOf("}, [form.step"));
    expect(effect.length).toBeGreaterThan(0);
    expect(effect).toContain("el.scrollTop = 0;");
    expect(effect).toContain("resetLargeTitles();");
  });

  it("an AppPage screen shows its h1 in an aria-hidden compact bar past 56px", () => {
    uninstall = installLargeTitles();
    const el = scroller({ appPage: true, title: "Earnings" });
    scrollTo(el, 40);
    expect(bar()?.textContent).toBe("Earnings");
    expect(bar()?.getAttribute("aria-hidden")).toBe("true");
    expect(bar()?.classList.contains("on")).toBe(false);
    scrollTo(el, 57);
    expect(bar()?.classList.contains("on")).toBe(true);
    // One bar, reused.
    scrollTo(el, 80);
    expect(document.querySelectorAll(".compact-title-bar")).toHaveLength(1);
  });

  it("a page with its own pinned title row (AppPage stickyHeader) never gets the title-only bar over its buttons (DA-9)", () => {
    uninstall = installLargeTitles();
    const el = scroller({ appPage: true, title: "Blue mug" });
    el.setAttribute("data-own-title-row", "");
    scrollTo(el, 300);
    expect(html().contains("page-scrolled")).toBe(true);
    expect(bar()?.classList.contains("on")).toBe(false);
    // The same page without the attribute does get it: the check is the attribute, not the page.
    el.removeAttribute("data-own-title-row");
    scrollTo(el, 320);
    expect(bar()?.classList.contains("on")).toBe(true);
  });

  it("uninstall removes the bar, the flag and the listener", () => {
    uninstall = installLargeTitles();
    const el = scroller({ appPage: true, title: "Profile" });
    scrollTo(el, 100);
    expect(bar()).not.toBeNull();
    uninstall();
    uninstall = null;
    expect(bar()).toBeNull();
    expect(html().contains("page-scrolled")).toBe(false);
    scrollTo(el, 200);
    expect(html().contains("page-scrolled")).toBe(false);
    expect(bar()).toBeNull();
  });
});
