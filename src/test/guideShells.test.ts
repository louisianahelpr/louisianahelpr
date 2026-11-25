/**
 * Guide prerender (11-24; owner rule: pages under 2 s): every live gift guide page, the deals days and the /gift-guides
 * landing have a first screen in the raw HTML (src/prerender/guidePages.tsx -> scripts/lib/guideShellBuild.mjs ->
 * api/share.ts via src/lib/guideShell.mjs), drawn from the page's own component, carrying its banner and its first
 * items (name, link, photo), and src/boot/guideShellHandoff.ts keeps it over the booting app only until the page's own
 * content is on screen. Round 2 (owner 2026-11-24 ~10 PM, "Finish + land for everyone"): signed-in visitors too (the
 * member rules and index.html's guide script), the page's own rules inside the block (after the app sheet, as the page
 * has them), the deals list and theme row drawn in, built asset paths, and a redraw once the web fonts are in.
 *
 * @mutate src/lib/guideShell.mjs |   const page = html.replace(/<div\s+id="boot-loader"[^>]*>/, (open) => `${open}${block}`); |   const page = html;
 * @mutate src/content/giftGuideLive.mjs | export const LIVE_GUIDES_1121 = ["her", | export const LIVE_GUIDES_1121 = ["her", "lh-not-prerendered",
 * @mutate scripts/lib/guideShellBuild.mjs |   if (items.length > FIRST_SCREEN_ITEMS) { |   if (items.length > 0) {
 * @mutate src/boot/guideShellHandoff.ts |   if (signedIn !== member \|\| el.getAttribute("data-guide-shell") !== path) { |   if (el.getAttribute("data-guide-shell") !== path) {
 * @mutate src/boot/guideShellHandoff.ts |     if (!content \|\| Boolean(content.closest(".app-shell-frame")) !== member) return; |     if (!content) return;
 * @mutate scripts/lib/guideShellBuild.mjs |     for (const sib of [...(node.parentElement?.children ?? [])]) if (sib !== node) sib.setAttribute("data-lh-guest-only", ""); |     void node;
 * @mutate scripts/lib/guideShellBuild.mjs |       return [path, `${block.slice(0, at)}<style>${ownCss}</style>${block.slice(at)}`]; |       return [path, block];
 * @mutate src/prerender/guidePages.tsx |   return page.replace(DEALS_LOADING, () => render(path, <GiftGuideDeals day={day} initialDeals={bundledDeals as Deal[]} />)); |   return page;
 * @mutate index.html |             if (key.indexOf("sb-") === 0 && key.slice(-11) === "-auth-token") html.setAttribute("data-lh-guide-member", ""); |             void key;
 * @mutate index.html |           el.innerHTML = el.innerHTML; |           void el;
 * @mutate src/boot/guideShellHandoff.ts |   doc.body.appendChild(el); |   void doc.body;
 * @mutate src/main.tsx | adoptGuideShell(window.location.pathname, tokenProbeAtBoot(), document); | void adoptGuideShell;
 * @mutate api/share.ts |       return respond(guided, meta.cdnCache, 200, meta.noindexHeader === true); |       return respond(page, meta.cdnCache, 200, meta.noindexHeader === true);
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { LIVE_GUIDES_1121 } from "@/content/giftGuideLive.mjs";
import { DEAL_DAY_SLUGS } from "@/content/giftGuideDeals.mjs";
import { GUIDE_HINTS_ATTR, GUIDE_MEMBER_ATTR, GUIDE_SHELL_ID, GUIDE_SHELL_SHOW_RULE, guideShellHintRules, withGuideShell } from "@/lib/guideShell.mjs";
import { adoptGuideShell, GUIDE_MEMBER_ATTR as BOOT_MEMBER_ATTR, GUIDE_SHELL_ELEMENT_ID, GUIDE_SHELL_MAX_MS } from "@/boot/guideShellHandoff";
import { FIRST_SCREEN_ITEMS, ITEM_SELECTOR, builtAssetPaths, guideShellData } from "../../scripts/lib/guideShellBuild.mjs";

// The page renders once per width, as the build's Vite config makes it (useIsMobile aliased to the stub).
vi.mock("@/hooks/use-mobile", async () => await import("@/prerender/useIsMobileStub"));

/** The first n item names of a page, in page order (gift names, deal lines' store names, or Top 10 cards). */
function firstNames(markup: string, n: number): string[] {
  const doc = new DOMParser().parseFromString(`<div>${markup.replace(/<style[\s\S]*?<\/style>/g, "")}</div>`, "text/html");
  const main = doc.querySelector(".gg-main");
  if (!main) return [];
  return [...main.querySelectorAll(ITEM_SELECTOR)].slice(0, n).map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40));
}

let rendered: Record<string, { phone: string; desktop: string }>;
let data: ReturnType<typeof guideShellData>["data"];
let counts: Record<string, number>;
let paths: string[];

beforeAll(async () => {
  const mod = await import("@/prerender/guidePages");
  paths = mod.GUIDE_SHELL_PATHS;
  rendered = await mod.renderGuidePages();
  // A stand-in sheet: the real one is the build's (scripts/prerender-static-pages.mjs reads dist/).
  // And stand-in built names for the page's image imports (the build lists dist/assets).
  const all = Object.values(rendered).map((r) => r.phone + r.desktop).join("");
  const names = [...new Set([...all.matchAll(/\/src\/assets\/([\w.-]+?)\.(webp|png|jpe?g|svg|avif|gif)\b/g)].map((m) => `${m[1]}-AbCd1234.${m[2]}`))];
  expect(names.length).toBeGreaterThan(0);
  ({ data, counts } = guideShellData(rendered, ".gg{color:red}", names));
}, 120_000);

describe("every live guide page has its first screen in the HTML", () => {
  it("covers the landing and every live guide slug", () => {
    expect(LIVE_GUIDES_1121.length).toBeGreaterThan(6);
    const want = ["/gift-guides", ...LIVE_GUIDES_1121.map((s) => `/gift-guides/${s}`)];
    expect([...paths].sort()).toEqual([...want].sort());
    expect(Object.keys(data.pages).sort()).toEqual([...want].sort());
  });

  it("each block carries the banner and the page's own first items, with their links and photos", () => {
    let checked = 0;
    for (const p of paths) {
      const block = data.pages[p];
      // The page's own rules come first inside the block, after the app sheet in document order, as the page has them.
      expect(block.startsWith(`<div id="${GUIDE_SHELL_ID}" data-guide-shell="${p}"><style>`), p).toBe(true);
      // A guide opens on at least 4 gifts; a deals day on at least one line (Small Business Saturday's shop grid is read live).
      const least = DEAL_DAY_SLUGS.includes(p.replace("/gift-guides/", "")) ? 1 : 4;
      expect(counts[p], p).toBeGreaterThanOrEqual(least);
      expect(counts[p], p).toBeLessThanOrEqual(FIRST_SCREEN_ITEMS);
      for (const w of ["phone", "desktop"] as const) {
        const full = rendered[p][w];
        const names = firstNames(full, Math.max(least, Math.min(4, counts[p])));
        expect(names.length, `${p} ${w}`).toBeGreaterThanOrEqual(least);
        const own = firstNames(block, FIRST_SCREEN_ITEMS * 2);
        for (const n of names) expect(own, `${p} ${w}: ${n}`).toContain(n);
      }
      // A guide or deals day opens on its banner h1; the landing's h1 is its head row's title.
      expect(block, p).toMatch(/<h1[\s>]/);
      expect(block, p).toMatch(/<a [^>]*href="[^"]+"/);
      expect(block, p).toMatch(/<img [^>]*src="[^"]+"/);
      // Never the whole list: the rest comes with the app.
      const doc = new DOMParser().parseFromString(block, "text/html");
      for (const v of doc.querySelectorAll(`#${GUIDE_SHELL_ID} > [data-lh-guide-v]`)) {
        expect(v.querySelectorAll(ITEM_SELECTOR).length, p).toBeLessThanOrEqual(FIRST_SCREEN_ITEMS);
      }
      const bare = block.replace(/^<div[^>]*><style>[^<]*<\/style>/, "");
      expect(bare, p).not.toMatch(/<style|<script|<footer/);
      // No stand-in where the page draws a lazy part once it is in (the deals list, the theme row), and no source path.
      // (Small Business Saturday's shop grid is read live from the database, so it keeps its loading line.)
      const standIn = p.endsWith("/small-business-saturday") ? /data-gift-theme-row-wait|\/src\/assets\/[^"]*/ : /data-gift-deals-loading|data-gift-theme-row-wait|\/src\/assets\/[^"]*/;
      expect(standIn.exec(bare)?.[0] ?? null, p).toBeNull();
      // A member's drawing: the guest site bar and spacer are marked, the guide's container and its parents are not.
      for (const v of doc.querySelectorAll(`#${GUIDE_SHELL_ID} > [data-lh-guide-v]`)) {
        const box = v.querySelector("[data-public-container]");
        expect(box, p).not.toBeNull();
        expect(box?.closest("[data-lh-guest-only]"), p).toBeNull();
        expect(v.querySelectorAll("[data-lh-guest-only]").length, p).toBeGreaterThan(0);
        expect(v.querySelector("[data-lh-guest-only] a[href='/login'], [data-lh-guest-only] a[href^='/login'], [data-lh-guest-only] a[href^='/signup']"), `${p} site bar marked`).not.toBeNull();
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(6);
  });

  it("the rules end with the block's own show rule and one hide rule per tip drawn", () => {
    const hints = guideShellHintRules(Object.values(data.pages).join(""));
    expect(hints).toContain(`html[${GUIDE_HINTS_ATTR}~="menu"] #${GUIDE_SHELL_ID} [data-gift-menu-hint]{display:none}`);
    expect(data.css?.endsWith(GUIDE_SHELL_SHOW_RULE + hints)).toBe(true);
    expect(GUIDE_SHELL_SHOW_RULE).toContain(`html[${GUIDE_MEMBER_ATTR}] #${GUIDE_SHELL_ID} [data-lh-guest-only]{display:none}`);
    expect(guideShellData(rendered, null).data.css).toBeNull();
  });

  it("the menu tip is drawn for a first-time visitor (Her, Him, Kids, the landing)", () => {
    for (const p of ["/gift-guides", "/gift-guides/her", "/gift-guides/him", "/gift-guides/kids"]) expect(data.pages[p], p).toContain("data-gift-menu-hint=");
  });

  it("source asset paths become the build's hashed files, and a missing one fails the build", () => {
    const names = ["helpr-logo-256-7lzBG8jC.webp", "helpr-logo-96-C77gmY--.webp", "helpr-logo-96-Dg-lBfwp.js"];
    expect(builtAssetPaths('<img src="/src/assets/helpr-logo-256.webp" srcset="/src/assets/helpr-logo-96.webp 96w">', names))
      .toBe('<img src="/assets/helpr-logo-256-7lzBG8jC.webp" srcset="/assets/helpr-logo-96-C77gmY--.webp 96w">');
    expect(() => builtAssetPaths('<img src="/src/assets/gone.webp">', names)).toThrow(/gone\.webp/);
  });
});

describe("withGuideShell", () => {
  const shell = '<html><head><style id="lh-shell-css">.landing{}</style></head><body><div id="root"><div id="boot-loader" role="status"><p>x</p></div></div></body></html>';
  it("puts the page's block first inside #boot-loader and its rules in the inlined block", () => {
    const out = withGuideShell(shell, "/gift-guides/her/", data);
    expect(out).toContain(`<div id="boot-loader" role="status">${data.pages["/gift-guides/her"]}<p>x</p>`);
    expect(out).toContain(`<style id="lh-shell-css">${data.css}</style>`);
    expect(out).not.toContain(".landing{}");
  });
  it("leaves every other page, and a build without rules, as it was", () => {
    expect(withGuideShell(shell, "/gift-guides/nope", data)).toBe(shell);
    expect(withGuideShell(shell, "/browse", data)).toBe(shell);
    expect(withGuideShell(shell, "/gift-guides/her", { css: null, pages: data.pages })).toBe(shell);
    expect(withGuideShell(shell, "/gift-guides/her", null)).toBe(shell);
  });
  it("api/share.ts serves it on the guide pages and main.tsx adopts it before React renders", () => {
    const share = blankComments(readFileSync("api/share.ts", "utf8"));
    expect(share).toMatch(/withGuideShell\(page, path, GUIDE_SHELLS as GuideShellData\)/);
    expect(share).toMatch(/return respond\(guided, meta\.cdnCache/);
    const main = blankComments(readFileSync("src/main.tsx", "utf8"));
    const adopt = main.indexOf("adoptGuideShell(window.location.pathname, tokenProbeAtBoot(), document);");
    expect(adopt).toBeGreaterThan(0);
    expect(adopt).toBeLessThan(main.indexOf("createRoot("));
  });
});

describe("adoptGuideShell", () => {
  afterEach(() => vi.useRealTimers());
  const page = (path = "/gift-guides/her") => {
    document.body.innerHTML = `<div id="root"><div id="boot-loader"><div id="${GUIDE_SHELL_ID}" data-guide-shell="${path}">first screen</div></div></div>`;
  };
  const el = () => document.getElementById(GUIDE_SHELL_ID);

  afterEach(() => document.documentElement.removeAttribute(GUIDE_MEMBER_ATTR));
  it("one id and one member mark everywhere", () => {
    expect(GUIDE_SHELL_ELEMENT_ID).toBe(GUIDE_SHELL_ID);
    expect(BOOT_MEMBER_ATTR).toBe(GUIDE_MEMBER_ATTR);
  });

  it("a guest on the page it was drawn for: moved out of #boot-loader, kept until the page's own list is in", async () => {
    page();
    adoptGuideShell("/gift-guides/her/", false);
    expect(el()?.parentElement).toBe(document.body);
    document.getElementById("root")!.innerHTML = "<p>loading</p>";
    await new Promise((r) => setTimeout(r, 50));
    expect(el()).not.toBeNull();
    document.getElementById("root")!.innerHTML = '<ol><li data-gift-pick="">gift</li></ol>';
    await vi.waitFor(() => expect(el()).toBeNull());
  });

  it("signed in (marked by index.html's script): kept until the page is drawn inside the app's frame", async () => {
    page();
    document.documentElement.setAttribute(GUIDE_MEMBER_ATTR, "");
    adoptGuideShell("/gift-guides/her", true);
    expect(el()?.parentElement).toBe(document.body);
    // The guest layout's list (auth not known yet) is not the member's page: the block stays.
    document.getElementById("root")!.innerHTML = '<ol><li data-gift-pick="">gift</li></ol>';
    await new Promise((r) => setTimeout(r, 50));
    expect(el()).not.toBeNull();
    document.getElementById("root")!.innerHTML = '<div class="app-shell-frame"><ol><li data-gift-pick="">gift</li></ol></div>';
    await vi.waitFor(() => expect(el()).toBeNull());
  });

  it("a guest's hand-off never waits on the member frame", async () => {
    page();
    adoptGuideShell("/gift-guides/her", false);
    document.getElementById("root")!.innerHTML = '<div class="app-shell-frame"><ol><li data-gift-pick="">gift</li></ol></div>';
    await new Promise((r) => setTimeout(r, 50));
    expect(el()).not.toBeNull();
  });

  it("signed in without the mark (the script did not run), a mark without a session, or another path: removed at once", () => {
    page();
    adoptGuideShell("/gift-guides/her", true);
    expect(el()).toBeNull();
    page();
    document.documentElement.setAttribute(GUIDE_MEMBER_ATTR, "");
    adoptGuideShell("/gift-guides/her", false);
    expect(el()).toBeNull();
    document.documentElement.removeAttribute(GUIDE_MEMBER_ATTR);
    page("/gift-guides/her");
    adoptGuideShell("/gift-guides/him", false);
    expect(el()).toBeNull();
  });

  it("never longer than GUIDE_SHELL_MAX_MS", () => {
    vi.useFakeTimers();
    page();
    adoptGuideShell("/gift-guides/her", false);
    vi.advanceTimersByTime(GUIDE_SHELL_MAX_MS - 1);
    expect(el()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(el()).toBeNull();
  });
});

describe("index.html's guide script (before the first paint)", () => {
  const html = readFileSync("index.html", "utf8");
  const at = html.indexOf('if (location.pathname.indexOf("/gift-guides") !== 0');
  const code = html.slice(html.lastIndexOf("<script>", at) + "<script>".length, html.indexOf("</script>", at));
  const store = (entries: Record<string, string>) => ({
    get length() { return Object.keys(entries).length; },
    key: (i: number) => Object.keys(entries)[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
  });
  const run = (pathname: string, entries: Record<string, string>, fonts?: unknown) => {
    const doc = document.implementation.createHTMLDocument("x");
    doc.head.innerHTML = '<link rel="preload" as="font" href="/fonts/bodoni-moda-normal-latin.woff2" data-lh-hero-font media="not all">';
     
    new Function("location", "window", "document", "localStorage", code)({ pathname, protocol: "https:" }, {}, Object.assign(doc, fonts ? { fonts } : {}), store(entries));
    return doc;
  };
  it("is in the page and runs before the body", () => {
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(html.indexOf("</head>"));
  });
  it("marks a stored session and the closed tips on a guide path only", () => {
    const d = run("/gift-guides/her", { "sb-x-auth-token": "{}", "lh-gg-hint-menu": "1", "lh-gg-hint-heart": "0" });
    expect(d.documentElement.hasAttribute(GUIDE_MEMBER_ATTR)).toBe(true);
    expect(d.documentElement.getAttribute(GUIDE_HINTS_ATTR)).toBe("menu");
    const guest = run("/gift-guides/her", {});
    expect(guest.documentElement.hasAttribute(GUIDE_MEMBER_ATTR)).toBe(false);
    expect(guest.documentElement.hasAttribute(GUIDE_HINTS_ATTR)).toBe(false);
    const off = run("/browse", { "sb-x-auth-token": "{}" });
    expect(off.documentElement.hasAttribute(GUIDE_MEMBER_ATTR)).toBe(false);
    expect(off.querySelector("link")?.getAttribute("media")).toBe("not all");
  });
  it("turns on the Bodoni preloads on a guide page (its banner is set in both faces)", () => {
    expect(run("/gift-guides/monster-jam", {}).querySelector("link")?.getAttribute("media")).toBe("all");
  });
  it("draws the block again, at the same scroll, each time a web font finishes loading", () => {
    let done: (() => void) | null = null;
    const d = run("/gift-guides/her", {}, { addEventListener: (type: string, f: () => void) => { if (type === "loadingdone") done = f; } });
    d.body.innerHTML = `<div id="${GUIDE_SHELL_ID}"><p>gift</p></div>`;
    const before = d.querySelector(`#${GUIDE_SHELL_ID} p`);
    expect(done).not.toBeNull();
    done!();
    const after = d.querySelector(`#${GUIDE_SHELL_ID} p`);
    expect(after?.textContent).toBe("gift");
    expect(after).not.toBe(before);
    d.getElementById(GUIDE_SHELL_ID)!.remove();
    expect(() => done!()).not.toThrow();
  });
});
