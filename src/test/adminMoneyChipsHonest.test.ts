/**
 * Owner 2026-10-21: Admin › Users showed "$94 moved" for a Helpr who had worked
 * no job; his $100 was HELD on a job not yet done. Every admin money chip names
 * one fact from its own record:
 *  - paid out  = payout_transfers with status paid (what Stripe really sent);
 *  - held      = their budget share on captured jobs not yet transferred to them
 *                (escrow, or released but untransferred: it must not vanish), crew included;
 *  - charged   = posterPaidDollars on card-captured jobs they posted, gift-card jobs left out.
 * And no chip says "moved" (escrow mixed with money that left).
 *
 * @mutate src/components/admin/useAdminUserSummaries.ts | .eq("status", "paid"), | ,
 * @mutate src/components/admin/useAdminUserSummaries.ts | userIds.includes(j.helper_id) && !paidJobs.has(`${j.id}:${j.helper_id}`) | userIds.includes(j.helper_id) && j.payment_status !== "released"
 * @mutate src/components/admin/useAdminUserSummaries.ts | userIds.includes(j.customer_id) && !giftCardPaid.ids.has(j.id) | userIds.includes(j.customer_id)
 * @mutate src/components/admin/useAdminUserSummaries.ts | supabase.from("group_job_helpers") | supabase.from("no_such_table")
 * @mutate src/components/admin/useAdminUserSummaries.ts |         of(j.customer_id).chargedCents += Math.round(posterPaidDollars(j) * 100); |         of(j.customer_id).chargedCents += Math.round(Number(j.budget) * 100);
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const hook = blankComments(readFileSync(join(ROOT, "src/components/admin/useAdminUserSummaries.ts"), "utf8"));
const row = blankComments(readFileSync(join(ROOT, "src/components/admin/adminusers/AdminUserRow.tsx"), "utf8"));

describe("admin money chips are honest (owner 2026-10-21)", () => {
  it("paid out is read from payout_transfers that were paid", () => {
    expect(hook).toMatch(/from\("payout_transfers"\)\.select\("helper_id, amount_cents, job_id"\)\.in\("helper_id", userIds\)\.eq\("status", "paid"\)/);
  });
  it("held counts every untransferred share (released included) and never a transferred one", () => {
    expect(hook).toMatch(/userIds\.includes\(j\.helper_id\) && !paidJobs\.has\(`\$\{j\.id\}:\$\{j\.helper_id\}`\)/);
    expect(hook).not.toMatch(/payment_status !== "released"/);
  });
  it("held counts crew members from the roster", () => {
    expect(hook).toMatch(/supabase\.from\("group_job_helpers"\)/);
  });
  it("charged leaves out gift-card jobs", () => {
    expect(hook).toMatch(/userIds\.includes\(j\.customer_id\) && !giftCardPaid\.ids\.has\(j\.id\)/);
  });
  it("charged is what the poster was charged (posterPaidDollars)", () => {
    expect(hook).toMatch(/chargedCents \+= Math\.round\(posterPaidDollars\(j\) \* 100\)/);
  });
  it("no chip says 'moved'", () => {
    expect(row).not.toMatch(/\bmoved\b/);
    expect(row).toMatch(/paid out/);
    expect(row).toMatch(/held/);
    expect(row).toMatch(/charged/);
  });
});
