import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The silent-failure watcher reads its keys OUT OF THE FUNCTION'S RESPONSE
 * BODY, by name, and nothing makes the two agree.
 *
 * `sweep_silent_cron_failures()` (20260829020000) joins `cron_run_log` to
 * `cron_work_expectations` on `body ? candidate_key`, then sums the
 * `disposition_keys` with `(body ->> k)::numeric`. Three ways that breaks, none
 * of which raises anything a human sees:
 *
 *   • a candidate key the function never emits — the JOIN's `body ? key` filter
 *     matches nothing, so the cron is never evaluated. The rule is silently OFF
 *     and the table still lists the job, which reads as covered.
 *   • a disposition key that was renamed — its `(body ->> k)` is NULL, sums as
 *     0, and a healthy run starts looking like "candidates found, none
 *     dispositioned". That pages falsely until someone mutes it.
 *   • a key emitted as a boolean or string — `'true'::numeric` RAISES, inside
 *     the detector's own query, which takes down silent-failure detection for
 *     EVERY cron in the table rather than just the one at fault. This nearly
 *     shipped on 2026-09-03: a first draft returned `skipped: true`.
 *
 * So this test diffs two independently-authored files — the migration that
 * registers the expectation and the function that answers it. Neither is
 * derived from the other, which is what makes it a real check rather than a
 * registry compared against itself.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const FUNCTIONS = join(process.cwd(), "supabase", "functions");

interface Expectation {
  jobname: string;
  candidateKey: string;
  dispositionKeys: string[];
  migration: string;
}

/**
 * Every `cron_work_expectations` row any migration inserts, latest wins.
 *
 * Migrations are applied in filename order and every insert in this repo is an
 * upsert (`ON CONFLICT (jobname) DO UPDATE`), so reading them in sorted order
 * and overwriting reproduces the state the database actually ends up in.
 */
function registeredExpectations(): Expectation[] {
  const byJob = new Map<string, Expectation>();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    // ('jobname', 'candidate', ARRAY['a','b'], …) — tolerant of whitespace and
    // of the trailing columns (min_streak / expected_max_gap / note) varying.
    const rows = sql.matchAll(
      /\(\s*'([a-z0-9-]+)'\s*,\s*'([a-zA-Z0-9_]+)'\s*,\s*ARRAY\[([^\]]*)\]/g,
    );
    for (const m of rows) {
      const dispositions = [...m[3].matchAll(/'([a-zA-Z0-9_]+)'/g)].map((d) => d[1]);
      if (dispositions.length === 0) continue;
      byJob.set(m[1], {
        jobname: m[1],
        candidateKey: m[2],
        dispositionKeys: dispositions,
        migration: file,
      });
    }
  }
  return [...byJob.values()].sort((a, b) => a.jobname.localeCompare(b.jobname));
}

/** Every `.ts` under a function's directory, so multi-file functions are covered. */
function functionSource(jobname: string): string | null {
  const dir = join(FUNCTIONS, jobname);
  if (!existsSync(dir)) return null;
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : [],
    );
  return walk(dir).map((f) => readFileSync(f, "utf8")).join("\n");
}

/**
 * Whether the source assigns `key` as an object property.
 *
 * Deliberately loose — it accepts `key: 0`, `key: someVar`, `key,` shorthand and
 * `["key"]:`. A tighter matcher would fail on a legitimate refactor and teach
 * people to delete the test. What it CANNOT see is a key emitted only on some
 * branches; that is what the behavioural tests are for.
 */
function emitsKey(src: string, key: string): boolean {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w.])${k}\\s*:|\\[\\s*["']${k}["']\\s*\\]\\s*:|(^|[{,\\s])${k}\\s*,`, "m").test(src);
}

/** A key assigned a bare `true`/`false` — `(body ->> k)::numeric` raises on it. */
function emitsKeyAsBoolean(src: string, key: string): boolean {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w.])${k}\\s*:\\s*(true|false)\\s*[,}\\n]`, "m").test(src);
}

const expectations = registeredExpectations();

describe("cron watcher key contract", () => {
  it("finds the registrations at all (guards the regex silently matching nothing)", () => {
    // Without this, every per-job assertion below would vacuously pass if a
    // migration were reformatted and the parse stopped matching.
    expect(expectations.length).toBeGreaterThanOrEqual(6);
    expect(expectations.map((e) => e.jobname)).toContain("marketing-publish");
  });

  for (const exp of expectations) {
    describe(exp.jobname, () => {
      const src = functionSource(exp.jobname);

      it("has an edge function of that name", () => {
        expect(src, `${exp.jobname} is registered by ${exp.migration} but has no function directory`).not.toBeNull();
      });

      it(`emits its candidate key "${exp.candidateKey}"`, () => {
        if (src === null) return;
        expect(
          emitsKey(src, exp.candidateKey),
          `${exp.jobname} never emits "${exp.candidateKey}". The watcher joins on \`body ? candidate_key\`, so this job is silently NOT being checked — while still appearing in cron_work_expectations as though it were.`,
        ).toBe(true);
      });

      it("emits every disposition key it registered", () => {
        if (src === null) return;
        const missing = exp.dispositionKeys.filter((k) => !emitsKey(src, k));
        expect(
          missing,
          `${exp.jobname} registered disposition keys it never emits: ${missing.join(", ")}. Each one reads as 0, so a healthy run looks like "candidates found, none dispositioned" and pages falsely.`,
        ).toEqual([]);
      });

      it("emits no contract key as a boolean", () => {
        if (src === null) return;
        const keys = [exp.candidateKey, ...exp.dispositionKeys];
        const booleans = keys.filter((k) => emitsKeyAsBoolean(src, k));
        expect(
          booleans,
          `${exp.jobname} emits ${booleans.join(", ")} as a boolean. sweep_silent_cron_failures casts every disposition with (body ->> k)::numeric — 'true'::numeric RAISES inside the detector's own query, which breaks silent-failure detection for EVERY cron in the table, not just this one.`,
        ).toEqual([]);
      });
    });
  }
});
