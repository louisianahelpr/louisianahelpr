/*
 * CLASS GUARD: a journey finds a job-card chip on the row OR in its "More"
 * overflow, never on the row alone.
 *
 * PR #1797's vacuity gate (job 108310368705) and e2e-journeys probe
 * 36211846948 (2026-09-26) failed 02-marketplace.spec.ts on "the poster's card
 * never showed the Reviewed badge after the review was submitted". Measured on
 * prod the same hour (probe runs 36212737517 / 36213134702 on
 * wip/vac1797-probe-journeys): the review row existed, and the Done card's
 * row read Photos · More · Hire Again — "Tip" and "Reviewed" were in the More
 * panel, a Radix popover portaled to <body>, so the card-scoped
 * `getByRole("button", { name: /^Reviewed\b/ })` counted 0 on every reload.
 * The journey's own job carries proof photos, which is what pushes its row
 * past what fits.
 *
 * THE CLASS: any chip a completed card draws can be parked in the overflow
 * (JobActionRow's allocateJobStepRow decides, by width). So:
 *   1. JobActionRow still marks the overflow trigger and its panel with the
 *      two data attributes the journey's `findChip` opens and searches.
 *   2. 02-marketplace's `findChip` uses both.
 *   3. No journey spec looks up a completed-card chip (labels read from
 *      CompletedStep.tsx, not hand-kept) with a direct
 *      `getByRole("button", { name: /^<label>` — it goes through findChip
 *      (or press, which calls it).
 */

// @mutate e2e/journeys/02-marketplace.spec.ts | const more = scope.locator("[data-job-step-overflow]") | const more = scope.locator("[data-no-such-overflow]")
// @mutate src/components/job-card/JobActionRow.tsx | data-job-step-overflow-panel="" | data-overflow-panel=""
// @mutate e2e/journeys/02-marketplace.spec.ts | (await findChip(pp, await card(pp, "/posts", "Done"), /^Reviewed\b/, 20_000)) ? 1 : 0, | (await card(pp, "/posts", "Done")).getByRole("button", { name: /^Reviewed\b/ }).count(),

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("journeys reach a job-card chip parked in the More overflow", () => {
  const row = blankComments(read("src/components/job-card/JobActionRow.tsx"));
  const market = blankComments(read("e2e/journeys/02-marketplace.spec.ts"));

  it("JobActionRow marks the overflow trigger and its panel", () => {
    expect(row).toMatch(/data-job-step-overflow=""/);
    expect(row).toMatch(/data-job-step-overflow-panel=""/);
  });

  it("02-marketplace's findChip opens the overflow and searches its panel", () => {
    const body = market.match(/async function findChip\([\s\S]*?\n {2}}\n/)?.[0] ?? "";
    expect(body, "findChip is gone from 02-marketplace.spec.ts").not.toBe("");
    expect(body).toContain('"[data-job-step-overflow]"');
    expect(body).toContain('"[data-job-step-overflow-panel]"');
    // press() resolves its control through findChip.
    const press = market.match(/async function press\([\s\S]*?\n {2}}\n/)?.[0] ?? "";
    expect(press).toMatch(/await findChip\(/);
  });

  it("no journey looks up a completed-card chip on the row alone", () => {
    const labels = [
      ...read("src/pages/posts/postedJobCard/steps/CompletedStep.tsx").matchAll(/\blabel="([^"]+)"/g),
    ].map((m) => m[1]);
    // INVENTORY FLOOR: the labels come from source; an empty read is a broken scan.
    expect(labels.length).toBeGreaterThan(3);
    const direct = new RegExp(
      `getByRole\\(\\s*"button"\\s*,\\s*\\{\\s*name:\\s*/\\^(?:${labels.map(escape).join("|")})\\b`,
    );
    const files = walk(join(root, "e2e/journeys"));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((f) => {
      const src = blankComments(readFileSync(f, "utf8"));
      return src
        .split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => direct.test(line))
        .map(({ line, i }) => `${relative(root, f)}:${i + 1}: ${line.trim()}`);
    });
    expect(
      offenders,
      "a completed-card chip looked up on the card alone: it may be in the More overflow (a portaled popover) — use findChip/press",
    ).toEqual([]);
    // And the reviewed-badge wait actually uses the overflow-aware lookup.
    expect(market).toMatch(/findChip\(pp, await card\(pp, "\/posts", "Done"\), \/\^Reviewed\\b\//);
  });
});
