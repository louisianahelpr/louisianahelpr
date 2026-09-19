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
 * ── WHERE THE RULE LIVES NOW ──────────────────────────────────────────────
 * It moved out of JobTracking's render on 2026-09-19, into
 * `src/components/activity/jobRailTone.ts`, because the owner's collapsed-rail
 * ruling added a SECOND rail painting the same dots at 16px and a second copy
 * of a colour rule is the drift this file exists to catch. Both rails call
 * `railStepPaint`; this file reads the one definition.
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
 * @mutate src/components/activity/jobRailTone.ts |     fill: "hsl(var(--bark))",\n    ring: "hsl(var(--bark) / 0.30)", |     fill: "hsl(var(--success-ink))",\n    ring: "hsl(var(--bark) / 0.30)",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { railStepTone } from "@/components/activity/jobRailTone";

const ROOT = resolve(__dirname, "../..");
const CSS = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
const RULE = readFileSync(resolve(ROOT, "src/components/activity/jobRailTone.ts"), "utf8");
/** Comments stripped — the module NAMES `--success-ink` in prose, recording
 *  what the green used to be, and a guard that read prose as code would fail
 *  on its own history note. Declarations only. */
const RULE_CODE = RULE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

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

/**
 * The token the `green` tone paints with — the ONE fill every completed step
 * and the whole finished rail wear.
 *
 * `railStepTone` is imported below and swept over the rail's entire state
 * space, so "which steps are green" is asserted against the real function
 * rather than parsed; only the COLOUR that tone resolves to has to be read out
 * of source, because jsdom applies no stylesheet.
 */
function greenToken(): string {
  const block = /\n  green: \{[\s\S]*?fill: "hsl\(var\(--([\w-]+)\)\)"/.exec(RULE);
  expect(
    block,
    "the `green` tone's fill is gone from jobRailTone.ts — re-read the rule before " +
      "trusting this file, it no longer describes the rail",
  ).not.toBeNull();
  return block![1];
}

/** Every distinct tone a COMPLETED step can wear, from the real rule. */
function completedPipTokens(): string[] {
  // Swept, not assumed: every (status x cursor) the rail can be in, collecting
  // the tones that mean "this step completed". If a future edit splits green
  // into two tones, this picks both up and the assertions below check both.
  const tones = new Set<string>();
  const steps = 8;
  for (const jobStatus of ["open", "accepted", "in_progress", "completed", "disputed"]) {
    for (let displayIdx = 0; displayIdx < steps; displayIdx++) {
      for (let idx = 0; idx < steps; idx++) {
        const t = railStepTone({ idx, displayIdx, stepCount: steps, jobStatus });
        if (t === "green") tones.add(greenToken());
      }
    }
  }
  expect(tones.size, "no step in the rail's whole state space is ever green").toBeGreaterThan(0);
  return [...tones];
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
    expect(pips.length, "no completed-pip tones found — the inventory is empty").toBeGreaterThan(0);
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

  it("the emerald --success-ink is no longer anywhere in the rail's tone table", () => {
    // The specific regression: `--success-ink` (142 50% 30%) beside a `--bark`
    // (70 20% 33%) button. Named, so a revert is loud. The whole table is one
    // module now, so this reads all five tones rather than one ternary chain.
    expect(
      RULE_CODE.includes("--success-ink"),
      "a rail tone paints --success-ink again. That is the emerald the owner reported as " +
        "'a different shade' from the primary button's olive.",
    ).toBe(false);
  });

  it("the alarm and amber pips are NOT flattened into the green", () => {
    // In scope: the green. Out of scope, and load-bearing: red means "this is
    // the step that went wrong", amber means "you are on this step".
    expect(RULE, "the disputed pip must stay --destructive").toMatch(/hsl\(var\(--destructive\)\)/);
    expect(RULE, "the current-step pip must stay --amber-solid").toMatch(/hsl\(var\(--amber-solid\)\)/);
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
