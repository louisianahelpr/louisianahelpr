/*
 * CLASS CHECK — a guard that pins ONE migration by name grades a body the
 * database may have replaced.
 *
 * FOUND 2026-09-21. `src/lib/reliabilityLadder.parity.test.ts` resolved its SQL
 * through a helper pinned to `20260829030000` BY NAME. Its
 * `message_violation_ladder` half already used a newest-first scanner for
 * exactly this reason; the other two thirds did not — a guard half-fixed, and
 * therefore trusted more than it deserved.
 *
 * Measuring the class turned up something worse than a latent risk: **14
 * guards were ALREADY grading superseded SQL.** Among them —
 *
 *   - `src/lib/smartSort.test.ts` pins a `get_ranked_open_jobs` that
 *     20260915051752 replaced — it grades the ranking of the browse feed.
 *   - `disputeEvidenceChannel` pins FOURTEEN dispute functions, every one of
 *     them reapplied by 20260915071502.
 *   - `consequenceCopyParity` pins FOUR separate migrations, all superseded,
 *     including the arrival gates (`mark_helper_arrival`,
 *     `enforce_job_tracking_arrival_gate`) now living in 20260919155016.
 *
 * A first pass counted 14 by grepping raw text. Blanking COMMENTS first — this
 * repo cites the origin migration of a rule in prose constantly — brought it to
 * seven, of which `reliabilityLadder` was fixed on the spot. Citing a migration
 * is not reading one, and a check that cannot tell the difference would have
 * been dismissed as noise within a day.
 *
 * A pin being superseded does not by itself mean a guard is wrong — it may
 * assert only on parts that did not change, or deliberately grade a historical
 * version. It means the guard cannot know either way, which is the same
 * position as not checking.
 *
 * THE FIX, where it applies: resolve the function from the NEWEST migration
 * that defines it, the way `reliabilityLadder`'s `newestBlock` now does for
 * all three of its wrappers.
 *
 * RATCHET: the list below is the state on 2026-09-21 and may only SHRINK.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");

/** `CREATE [OR REPLACE] FUNCTION [public.]name(` in any case. */
const FUNC_DEF = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;

/** function name -> newest migration filename that defines it. */
function newestDefiner(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(FUNC_DEF)) out.set(m[1], f);
  }
  return out;
}

interface Stale { guard: string; pin: string; superseded: string[]; now: string }

/**
 * Migration filenames a guard names IN CODE.
 *
 * Comments are blanked first — this repo documents which migration a rule came
 * from in prose constantly, and a guard that merely CITES a migration is not
 * reading it. Strings are preserved, because the pin lives inside one.
 */
function pinnedMigrations(src: string): string[] {
  const code = blankComments(src);
  return [...new Set([...code.matchAll(/migrations\/(\d{14}_[\w.]+?\.sql)/g)].map((m) => m[1]))];
}

function staleGuards(): Stale[] {
  const newest = newestDefiner();
  const files = execFileSync("git", ["ls-files", "--", "src/*.ts", "src/*.tsx"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 1 << 24,
  })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => /\.(test|spec)\.tsx?$/.test(f));

  const out: Stale[] = [];
  for (const f of files) {
    if (f === "src/test/guardsReadTheNewestMigration.test.ts") continue;
    for (const pin of pinnedMigrations(readFileSync(resolve(REPO, f), "utf8"))) {
      const full = join(MIGRATIONS, pin);
      if (!existsSync(full)) {
        out.push({ guard: f, pin, superseded: ["<the pinned migration no longer exists>"], now: "-" });
        continue;
      }
      const defined = [...new Set([...readFileSync(full, "utf8").matchAll(FUNC_DEF)].map((m) => m[1]))];
      const superseded = defined.filter((fn) => (newest.get(fn) ?? pin) > pin);
      if (superseded.length) {
        out.push({ guard: f, pin, superseded, now: newest.get(superseded[0])! });
      }
    }
  }
  return out;
}

/** Known, reported, NOT fixed here. MAY ONLY SHRINK. */
const GRANDFATHERED: readonly string[] = [
  "src/components/disputeEvidenceChannel.test.ts",
  "src/lib/cancellationFee.parity.test.ts",
  "src/pages/dashboard/applyErrorCopy.test.ts",
  "src/lib/smartSort.test.ts",
  "src/test/consequenceCopyParity.test.ts",
  "src/test/groupJobRosterLifecycle.test.ts",
];

describe("a guard reads the NEWEST definition of the SQL it grades", () => {
  const stale = staleGuards();

  it("the detector works on both sides (a check that finds nothing cannot fail)", () => {
    // It must see a real superseded pin...
    expect(newestDefiner().size, "no migration defines any function — the scan is broken").toBeGreaterThan(50);
    // ...and it must NOT fire on a migration merely cited in a comment.
    expect(
      pinnedMigrations('// see migrations/20260829030000_consolidate_consequence_ladders.sql\nconst x = 1;'),
    ).toEqual([]);
    expect(
      pinnedMigrations('const p = "supabase/migrations/20260829030000_consolidate_consequence_ladders.sql";'),
    ).toHaveLength(1);
  });

  it("no NEW guard pins a migration whose functions were redefined later", () => {
    const known = new Set(GRANDFATHERED);
    const added = stale.filter((s) => !known.has(s.guard));
    expect(
      added.map((s) => `${s.guard} pins ${s.pin}; ${s.superseded.join(", ")} now live in ${s.now}`),
      "this guard grades SQL the database has since replaced, and cannot know whether the rule it " +
        "asserts still holds. Resolve the function from the NEWEST migration that defines it — see " +
        "`newestBlock` in src/lib/reliabilityLadder.parity.test.ts.",
    ).toEqual([]);
  });

  it("the grandfathered list only shrinks", () => {
    const live = new Set(stale.map((s) => s.guard));
    expect(
      GRANDFATHERED.filter((f) => !live.has(f)),
      "these no longer pin a superseded migration — remove them so the ratchet records the progress",
    ).toEqual([]);
  });
});

// PROVEN RED 2026-09-21: removing any entry from GRANDFATHERED while that guard
// still pins a superseded migration fails "the grandfathered list only
// shrinks"; pinning a superseded migration from a guard not on the list fails
// "no NEW guard pins...". The detector's own case fails if comment-blanking
// stops distinguishing a cited migration from a read one.
// SOURCE-TEXT PIN: this compares migration FILES against each other. A prod
// function hand-applied outside the migration tree is newer than anything here
// and invisible to it — that needs `pg_get_functiondef`.
// @mutate src/lib/reliabilityLadder.parity.test.ts | for (let i = files.length - 1; i >= 0; i--) { | for (let i = 0; i < files.length; i++) {
