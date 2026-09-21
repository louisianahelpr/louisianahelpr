/**
 * The live-presence green is a DOT colour, never a text colour.
 *
 * 2026-09-15: the a11y-prod sweep measured the public profile's "Active now"
 * label at 3.12:1 on white (#25a755, 13px) — `hsl(var(--live))` used as
 * `color`. The Messages row's 10px "Active now" used the same token the same
 * way. `--live-ink` is that hue darkened for text; this fails on any `color`
 * (inline style, CSS, or a Tailwind `text-[…]` arbitrary value) that still
 * reads `--live`, and checks the light-theme `--live-ink` clears AA on white.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// PROVEN ABLE TO FAIL 2026-09-20. Setting --live-ink back to --live's own value
// drops the measured ratio to 3.11:1 and this file goes red. It measures a
// CONTRAST RATIO from the token's H S% L%, not a count of call sites.
// @mutate src/index.css | --live-ink: 142 72% 27%; | --live-ink: 142 64% 40%;

const ROOT = path.resolve(__dirname, "../..");

/** `color:` (not background-color / borderColor) whose value reads --live, across a multi-line ternary. */
export function liveAsTextColour(source: string): string[] {
  const hits: string[] = [];
  const styleRe = /(?<![A-Za-z-])color\s*:\s*[^,;{}]*?var\(--live\)/g;
  const classRe = /text-\[hsl\(var\(--live\)[^\]]*\]/g;
  for (const re of [styleRe, classRe]) {
    for (const m of source.matchAll(re)) {
      hits.push(`${source.slice(0, m.index).split("\n").length}: ${m[0].replace(/\s+/g, " ")}`);
    }
  }
  return hits;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** WCAG relative-luminance contrast of an `H S% L%` token against white. */
function contrastOnWhite(hsl: string): number {
  const [h, s, l] = hsl.split(/\s+/).map((v) => parseFloat(v));
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => L - S * Math.min(L, 1 - L) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const Y = 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
  return 1.05 / (Y + 0.05);
}

describe("live-presence green: dot colour, not text colour", () => {
  it("no source uses --live as a text colour", () => {
    const bad = sourceFiles(path.join(ROOT, "src")).flatMap((f) =>
      liveAsTextColour(fs.readFileSync(f, "utf8")).map((h) => `${path.relative(ROOT, f)}:${h}`),
    );
    expect(bad, "use hsl(var(--live-ink)) for text; --live stays for dots and glows").toEqual([]);
  });

  it("RED on the exact 2026-09-15 defect: both 'Active now' labels as they were", () => {
    // Verbatim from main before this fix (ProfileHeaderCard.tsx, ConversationRow.tsx).
    const profile = `<span
                    className="inline-flex items-center gap-1.5 min-w-0"
                    style={{
                      color: lastActiveLabel.isLive
                        ? "hsl(var(--live))"
                        : "hsl(var(--olivewood) / 0.8)",
                    }}
                  >`;
    const messagesRow = `style={{
                      color: lastActiveLabel.isLive
                        ? "hsl(var(--live))"
                        : "hsl(var(--olivewood) / 0.8)",
                      letterSpacing: "0.02em",
                    }}`;
    expect(liveAsTextColour(profile)).toHaveLength(1);
    expect(liveAsTextColour(messagesRow)).toHaveLength(1);
    // Dots and glows are not text.
    expect(liveAsTextColour('background: "hsl(var(--live))", boxShadow: "0 0 4px hsl(var(--live) / 0.55)"')).toEqual([]);
    expect(liveAsTextColour("backgroundColor: 'hsl(var(--live))'")).toEqual([]);
    expect(liveAsTextColour('className="text-[hsl(var(--live))]"')).toHaveLength(1);
  });

  it("--live-ink clears AA (4.5:1) on white; --live does not, which is why it exists", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/index.css"), "utf8");
    const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([\\d.]+ [\\d.]+% [\\d.]+%)`))![1];
    expect(contrastOnWhite(token("live-ink"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastOnWhite(token("live"))).toBeLessThan(4.5);
  });
});
