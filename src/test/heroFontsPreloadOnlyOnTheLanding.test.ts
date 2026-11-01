/**
 * Speed (owner rule: pages under 2 s; Home on Slow 4G read 3.4 s). The landing hero's two Bodoni preloads (42 KB) were
 * fetched on EVERY route, though no other first screen draws Bodoni (measured 2026-10-31 on a production build at 375:
 * /home, /declutter, /messages, /browse, /posts, /activity, /profile, /dashboard, /search, guest /login, /signup,
 * /browse load Montserrat only; "/" draws Bodoni normal + italic). Holding them back off "/" took /home Slow 4G from
 * 3.43-3.82 s (558 KB) to 3.38-3.50 s (517 KB), same build, interleaved runs (~/.lh-shots/b53/speed).
 *
 * The class: a hero-only font preload that starts on routes that do not draw it, or one the landing loses (Q371's
 * CLS rule: heroFontSwapDoesNotShift.test.ts keeps the preload links themselves).
 *   (a) each latin Bodoni preload is marked data-lh-hero-font and starts off (media="not all");
 *   (b) index.html's inline script turns them on for "/" only (run here on "/", "/home", "/declutter/");
 *   (c) the app warms them once the page has settled, so a later Bodoni heading finds them cached.
 *
 * @mutate index.html |       href="/fonts/bodoni-moda-italic-latin.woff2"\n      crossorigin\n      data-lh-hero-font\n      media="not all" |       href="/fonts/bodoni-moda-italic-latin.woff2"\n      crossorigin\n      data-lh-hero-font
 * @mutate index.html |         if ((location.pathname.replace(/\/+$/, "") \|\| "/") !== "/") return; |         if (false) return;
 * @mutate src/App.tsx |     link.media = "all"; |     void link;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const html = readFileSync(resolve("index.html"), "utf8");
const app = blankComments(readFileSync(resolve("src/App.tsx"), "utf8"));
const LATIN = ["/fonts/bodoni-moda-normal-latin.woff2", "/fonts/bodoni-moda-italic-latin.woff2"];

const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
/** index.html without its comments (one of them quotes a "<script>" tag), then the one inline script naming the hero fonts. */
function withoutHtmlComments(src: string): string {
  let out = src;
  for (;;) {
    const start = out.indexOf("<!--");
    if (start < 0) return out;
    const end = out.indexOf("-->", start + 4);
    out = end < 0 ? out.slice(0, start) : out.slice(0, start) + out.slice(end + 3);
  }
}
const script = [...withoutHtmlComments(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1]).find((b) => b.includes("data-lh-hero-font"));

/** Runs index.html's inline script on a path; returns each hero font link's media afterwards. */
function mediaAfter(pathname: string): string[] {
  const fonts = LATIN.map(() => ({ media: "not all" }));
  const doc = { querySelectorAll: (sel: string) => (sel === "link[data-lh-hero-font]" ? fonts : []) };
  new Function("document", "location", script ?? "")(doc, { pathname });
  return fonts.map((f) => f.media);
}

describe("the landing hero's Bodoni preloads start only on the landing", () => {
  it("(a) each latin Bodoni preload is a hero font that starts off", () => {
    expect(LATIN.length).toBeGreaterThan(1);
    for (const href of LATIN) {
      const link = links.find((l) => l.includes(`href="${href}"`) && /rel="preload"/.test(l));
      expect(link, href).toBeDefined();
      expect(link).toContain("data-lh-hero-font");
      expect(link).toContain('media="not all"');
    }
  });

  it('(b) the inline script turns them on for "/" only', () => {
    expect(script).toBeDefined();
    expect(mediaAfter("/")).toEqual(["all", "all"]);
    expect(mediaAfter("/home")).toEqual(["not all", "not all"]);
    expect(mediaAfter("/declutter/")).toEqual(["not all", "not all"]);
  });

  it("(c) the app warms them once the page has settled", () => {
    const at = app.indexOf("whenPageSettled(() => {");
    expect(at).toBeGreaterThan(-1);
    const body = app.slice(at, app.indexOf("});", app.indexOf('link[data-lh-hero-font]', at)) + 3);
    expect(body).toContain('document.querySelectorAll<HTMLLinkElement>("link[data-lh-hero-font]")');
    expect(body).toContain('link.media = "all";');
  });
});
