/**
 * ITEM PAGE SPEED (lead 11-09; the owner's under-2 s rule). On a phone, an item page's largest paint (its first photo)
 * came only once the item page's JavaScript had arrived (cwv-lab 375 Slow 4G: 5.8 s guest, 6.2 s member). index.html
 * now draws the page's OWN loading frame (DeclutterItemSkeleton, never a hand-rolled one) as #lh-item-shell and puts the
 * first photo into its photo frame (src/boot/declutterItemEarly.test.ts holds the script).
 *
 * The block is byte-for-byte what DeclutterItemSkeleton renders at a phone width; a change to the skeleton turns this
 * red until the block is rewritten from the source:
 *   LH_WRITE_MD_SHELLS=1 npx vitest run src/test/itemShellMatchesSkeleton.test.tsx
 * It also pins: the photo frame the script fills; the show rules; main.tsx drops it when not shown; DeclutterItemPage
 * holds it until the gallery's first photo is complete under it (itemShell.ts); the app drops it off an item route and
 * on every error card (dropHomeShell); the build inlines its CSS.
 *
 * @mutate src/pages/declutter/DeclutterItemPage.tsx |   useEffect(() => releaseItemShell(), []); |
 * @mutate src/components/landing/HomeShellLeaves.tsx | if (!ITEM_ROUTE.test(pathname)) document | if (ITEM_ROUTE.test(pathname)) document
 * @mutate src/components/landing/homeShell.ts |   doc.getElementById(ITEM_SHELL_ID)?.remove();\n |\n
 * @mutate src/main.tsx | if (document.documentElement.getAttribute("data-lh-app-shell") !== "item") document.getElementById("lh-item-shell")?.remove(); |
 * @mutate src/index.css | [data-lh-app-shell="item"] #lh-item-shell { | [data-lh-app-shell="itemz"] #lh-item-shell {
 * @mutate scripts/inline-shell-css.mjs |   { id: "lh-item-shell", | //{ id: "lh-item-shell",
 * @mutate src/components/declutter/itemShell.ts |   if (photo) return photo.complete; |   if (photo) return true;
 * @mutate src/components/declutter/itemShell.ts |   return !root.querySelector("[data-item-loading]"); |   return true;
 * @mutate src/components/declutter/DeclutterSkeletons.tsx | <Skeleton data-item-photo-bone="" | <Skeleton
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LucideProvider } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import { DeclutterItemSkeleton } from "@/components/declutter/DeclutterSkeletons";
import { ITEM_SHELL_HOLD_MS, itemPageReady, releaseItemShell } from "@/components/declutter/itemShell";
import { blankComments } from "./helpers/blankNonCode";
import { ITEM_PHOTO_MARKUP, SHELL_END, SHELLS } from "../../scripts/inline-shell-css.mjs";
import { scopeShellIds } from "../../scripts/shell-ids.mjs";

const ROOT = join(__dirname, "..", "..");
const INDEX = join(ROOT, "index.html");
const PATH = "/declutter/item/0a1b2c3d-1111-4222-8333-444455556666";
const START = '<div id="lh-item-shell" aria-hidden="true" inert data-lh-shell="start">';

function rendered(): string {
  // A phone on the bare route: the skeleton reads the desktop queries on its first render.
  const mm = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  window.history.replaceState(null, "", PATH);
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <LucideProvider strokeWidth={ICON_STROKE_PX} nonScalingStroke>
          <MemoryRouter initialEntries={[PATH]}>
            <DeclutterItemSkeleton />
          </MemoryRouter>
        </LucideProvider>
      </QueryClientProvider>,
    );
  } finally {
    window.matchMedia = mm;
    window.history.replaceState(null, "", "/");
  }
}

function block(html: string): string {
  const a = html.indexOf(START);
  expect(a, "index.html has the item shell").toBeGreaterThan(-1);
  const b = html.indexOf(SHELL_END, a);
  expect(b).toBeGreaterThan(a);
  return html.slice(a + START.length, b);
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("a phone's item page paints its own loading frame, with the first photo, from the HTML (item page speed)", () => {
  it("index.html's item block is byte-for-byte what DeclutterItemSkeleton renders on a phone", () => {
    const want = scopeShellIds(rendered(), "item");
    let html = readFileSync(INDEX, "utf8");
    if (process.env.LH_WRITE_MD_SHELLS === "1") {
      const a = html.indexOf(START) + START.length;
      html = html.slice(0, a) + want + html.slice(html.indexOf(SHELL_END, a));
      writeFileSync(INDEX, html);
    }
    expect(block(html)).toBe(want);
    expect(want.length).toBeGreaterThan(500);
    // Exactly one photo frame for the script to fill, and no visible words (it shows in every language).
    expect(want.match(/data-item-photo-bone=""/g)).toHaveLength(1);
    expect(want).toContain('data-item-loading=""');
    // The page title is screen-reader only, and the sticky bar's copy of it shows only once the page has scrolled
    // (.sticky-title-row-name: opacity 0 until html.page-scrolled), which the fixed shell never does.
    const hidden = /<[^>]*class="[^"]*\b(?:sr-only|sticky-title-row-name)\b[^"]*"[^>]*>[^<]*</g;
    const visible = want.replace(hidden, "<").replace(/<[^>]*>/g, " ").trim();
    expect(visible).toBe("");
  });

  it("is hidden until shown, shown by its own rule, and dropped by main.tsx when the HTML did not show it", () => {
    const index = readFileSync(INDEX, "utf8");
    expect(index).toMatch(/#lh-item-shell \{\s*display: none;\s*\}/);
    expect(index).toMatch(/\[data-lh-app-shell="item"\] #boot-loader \.boot-h \{\s*background-image: none;/);
    const sheet = readFileSync(join(ROOT, "src/index.css"), "utf8");
    expect(sheet).toMatch(/\[data-lh-app-shell="item"\] #lh-item-shell \{\s*display: block;\s*position: fixed;/);
    const main = blankComments(readFileSync(join(ROOT, "src/main.tsx"), "utf8"));
    expect(main).toContain('if (document.documentElement.getAttribute("data-lh-app-shell") !== "item") document.getElementById("lh-item-shell")?.remove();');
  });

  it("the item page holds it; the app drops it off an item route and on every error card", () => {
    expect(blankComments(readFileSync(join(ROOT, "src/pages/declutter/DeclutterItemPage.tsx"), "utf8"))).toContain("useEffect(() => releaseItemShell(), []);");
    const leaves = blankComments(readFileSync(join(ROOT, "src/components/landing/HomeShellLeaves.tsx"), "utf8"));
    expect(leaves).toContain("if (!ITEM_ROUTE.test(pathname)) document.getElementById(ITEM_SHELL_ID)?.remove();");
    const helper = blankComments(readFileSync(join(ROOT, "src/components/landing/homeShell.ts"), "utf8"));
    expect(helper).toContain('export const ITEM_SHELL_ID = "lh-item-shell";');
    const drop = helper.match(/export function dropHomeShell\([^)]*\): void \{([^}]*)\}/)?.[1] ?? "";
    expect(drop).toContain("doc.getElementById(ITEM_SHELL_ID)?.remove();");
  });

  it("stays until the gallery's first photo is complete, goes at once for anything that is not the loading frame, and at most after the hold", () => {
    const setup = (rootHtml: string) => {
      document.body.innerHTML = `<div id="root">${rootHtml}</div><div id="lh-item-shell"></div>`;
    };
    setup('<div data-item-loading=""></div>');
    expect(itemPageReady(), "still loading").toBe(false);
    setup('<div data-gallery-track=""><img></div>');
    const img = document.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: false, configurable: true });
    expect(itemPageReady(), "photo still loading").toBe(false);
    Object.defineProperty(img, "complete", { value: true, configurable: true });
    expect(itemPageReady(), "photo complete").toBe(true);
    setup('<div data-gallery-empty=""></div>');
    expect(itemPageReady(), "an item with no photos").toBe(true);
    setup('<div data-item-unavailable-onward=""></div>');
    expect(itemPageReady(), "the item is gone").toBe(true);

    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
    setup('<div data-item-loading=""></div>');
    releaseItemShell();
    vi.advanceTimersByTime(ITEM_SHELL_HOLD_MS - 100);
    expect(document.getElementById("lh-item-shell"), "held while loading").not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(document.getElementById("lh-item-shell"), "gone after the hold").toBeNull();
    setup('<div data-gallery-empty=""></div>');
    releaseItemShell();
    vi.advanceTimersByTime(100);
    expect(document.getElementById("lh-item-shell"), "gone once ready").toBeNull();
    vi.unstubAllGlobals();
  });

  it("the build inlines its CSS, with the photo the script draws", () => {
    const item = SHELLS.find((s: { id: string }) => s.id === "lh-item-shell") as { htmlAttr: string; show: string; extra?: string } | undefined;
    expect(SHELLS.length).toBeGreaterThan(6);
    expect(item?.htmlAttr).toBe('data-lh-app-shell="item"');
    expect(item?.show).toContain('[data-lh-app-shell="item"] #lh-item-shell{display:block;position:fixed');
    expect(item?.extra).toBe(ITEM_PHOTO_MARKUP);
    // The classes the script gives the photo are in that markup, so their rules are inlined.
    const script = readFileSync(INDEX, "utf8");
    expect(script).toContain('img.className = "h-full w-full object-cover bg-photo-empty";');
    expect(ITEM_PHOTO_MARKUP).toContain('class="h-full w-full object-cover bg-photo-empty"');
  });
});
