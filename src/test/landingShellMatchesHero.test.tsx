/**
 * B100 (11-04, Q2705/Q2708; lead: "the hero is LOCKED: byte-identical markup, font, colour and copy, with a guard
 * comparing the prerendered and React heroes; no flash or shift on hydration").
 *
 * index.html's #lh-landing-shell block is the landing's top bar and hero as the app renders them for a guest on "/"
 * (PublicLayout landing, no footer, HeroSection). This renders the same tree and requires the block to be exactly
 * that markup, so a change to the hero, the top bar or the landing wrapper turns this red until the block is
 * rewritten from the source:  LH_WRITE_LANDING_SHELL=1 npx vitest run src/test/landingShellMatchesHero.test.tsx
 * It also holds the locked copy (CLAUDE.md) in the block, the show rule of index.html's inline script, and that
 * HeroSection takes the copy away once it is painted.
 *
 * @mutate src/components/landing/HeroSection.tsx |   useEffect(() => removeLandingShellOncePainted(), []); |
 * @mutate src/components/landing/HeroSection.tsx | lg:mt-7 text-ds-16 | lg:mt-6 text-ds-16
 * @mutate index.html | if (k && k.indexOf("sb-") === 0 && k.slice(-11) === "-auth-token") return; | if (k && k.indexOf("sb-") === 0) {}
 * @mutate src/index.css | [data-lh-landing-shell] #lh-landing-shell {\n  display: block; | [data-lh-landing-shell] #lh-landing-shell {\n  display: none;
 * @mutate src/components/landing/landingShell.ts |   raf(() => raf(() => el.remove())); |   el.remove();
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import PublicLayout from "@/components/marketing/PublicLayout";
import HeroSection from "@/components/landing/HeroSection";
import { removeLandingShellOncePainted } from "@/components/landing/landingShell";

const ROOT = join(__dirname, "..", "..");
const INDEX = join(ROOT, "index.html");
const START = "<!-- lh-landing-shell:start -->";
const END = "<!-- lh-landing-shell:end -->";

function rendered(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={["/"]}>
      <PublicLayout noNavSpacer landing footer={false}>
        <HeroSection />
      </PublicLayout>
    </MemoryRouter>,
  );
}

function block(html: string): string {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  expect(a, "index.html has the landing shell markers").toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return html.slice(a + START.length, b);
}

const showScript = (html: string) =>
  [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).find((b) => b.includes("data-lh-landing-shell")) ?? "";

describe("the guest landing's HTML-drawn first screen is the app's own hero (B100)", () => {
  it("index.html's block is byte-for-byte what React renders for a guest on /", () => {
    const want = rendered();
    let html = readFileSync(INDEX, "utf8");
    if (process.env.LH_WRITE_LANDING_SHELL === "1") {
      html = html.slice(0, html.indexOf(START) + START.length) + want + html.slice(html.indexOf(END));
      writeFileSync(INDEX, html);
    }
    expect(block(html)).toBe(want);
    expect(want.length).toBeGreaterThan(1000);
  });

  it("carries the LOCKED hero copy, font and colours (CLAUDE.md)", () => {
    const b = block(readFileSync(INDEX, "utf8"));
    expect(b).toMatch(/Louisiana(’|&rsquo;|&#x27;|')s local/);
    expect(b).toContain('style="font-style:italic;color:var(--lp-money)">partner.</em>');
    expect(b).toContain(">Hire help or find work. One account, real neighbors.</p>");
    expect(b).toContain('class="landing-h1 relative z-10 font-display font-bold');
    expect(b).toContain("landing-page");
  });

  it('is shown only on "/" for a guest outside the native app, and removed after 10 s at most', () => {
    const src = showScript(readFileSync(INDEX, "utf8"));
    expect(src).not.toBe("");
    const run = (pathname: string, keys: string[], opts: { capacitor?: boolean; protocol?: string } = {}) => {
      const attrs: string[] = [];
      const timers: number[] = [];
      const store = { length: keys.length, key: (i: number) => keys[i] ?? null };
      new Function("document", "location", "localStorage", "window", "setTimeout", src)(
        { documentElement: { setAttribute: (n: string) => attrs.push(n) }, getElementById: () => null },
        { pathname, protocol: opts.protocol ?? "https:" },
        store,
        opts.capacitor ? { Capacitor: {} } : {},
        (_: unknown, ms: number) => timers.push(ms),
      );
      return { shown: attrs.includes("data-lh-landing-shell"), timers };
    };
    expect(run("/", [])).toEqual({ shown: true, timers: [10000] });
    expect(run("/", ["helpr_lang"]).shown).toBe(true);
    expect(run("/", ["sb-proj-auth-token"]).shown, "a stored session goes to /home").toBe(false);
    for (const p of ["/home", "/browse", "/declutter", "/terms"]) expect(run(p, []).shown, p).toBe(false);
    expect(run("/", [], { capacitor: true }).shown, "native app").toBe(false);
    expect(run("/", [], { protocol: "capacitor:" }).shown, "native app").toBe(false);
    // Hidden by index.html's inline style; shown only by the app's own (non-blocking) stylesheet, so it never paints
    // unstyled (measured before this rule moved: two layout shifts inside the shell as that sheet arrived).
    const inline = readFileSync(INDEX, "utf8");
    expect(inline).toMatch(/#lh-landing-shell \{\s*display: none;\s*\}/);
    expect(inline).not.toMatch(/\[data-lh-landing-shell\] #lh-landing-shell \{/);
    const sheet = readFileSync(join(ROOT, "src/index.css"), "utf8");
    expect(sheet).toMatch(/\[data-lh-landing-shell\] #lh-landing-shell \{\s*display: block;\s*position: fixed;/);
  });

  it("HeroSection takes the copy away two frames after it mounts", async () => {
    const el = document.createElement("div");
    el.id = "lh-landing-shell";
    document.body.appendChild(el);
    const frames: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
    removeLandingShellOncePainted();
    expect(document.getElementById("lh-landing-shell"), "not before React's hero is painted").not.toBeNull();
    frames.shift()!();
    expect(document.getElementById("lh-landing-shell")).not.toBeNull();
    frames.shift()!();
    expect(document.getElementById("lh-landing-shell")).toBeNull();
    vi.unstubAllGlobals();
    const hero = readFileSync(join(ROOT, "src/components/landing/HeroSection.tsx"), "utf8");
    expect(hero).toContain("useEffect(() => removeLandingShellOncePainted(), []);");
  });
});
