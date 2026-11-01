/**
 * /terms/full, /privacy/full AND /sms-opt-in CARRY THEIR TEXT IN THE RAW HTML (owner/lead, 2026-10-23). Twilio's A2P
 * checker fetches them without running JavaScript and reported them unreadable: the SPA shell has no page text.
 *
 * The chain this checks, end to end without a browser:
 *   1. the build renders each page's own body component (src/prerender/staticPages.tsx) and it carries the required
 *      text and both opt-in images (the same check fails `npm run build`);
 *   2. `npm run build` runs that step (scripts/prerender-static-pages.mjs);
 *   3. vercel.json sends each URL to api/share (and no file in public/ shadows it: Vercel serves files first);
 *   4. api/share answers that exact rewrite with 200 HTML whose #root holds the text, and its own head.
 *
 * @mutate api/share.ts | const page = withStaticBody(applyMeta(shell, meta), url); | const page = applyMeta(shell, meta);
 * @mutate package.json |  && node scripts/prerender-static-pages.mjs && | &&
 * @mutate src/pages/info/legal/TermsSection.tsx |         title="SMS Terms" |         title="Text alerts"
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { STATIC_PAGE_MUST_SAY, STATIC_PAGE_PATHS, renderStaticPages, staticPageGaps } from "@/prerender/staticPages";

const ROOT = resolve(__dirname, "..", "..");
let handler: { fetch: (req: Request) => Promise<Response> };

beforeAll(async () => {
  // The handler imports the build's generated bodies; a test run has none (or an empty placeholder), so it gets the
  // real render of the same components instead. vi.doMock (not the hoisted vi.mock) AFTER the placeholder exists,
  // by absolute path: on a fresh checkout the file is missing until ensureOgShellSnapshot writes it, and a hoisted
  // mock of a path that does not exist yet never attaches (vacuity measured it: guard red before any mutation).
  ensureOgShellSnapshot(ROOT);
  vi.doMock(resolve(ROOT, "scripts/generated/static-pages.js"), () => ({ STATIC_PAGE_BODIES: renderStaticPages() }));
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
});

const rootOf = (html: string) => {
  const i = html.indexOf('<div id="root"');
  expect(i, "the shell has a #root").toBeGreaterThan(-1);
  return html.slice(i);
};

describe("the three Twilio pages are readable with no JavaScript", () => {
  it("the build-time render of each page's own body carries the required text and images", () => {
    const pages = renderStaticPages();
    expect(Object.keys(pages).sort()).toEqual(["/privacy/full", "/sms-opt-in", "/terms/full"]);
    expect(staticPageGaps(pages)).toEqual([]);
    expect(pages["/terms/full"].length).toBeGreaterThan(20_000);
    expect(pages["/terms/full"]).not.toMatch(/aria-expanded|data-state="closed"/);
  });

  it("npm run build runs the prerender after vite build", () => {
    const build = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).scripts.build as string;
    expect(build).toMatch(/^vite build && .*node scripts\/prerender-static-pages\.mjs/);
  });

  for (const path of STATIC_PAGE_PATHS) {
    it(`${path}: vercel.json sends it to api/share and nothing in public/ shadows it`, () => {
      const vercel = JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8")) as { rewrites: { source: string; destination: string }[] };
      expect(vercel.rewrites.find((r) => r.source === path)?.destination).toBe(`/api/share?_og=page&_id=${path.slice(1)}`);
      for (const f of [path, `${path}.html`, `${path}/index.html`]) expect(existsSync(resolve(ROOT, "public", f.slice(1))), f).toBe(false);
    });

    it(`${path}: api/share answers the rewrite with 200 HTML whose #root holds the page text`, async () => {
      const res = await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=page&_id=${path.slice(1)}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
      const html = await res.text();
      const root = rootOf(html);
      for (const s of STATIC_PAGE_MUST_SAY[path]) expect(root, s).toContain(s);
      expect(html).toContain(`<link rel="canonical" href="https://www.louisianahelpr.com${path}">`);
    });
  }

  it("any other page's shell is unchanged (no body injected)", async () => {
    const html = await (await handler.fetch(new Request("https://www.louisianahelpr.com/api/share?_og=page&_id=help"))).text();
    expect(rootOf(html)).not.toContain('id="static-page"');
  });
});
