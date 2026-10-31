/**
 * LEAD-PAYOUT-RELEASE-UNSENT (review of 20261031200034, 10-31). admin_payout_release now puts a released payout back to
 * 'pending' with attempts = 0, so the payout run offers it again. declutter_payout_unsent read "pending, no transfer,
 * attempts = 0, no send mark" as "the seller's money was never touched", so a payout an admin had released looked
 * untouched again: a later refund could rebook it and the buyer's problem window could reopen.
 *
 * CLASS: in the NEWEST definition of every function (effectiveDefs replays every migration, any dollar-quote tag), a
 * read that takes `<alias>.attempts = 0` on a payout table as "untouched" also rules out a row an admin released
 * (the admin_payout_release row in admin_audit_log). A bare `attempts = 0` in an UPDATE's SET is a write, not this read.
 * Backend proof: src/test/pglite/declutterReleasedPayoutNotUnsent.pglite.mjs (3x replay; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261031204932_declutter_released_payout_not_unsent.sql |            AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a\n                            WHERE a.action = 'admin_payout_release' AND a.target_type = 'declutter' AND a.target_id = p.id::text)\n |
 * @mutate supabase/migrations/20261031204932_declutter_released_payout_not_unsent.sql | WHERE a.action = 'admin_payout_release' AND a.target_type = 'declutter' | WHERE a.action = 'admin_payout_release' AND a.target_type = 'shop'
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const KIND: Record<string, string> = { declutter_payouts: "declutter", helpr_task_payouts: "helpr_task", shop_payouts: "shop" };

interface Reader { fn: string; table: string; code: string }
const readers: Reader[] = [];
for (const [fn, d] of DEFS) {
  const code = blankSqlComments(d.stmt ?? "");
  for (const m of code.matchAll(/FROM\s+public\.(declutter_payouts|helpr_task_payouts|shop_payouts)\s+(\w+)/gi)) {
    const alias = m[2];
    if (new RegExp(`\\b${alias}\\.attempts\\s*=\\s*0\\b`, "i").test(code)) readers.push({ fn, table: m[1].toLowerCase(), code });
  }
}

describe("a read that takes attempts = 0 as an untouched payout rules out an admin's release", () => {
  it("the inventory read something (declutter_payout_unsent is one)", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    expect(readers.length).toBeGreaterThan(0);
    expect(readers.map((r) => r.fn)).toContain("declutter_payout_unsent");
  });

  it("each one checks admin_audit_log for that kind's admin_payout_release row", () => {
    const bad = readers.filter((r) => {
      const kind = KIND[r.table];
      return !(/admin_audit_log/i.test(r.code) && /'admin_payout_release'/.test(r.code) && new RegExp(`target_type\\s*=\\s*'${kind}'`).test(r.code));
    }).map((r) => `${r.fn} (${r.table})`);
    expect(bad).toEqual([]);
  });
});
