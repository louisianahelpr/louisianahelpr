import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The destructive-DDL gate, tested by watching it fail.
 *
 * `.github/workflows/db-deploy.yml` runs `supabase db push` against
 * PRODUCTION on every push to main, and this project has no restorable
 * backup (Supabase free tier — an accepted constraint, not a defect). So
 * `scripts/check-destructive-ddl.mjs` is the last thing standing between a
 * DROP TABLE and permanent loss.
 *
 * A guard nobody has watched fail is not a guard. Every case below either
 * asserts the gate FIRES on a real destructive statement, or asserts that a
 * near-miss of the escape hatch does NOT open it. The second half matters
 * more than the first: an escape hatch that can be tripped by pasting
 * another migration's acknowledgement is not an escape hatch, it is a hole.
 */

const SCRIPT = resolve(__dirname, "../../scripts/check-destructive-ddl.mjs");
const REPO = resolve(__dirname, "../..");

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ddl-gate-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write `sql` to a scratch file and run the gate over it. */
function check(sql: string): { code: number; out: string } {
  const file = join(dir, `m_${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, sql);
  const r = spawnSync("node", [SCRIPT, file], { cwd: REPO, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

/** A well-formed acknowledgement for `descriptor`, ready to prepend. */
function ack(descriptor: string): string {
  return [
    `-- DESTRUCTIVE-DDL-ACK: ${descriptor}`,
    "-- ACK-REASON: the feature that owned this shipped its removal already,",
    "--   and nothing has read it since; this is the data-layer half.",
    "-- ACK-DATA-LOSS: every row goes, and no other table can reproduce them.",
  ].join("\n");
}

describe("check-destructive-ddl — fires on real destruction", () => {
  const destructive: [name: string, sql: string, descriptor: string][] = [
    ["DROP TABLE", "DROP TABLE IF EXISTS public.payout_transfers CASCADE;", "DROP TABLE public.payout_transfers"],
    ["DROP SCHEMA", "DROP SCHEMA public CASCADE;", "DROP SCHEMA public"],
    ["TRUNCATE", "TRUNCATE TABLE public.reviews;", "TRUNCATE public.reviews"],
    ["DELETE with no WHERE", "DELETE FROM public.applications;", "DELETE FROM public.applications (no WHERE)"],
    ["UPDATE with no WHERE", "UPDATE public.profiles SET stripe_account_id = NULL;", "UPDATE public.profiles (no WHERE)"],
    [
      "DROP COLUMN buried in a multi-action ALTER",
      "ALTER TABLE public.jobs\n  ADD COLUMN IF NOT EXISTS note text,\n  DROP COLUMN IF EXISTS budget;",
      "DROP COLUMN public.jobs.budget",
    ],
    [
      "DROP CONSTRAINT never re-added",
      "ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_budget_check;",
      "DROP CONSTRAINT public.jobs.jobs_budget_check",
    ],
    [
      "dynamic SQL inside a DO block, which executes immediately",
      "DO $$\nBEGIN\n  EXECUTE 'DROP TABLE IF EXISTS public.disputes';\nEND $$;",
      "DROP TABLE public.disputes",
    ],
  ];

  it.each(destructive)("blocks %s", (_name, sql, descriptor) => {
    const { code, out } = check(sql);
    expect(code, `expected the gate to FAIL on:\n${sql}\n\ngot:\n${out}`).toBe(1);
    expect(out).toContain(descriptor);
  });

  it.each(destructive)("lets %s through once acknowledged", (_name, sql, descriptor) => {
    // The acknowledgement goes directly above the STATEMENT, which for the
    // DO-block case means inside the block, above the EXECUTE — not above
    // the `DO`. That is the rule working as intended: the ack sits with the
    // thing it excuses, so it cannot drift away from it in a later edit.
    const acked = sql.startsWith("DO $$")
      ? sql.replace(/^(\s*)(EXECUTE )/m, (_m, indent, kw) => {
          const block = ack(descriptor)
            .split("\n")
            .map((l) => indent + l)
            .join("\n");
          return `${block}\n${indent}${kw}`;
        })
      : `${ack(descriptor)}\n${sql}`;
    const { code, out } = check(acked);
    expect(code, `expected the ack to be accepted:\n${acked}\n\ngot:\n${out}`).toBe(0);
    expect(out).toContain("acknowledged");
  });
});

describe("check-destructive-ddl — does NOT fire on look-alikes", () => {
  // Each of these reads like destruction and destroys nothing. They are the
  // reason the gate parses statements rather than grepping for "DROP": a
  // lint with a ~1-in-20 false-positive rate gets disabled, which is how
  // migration-lint spent three months not running.
  const benign: [string, string][] = [
    ["ALTER PUBLICATION … DROP TABLE", "ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;"],
    ["REVOKE TRUNCATE", "REVOKE TRUNCATE, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;"],
    [
      "ALTER DEFAULT PRIVILEGES … REVOKE TRUNCATE",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER ON TABLES FROM anon;",
    ],
    ["DELETE with a WHERE", "DELETE FROM public.job_views WHERE created_at < now() - interval '90 days';"],
    ["UPDATE with a WHERE", "UPDATE public.jobs SET status = 'open' WHERE status IS NULL;"],
    ["DROP POLICY", 'DROP POLICY IF EXISTS "some policy" ON public.jobs;'],
    ["DROP INDEX", "DROP INDEX IF EXISTS public.idx_jobs_status;"],
    ["DROP FUNCTION", "DROP FUNCTION IF EXISTS public.some_dead_fn();"],
    ["DROP TRIGGER", "DROP TRIGGER IF EXISTS t_jobs_notify ON public.jobs;"],
    ["a commented-out DROP", "-- DROP TABLE public.jobs;\nSELECT 1;"],
    ["prose that mentions dropping a table", "DO $$ BEGIN RAISE NOTICE 'dropping the old table'; END $$;"],
    [
      "constraint dropped and re-added in the same file",
      "ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_payment_status_check;\n" +
        "ALTER TABLE public.jobs ADD CONSTRAINT jobs_payment_status_check CHECK (payment_status IN ('none','escrow'));",
    ],
    [
      "a sweep FUNCTION whose body deletes rows (runs when called, not now)",
      "CREATE OR REPLACE FUNCTION public.sweep_old_views() RETURNS void LANGUAGE plpgsql AS $fn$\n" +
        "BEGIN\n  DELETE FROM public.job_views;\nEND;\n$fn$;",
    ],
  ];

  it.each(benign)("allows %s", (_name, sql) => {
    const { code, out } = check(sql);
    expect(code, `expected the gate to PASS on:\n${sql}\n\ngot:\n${out}`).toBe(0);
  });
});

describe("check-destructive-ddl — the escape hatch cannot be tripped by accident", () => {
  const STMT = "DROP TABLE IF EXISTS public.parish_tax_rates;";
  const DESC = "DROP TABLE public.parish_tax_rates";
  const REASON = "-- ACK-REASON: this reason is long enough to pass the prose length check";
  const LOSS = "-- ACK-DATA-LOSS: this loss note is long enough to pass the length check";

  const nearMisses: [name: string, sql: string][] = [
    [
      "an ack copied from another migration (wrong object)",
      `-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.some_other_table\n${REASON}\n${LOSS}\n${STMT}`,
    ],
    [
      "an ack naming the wrong operation on the right object",
      `-- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.parish_tax_rates\n${REASON}\n${LOSS}\n${STMT}`,
    ],
    [
      "a blank line between the ack and the statement",
      `-- DESTRUCTIVE-DDL-ACK: ${DESC}\n${REASON}\n${LOSS}\n\n${STMT}`,
    ],
    [
      "a file-header ack trying to cover the whole file",
      `-- DESTRUCTIVE-DDL-ACK: ${DESC}\n${REASON}\n${LOSS}\n\nSELECT 1;\n${STMT}`,
    ],
    ["a placeholder reason", `-- DESTRUCTIVE-DDL-ACK: ${DESC}\n-- ACK-REASON: cleanup\n${LOSS}\n${STMT}`],
    ["a too-short reason", `-- DESTRUCTIVE-DDL-ACK: ${DESC}\n-- ACK-REASON: had to go\n${LOSS}\n${STMT}`],
    ["a missing ACK-DATA-LOSS line", `-- DESTRUCTIVE-DDL-ACK: ${DESC}\n${REASON}\n${STMT}`],
    ["a missing ACK-REASON line", `-- DESTRUCTIVE-DDL-ACK: ${DESC}\n${LOSS}\n${STMT}`],
    ["the ack marker alone, with no fields", `-- DESTRUCTIVE-DDL-ACK: ${DESC}\n${STMT}`],
    [
      "one ack in front of two destructive statements",
      `-- DESTRUCTIVE-DDL-ACK: ${DESC}\n${REASON}\n${LOSS}\n${STMT}\nDROP TABLE public.other_table;`,
    ],
  ];

  it.each(nearMisses)("refuses %s", (_name, sql) => {
    const { code, out } = check(sql);
    expect(code, `expected the gate to still FAIL:\n${sql}\n\ngot:\n${out}`).toBe(1);
  });

  it("has no environment variable or flag that skips it", () => {
    // If one is ever added, this test is the thing that should have to be
    // deleted first — deliberately, in a diff someone reads.
    const src = spawnSync("cat", [SCRIPT], { encoding: "utf8" }).stdout;
    expect(src).not.toMatch(/process\.env\.[A-Z_]*(SKIP|FORCE|BYPASS|ALLOW|OVERRIDE)/);
    expect(src.match(/--(force|skip|no-verify|bypass)\b/)).toBeNull();
  });
});
