/*
 * CLASS CHECK: every billing column on `profiles` is pinned against its own
 * member's write.
 *
 * FOUND 2026-10-15 (lh-money-escrow review of the Q1794 branch, filed as an
 * open item). `authenticated` holds a column UPDATE grant on
 * profiles.subscription_source, and the BEFORE UPDATE trigger
 * tr_prevent_self_escalation (public.prevent_self_escalation) pinned every
 * other billing column but not that one. subscription-reconciliation skips
 * every 'apple' row, so a Stripe member could write 'apple' on their own row
 * and take their paid tier out of the daily Stripe check.
 *
 * The grant itself cannot be revoked while 1.0.4 (7119) is in App Review
 * (REVIEW FREEZE), so the trigger is the authority, and this guard checks it:
 *
 *   BILLING = every column of profiles (src/integrations/supabase/types.ts,
 *             generated from the live schema) whose name says it carries
 *             billing or payout authority: subscription_*, stripe_*, apple_*,
 *             onboarding_fee_*. Never hand-typed: a new billing column joins
 *             the day the types are regenerated.
 *   PINNED  = every `NEW.<col> := OLD.<col>` in the EFFECTIVE definition of
 *             prevent_self_escalation (src/test/helpers/effectiveFunctionDefs:
 *             the newest CREATE, any dollar-quote tag, plus later rewrites),
 *             read with SQL comments blanked.
 *
 * BILLING minus PINNED must be exactly KNOWN_UNPINNED (empty), two-way.
 *
 * @mutate supabase/migrations/20261015005850_pin_subscription_source_self_write.sql |   NEW.subscription_source := OLD.subscription_source; |   NULL;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");
const TYPES = join(REPO, "src", "integrations", "supabase", "types.ts");

const BILLING_NAME = /^(subscription_|stripe_|apple_|onboarding_fee_)\w+$/;

// Billing columns a member may legitimately move, `column: why`. EXACT and
// two-way: a new unpinned one fails, and so does a listed one that is pinned.
// @two-way src/test/billingColumnsArePinned.test.ts:const staleUnpinned =
const KNOWN_UNPINNED: Record<string, string> = {};

/** Column names of public.profiles' Row type in the generated types. */
function profileColumns(): string[] {
  const src = readFileSync(TYPES, "utf8");
  const start = src.search(/\n {6}profiles: \{\n {8}Row: \{\n/);
  if (start < 0) throw new Error("profiles Row not found in types.ts");
  const rowOpen = src.indexOf("Row: {", start);
  const rowClose = src.indexOf("\n        }", rowOpen);
  const body = src.slice(rowOpen, rowClose);
  return [...body.matchAll(/^ {10}(\w+)\??:/gm)].map((m) => m[1]);
}

function pinnedColumns(): { file: string; cols: Set<string> } {
  const def = effectiveDefs(MIGRATIONS).get("prevent_self_escalation");
  if (!def) throw new Error("no migration leaves prevent_self_escalation defined");
  const code = blankSqlComments(def.stmt);
  const cols = new Set<string>();
  for (const m of code.matchAll(/\bNEW\.(\w+)\s*:=\s*OLD\.(\w+)\s*;/gi)) {
    if (m[1] === m[2]) cols.add(m[1]);
  }
  return { file: def.file, cols };
}

describe("every profiles billing column is pinned by prevent_self_escalation", () => {
  const columns = profileColumns();
  const billing = columns.filter((c) => BILLING_NAME.test(c)).sort();
  const { file, cols: pinned } = pinnedColumns();

  it("reads real inventories, not empty ones", () => {
    expect(columns.length).toBeGreaterThan(80);
    expect(billing.length).toBeGreaterThan(12);
    expect(billing).toContain("subscription_source");
    expect(billing).toContain("subscription_tier");
    expect(pinned.size).toBeGreaterThan(40);
  });

  it("leaves no billing column self-writable", () => {
    const unpinned = billing.filter((c) => !pinned.has(c));
    const unexpected = unpinned.filter((c) => !(c in KNOWN_UNPINNED));
    expect(
      unexpected,
      `profiles billing columns a member can write on their own row (prevent_self_escalation from ${file} does not pin them)`,
    ).toEqual([]);
  });

  it("KNOWN_UNPINNED is exact (a pinned column must leave the list)", () => {
    const staleUnpinned = Object.keys(KNOWN_UNPINNED).filter((c) => pinned.has(c) || !billing.includes(c));
    expect(staleUnpinned).toEqual([]);
  });
});
