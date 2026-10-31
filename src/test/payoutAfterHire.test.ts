/**
 * Payout setup after the hire (owner decision 2026-10-25, item 9; lead
 * answers 2026-10-25), behind the hidden switch `payout_after_hire`. Static
 * guard over every layer, read from real source (comments blanked) and the
 * NEWEST migration definitions (any dollar tag):
 *
 *   (a1) helper_accept_missing lists nothing while payout_after_hire is on for
 *        the member, decided BEFORE the payout/ID checks (the accept goes
 *        ahead; every accept path reads this one function).
 *   (a2) the client mirror (acceptMissingFromProfile) does the same, and both
 *        hooks that read it pass the switch.
 *   (p1) the ID check gates the PAYOUT instead: refuse_payout_claim_while_held
 *        asks payout_waits_on_identity (since Builder 49's 20261030225327, rebuilt as
 *        20261031220849, it needs only identity_check).
 *   (r1) reminders only while payout_after_hire AND payout_setup are on, at
 *        most one a day, never for a payout-ready Helpr.
 *   (c1) the reminder's 'hired' words equal the app prompt's, and no copy
 *        promises a time ("a few minutes", lead 2026-10-25).
 *   (u1) both accept-complete paths offer the "You're hired" prompt.
 *   (h1) process-scheduled-payouts tells a payee with no account at most once
 *        a day per job (it runs hourly).
 *
 * Behaviour: src/test/pglite/payoutAfterHire.pglite.mjs (SQL),
 * src/test/edge/payout-setup-reminders.test.ts, src/test/edge/process-scheduled-payouts.test.ts
 * ("once a day per job"), src/components/payouts/payoutAfterHire.test.tsx (screens).
 *
 * @mutate supabase/migrations/20261025162003_payout_after_hire.sql |            WHEN public.feature_enabled_for_user('payout_after_hire', p.user_id) THEN ARRAY[]::text[] |            WHEN false THEN ARRAY[]::text[]
 * @mutate supabase/migrations/20261027200455_helpr_guarantee.sql |      AND public.payout_waits_on_identity(NEW.helper_id) THEN |      AND false THEN
 * @mutate supabase/migrations/20261031220849_id_check_asked_when_hired_restated.sql |       AND public.feature_enabled_for_user('payout_setup', h.uid) |
 * @mutate supabase/migrations/20261031220849_id_check_asked_when_hired_restated.sql |                         WHERE r.helper_id = h.uid AND r.claimed_at > now() - interval '20 hours') |                         WHERE false)
 * @mutate src/lib/awardGate.ts |   if (opts.payoutAfterHire === true) return []; |
 * @mutate src/hooks/useAwardBlockReason.ts |   const missing = acceptMissingFromProfile(profile, { payoutAfterHire }); |   const missing = acceptMissingFromProfile(profile);
 * @mutate src/components/job-card/activityActions/useOfferHandlers.ts |   if (!(await deps.promptPayoutAfterHire?.(user.id))) {\n    setPaymentHeldWho | {\n    setPaymentHeldWho
 * @mutate supabase/functions/_shared/payoutSetupReminder.ts | adds your bank in one short step, a few minutes, once. | adds your bank in one short step, about 2 minutes, once.
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |         if (toldErr \|\| !toldToday) await insertNotifications | await insertNotifications
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";
import { acceptMissingFromProfile } from "@/lib/awardGate";
import * as appCopy from "@/lib/payoutAfterHire";
import { payoutSetupReminderCopy } from "../../supabase/functions/_shared/payoutSetupReminder";

const ROOT = path.resolve(__dirname, "../..");
const code = (p: string) => blankComments(fs.readFileSync(path.join(ROOT, p), "utf8"));

describe("payout setup after the hire", () => {
  it("(a1) helper_accept_missing lists nothing while payout_after_hire is on, before the payout and ID checks", () => {
    const body = newestFunction("helper_accept_missing").body;
    const sw = body.search(/WHEN\s+public\.feature_enabled_for_user\(\s*'payout_after_hire'\s*,\s*p\.user_id\s*\)\s+THEN\s+ARRAY\[\]::text\[\]/);
    const payout = body.search(/'payout_setup'/);
    const id = body.search(/'stripe_id'/);
    expect(sw, "the payout_after_hire branch is missing").toBeGreaterThan(0);
    expect(payout).toBeGreaterThan(sw);
    expect(id).toBeGreaterThan(sw);
  });

  it("(a2) the client mirror agrees, and both hooks pass the switch", () => {
    const unready = { stripe_account_id: null, stripe_payouts_enabled: false, idv_status: null };
    expect(acceptMissingFromProfile(unready)).toEqual(["payout_setup"]);
    expect(acceptMissingFromProfile(unready, { payoutAfterHire: true })).toEqual([]);
    const hook = code("src/hooks/useAwardBlockReason.ts");
    expect(hook.match(/acceptMissingFromProfile\(profile,\s*\{\s*payoutAfterHire\s*\}\)/g)?.length).toBe(2);
    expect(hook.match(/usePayoutAfterHireOn\(\)/g)?.length).toBe(2);
    // The one switch read the store is published from (IdentityCheckHost).
    expect(code("src/components/identity/IdentityCheckSheet.tsx")).toMatch(/const payoutAfterHire = useFeature\("payout_after_hire"\);\s*useEffect\(\(\) => setPayoutAfterHireOn\(payoutAfterHire\), \[payoutAfterHire\]\);/);
  });

  it("(p1) the ID check gates the payout claim, whatever payout_after_hire says (owner 2026-10-30)", () => {
    const trig = newestFunction("refuse_payout_claim_while_held").body;
    expect(trig).toMatch(/public\.payout_waits_on_identity\(NEW\.helper_id\)/);
    const waits = newestFunction("payout_waits_on_identity").body;
    expect(waits).not.toMatch(/payout_after_hire/);
    expect(waits).toMatch(/NOT public\.identity_check_exempt\(p_user_id\)/);
  });

  it("(r1) reminders: both switches, at most one a day, never a payout-ready Helpr", () => {
    const claim = newestFunction("claim_payout_setup_reminders").body;
    expect(claim).toMatch(/feature_enabled_for_user\(\s*'payout_after_hire'\s*,\s*h\.uid\s*\)/);
    expect(claim).toMatch(/feature_enabled_for_user\(\s*'payout_setup'\s*,\s*h\.uid\s*\)/);
    expect(claim).toMatch(/r\.claimed_at\s*>\s*now\(\)\s*-\s*interval\s*'20 hours'/);
    expect(claim).toMatch(/p\.stripe_account_id IS NULL OR p\.stripe_payouts_enabled IS NOT TRUE/);
    expect(claim).toMatch(/ON CONFLICT DO NOTHING/);
  });

  /** A copy line that names a setup time ("in 2 minutes", "about five minutes"). */
  const PROMISES_A_TIME = /\b(?:about|in|within)\s+(?:\d+|two|five)\s+minutes?\b/i;
  it("(c1) one set of words: the reminder's 'hired' notice is the prompt, and no copy promises a time", () => {
    expect(payoutSetupReminderCopy("hired", null)).toEqual({ title: appCopy.HIRED_PAYOUT_TITLE, message: appCopy.HIRED_PAYOUT_BODY });
    const strings: string[] = Object.values(appCopy as Record<string, unknown>).filter((v): v is string => typeof v === "string");
    const all: string[] = [
      ...strings,
      appCopy.jobPayoutHeldLine("$40"),
      ...(["hired", "day1", "day3", "day7", "money"] as const).flatMap((s) => Object.values(payoutSetupReminderCopy(s, "Mow"))),
    ];
    expect(all.length).toBeGreaterThan(10);
    for (const s of all) expect(s, s).not.toMatch(PROMISES_A_TIME);
    expect(all.filter((s) => /a few minutes/.test(s)).length).toBeGreaterThan(2);
  });

  it("(u1) both accept-complete paths offer the 'You're hired' prompt", () => {
    const h = code("src/components/job-card/activityActions/useOfferHandlers.ts");
    expect(h.match(/await deps\.promptPayoutAfterHire\?\.\(user\.id\)\)+\s*\{\s*setPaymentHeldWho/g)?.length).toBe(2);
    const a = code("src/components/job-card/useActivityActions.ts");
    expect(a).toMatch(/promptPayoutAfterHire:\s*hiredPayout\.offer/);
    expect(code("src/components/job-card/ActivityOfferDialogs.tsx")).toMatch(/<HiredPayoutSetupDialog\b/);
  });

  it("(h1) the hourly payout cron tells a payee with no account at most once a day per job", () => {
    const p = code("supabase/functions/process-scheduled-payouts/index.ts");
    const branch = p.slice(p.search(/if \(!helperProfile\?\.stripe_account_id\) \{/));
    expect(branch).toMatch(/\.eq\("title",\s*PAYOUT_ACCOUNT_REQUIRED_TITLE\)[\s\S]{0,200}24 \* 60 \* 60 \* 1000/);
    expect(branch.slice(0, 1500)).toMatch(/if \(toldErr \|\| !toldToday\) await insertNotifications/);
  });
});
