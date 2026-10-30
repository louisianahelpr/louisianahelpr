/**
 * ITEM 1 of the 2026-10-28 shared-UI list (Declutter walk shots 03, 07, 16, 22): on the desktop website the top
 * bar "slid away" leaving a grey strip, the rail's logo was cut, and a blank band sat at the bottom. Measured in
 * WebKit at 1440 (Selling, "I can deliver" open, scrollIntoView on the card; ~/.lh-shots/b3-1028/s1):
 *  - `.app-shell-frame` scrollTop went 0 -> 105. The frame was `overflow: hidden`, which is still a scroll
 *    container, so scrollIntoView scrolled it: the header slid up, a blank band opened at the bottom.
 *    It is `overflow: clip` now wherever WebKit has it (index.css, @supports; iOS 15 keeps `hidden`). After:
 *    scrollTop stays 0 (same repro, same build).
 *  - the grey strip was the iOS-style compact title bar (largeTitles.ts), fixed at the top, 44px, opaque, turned
 *    on EMPTY (Declutter's title is in its header, no h1.text-page-title in the scroller), over the rail and the
 *    top bar. It shows only with a title, and never on the desktop website.
 * jsdom has no layout, so the frame half is held by its stylesheet rule and its class (never a scrolling overflow),
 * and the bar half by behaviour.
 *
 * @mutate src/index.css |   .app-shell-frame.app-shell-frame {\n    overflow: clip; |   .app-shell-frame.app-shell-frame {\n    overflow: hidden;
 * @mutate src/components/AppShell.tsx | flex flex-col bg-background overflow-hidden", | flex flex-col bg-background overflow-y-auto",
 * @mutate src/lib/largeTitles.ts |  && title !== "" && !desktop && !ownRow); | );
 * @mutate src/lib/largeTitles.ts |       b.classList.toggle("on", t.scrollTop > 56 && title !== "" && !desktop && !ownRow); |       b.classList.toggle("on", t.scrollTop > 56 && !desktop && !ownRow);
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { installLargeTitles } from "@/lib/largeTitles";

function appPageScroller(title: string | null) {
  const el = document.createElement("div");
  el.setAttribute("data-app-page-scroll", "");
  if (title !== null) {
    const h1 = document.createElement("h1");
    h1.className = "text-page-title";
    h1.textContent = title;
    el.appendChild(h1);
  }
  Object.defineProperty(el, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 800, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: 390, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 390, configurable: true });
  document.body.appendChild(el);
  return el;
}
const scroll = (el: HTMLElement, top: number) => { el.scrollTop = top; el.dispatchEvent(new Event("scroll")); };
const barOn = () => !!document.querySelector(".compact-title-bar.on");

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.body.innerHTML = "";
  document.documentElement.classList.remove("web-desktop");
});

describe("the app-shell frame can never be scrolled", () => {
  it("index.css clips the frame wherever overflow: clip exists, out-ranking the utility", () => {
    const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
    expect(css).toMatch(/@supports \(overflow: clip\) \{\s*\.app-shell-frame\.app-shell-frame \{\s*overflow: clip;/);
  });

  it("AppShell's frame class never makes it a scroller (hidden is the iOS 15 fallback only)", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/AppShell.tsx"), "utf8"));
    const frame = /"app-shell-frame [^"]*"/.exec(src)?.[0] ?? "";
    expect(frame).toMatch(/\boverflow-(hidden|clip)\b/);
    expect(frame).not.toMatch(/\boverflow-(auto|scroll|y-auto|y-scroll|x-auto|x-scroll)\b/);
  });
});

describe("the compact title bar never paints an empty strip", () => {
  it("a page with no title in its scroller: no bar, however far it scrolls (Declutter)", () => {
    uninstall = installLargeTitles();
    scroll(appPageScroller(null), 400);
    expect(barOn()).toBe(false);
  });

  it("the desktop website: no bar, its top bar holds the title", () => {
    document.documentElement.classList.add("web-desktop");
    uninstall = installLargeTitles();
    scroll(appPageScroller("Post a job"), 400);
    expect(barOn()).toBe(false);
  });

  it("a phone page with a title still gets its bar", () => {
    uninstall = installLargeTitles();
    scroll(appPageScroller("Post a job"), 400);
    expect(barOn()).toBe(true);
  });
});
