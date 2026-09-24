/**
 * docs/OPEN.md Q13 — script-src must not allow inline script.
 *
 * On 2026-09-23 a stored `javascript:` href executed in an admin session. The
 * sink was fixed (3c81624d0, dd4713c00); what let it RUN was 'unsafe-inline'
 * in script-src. This keeps it out of every CSP the app ships (vercel.json
 * header, index.html's Capacitor meta) and proves the inline
 * scripts the app DOES rely on (storage probe, boot watchdog, pre-paint theme,
 * async-CSS swap, offline retry) still run: each one's exact sha256 must be
 * listed, or the browser silently blocks it.
 *
 * The class is "a CSP edit or an inline-script edit that either re-opens
 * injection or silently kills a boot script". This test sees it from SOURCE,
 * no build needed. scripts/check-csp-inline-scripts.mjs (end of
 * `npm run build`) sees the same thing in the BUILT dist/, including anything a
 * Vite plugin injects.
 *
 * Inventory is derived from the files, not listed here: every *.html under the
 * repo root and public/, every inline executable <script> in them.
 */
// @mutate vercel.json | script-src 'self' 'sha256-NByp | script-src 'self' 'unsafe-inline' 'sha256-NByp
// @mutate index.html | var probeKey = "__helpr_boot_storage_probe__"; | var probeKey = "__helpr_boot_storage_probe_v2__";
// @mutate vite.config.ts | if(k.sheet)on(); | if(k.sheet){on()}
// @mutate public/offline.html | </title> | </title><!-- paste your .p8 here -->
// @mutate index.html | script-src 'self' 'sha256-NByp | script-src 'self' 'unsafe-eval' 'sha256-NByp
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  FORBIDDEN_SCRIPT_SRC,
  inlineExecutableScripts,
  inlineHandlers,
  javascriptUrls,
  metaCsp,
  scriptElements,
  scriptSrcTokens,
  sha256Source,
  vercelCsp,
} from "../../scripts/csp/inline-scripts.mjs";

const read = (p: string) => readFileSync(p, "utf8");
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

const vercelPolicy = vercelCsp(JSON.parse(read("vercel.json")));
const indexHtml = read("index.html");
const metaPolicy = metaCsp(indexHtml);

// Every HTML page the build ships: index.html + everything public/ copies over.
const pages = ["index.html", ...walk("public").filter((f) => f.endsWith(".html"))];

// The async-CSS swap is injected by a Vite plugin, not written in any HTML.
const swap = /const ASYNC_CSS_SWAP =\s*'([^']*)'/.exec(read("vite.config.ts"))?.[1] ?? null;

describe("CSP script-src (Q13)", () => {
  // A-004: Vercel never reads public/_headers (a Netlify/Cloudflare file), so a
  // CSP there is inert and drifts; a hardening edit made in it changes nothing.
  it("no inert header file ships beside vercel.json (A-004)", () => {
    expect(existsSync("public/_headers")).toBe(false);
  });

  // BR-007: the Apple Sign In JWT generator asks for a .p8 PRIVATE KEY. It is
  // an owner-only tool, opened from tools/ as a local file, never served.
  it("no developer tool that solicits a private key ships in public/", () => {
    expect(existsSync("tools/apple-jwt.html")).toBe(true);
    const shipped = walk("public").filter((f) => /BEGIN PRIVATE KEY|\.p8\b/i.test(read(f)));
    expect(shipped).toEqual([]);
  });

  it("every shipped policy exists", () => {
    expect(vercelPolicy).toBeTruthy();
    expect(metaPolicy).toBeTruthy();
  });

  it.each([
    ["vercel.json", () => vercelPolicy],
    ["index.html <meta>", () => metaPolicy],
  ] as const)("%s script-src has no 'unsafe-inline' / 'unsafe-eval' / 'unsafe-hashes' / 'strict-dynamic'", (_n, get) => {
    const tokens = scriptSrcTokens(get() ?? "");
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.filter((t) => FORBIDDEN_SCRIPT_SRC.includes(t))).toEqual([]);
  });

  it("inventory is non-empty: the boot scripts and offline retry are seen", () => {
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const total = pages.reduce((n, p) => n + inlineExecutableScripts(read(p)).length, 0);
    expect(total).toBeGreaterThanOrEqual(4);
    expect(inlineExecutableScripts(indexHtml).length).toBeGreaterThanOrEqual(3);
    // JSON-LD is a data block: seen as a script, but never executable.
    const ld = scriptElements(indexHtml).filter((s) => s.type === "application/ld+json");
    expect(ld.length).toBeGreaterThanOrEqual(1);
    expect(ld.every((s) => !s.executable)).toBe(true);
    expect(swap).toBeTruthy();
  });

  it.each(pages)("every inline executable script in %s is hash-allowed by vercel.json", (page) => {
    const tokens = scriptSrcTokens(vercelPolicy ?? "");
    const missing = inlineExecutableScripts(read(page))
      .map((s) => ({ hash: sha256Source(s.body), start: s.body.trim().slice(0, 50) }))
      .filter((s) => !tokens.includes(s.hash));
    expect(missing).toEqual([]);
  });

  it("index.html's inline scripts and the async-CSS swap are hash-allowed by the Capacitor meta CSP and vercel.json", () => {
    const bodies = [...inlineExecutableScripts(indexHtml).map((s) => s.body), swap ?? ""];
    for (const policy of [metaPolicy, vercelPolicy]) {
      const tokens = scriptSrcTokens(policy ?? "");
      expect(bodies.map(sha256Source).filter((h) => !tokens.includes(h))).toEqual([]);
    }
  });

  it.each(pages)("%s has no inline event handler and no javascript: URL", (page) => {
    const html = read(page);
    expect(inlineHandlers(html)).toEqual([]);
    expect(javascriptUrls(html)).toEqual([]);
  });

  it("the detectors themselves fire (not vacuous)", () => {
    expect(inlineHandlers('<link rel="stylesheet" onload="this.media=\'all\'">').length).toBe(1);
    expect(javascriptUrls('<a href="javascript:alert(1)">x</a>').length).toBe(1);
    expect(inlineExecutableScripts("<script>x()</script><script type=\"application/ld+json\">{}</script><script src=\"/a.js\"></script>").length).toBe(1);
    expect(scriptSrcTokens("default-src 'self'; script-src 'self' 'unsafe-inline'")).toContain("'unsafe-inline'");
  });
});
