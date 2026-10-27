/**
 * CLASS GUARD: payout setup only after a hire (owner decision 2026-10-25,
 * item 9). Stripe rejected 45 of our 46 live connected accounts as
 * rejected.fraud; 30 of the 33 linked to a live profile belonged to people
 * nobody hired, 22 opened within an hour of sign-up (GET /v1/accounts + prod
 * profiles/jobs, read-only, 2026-10-25). A Connect account is opened only for
 * someone chosen for a job that holds money.
 *
 * SERVER, from the real source (comments blanked):
 *   (h1) stripe-connect refuses every PAYOUT_SETUP_ACTION (read from
 *        _shared/payoutSetupPause.ts) for a member payoutSetupHireAllowed()
 *        says no to, AFTER the pause gate and BEFORE its first action branch,
 *        asked for the verified `user.id`; only the App Store review account
 *        is exempt.
 *   (h2) every branch that creates or deletes an account or an Account Link
 *        (accounts.create / accountLinks.create / getOrCreateAccount /
 *        accounts.del) is a setup action (gated by h1) or asks
 *        payoutSetupHireAllowed() before that call inside the branch.
 *   (h3) payoutSetupHireAllowed fails closed: only a literal `true` allows.
 *   (h4) the 403's words equal the app notice's (an old build toasts them).
 * DATABASE, from the NEWEST definition (any dollar tag):
 *   (h5) payout_setup_hire_allowed counts a job or crew seat only when its
 *        payment is funded (job_payment_is_funded), is service-role only, and
 *        its _for_me twin answers about auth.uid() alone.
 * CLIENT:
 *   (h6) usePayoutSetupPaused() is true while the member is not hired yet
 *        (it reads payout_setup_hire_allowed_for_me), so every entry point the
 *        pause guard already inventories (payoutSetupPausedEntryPoints.test.ts)
 *        hides setup for them too.
 *
 * Behaviour: src/test/edge/stripeConnectNeedsHire.test.ts (the real function),
 * src/test/pglite/payoutAfterHire.pglite.mjs (the SQL, 57 PASS; skip: 47 FAIL).
 *
 * @mutate supabase/functions/stripe-connect/index.ts |       !(await payoutSetupHireAllowed(supabaseAdmin, user.id))\n    ) { |       !(await payoutSetupHireAllowed(supabaseAdmin, body.user_id))\n    ) {
 * @mutate supabase/functions/stripe-connect/index.ts |       !APP_REVIEW_ACCOUNT_IDS.has(user.id) &&\n      !(await payoutSetupHireAllowed | \n      !(await payoutSetupHireAllowed
 * @mutate supabase/functions/stripe-connect/index.ts |       if (account.type !== "express" && !APP_REVIEW_ACCOUNT_IDS.has(user.id) && !(await payoutSetupHireAllowed(supabaseAdmin, user.id))) { |       if (account.type === "none") {
 * @mutate supabase/functions/_shared/payoutSetupHire.ts |     return data === true; |     return Boolean(data);
 * @mutate supabase/functions/_shared/payoutSetupHire.ts | You'll set up payouts once you're hired or make your first sale. | Set up payouts after your first hire.
 * @mutate supabase/migrations/20261027170717_declutter_free_section.sql |                 WHERE j.helper_id = p_user_id\n                  AND public.job_payment_is_funded(j.payment_status::text)) |                 WHERE j.helper_id = p_user_id\n                  AND true)
 * @mutate supabase/migrations/20261027170717_declutter_free_section.sql |                 WHERE a.helper_id = p_user_id\n                  AND public.job_payment_is_funded(j.payment_status::text)) |                 WHERE a.helper_id = p_user_id)
 * @mutate supabase/migrations/20261025162003_payout_after_hire.sql | REVOKE ALL ON FUNCTION public.payout_setup_hire_allowed(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.payout_setup_hire_allowed(uuid) FROM PUBLIC, anon;
 * @mutate src/hooks/usePayoutSetupPaused.ts |   if (!hireAllowed) return "needs_hire"; |
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";
import { PAYOUT_SETUP_NEEDS_HIRE_COPY } from "@/lib/payoutSetupPaused";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const CREATES = /\baccounts\.create\s*\(|\baccountLinks\.create\s*\(|\bgetOrCreateAccount\s*\(|\baccounts\.del\s*\(/;
const HIRE_GATE =
  /if\s*\(\s*PAYOUT_SETUP_ACTIONS\.has\(action\)\s*&&\s*!APP_REVIEW_ACCOUNT_IDS\.has\(user\.id\)\s*&&\s*!\(await payoutSetupHireAllowed\(supabaseAdmin,\s*user\.id\)\)\s*\)\s*\{\s*return payoutSetupNeedsHireResponse\(corsHeaders\);/;
const PAUSE_GATE = /if\s*\(\s*PAYOUT_SETUP_ACTIONS\.has\(action\)\s*&&\s*\(await payoutSetupPausedFor\(supabaseAdmin,\s*user\)\)\)/;

/** stripe-connect's action branches: name -> branch body (to the next branch). Same split as payoutSetupPausedEntryPoints.test.ts. */
function actionBranches(code: string): Map<string, { start: number; body: string }> {
  const out = new Map<string, { start: number; body: string }>();
  const hits = [...code.matchAll(/\bif\s*\(\s*action\s*===\s*"([a-z_]+)"\s*\)\s*\{/g)];
  hits.forEach((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index! : code.length;
    out.set(h[1], { start: h.index!, body: code.slice(h.index!, end) });
  });
  return out;
}

/** Which branches ask the hire before each create/delete call (h2). */
export function ungatedMakers(code: string, setupActions: ReadonlySet<string>): { makers: number; bad: string[] } {
  const bad: string[] = [];
  let makers = 0;
  for (const [name, b] of actionBranches(code)) {
    if (b.body.search(CREATES) < 0) continue;
    makers++;
    if (setupActions.has(name)) continue;
    for (const m of b.body.matchAll(new RegExp(CREATES.source, "g"))) {
      if (b.body.slice(0, m.index!).search(/\bpayoutSetupHireAllowed\s*\(/) < 0) bad.push(`${name}: ${m[0]} without payoutSetupHireAllowed() before it`);
    }
  }
  return { makers, bad };
}

describe("payout setup only after a hire", () => {
  const connect = blankComments(read("supabase/functions/stripe-connect/index.ts"));
  const shared = blankComments(read("supabase/functions/_shared/payoutSetupPause.ts"));
  const hire = blankComments(read("supabase/functions/_shared/payoutSetupHire.ts"));
  const setupActions = new Set(
    [...(/PAYOUT_SETUP_ACTIONS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(shared)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]),
  );
  const branches = actionBranches(connect);

  it("reads a real inventory (floors)", () => {
    expect(setupActions.size).toBeGreaterThan(2);
    expect(branches.size).toBeGreaterThan(6);
  });

  it("(h1) stripe-connect refuses setup for a member nobody hired, after the pause and before the first branch", () => {
    const pause = connect.search(PAUSE_GATE);
    const gate = connect.search(HIRE_GATE);
    const firstBranch = Math.min(...[...branches.values()].map((b) => b.start));
    expect(pause, "the pause gate").toBeGreaterThan(0);
    expect(gate, "the hire gate is missing (or asks about someone other than the verified caller)").toBeGreaterThan(pause);
    expect(gate).toBeLessThan(firstBranch);
  });

  it("(h2) every branch that makes or deletes an account or link is setup, or asks the hire first", () => {
    const { makers, bad } = ungatedMakers(connect, setupActions);
    expect(makers).toBeGreaterThan(3);
    expect(bad).toEqual([]);
  });

  it("(h3) only a literal true allows (an error, null or any other answer refuses)", () => {
    expect(hire).toMatch(/return data === true;/);
    expect(hire).not.toMatch(/return\s+(?:Boolean\(data\)|!!data|data\s*!==\s*false)/);
  });

  it("(h4) the 403 carries the notice's exact words and code", () => {
    const msg = /PAYOUT_SETUP_NEEDS_HIRE_MESSAGE\s*=\s*"([^"]*)"/.exec(read("supabase/functions/_shared/payoutSetupHire.ts"))?.[1];
    expect(msg).toBe(PAYOUT_SETUP_NEEDS_HIRE_COPY);
    expect(hire).toMatch(/PAYOUT_SETUP_NEEDS_HIRE_CODE\s*=\s*"payout_setup_needs_hire"/);
    expect(hire).toMatch(/status:\s*403/);
  });

  it("(h5) the newest payout_setup_hire_allowed counts only funded work and is service-role only", () => {
    const def = newestFunction("payout_setup_hire_allowed");
    const body = def.body;
    // Both job reads (the Helpr's own job, a crew seat's job) are judged funded.
    const jobReads = [...body.matchAll(/FROM\s+public\.(?:jobs|group_job_helpers)\b[\s\S]*?(?=\bOR\s+EXISTS|\bOR\s+public\.|\)\s*;|$)/gi)].map((m) => m[0]);
    expect(jobReads.length).toBeGreaterThan(1);
    for (const r of jobReads) expect(r, `an unfunded job unlocks an account:\n${r}`).toMatch(/job_payment_is_funded\s*\(/);
    // An accept waiting on setup counts only while its job still holds money (lh-authz-rls #2).
    expect(body).toMatch(/FROM public\.job_accept_pending a\s+JOIN public\.jobs j ON j\.id = a\.job_id\s+WHERE a\.helper_id = p_user_id\s+AND public\.job_payment_is_funded\(j\.payment_status::text\)/);
    // No poster-writable column unlocks an account (lh-authz-rls #4): fees come from server-written rows.
    expect(body).not.toMatch(/cancellation_fee_status/);
    const file = blankSqlComments(read(`supabase/migrations/${def.file}`));
    expect(file).toMatch(/REVOKE ALL ON FUNCTION public\.payout_setup_hire_allowed\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(file).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.payout_setup_hire_allowed\(uuid\) TO [^;]*\bauthenticated\b/);
    const mine = newestFunction("payout_setup_hire_allowed_for_me").body;
    expect(mine).toMatch(/payout_setup_hire_allowed\s*\(\s*auth\.uid\(\)\s*\)/);
  });

  it("(h6) usePayoutSetupPaused() hides setup from a member nobody hired", () => {
    const hook = blankComments(read("src/hooks/usePayoutSetupPaused.ts"));
    expect(blankComments(read("src/hooks/usePayoutSetupHireAllowed.ts"))).toMatch(/rpc\(\s*"payout_setup_hire_allowed_for_me"\s*\)/);
    expect(hook).toMatch(/const hireAllowed = usePayoutSetupHireAllowed\(\);/);
    expect(hook).toMatch(/if\s*\(\s*!hireAllowed\s*\)\s*return\s*"needs_hire";/);
    expect(hook).toMatch(/export function usePayoutSetupPaused\(\): boolean \{\s*return usePayoutSetupBlock\(\) !== null;/);
  });

  it("the scanner sees a planted ungated maker (self-test)", () => {
    const planted = `
      if (action === "onboard") { await getOrCreateAccount(); }
      if (action === "dashboard") { await stripe.accountLinks.create({}); }
      if (action === "status") { await stripe.accounts.retrieve("a"); }
    `;
    expect(ungatedMakers(planted, new Set(["onboard"])).bad).toEqual(["dashboard: accountLinks.create( without payoutSetupHireAllowed() before it"]);
    expect(HIRE_GATE.test(`if (PAYOUT_SETUP_ACTIONS.has(action) && !APP_REVIEW_ACCOUNT_IDS.has(user.id) && !(await payoutSetupHireAllowed(supabaseAdmin, body.user_id))) { return payoutSetupNeedsHireResponse(corsHeaders);`)).toBe(false);
  });
});
