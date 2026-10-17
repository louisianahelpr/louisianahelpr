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
 *
 * SECOND OCCURRENCE (e2e-journeys 39020810698, 2026-10-17): this guard read
 * only CompletedStep's labels, so the BOOKED card's "Message Helpr" — parked in
 * More at 390px, where the row is More + "I'm Still On" — was looked up on the
 * page alone in hire-and-message and timed out. 04-admin-safety's no-show
 * journey asserted "No-Show not offered" with `toHaveCount(0)` on the page:
 * vacuous whenever the chip sits in the overflow.
 *
 * THE CLASS: any chip ANY job card draws can be parked in the overflow
 * (allocateJobStepRow decides, by width). So:
 *   1. JobActionRow still marks the overflow trigger and its panel with the
 *      two data attributes the shared `findChip` (e2e/journeys/cardChips.ts)
 *      opens and searches.
 *   2. findChip uses both; 02-marketplace's press() resolves through it.
 *   3. No journey file looks a chip up by name with getByRole("button", ...)
 *      on anything but the open overflow panel. The chip names are read from
 *      every component that renders <JobActionChip> (label, and the composed
 *      label + ariaLabel name), not hand-kept, and a lookup matches the way
 *      Playwright does: a string is a case-insensitive substring, a regex is
 *      tested as written.
 */

// @mutate e2e/journeys/cardChips.ts | const more = scope.locator("[data-job-step-overflow]") | const more = scope.locator("[data-no-such-overflow]")
// @mutate src/components/job-card/JobActionRow.tsx | data-job-step-overflow-panel="" | data-overflow-panel=""
// @mutate e2e/journeys/02-marketplace.spec.ts | (await findChip(pp, await card(pp, "/posts", "Done"), /^Reviewed\b/, 20_000)) ? 1 : 0, | (await card(pp, "/posts", "Done")).getByRole("button", { name: /^Reviewed\b/ }).count(),
// @mutate e2e/journeys/02-marketplace.spec.ts | const message = await findChip(pp, booked, /^Message\b/, 30_000); | const message = pp.getByRole("button", { name: "Message Helpr" }).first();
// @mutate e2e/journeys/04-admin-safety.spec.ts | const chip = await findChip(pp, cardByTitle(pp, JOB_TITLE), /^No-Show/, 30_000); | const chip = pp.getByRole("button", { name: /^No-Show/ }).first();

import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

/** Same rule as JobActionRow's composeAccessibleName. */
function accessibleName(label: string, ariaLabel?: string): string {
  if (!ariaLabel) return label;
  return ariaLabel.trim().toLowerCase().startsWith(label.trim().toLowerCase()) ? ariaLabel : `${label} — ${ariaLabel}`;
}

/** Every <JobActionChip ... /> with a literal label: its accessible name(s). */
function chipNames(): { names: string[]; files: string[] } {
  const files = walk(join(root, "src"), /\.tsx$/)
    .filter((f) => !/\.test\.tsx$/.test(f))
    .filter((f) => /<JobActionChip\b/.test(blankComments(readFileSync(f, "utf8"))));
  const names = new Set<string>();
  for (const f of files) {
    const src = blankComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(/<JobActionChip\b([\s\S]*?)\/>/g)) {
      const label = /\blabel="([^"]+)"/.exec(m[1])?.[1];
      const aria = /\bariaLabel="([^"]+)"/.exec(m[1])?.[1];
      if (label) names.add(accessibleName(label, aria));
      // A ternary label (`label={a ? "X" : "Y"}`): every literal it can be.
      const expr = /\blabel=\{([^}]*)\}/.exec(m[1])?.[1];
      if (expr) for (const lit of expr.matchAll(/"([^"]+)"/g)) names.add(accessibleName(lit[1], aria));
    }
  }
  return { names: [...names].sort(), files: files.map((f) => relative(root, f)).sort() };
}

/** Does a Playwright `name` option written as source text match `chip`? */
function lookupMatches(nameSrc: string, chip: string): boolean {
  const str = /^"([^"]*)"$/.exec(nameSrc);
  if (str) return chip.toLowerCase().includes(str[1].toLowerCase());
  const re = /^\/(.+)\/([a-z]*)$/.exec(nameSrc);
  if (re) return new RegExp(re[1], re[2]).test(chip);
  return false; // a variable: findChip's own `name`, judged where it is called
}

/** Receivers that ARE the open overflow panel (findChip's own searches). */
const PANEL_RECEIVERS = new Set(["panel", "inPanel", "inOpenPanel"]);
/** Receivers scoped to a dialog or sheet: their buttons are not card chips
 *  (01-browse's filter `sheet` "Show N jobs" is not the No-Show chip). */
const OVERLAY_RECEIVER = /dialog|dlg|sheet|modal|confirm|alert/i;

describe("journeys reach a job-card chip parked in the More overflow", () => {
  const row = blankComments(read("src/components/job-card/JobActionRow.tsx"));
  const chips = blankComments(read("e2e/journeys/cardChips.ts"));
  const market = blankComments(read("e2e/journeys/02-marketplace.spec.ts"));

  it("JobActionRow marks the overflow trigger and its panel", () => {
    expect(row).toMatch(/data-job-step-overflow=""/);
    expect(row).toMatch(/data-job-step-overflow-panel=""/);
  });

  it("the shared findChip opens the overflow and searches its panel; press() uses it", () => {
    const body = chips.match(/export async function findChip\([\s\S]*?\n}\n/)?.[0] ?? "";
    expect(body, "findChip is gone from e2e/journeys/cardChips.ts").not.toBe("");
    expect(body).toContain('"[data-job-step-overflow]"');
    expect(body).toContain('"[data-job-step-overflow-panel]"');
    expect(market).toMatch(/import \{[^}]*\bfindChip\b[^}]*\} from "\.\/cardChips"/);
    const press = market.match(/async function press\([\s\S]*?\n {2}}\n/)?.[0] ?? "";
    expect(press).toMatch(/await findChip\(/);
  });

  it("no journey looks a job-card chip up on anything but the overflow panel", () => {
    const { names, files: chipFiles } = chipNames();
    // INVENTORY FLOORS: names and files come from source; an empty read is a broken scan.
    expect(chipFiles.length).toBeGreaterThan(8);
    expect(names.length).toBeGreaterThan(30);
    expect(names).toContain("Message Helpr");
    expect(names).toContain("No-Show — report that the Helpr never turned up");
    expect(names).toContain("Reviewed");

    const files = walk(join(root, "e2e/journeys"), /\.ts$/);
    expect(files.length).toBeGreaterThan(5);
    const lookup = /(\w+)\s*\.getByRole\(\s*"button"\s*,\s*\{\s*name:\s*("(?:[^"\\]|\\.)*"|\/(?:[^/\\\n]|\\.)+\/[a-z]*)/g;
    const offenders: string[] = [];
    for (const f of files) {
      const lines = blankComments(readFileSync(f, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(lookup)) {
          if (PANEL_RECEIVERS.has(m[1]) || OVERLAY_RECEIVER.test(m[1])) continue;
          const hit = names.find((n) => lookupMatches(m[2], n));
          if (hit) offenders.push(`${relative(root, f)}:${i + 1}: ${m[1]}.getByRole(... ${m[2]}) matches chip "${hit}"`);
        }
      });
    }
    expect(
      offenders,
      "a job-card chip looked up outside findChip: it may be in the More overflow (a portaled popover), and a count of 0 there proves nothing — use findChip/press from e2e/journeys/cardChips.ts",
    ).toEqual([]);
    // And the reviewed-badge wait actually uses the overflow-aware lookup.
    expect(market).toMatch(/findChip\(pp, await card\(pp, "\/posts", "Done"\), \/\^Reviewed\\b\//);
  });

  it("the matcher reads a lookup the way Playwright does", () => {
    expect(lookupMatches('"Message Helpr"', "Message Helpr")).toBe(true);
    expect(lookupMatches('"message helpr"', "Message Helpr")).toBe(true);
    expect(lookupMatches("/^No-Show/", "No-Show — report that the Helpr never turned up")).toBe(true);
    expect(lookupMatches("/Review & Pay/", "Reviewed")).toBe(false);
    expect(lookupMatches("name", "Reviewed")).toBe(false);
  });
});
