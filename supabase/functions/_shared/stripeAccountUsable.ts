/**
 * Is this Stripe error saying the CONNECT ACCOUNT on file cannot be used at all?
 *
 * Two different facts answer yes:
 *
 *   1. The account is gone: 404 / "No such account" / account_invalid /
 *      resource_missing (a deleted account, a test-mode purge).
 *   2. The account is a SANDBOX account and we are on the live key. Stripe
 *      went live on prod 2026-09-27, and a profile still pointing at an
 *      account created with a testmode key gets, from the live key, a 400
 *      StripeAPIError: "The account acct_… was a test account created with a
 *      testmode key, and therefore can only be used with testmode keys."
 *      Nothing about retrying changes that answer.
 *
 *      Deliberately ONE direction only. The mirror sentence ("…can only be
 *      used with livemode keys") means a REAL live account seen through a
 *      test key, i.e. prod's STRIPE_SECRET_KEY was misconfigured. Treating
 *      that as unusable would make stripe-connect null every live helper's
 *      account id on their next Payment-settings visit and strand their
 *      balance (lh-money-escrow review, 2026-09-30), so it stays an error.
 *
 * Case 2 was unmatched, so stripe-connect and stripe-payouts answered 500 on
 * every Payment/Earnings page load for the two shared E2E accounts — 216 of
 * the 227 press failures in press-every-control run 36697559350 (#1582,
 * function_logs 2026-09-30 10:00-12:30Z).
 */
export function isUnusableConnectAccountError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { statusCode?: unknown; message?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  return (
    e.statusCode === 404 ||
    message.includes("No such account") ||
    e.code === "account_invalid" ||
    e.code === "resource_missing" ||
    /test account created with a testmode key, and therefore can only be used with testmode keys/.test(message)
  );
}
