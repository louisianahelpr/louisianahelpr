// No test fixture may describe a job that the database would reject.
//
// `e2e/happy-path/earnings-length.spec.ts` seeded 12 jobs with
// `payment_status: "paid"`. That value has never been legal — the
// `jobs_payment_status_check` constraint admits exactly ten strings, and "paid"
// is not among them. Four more specs carried the same value on `open` jobs.
//
// It survived because the code under test ignored the column: the earnings
// screen counted anything with `status === "completed"`. The fixture's
// impossible value never had to mean anything, so nothing could notice it. Both
// halves were wrong in the same direction and agreed with each other.
//
// It surfaced on 2026-09-07, when `payment_status` started deciding what counts
// as the helper's money. The count went to zero and a passing E2E turned red —
// correctly, and for a defect that had been sitting in the fixture for months.
//
// The general shape: A FIXTURE IS AN ASSERTION ABOUT WHAT THE WORLD CAN HOLD.
// One that describes an impossible row makes every test built on it a test of
// something that cannot happen, and the failure is invisible for exactly as
// long as the code ignores the field.
//
// So the legal set is read from the CONSTRAINT — from the newest migration that
// defines it, since migrations are append-only and a pinned path grades a body
// Postgres has already replaced — and every fixture is checked against it.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const CONSTRAINT = "jobs_payment_status_check";

/** The values the LIVE constraint admits, from the newest migration to define it. */
function legalPaymentStatuses(): string[] {
  const defining = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      new RegExp(`ADD\\s+CONSTRAINT\\s+${CONSTRAINT}`, "i").test(
        readFileSync(join(MIGRATIONS, f), "utf8"),
      ),
    );
  const newest = defining[defining.length - 1];
  if (!newest) throw new Error(`No migration defines ${CONSTRAINT}`);
  const sql = readFileSync(join(MIGRATIONS, newest), "utf8");
  // Bounded to THAT constraint's ARRAY[...] so a later statement in the same
  // file cannot leak its own quoted strings into the legal set.
  const after = sql.slice(sql.search(new RegExp(`ADD\\s+CONSTRAINT\\s+${CONSTRAINT}`, "i")));
  const array = /ARRAY\s*\[([^\]]*)\]/.exec(after);
  if (!array) throw new Error(`Could not read the value list for ${CONSTRAINT}`);
  return [...array[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Every .ts/.tsx under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const LEGAL = legalPaymentStatuses();

describe("the legal set is really being read", () => {
  it("found the constraint and its values", () => {
    // A discovery pass that finds nothing passes for exactly the reason it
    // exists to prevent.
    expect(LEGAL.length).toBeGreaterThanOrEqual(8);
    expect(LEGAL).toContain("escrow");
    expect(LEGAL).toContain("payout_pending");
    expect(LEGAL).toContain("released");
  });

  it("does not admit the value that was wrong", () => {
    expect(LEGAL).not.toContain("paid");
  });
});

describe("no fixture describes a job the database would reject", () => {
  // `payment_status` also exists on `tips` and `pif_credits`, where "paid" IS
  // legal and IS written by stripe-webhook. Those are matched too, so the
  // assertion allows any legal value from ANY of those columns rather than
  // claiming a violation on a row that is fine. The jobs constraint is the one
  // that had the real drift; this stays a net for it without false positives.
  const OTHER_TABLE_VALUES = ["paid", "pending", "sent", "refunded"];

  const files = [...walk(resolve(ROOT, "e2e")), ...walk(resolve(ROOT, "src/test"))]
    .filter((f) => !f.endsWith(".gen.ts"));

  it("scanned a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("uses only values some real column admits", () => {
    const allowed = new Set([...LEGAL, ...OTHER_TABLE_VALUES]);
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/payment_status:\s*"([^"]+)"/g)) {
        if (!allowed.has(m[1])) {
          offenders.push(`${file.replace(ROOT + "/", "")} -> "${m[1]}"`);
        }
      }
    }
    expect(offenders, `fixtures using an impossible payment_status:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("no JOBS fixture uses a value only another table admits", () => {
    // The specific bug: `payment_status: "paid"` sitting beside a `status:`
    // that only `jobs` has ("open", "completed", "accepted", ...). That pairing
    // is what makes it a jobs row, and "paid" is illegal on one.
    const JOB_STATUSES = ["open", "completed", "accepted", "in_progress", "cancelled"];
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/status:\s*"([^"]+)",[\s\S]{0,900}?payment_status:\s*"([^"]+)"/g)) {
        if (JOB_STATUSES.includes(m[1]) && !LEGAL.includes(m[2])) {
          offenders.push(`${file.replace(ROOT + "/", "")} -> status "${m[1]}" with payment_status "${m[2]}"`);
        }
      }
    }
    expect(offenders, `job fixtures the constraint would reject:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});
