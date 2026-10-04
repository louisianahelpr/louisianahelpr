/**
 * LOW-2: the single-Helpr cancellation-fee ledger (cancellation_fee_transfers)
 * keeps the database half of its money contract.
 *
 * void-cancelled-payments CLAIMS a row before it transfers (insert 'pending',
 * transfer with an idempotency key from the row id). That claim is only a claim
 * because of UNIQUE (job_id, helper_id): without it two overlapping runs each
 * insert a row and each send the fee. The webhook and reconciliation key on
 * stripe_transfer_id, so it is UNIQUE too. A row may only be 'paid' or
 * 'reversed' with the transfer id that proves it. And it is service-role only:
 * RLS on, every client role revoked.
 *
 * Reads EVERY migration in order (comments blanked), so a later migration that
 * drops a constraint, disables RLS or grants a client role turns this red.
 *
 * @mutate supabase/migrations/20261002052502_cancellation_fee_transfers_ledger.sql | CONSTRAINT cancellation_fee_transfers_one_per_helper UNIQUE (job_id, helper_id), | CONSTRAINT cancellation_fee_transfers_one_per_helper CHECK (true),
 * @mutate supabase/migrations/20261002052502_cancellation_fee_transfers_ledger.sql | stripe_transfer_id text UNIQUE, | stripe_transfer_id text,
 * @mutate supabase/migrations/20261002052502_cancellation_fee_transfers_ledger.sql | ALTER TABLE public.cancellation_fee_transfers ENABLE ROW LEVEL SECURITY; | SELECT 1;
 * @mutate supabase/migrations/20261002052502_cancellation_fee_transfers_ledger.sql | REVOKE ALL ON TABLE public.cancellation_fee_transfers FROM PUBLIC, anon, authenticated; | REVOKE ALL ON TABLE public.cancellation_fee_transfers FROM PUBLIC;
 * @mutate supabase/migrations/20261002052502_cancellation_fee_transfers_ledger.sql | CHECK (status NOT IN ('paid', 'reversed') OR stripe_transfer_id IS NOT NULL), | CHECK (true),
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const MIGRATIONS = join(resolve(__dirname, "..", ".."), "supabase", "migrations");
const T = String.raw`(?:public\.)?"?cancellation_fee_transfers"?`;

/** Every migration, oldest first, comments blanked, joined in order. */
function allSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8")))
    .join("\n");
}

/** The body of the newest CREATE TABLE for the ledger (balanced parens). */
function newestCreateTable(sql: string): string {
  const re = new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${T}\s*\(`, "gi");
  let start = -1;
  for (const m of sql.matchAll(re)) start = (m.index ?? 0) + m[0].length;
  if (start < 0) return "";
  let depth = 1;
  let i = start;
  for (; i < sql.length && depth > 0; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
  }
  return sql.slice(start, i - 1);
}

/** Index of the last match of `re` in `sql`, or -1. */
function lastIndex(sql: string, re: RegExp): number {
  let at = -1;
  for (const m of sql.matchAll(re)) at = m.index ?? at;
  return at;
}

const SQL = allSql();
const BODY = newestCreateTable(SQL);
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

describe("LOW-2: cancellation_fee_transfers keeps its claim, proof and access rules", () => {
  it("the table is defined by a migration", () => {
    expect(BODY.length).toBeGreaterThan(0);
  });

  it("UNIQUE (job_id, helper_id): one fee claim per (job, Helpr), never dropped later", () => {
    const b = norm(BODY);
    expect(/unique\s*\(\s*job_id\s*,\s*helper_id\s*\)/.test(b)).toBe(true);
    expect(new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?${T}\s+drop\s+constraint\s+(?:if\s+exists\s+)?"?cancellation_fee_transfers_one_per_helper`, "i").test(SQL)).toBe(false);
  });

  it("stripe_transfer_id is UNIQUE: one ledger row per Stripe transfer", () => {
    expect(/stripe_transfer_id\s+text\s+unique\b/.test(norm(BODY))).toBe(true);
  });

  it("'paid' and 'reversed' rows must carry the transfer id", () => {
    expect(
      /check\s*\(\s*status\s+not\s+in\s*\(\s*'paid'\s*,\s*'reversed'\s*\)\s+or\s+stripe_transfer_id\s+is\s+not\s+null\s*\)/.test(norm(BODY)),
    ).toBe(true);
  });

  it("RLS is enabled, and no later migration disables it", () => {
    const on = lastIndex(SQL, new RegExp(String.raw`alter\s+table\s+${T}\s+enable\s+row\s+level\s+security`, "gi"));
    const off = lastIndex(SQL, new RegExp(String.raw`alter\s+table\s+${T}\s+disable\s+row\s+level\s+security`, "gi"));
    expect(on).toBeGreaterThan(-1);
    expect(off).toBeLessThan(on);
  });

  it("PUBLIC, anon and authenticated are revoked, and no later migration grants them back", () => {
    const revoke = new RegExp(String.raw`revoke\s+all\s+on\s+(?:table\s+)?${T}\s+from\s+([^;]+);`, "gi");
    let lastRevoke = -1;
    for (const m of SQL.matchAll(revoke)) {
      const roles = norm(m[1]);
      if (/\bpublic\b/.test(roles) && /\banon\b/.test(roles) && /\bauthenticated\b/.test(roles)) lastRevoke = m.index ?? -1;
    }
    expect(lastRevoke).toBeGreaterThan(-1);
    const grant = new RegExp(String.raw`grant\s+[^;]*?\s+on\s+(?:table\s+)?${T}\s+to\s+([^;]+);`, "gi");
    for (const m of SQL.matchAll(grant)) {
      if ((m.index ?? 0) < lastRevoke) continue;
      expect(norm(m[1]), "a client role was granted the fee ledger after the revoke").not.toMatch(/\b(public|anon|authenticated)\b/);
    }
  });
});
