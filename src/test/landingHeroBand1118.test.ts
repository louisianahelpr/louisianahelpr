/*
 * GUARD (owner decision 11-18, hero mockup B "Color band"; overrides the 11-17 "white everywhere" rule for the hero
 * ONLY): a soft olive-to-cream band behind the whole signed-out hero (top bar through the search), the page below
 * white; "partner." italic in the brand olive; the hero wording unchanged; the search pill and the Jobs | Declutter
 * switch white on the band; a dark olive band in dark mode with AA contrast; pure CSS (no image, no font).
 *
 * @mutate src/components/landing/HeroSection.tsx | <section className="landing-hero-band relative | <section className="relative
 * @mutate src/components/landing/HeroSection.tsx | <span className="landing-h1-accent">{es ? es.titleAccent : "partner."}</span> | {es ? es.titleAccent : "partner."}
 * @mutate src/index.css | .landing-page .landing-hero-band { background: var(--lp-hero-band); | .landing-page .landing-hero-band { background: var(--lp-page);
 * @mutate src/index.css | .landing-page .landing-h1-accent { font-style: italic; color: var(--lp-action-strong); } | .landing-page .landing-h1-accent { color: var(--lp-action-strong); }
 * @mutate src/index.css |   --lp-hero-band: linear-gradient(160deg, #2e2f22 0%, #262620 45%, #1c1a17 100%); |   --lp-hero-band: linear-gradient(160deg, #eaeed6 0%, #f4f6ea 45%, #fdfaf4 100%);
 * @mutate src/components/Navbar.tsx |         landing && atTop && "landing-nav-top", |
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const CSS = blankComments(read("src/index.css"));
const HERO = read("src/components/landing/HeroSection.tsx");

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
}
function bandFor(prefix: string): string {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{[^}]*--lp-hero-band:\\s*([^;]+);`));
  return m ? m[1].trim() : "";
}
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const stops = (g: string) => [...g.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0]);
const token = (scope: "light" | "dark", name: string) => {
  const sel = scope === "light" ? /(?:^|})\s*\.landing-page\s*\{([^}]*)\}/g : /\[data-theme="dark"\]\s*\.landing-page\s*\{([^}]*)\}/g;
  for (const m of CSS.matchAll(sel)) {
    const v = m[1].match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (v) return v[1];
  }
  return "";
};

describe("landing hero colour band (owner 11-18, mockup B)", () => {
  it("the hero section wears the band and 'partner.' is the accent span; the words are unchanged", () => {
    expect(HERO).toContain('<section className="landing-hero-band relative');
    expect(HERO).toContain('<span className="landing-h1-accent">{es ? es.titleAccent : "partner."}</span>');
    expect(HERO).toContain("<>Louisiana&rsquo;s local</>");
    expect(HERO).toContain('"Hire help, find work, or buy and sell. One account, real neighbors."');
  });

  it("light band is the lightened mockup gradient (owner 11-18: 'light up the green'); dark band is a dark olive gradient", () => {
    expect(bandFor(".landing-page")).toBe("linear-gradient(160deg, #eaeed6 0%, #f4f6ea 45%, #fdfaf4 100%)");
    const dark = bandFor('[data-theme="dark"] .landing-page');
    expect(dark).toMatch(/^linear-gradient\(160deg,/);
    expect(dark).not.toBe(bandFor(".landing-page"));
    expect(rule(".landing-page .landing-hero-band")).toMatch(/background:\s*var\(--lp-hero-band\)/);
  });

  it("pure CSS: no image or font inside the band", () => {
    expect(bandFor(".landing-page") + bandFor('[data-theme="dark"] .landing-page')).not.toMatch(/url\(/);
    expect(rule(".landing-page .landing-hero-band")).not.toMatch(/url\(/);
  });

  it("'partner.' is italic in the brand olive, AA on every band stop in light and dark", () => {
    const r = rule(".landing-page .landing-h1-accent");
    expect(r).toMatch(/font-style:\s*italic/);
    expect(r).toMatch(/color:\s*var\(--lp-action-strong\)/);
    for (const scope of ["light", "dark"] as const) {
      const g = bandFor(scope === "light" ? ".landing-page" : '[data-theme="dark"] .landing-page');
      const s = stops(g);
      expect(s.length).toBe(3);
      for (const name of ["--lp-action-strong", "--lp-ink", "--lp-body"]) {
        const fg = token(scope, name);
        expect(fg, `${scope} ${name}`).not.toBe("");
        for (const bg of s) expect(ratio(fg, bg), `${scope} ${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the search pill stays white (the surface) on the band (its Jobs | Declutter switch is gone, owner 11-18)", () => {
    expect(rule(".landing-search")).toMatch(/background:\s*var\(--lp-surface\)/);
    expect(rule(".landing-search")).toMatch(/box-shadow:\s*var\(--lp-shadow\)/);
  });

  it("the band runs behind the top bar only at the very top of the landing", () => {
    expect(rule(".landing-page .glass-nav.landing-nav-top")).toMatch(/background-color:\s*transparent/);
    const nav = read("src/components/Navbar.tsx");
    expect(nav).toContain('landing && atTop && "landing-nav-top",');
    expect(nav).toContain("setAtTop(window.scrollY <= 0)");
  });
});
