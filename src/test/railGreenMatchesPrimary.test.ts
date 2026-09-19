/**
 * THE COMPLETED STEP PIPS ARE THE PRIMARY BUTTON'S GREEN — the same green, by
 * resolved value, not by looking similar.
 *
 * Owner, 2026-09-19, on a `/my-posts` disputed card: "also the posted offered
 * accepted etc buttons should all be the same primary green as the buttons not
 * a different shade."
 *
 * ── WHAT IT ACTUALLY WAS ──────────────────────────────────────────────────
 * The completed pips painted `--success-ink` = `142 50% 30%`, an EMERALD.
 * The primary button ("Resolve & Pay") is `.btn-grad-primary`, a radial
 * gradient built from `--bark-light` → `--bark` (`70 20% 33%`) → `--bark-deep`,
 * an OLIVE. Those hues are 72° apart. "A different shade" was generous: they
 * are different colours, eight pixels from each other on the same card.
 *
 * ── WHY THE FIX IS A TOKEN AND NOT THE CLASS ──────────────────────────────
 * The obvious move — put `.btn-grad-primary` on the pip — makes it worse. The
 * gradient is `radial-gradient(125% 125% at 32% 22%, …)`; on a 28px dot the
 * visible area is almost all the LIGHT stop, so the dot would read lighter than
 * the wide button beside it and the owner's complaint would survive the fix.
 * The pip takes `--bark`, the gradient's own dominant mid stop, which is what
 * makes the two the same green to the eye.
 *
 * ── WHY THIS FILE PARSES SOURCE INSTEAD OF READING getComputedStyle ───────
 * jsdom applies no stylesheet, so a rendered pip has no resolved colour to
 * read; `alarmColourInvariant.test.ts` next door parses for exactly this
 * reason. What is asserted is nonetheless a VALUE and not a class name: the
 * token the pip names is resolved to its `H S% L%` triple in `:root`, the
 * gradient's stops are resolved the same way, and the two are compared as
 * strings. A guard that accepted "it has the right class" is the failure mode
 * that let today's button tiers drift.
 *
 * ── SCOPE ─────────────────────────────────────────────────────────────────
 * COMPLETED pips only. The alarm-red disputed pip and the amber current-step
 * pip carry meaning and are pinned by `alarmColourInvariant.test.ts`; this file
 * asserts they are NOT green, so a future "make the rail one colour" cannot
 * quietly flatten them here.
 *
 * @mutate src/components/JobTracking.tsx | ? { background: "hsl(var(--bark))", color: "hsl(var(--parchment))" } | ? { background: "hsl(var(--success-ink))", color: "hsl(var(--parchment))" }
 * @mutate src/components/JobTracking.tsx | ? { fill: "hsl(var(--bark))", ring: "hsl(var(--bark) / 0.30)", ringEnd: "hsl(var(--bark) / 0)" } | ? { fill: "hsl(var(--success-ink))", ring: "hsl(var(--success-ink) / 0.30)", ringEnd: "hsl(var(--success-ink) / 0)" }
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const CSS = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
const TRACKER = readFileSync(resolve(ROOT, "src/components/JobTracking.tsx"), "utf8");

/**
 * The `H S% L%` triple a token resolves to in the LIGHT theme.
 *
 * `:root` is the first declaration of each token in this file; the dark-theme
 * block re-declares them further down. Taking the FIRST match is therefore the
 * light value, which is the one the owner is looking at. Both themes are
 * compared below by taking first-vs-first and last-vs-last.
 */
function resolveToken(name: string, which: "first" | "last"): string {
  const re = new RegExp(`--${name}:\\s*([^;/]+?)\\s*(?:;|/\\*)`, "g");
  const hits = [...CSS.matchAll(re)].map((m) => m[1].trim());
  expect(hits.length, `--${name} is not declared in src/index.css`).toBeGreaterThan(0);
  return which === "first" ? hits[0] : hits[hits.length - 1];
}

/** Every `hsl(var(--x))` fill the rail paints a COMPLETED step with. */
function completedPipTokens(): string[] {
  const found: string[] = [];
  // The passed-step branch.
  const passed = /isPassed \|\| \(isActive && allDone\)\s*\n\s*(?:\/\*[\s\S]*?\*\/\s*\n\s*)*\?\s*\{ background: "hsl\(var\(--([\w-]+)\)\)"/.exec(TRACKER);
  expect(
    passed,
    "the `isPassed || (isActive && allDone)` pip branch is gone from JobTracking.tsx — " +
      "re-read the step map before trusting this file, it no longer describes the rail",
  ).not.toBeNull();
  found.push(passed![1]);
  // The final Done pip on a finished rail (`currentTone`, allDone branch).
  const done = /const currentTone = allDone\s*\n\s*\?\s*\{ fill: "hsl\(var\(--([\w-]+)\)\)"/.exec(TRACKER);
  expect(
    done,
    "`currentTone`'s allDone branch changed shape — the Done pip on a finished rail is " +
      "the one green that must match the others, and this file can no longer find it",
  ).not.toBeNull();
  found.push(done![1]);
  return found;
}

/** The token stops of `.btn-grad-primary`'s radial gradient, in order. */
function primaryGradientStops(): string[] {
  const block = /\.btn-grad-primary\s*\{[\s\S]*?background-image:\s*radial-gradient\(([\s\S]*?)\);/.exec(CSS);
  expect(block, ".btn-grad-primary no longer declares a radial-gradient background-image").not.toBeNull();
  const stops = [...block![1].matchAll(/hsl\(var\(--([\w-]+)\)\)/g)].map((m) => m[1]);
  expect(stops.length, "the primary gradient has no token stops to match against").toBeGreaterThanOrEqual(2);
  return stops;
}

describe("the rail's completed green IS the primary button's green", () => {
  it("every completed pip paints from a token the primary gradient is built from", () => {
    const stops = primaryGradientStops();
    const pips = completedPipTokens();
    expect(pips.length, "no completed-pip branches found — the inventory is empty").toBe(2);
    for (const token of pips) {
      expect(
        stops,
        `a completed step pip paints --${token}, which is not one of the primary button's ` +
          `gradient stops (${stops.map((s) => `--${s}`).join(", ")}). Owner, 2026-09-19: ` +
          `"the posted offered accepted etc buttons should all be the same primary green as ` +
          `the buttons not a different shade".`,
      ).toContain(token);
    }
  });

  it("and it resolves to the SAME H S% L% as the gradient's dominant stop, in both themes", () => {
    // The dominant stop is the middle one (46% of a 125% radial), which is what
    // the button reads as across most of its width.
    const stops = primaryGradientStops();
    const dominant = stops[Math.floor(stops.length / 2)];
    for (const token of completedPipTokens()) {
      for (const theme of ["first", "last"] as const) {
        expect(
          resolveToken(token, theme),
          `${theme === "first" ? "light" : "dark"} theme: the completed pip resolves to ` +
            `"${resolveToken(token, theme)}" and the primary's dominant stop to ` +
            `"${resolveToken(dominant, theme)}". These are the two greens the owner said ` +
            `must be the same; comparing class names would not have caught it.`,
        ).toBe(resolveToken(dominant, theme));
      }
    }
  });

  it("the emerald --success-ink is no longer anywhere in the rail's pip fills", () => {
    // The specific regression: `--success-ink` (142 50% 30%) beside a `--bark`
    // (70 20% 33%) button. Named, so a revert is loud.
    const railBlock = /const currentTone = allDone[\s\S]*?: \{ background: "hsl\(var\(--olivewood\) \/ 0\.08\)"/.exec(TRACKER);
    expect(railBlock, "the rail's pip style block moved — re-anchor this assertion").not.toBeNull();
    expect(
      railBlock![0].includes("--success-ink"),
      "a step pip paints --success-ink again. That is the emerald the owner reported as " +
        "'a different shade' from the primary button's olive.",
    ).toBe(false);
  });

  it("the alarm and amber pips are NOT flattened into the green", () => {
    // In scope: the green. Out of scope, and load-bearing: red means "this is
    // the step that went wrong", amber means "you are on this step".
    expect(TRACKER, "the disputed pip must stay --destructive").toMatch(/background: "hsl\(var\(--destructive\)\)"/);
    expect(TRACKER, "the current-step pip must stay --amber-solid").toMatch(/fill: "hsl\(var\(--amber-solid\)\)"/);
    const stops = primaryGradientStops();
    for (const token of ["destructive", "amber-solid"]) {
      expect(
        stops,
        `--${token} is now one of the primary's gradient stops, so the "completed pips match ` +
          `the primary" rule would also make the alarm/current pips green. Those two carry ` +
          `meaning (src/test/alarmColourInvariant.test.ts).`,
      ).not.toContain(token);
    }
  });
});
