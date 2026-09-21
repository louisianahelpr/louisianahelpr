/*
 * CLASS GUARD: a Playwright EXACT-match locator must name copy the app renders.
 *
 * A stale locator does not announce itself. It waits out its timeout and then
 * fails in language that reads like a flake or a product bug, and the real
 * cause — that nothing has rendered those words for weeks — is the one reading
 * nobody reaches for.
 *
 * THE DAY THIS COST, 2026-09-21. The full money loop against production is the
 * highest-stakes check in this repo. It waited 30 seconds for a panel titled
 * "Add an after photo" with an "Add Photo" button. That panel is
 * `PhotoProofStep`, which has ZERO call sites in `src/` — the card renders
 * `PhotoProofCaptureChip`, labelled "After Photo". The failure read "the card
 * never asked for the after photo", which sounds exactly like a broken
 * completion flow on a funded, hired job.
 *
 * It was worse than a wasted run. The spec had been SKIPPED since 2026-09-19
 * because a stuck fixture failed the pre-sweep first, so the stale locator sat
 * behind a red that had nothing to do with it. Two independent faults, one
 * hiding the other, on the money path.
 *
 * And it was the SECOND time this same locator went stale: its own comment
 * records waiting for "^Before Photos$" until that redesign shipped.
 *
 * WHY ONLY `exact: true`, which is what makes this precise rather than noisy.
 * Playwright's default name matching is case-insensitive and
 * whitespace-normalised, and `getByLabel`/`getByPlaceholder` default to
 * substring — so a literal that looks absent is very often matching fine. Only
 * an EXACT matcher makes a claim this check can hold the app to. Measured on
 * the day: scanning every literal locator flagged 15 candidates, 14 of them
 * fixture data or composed strings; restricting to exact matchers flagged 2,
 * both real. A guard whose exemption list is mostly noise is one nobody reads,
 * so this one is built to have no exemption list at all.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const ls = (dir: string) =>
  execFileSync("git", ["ls-files", dir], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

const SPECS = ls("e2e").filter((f) => f.endsWith(".spec.ts"));
const SRC_FILES = ls("src").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

/** Everything src/ contains, and the half of it that is actually CODE. */
const SRC_RAW = SRC_FILES.map(read).join("\n");
const SRC_CODE = SRC_FILES.map((f) => blankComments(read(f))).join("\n");

/**
 * Only matchers that assert an EXACT string. Anything else is case-insensitive
 * or a substring match, and would produce false positives, which is how a
 * guard earns an exemption list and then stops being read.
 */
const EXACT_MATCHERS = [
  /getByText\(\s*"([^"\\]{6,60})"\s*,\s*\{\s*exact:\s*true/g,
  /getByRole\(\s*"[a-z]+"\s*,\s*\{\s*name:\s*"([^"\\]{6,60})"\s*,\s*exact:\s*true/g,
];

interface Ghost {
  spec: string;
  literal: string;
  /** True when the words survive in a src/ comment — copy that was removed. */
  inCommentOnly: boolean;
}

function ghostLocators(): Ghost[] {
  const out: Ghost[] = [];
  for (const spec of SPECS) {
    const body = blankComments(read(spec));
    for (const re of EXACT_MATCHERS) {
      for (const m of body.matchAll(re)) {
        const literal = m[1];
        if (SRC_CODE.includes(literal)) continue;
        out.push({ spec, literal, inCommentOnly: SRC_RAW.includes(literal) });
      }
    }
  }
  return out;
}

describe("every exact-match e2e locator names copy the app actually renders", () => {
  it("the scan reads both sides (an empty side would pass everything vacuously)", () => {
    expect(SPECS.length, "no e2e specs were scanned").toBeGreaterThan(20);
    expect(SRC_FILES.length, "no src files were scanned").toBeGreaterThan(200);
    // And it must find SOME exact matchers, or the patterns have gone stale
    // themselves — the failure this file would be least able to notice.
    const found = SPECS.map((s) => blankComments(read(s)))
      .join("\n")
      .match(/exact:\s*true/g);
    expect(found?.length ?? 0, "no `exact: true` matchers found in any spec").toBeGreaterThan(5);
  });

  it("no spec waits on words nothing renders", () => {
    const ghosts = ghostLocators();
    const lines = ghosts.map(
      (g) =>
        `${g.spec} waits for "${g.literal}" — ` +
        (g.inCommentOnly
          ? "those words survive ONLY in a src/ comment, so the copy was removed and the comment kept"
          : "those words appear nowhere in src/ at all"),
    );
    expect(
      lines,
      "A stale exact-match locator waits out its timeout and then fails in language that reads like " +
        "a product bug. The money loop spent 30s waiting for a panel with zero call sites and " +
        'reported "the card never asked for the after photo".\n\n' +
        "Fix the locator to match what the component renders — do not add an exemption. If the app " +
        "genuinely should render those words and does not, that is the finding.\n\n" +
        lines.join("\n"),
    ).toEqual([]);
  });
});

// The exact stale pair this guard was built from, restored in the one spec that
// still carried it. Without the check, a locator waiting on a panel that has no
// call sites is indistinguishable from a broken completion flow.
// @mutate e2e/journeys/02-marketplace.spec.ts | const after = c.getByText("After Photo", { exact: true }); | const after = c.getByText("Add an after photo", { exact: true });
