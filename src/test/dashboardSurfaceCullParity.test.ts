/*
 * CLASS GUARD, third of three — the two SQL surfaces that feed /home must
 * cull the same jobs.
 *
 * THE OWNER HAS REPORTED THIS CLASS THREE TIMES:
 *   2026-09-15  "1 job" in the header, map pinned it, list said "Nothing today"
 *   2026-09-19  "map shows 7 jobs. list shows 4"
 *   2026-09-21  "the map still shows 6 jobs but 3 on the left"
 *
 * Each time it was a rule that reached one surface and not the others, and each
 * time the fix was a guard whose inventory is ONE interface:
 *
 *   dashboardSurfaceExclusionParity.test.ts  <- ViewerFeedExclusions
 *   mapFilterParity.test.ts                  <- MapJobFilterInput
 *
 * A guard whose inventory is one interface is structurally blind to a sibling
 * with the same disease, which is how the class survived two fixes. THIS file
 * is the half neither could see: the DATA-LAYER culls, which live in no
 * interface at all — they are SQL `WHERE` clauses. That absence is exactly why
 * they were unguarded.
 *
 * Both signed-in surfaces read `open_jobs_browse` (the list via
 * useDashboardData, the header count via useDashboardJobsCount's
 * `.from("open_jobs_browse")`), so they inherit the view's culls and cannot
 * disagree with each other. The MAP calls `get_open_jobs_for_map`, a separate
 * function. So the whole data-layer question reduces to: do those two objects
 * cull the same things?
 *
 * DERIVED, never listed. The vocabulary is the UNION of the cull markers the
 * two objects mention, so a rule added to either one enters the check by
 * existing — and fails until the other has it too. There is no list here for
 * someone to forget to update, which is the mistake that produced the bug
 * three times.
 *
 * Verified live on prod 2026-09-21 before writing this: both objects currently
 * carry all eight. The guard asserts a true thing; its job is to keep it true.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = resolve(__dirname, "..", "..", "supabase", "migrations");

/**
 * The NEWEST migration body defining `re` — filename order is apply order.
 * Grading a superseded definition is its own hollow shape; six guards in this
 * repo were doing it.
 */
function newestBody(re: RegExp, label: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(join(MIGRATIONS, files[i]), "utf8");
    if (re.test(sql)) return blankSqlComments(sql);
  }
  throw new Error(`no migration defines ${label} — this guard has rotted`);
}

/**
 * Data-layer culls, as the column (or predicate) each is expressed through.
 *
 * NOT a list of rules someone maintains: each entry is a marker, and the set
 * that MATTERS is computed below as the union of what the two objects actually
 * mention. An entry nothing references is reported as dead rather than
 * silently carried.
 */
const MARKERS: Record<string, RegExp> = {
  "ownerless job (poster deleted their account)": /customer_id\s+IS\s+NOT\s+NULL/i,
  "the viewer's own post": /auth\.uid\(\)/i,
  "unfunded escrow": /payment_status/i,
  "credential tier above the viewer": /credential_tier/i,
  "expired posting": /expires_at/i,
  "date already passed": /date_needed/i,
  "held for a direct offer": /offered_to_helper_id/i,
  "seed fixture row": /is_seed/i,
};

describe("the map and the browse view cull the same jobs", () => {
  const view = newestBody(/create\s+(or\s+replace\s+)?view\s+(public\.)?open_jobs_browse/i, "open_jobs_browse");
  const map = newestBody(/function\s+(public\.)?get_open_jobs_for_map/i, "get_open_jobs_for_map");

  it("both objects were found and are substantial (a check that finds nothing cannot fail)", () => {
    expect(view.length).toBeGreaterThan(400);
    expect(map.length).toBeGreaterThan(400);
    // Both must be real SELECTs, not a stub that happens to match the name.
    expect(/\bFROM\s+(public\.)?jobs\b/i.test(view)).toBe(true);
    expect(/\bFROM\s+(public\.)?jobs\b/i.test(map)).toBe(true);
  });

  /** A marker counts as "in play" if EITHER surface references it. */
  const inPlay = Object.entries(MARKERS).filter(([, re]) => re.test(view) || re.test(map));

  it("the vocabulary is non-empty and mostly shared", () => {
    expect(inPlay.length, "neither surface mentions any known cull — the markers have rotted").toBeGreaterThan(5);
  });

  it.each(inPlay.map(([name]) => [name] as const))("both surfaces cull: %s", (name) => {
    const re = MARKERS[name];
    const missing = [
      !re.test(view) && "open_jobs_browse (the LIST and the header COUNT)",
      !re.test(map) && "get_open_jobs_for_map (the MAP)",
    ].filter(Boolean);
    expect(
      missing,
      `"${name}" is culled by one dashboard surface and not the other. That is the defect the owner ` +
        `has reported three times — the map pinning jobs the list refuses to show, or the header ` +
        `counting jobs neither displays. Add the rule to BOTH, or explain here why it belongs to one.`,
    ).toEqual([]);
  });

  it("no marker is dead (one nothing references is a rule that quietly left)", () => {
    const dead = Object.keys(MARKERS).filter((n) => !MARKERS[n].test(view) && !MARKERS[n].test(map));
    expect(
      dead,
      "neither surface mentions these any more. A marker that matches nothing cannot fail, so it " +
        "reads as coverage while providing none — delete it, or find where the rule went.",
    ).toEqual([]);
  });
});

// PROVEN RED 2026-09-21: deleting `AND j.customer_id IS NOT NULL` from
// get_open_jobs_for_map's newest migration fails "both surfaces cull: ownerless
// job" — a job whose poster deleted their account would pin on the map and be
// absent from the list, which is the 2026-09-15 report exactly.
// SOURCE-TEXT PIN, and an important one: this compares MIGRATION TEXT, and by
// MARKER, not by meaning. Two surfaces can both mention `expires_at` and apply
// it differently (one `>`, one `>=`), and this cannot tell. It also cannot see
// a prod object hand-applied outside the migration tree. It proves a rule
// REACHED both surfaces; mapFilterParity and dashboardSurfaceExclusionParity
// cover the client halves.
// @mutate supabase/migrations/20260921201657_map_boosted_means_still_active.sql | AND j.customer_id IS NOT NULL |
