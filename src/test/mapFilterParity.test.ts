/*
 * CLASS GUARD — every filter the LIST applies, the MAP applies too.
 *
 * THE OWNER HAS REPORTED THIS CLASS THREE TIMES:
 *   2026-09-15  "1 job" in the header, map pinned it, list said "Nothing
 *               today."          → applied jobs reached the feed and nothing else
 *   2026-09-19  "map shows 7 jobs. list shows 4."
 *                                → dismissed jobs reached BrowseTasksFeed only
 *   2026-09-21  "the map still shows 6 jobs but 3 on the left ... when i apply
 *               they fall off the left but not the map."
 *
 * The first two were viewer EXCLUSIONS, and
 * `src/test/dashboardSurfaceExclusionParity.test.ts` was written for exactly
 * that class — deriving its inventory from the `ViewerFeedExclusions`
 * interface so a rule added there appears on every surface or the test goes
 * red.
 *
 * It could not see the third, because the third was not an exclusion. It was
 * the FILTER BAR: Boosted, Ending soon and Matches my availability were in
 * `MapJobFilterInput`, were rendered as active chips, and were never read by
 * `buildMapJobFilter`. `mapFilter.ts` even had a function naming them —
 * `unsupportedMapFilters`, "filters the map has no field to evaluate" — so the
 * gap was documented, tested, and shipped.
 *
 * That is the lesson worth keeping: a guard whose inventory is ONE interface
 * cannot see a sibling interface with the same disease. So this file does for
 * `MapJobFilterInput` what that one does for `ViewerFeedExclusions` — every
 * field must be READ by the predicate, or carry a written exemption.
 *
 * Both halves are needed. Neither replaces the other.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankNonCode } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const MODULE = "src/components/browseMap/mapFilter.ts";

const src = readFileSync(resolve(REPO, MODULE), "utf8");
const code = blankNonCode(src);

/** Field names declared on `MapJobFilterInput`, derived from the interface. */
function filterFields(): string[] {
  const start = code.indexOf("export interface MapJobFilterInput");
  expect(start, "MapJobFilterInput was not found — this guard has rotted").toBeGreaterThan(-1);
  const open = code.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  /*
   * TOP-LEVEL members only. `helperAvailability` is typed with an inline
   * object, and a flat regex over the interface body also collected its
   * `day_of_week` / `is_available` / `start_time` / `end_time` — which are
   * fields of a SLOT, not filters, and demanding buildMapJobFilter read them
   * by those names is nonsense. Track depth and take only depth-1 members.
   */
  const members = code.slice(open + 1, end);
  const out: string[] = [];
  let nesting = 0;
  for (const line of members.split("\n")) {
    const m = /^\s*(\w+)\??\s*:/.exec(line);
    if (m && nesting === 0) out.push(m[1]);
    for (const ch of line) {
      if (ch === "{" || ch === "[") nesting++;
      else if (ch === "}" || ch === "]") nesting--;
    }
  }
  return out;
}

/** The body of `buildMapJobFilter`, where a field has to actually be read. */
function predicateBody(): string {
  const start = code.indexOf("export function buildMapJobFilter");
  expect(start, "buildMapJobFilter was not found — this guard has rotted").toBeGreaterThan(-1);
  const open = code.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  return code.slice(open, end);
}

/**
 * Fields that are INPUTS TO another field's rule rather than rules of their
 * own. Each must name the field it serves, so an exemption cannot outlive it.
 */
const SERVES: Record<string, string> = {
  userLoc: "nearbyMiles",
  helperAvailability: "matchAvailability",
  earlyAccessDelayMs: "earlyAccessDelayMs", // its own rule; listed for completeness
};

describe("every filter the list applies, the map applies too", () => {
  const fields = filterFields();
  const body = predicateBody();

  it("the inventory is real (a check that finds nothing cannot fail)", () => {
    // If the interface parse collapses, every case below passes vacuously.
    expect(fields.length).toBeGreaterThan(8);
    expect(fields).toContain("boostedOnly");
    expect(fields).toContain("expiresWithin");
    expect(fields).toContain("matchAvailability");
    expect(body.length).toBeGreaterThan(200);
  });

  it.each(fields.map((f) => [f] as const))("`%s` is read by buildMapJobFilter", (field) => {
    const read = new RegExp(`\\bf\\.${field}\\b`).test(body);
    const servedBy = SERVES[field];
    const servedRead = servedBy ? new RegExp(`\\bf\\.${servedBy}\\b`).test(body) : false;
    expect(
      read || servedRead,
      `${field} is declared on MapJobFilterInput but buildMapJobFilter never reads it. ` +
        `The viewer turns it on, the chip appears, the LIST narrows — and every pin stays. ` +
        `That is the defect the owner has now reported three times. Either apply it, or add it ` +
        `to SERVES naming the field it is an input to.`,
    ).toBe(true);
  });

  it("no exemption outlives the rule it serves", () => {
    const stale = Object.entries(SERVES).filter(([, serves]) => !fields.includes(serves));
    expect(
      stale.map(([k, v]) => `${k} claims to serve ${v}, which is no longer a field`),
      "an exemption for a rule that no longer exists reads to the next person as evidence the " +
        "question was considered here",
    ).toEqual([]);
  });

  it("`unsupportedMapFilters` decides from the ROWS, not a hard-coded list", () => {
    /*
     * Its previous form was a static list of three names. That list stayed
     * "true" long after two of the three became evaluatable, and a static list
     * is how the workaround outlived the reason for it. It must consult the
     * rows it was handed.
     */
    const start = code.indexOf("export function unsupportedMapFilters");
    expect(start, "unsupportedMapFilters was not found").toBeGreaterThan(-1);
    const fn = code.slice(start, code.indexOf("\n}", start));
    expect(
      /\bjobs\b/.test(fn),
      "unsupportedMapFilters must decide from the rows the RPC actually returned — an absent " +
        "column means the deployed function predates the migration, and a present one means the " +
        "filter can be applied.",
    ).toBe(true);
  });
});

// PROVEN RED 2026-09-21: deleting the `boostedOnly` predicate from
// buildMapJobFilter fails "`boostedOnly` is read by buildMapJobFilter" — which
// is the owner's report, reproduced as a check. Deleting `expiresWithin` or
// `matchAvailability` fails the same way.
// SOURCE-TEXT PIN: this asserts the field is READ, not that the rule is
// CORRECT. mapFilter.test.ts holds the behaviour; this file holds the
// completeness. Nor does it look at the list's own filter set — a rule the
// list gains that never reaches MapJobFilterInput is invisible here.
// @mutate src/components/browseMap/mapFilter.ts | if (f.boostedOnly && "boosted_at" in job && !job.boosted_at) return false; |
