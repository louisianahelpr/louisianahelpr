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
 *   - `disputeEvidenceChannel` pinned FOURTEEN dispute functions, every one of
 *     them reapplied by 20260915071502. FIXED 2026-09-21: it now resolves both
 *     `rpc_supersede_dispute_decision` and `rpc_add_dispute_evidence` through a
 *     newest-first scanner and is off the list below.
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

/**
 * Migration filenames a test CREATES: named inside a `writeFileSync(` /
 * `writeFile(` / `appendFileSync(` call on the same line — a synthetic history
 * built in a temp dir (src/test/migrationLintRls.test.ts, Q118/Q129).
 *
 * A created name is excused ONLY when no migration of that name exists in the
 * real tree (`isFixture` below). A test that writes a name the repo really has
 * is still graded as a pin, so this can never hide a read of real SQL; and a
 * missing name that is only READ, never written, is still reported as a pin to
 * a migration that no longer exists.
 */
function writtenMigrations(src: string): Set<string> {
  const code = blankComments(src);
  return new Set(
    [...code.matchAll(/\b(?:writeFileSync|writeFile|appendFileSync)\([^;\n]*?migrations\/(\d{14}_[\w.]+?\.sql)/g)].map(
      (m) => m[1],
    ),
  );
}

/** Pins that are real reads: every pin except a created name absent from the real tree. */
function realPins(src: string, existsInRepo: (pin: string) => boolean): string[] {
  const written = writtenMigrations(src);
  return pinnedMigrations(src).filter((pin) => existsInRepo(pin) || !written.has(pin));
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
    for (const pin of realPins(readFileSync(resolve(REPO, f), "utf8"), (p) => existsSync(join(MIGRATIONS, p)))) {
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
// @two-way src/test/guardsReadTheNewestMigration.test.ts:GRANDFATHERED.filter((f) => !live.has(f))
const GRANDFATHERED: readonly string[] = [
  "src/lib/cancellationFee.parity.test.ts",
  "src/pages/home/applyErrorCopy.test.ts",
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

  it("a fixture a test CREATES is not a pin, and that exemption cannot hide a real one", () => {
    const REAL = "20260829030000_consolidate_consequence_ladders.sql";
    const FAKE = "20990101000000_new.sql";
    expect(existsSync(join(MIGRATIONS, REAL)), "the real sample must exist").toBe(true);
    expect(existsSync(join(MIGRATIONS, FAKE)), "the fixture sample must not exist").toBe(false);
    const inRepo = (p: string) => existsSync(join(MIGRATIONS, p));
    // Written into a temp dir and absent from the real tree: a fixture.
    expect(realPins(`writeFileSync(join(dir, "supabase/migrations/${FAKE}"), "select 2;\\n");`, inRepo)).toEqual([]);
    // The same absent name only READ: still a pin (to a migration that is gone).
    expect(realPins(`const p = "supabase/migrations/${FAKE}";`, inRepo)).toEqual([FAKE]);
    // A REAL migration name is a pin even when the test also writes it.
    expect(
      realPins(
        `writeFileSync(join(dir, "supabase/migrations/${REAL}"), "x");\nconst sql = readFileSync("supabase/migrations/${REAL}");`,
        inRepo,
      ),
    ).toEqual([REAL]);
    // A write of ONE name on a line does not excuse a read of a different missing one.
    expect(
      realPins(`writeFileSync(join(dir, "supabase/migrations/${FAKE}"), "x");\nread("supabase/migrations/20990101000001_gone.sql");`, inRepo),
    ).toEqual(["20990101000001_gone.sql"]);
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
// The mutation REINTRODUCES the pin this guard exists to forbid — the exact
// `LADDER_SQL` line deleted from reliabilityLadder today, naming a migration
// whose `apply_message_violation_consequence` 20260915020258 replaced.
//
// A first attempt registered "reverse newestBlock's scan direction" and
// SURVIVED, correctly: that changes which definition reliabilityLadder reads,
// which is reliabilityLadder's own property, not this file's. This guard
// measures whether a guard PINS superseded SQL, so the mutation has to add a
// pin. Registering the wrong mutation is how a guard ends up counted as proven
// while nothing about it was tested.
// @mutate src/lib/reliabilityLadder.parity.test.ts | const DENIAL = newestBlock("apply_job_denial_consequence").block; | const DENIAL = newestBlock("apply_job_denial_consequence").block;\nconst STALE_PIN = "supabase/migrations/20260829030000_consolidate_consequence_ladders.sql";
// Q129: the fixture exemption must not swallow a real pin. Making every created
// name exempt (dropping the exists-in-repo test) fails "cannot hide a real one".
// @mutate src/test/guardsReadTheNewestMigration.test.ts | .filter((pin) => existsInRepo(pin) \|\| !written.has(pin)); | .filter((pin) => !written.has(pin));
