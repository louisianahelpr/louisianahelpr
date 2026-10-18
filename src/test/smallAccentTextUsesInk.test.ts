/**
 * Q948: small text in the brand accent uses an INK token, never bare
 * `text-accent`.
 *
 * Measured on prod 2026-10-07 (poster-e2e, /messages thread, 375 and 1440):
 * the chat's "Keep chats & payments on Helpr" notice, 11px `text-accent` on
 * its own `bg-accent/10` tint, was 3.95:1 in dark (#d46735 on #36271f), under
 * AA's 4.5:1 for small text. Dark `--burnt-sienna` (the accent) is tuned as a
 * fill, not as small text; `--sienna-ink` (label on its own tint) and
 * `--accent-ink` (text on a raised surface) are the text forms, and both are
 * byte-identical to the accent in light, so light mode does not move.
 *
 * Inventory from source: every className string in src/**\/*.tsx that names a
 * small text size (text-ds-9..13) together with bare `text-accent` (not
 * `text-accent-foreground`). It must be empty. Then the token half: dark
 * `--sienna-ink` over the accent's 10% tint on either dark surface clears 4.5.
 *
 * @mutate src/components/messages/ChatView.tsx | <p className="text-ds-11 leading-snug text-[hsl(var(--sienna-ink))]"> | <p className="text-ds-11 leading-snug text-accent">
 * @mutate src/components/CancellationDialog.tsx | <span className="text-ds-11 text-[hsl(var(--sienna-ink))] font-medium"> | <span className="text-ds-11 text-accent font-medium">
 * @mutate src/index.css | --sienna-ink: 19 72% 68%; | --sienna-ink: 19 65% 52%;
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__") continue;
      tsxFiles(p, out);
    } else if (name.endsWith(".tsx") && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const SMALL = /\btext-ds-(?:9|10|11|12|13)\b/;
const BARE_ACCENT = /(^|\s)text-accent(?![-\w/])/;

/** Block of the stylesheet that sets a theme's tokens. */
function tokens(css: string, open: string): Record<string, string> {
  const at = css.indexOf(open);
  const body = css.slice(at, css.indexOf("\n}", at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([0-9.]+\s+[0-9.]+%\s+[0-9.]+%)/g)) if (!(m[1] in out)) out[m[1]] = m[2];
  return out;
}

function rgb(hsl: string): [number, number, number] {
  const [h, s, l] = hsl.split(/\s+/).map((v) => parseFloat(v));
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => L - S * Math.min(L, 1 - L) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const over = (top: number[], a: number, bot: number[]) => top.map((t, i) => t * a + bot[i] * (1 - a)) as [number, number, number];
function ratio(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("small accent text uses an ink token (Q948)", () => {
  it("no small text wears bare text-accent", () => {
    const files = tsxFiles(join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(300);
    const bad: string[] = [];
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const cls = m[1] ?? m[2];
        if (SMALL.test(cls) && BARE_ACCENT.test(cls)) bad.push(`${relative(ROOT, f)}:${src.slice(0, m.index).split("\n").length} ${cls}`);
      }
    }
    expect(bad, "small text in bare text-accent: use text-[hsl(var(--sienna-ink))] on a tint, --accent-ink on a surface").toEqual([]);
  });

  it("dark --sienna-ink clears AA on the accent's 10% tint over both dark surfaces", () => {
    const css = readFileSync(join(ROOT, "src", "index.css"), "utf8");
    const dark = tokens(css, '[data-theme="dark"] {');
    for (const k of ["sienna-ink", "burnt-sienna", "parchment", "ivory-sand"]) expect(dark[k], `dark --${k} not found`).toBeTruthy();
    for (const surface of ["parchment", "ivory-sand"]) {
      const bg = over(rgb(dark["burnt-sienna"]), 0.1, rgb(dark[surface]));
      expect(ratio(rgb(dark["sienna-ink"]), bg), `--sienna-ink on accent/10 over dark --${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    // Can fail: the bare accent itself, the original bug, does not.
    const bg = over(rgb(dark["burnt-sienna"]), 0.1, rgb(dark["ivory-sand"]));
    expect(ratio(rgb(dark["burnt-sienna"]), bg)).toBeLessThan(4.5);
  });
});
