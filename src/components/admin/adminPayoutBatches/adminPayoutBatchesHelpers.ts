import { toneBadgeClasses } from "@/components/admin/tones";

export const LEDGER_TONE: Record<string, string> = {
  paid: toneBadgeClasses.success,
  pending: toneBadgeClasses.warning,
  failed: "bg-destructive/10 text-destructive",
  reversed: toneBadgeClasses.neutral,
};

// Payout holds are no longer kept here. They lived in this browser's
// localStorage ("helpr.admin_payout_holds.v1"), which no other admin and no
// payout function could see; they are now public.payout_holds, read and
// written in AdminPayoutBatches.tsx and honoured server-side (docs/OPEN.md
// Q764). An old localStorage entry is simply ignored.


/**
 * Q1760 (lh-money-escrow review of the test-mode branch, 2026-10-12): a test
 * account's batch pays out on the Stripe TEST key, so the selection total and
 * both confirm dialogs ("This moves real money") count the real batches only
 * and name the test ones apart. Before this the grand total left test batches
 * out but the selection total did not, so an admin who ticked a test batch was
 * told its test dollars were real money.
 */
export type MoneyBatch = { total_payout: number | string | null; is_seed?: boolean | null };

export function splitRealAndTest(batches: MoneyBatch[]): { real: number; test: number; realCount: number; testCount: number } {
  const amount = (b: MoneyBatch) => Number(b.total_payout || 0);
  const real = batches.filter((b) => !b.is_seed);
  const test = batches.filter((b) => b.is_seed);
  return {
    real: real.reduce((s, b) => s + amount(b), 0),
    test: test.reduce((s, b) => s + amount(b), 0),
    realCount: real.length,
    testCount: test.length,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The bulk confirm's sentence: real money and test money said apart. */
export function bulkPayoutDescription(batches: MoneyBatch[]): string {
  const { real, test, realCount, testCount } = splitRealAndTest(batches);
  const transfers = plural(realCount + testCount, "Stripe transfer");
  const realPart = realCount > 0 ? `$${real.toFixed(2)} of real money to ${plural(realCount, "Helpr")}` : "";
  // A test account's payout runs where its escrow sits (release-payout's
  // jobMoneyMode), which is Stripe test mode when every party is a test
  // account. Said as "to a test account", never as "no real money moves": an
  // is_seed profile missing from test_accounts would pay live (2 such
  // profiles on 2026-10-14, neither with a job).
  const testPart = testCount > 0 ? `$${test.toFixed(2)} to ${plural(testCount, "test account")}` : "";
  const parts = [realPart, testPart].filter(Boolean).join(" and ");
  // Every transfer is irreversible, test or not (lh-money-escrow pass, 2026-10-14).
  const tail = realCount > 0 ? " The real money can't be undone here." : " This can't be undone here.";
  return `This fires ${transfers}: ${parts}.${tail}`;
}

/** One batch's confirm sentence: a test batch is never called real money. */
export function singlePayoutDescription(b: MoneyBatch & { helper_name: string | null; job_count: number }): string {
  const jobs = plural(b.job_count, "job");
  const name = b.helper_name ?? "this Helpr";
  return b.is_seed
    ? `This transfers $${Number(b.total_payout).toFixed(2)} to the test account ${name} for ${jobs} via Stripe. This can't be undone here.`
    : `This transfers $${Number(b.total_payout).toFixed(2)} to ${name} for ${jobs} via Stripe. This moves real money and can't be undone here.`;
}
