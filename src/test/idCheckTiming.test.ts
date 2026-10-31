/**
 * CLASS GUARD: the ID check's timing (owner 2026-10-30, replaces the removal of 2026-10-23).
 * Once per person: a poster when posting, a Helpr when hired or at the first payout,
 * and on Declutter a seller when listing, a buyer at the first purchase, a delivery Helpr
 * when taking a delivery. Never on Home, in a checklist or in Settings. No payout without
 * a verified ID: every function that sends a Helpr money asks, built from the source.
 *
 * Behaviour is proven by src/test/pglite/idCheckTiming.pglite.mjs (the migration 3x; red
 * with NEW_MIGRATION=skip).
 *
 * @mutate supabase/functions/release-payout/index.ts | const idHold = await checkIdentityHold(supabaseAdmin, job.helper_id); | const idHold = { kind: "clear" as const };
 * @mutate supabase/functions/declutter-money/index.ts | const idHold = await checkIdentityHold(admin, payeeId); | const idHold = { kind: "clear" as const };
 * @mutate supabase/migrations/20261031220849_id_check_asked_when_hired_restated.sql |      AND NOT public.identity_check_exempt(p_user_id)\n     AND NOT COALESCE((SELECT public.identity_is_verified |      AND public.feature_enabled_for_user('payout_after_hire', p_user_id) AND NOT public.identity_check_exempt(p_user_id)\n     AND NOT COALESCE((SELECT public.identity_is_verified
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | { key: "skills", label: skills | { key: "id", label: "Verify your ID", done: false, go: () => openIdentityCheck("general") },\n    { key: "skills", label: skills
 * @mutate supabase/functions/void-cancelled-payments/index.ts | \|\| noFeeRecorded ? 0 : computeCancellationFee(job); | ? 0 : computeCancellationFee(job);
 * @mutate supabase/functions/stripe-idv-start/index.ts | if (stored.status === "verified" && stored.metadata?.user_id === user.id) { | if (stored.status === "verified") {
 * @mutate src/pages/info/legal/TermsSection.tsx | setup fee covers this check. | Helpr pays for this check.
 * @mutate src/pages/info/legal/TermsSection.tsx |           idOn ? <>\n            <p><strong className="text-foreground">We ask for a photo ID |           true ? <>\n            <p><strong className="text-foreground">We ask for a photo ID
 * @mutate supabase/functions/create-payment/index.ts | const tipIdHold = await checkIdentityHold(supabaseAdmin, helperId); | const tipIdHold = { kind: "clear" as const };
 * @mutate supabase/functions/auto-tip-charge/index.ts | const tipIdHold = await checkIdentityHold(supabase, c.helper_id as string); | const tipIdHold = { kind: "clear" as const };
 * @mutate supabase/functions/declutter-checkout/index.ts | const tipIdHold = await checkIdentityHold(admin, helprId); | const tipIdHold = { kind: "clear" as const };
 * @mutate supabase/migrations/20261031213005_restore_id_members_reset_1027_restated.sql | AND v.old_value = 'processing' AND v.new_value = 'verified' | AND v.new_value = 'verified'
 * @mutate supabase/migrations/20261031213005_restore_id_members_reset_1027_restated.sql |    AND p.is_seed IS NOT TRUE\n |
 * @mutate supabase/migrations/20261031213005_restore_id_members_reset_1027_restated.sql |    AND NOT EXISTS (SELECT 1 FROM public.test_accounts ta WHERE ta.user_id = p.user_id)\n |
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";
import { readSource, walkSource } from "./helpers/walkSource";

const ROOT = path.resolve(__dirname, "../..");
const FN_DIR = path.join(ROOT, "supabase/functions");
const code = (p: string) => blankComments(fs.readFileSync(path.join(ROOT, p), "utf8"));
const rel = (f: string) => path.relative(FN_DIR, f).split(path.sep).join("/");

/**
 * Files that send money with no ID ask of their own, each with why. EXACT both ways.
 * Tips are asked at the checkout (owner 2026-10-30: blocked until verified): see "tips wait" below.
 */
const NOT_ASKING: Readonly<Record<string, string>> = {
  "_shared/chargebackClawback.ts": "re-pays a transfer the Helpr already had, after a chargeback reversal: not a first payout",
};

describe("the ID check's timing", () => {
  const senders = walkSource([FN_DIR])
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => ({ file: rel(f), src: blankComments(readSource(f) ?? "") }))
    .filter((f) => /\.transfers\.create\s*\(/.test(f.src));

  it("reads a real inventory (floor)", () => {
    expect(senders.length).toBeGreaterThan(9);
  });

  it("every function that sends a transfer asks for the ID, or says why not", () => {
    const silent = senders
      .filter((f) => !/checkIdentityHold\s*\(/.test(f.src))
      .map((f) => f.file)
      .sort();
    const exempt = Object.keys(NOT_ASKING).sort();
    expect(silent).toEqual(exempt);
  });

  it("the payout claim asks the rule, and the rule no longer needs payout_after_hire", () => {
    expect(newestFunction("refuse_payout_claim_while_held").body).toMatch(/public\.payout_waits_on_identity\(NEW\.helper_id\)/);
    const waits = newestFunction("payout_waits_on_identity").body;
    expect(waits).not.toMatch(/payout_after_hire/);
    expect(waits).toMatch(/NOT public\.identity_check_exempt\(p_user_id\)/);
  });

  it("a read that fails is a payout that waits", () => {
    const hold = code("supabase/functions/_shared/payoutHold.ts");
    expect(hold).toMatch(/return \{ kind: "error", message:/);
    expect(hold).toMatch(/data === true \? \{ kind: "waits" \} : \{ kind: "clear" \}/);
  });

  it("Home, the first-job checklist and a posted job never ask", () => {
    for (const f of ["src/pages/home/HomeDashboard.tsx", "src/pages/home/homeDashboard/FirstJobHome.tsx", "src/pages/posts/PostedJobCard.tsx"]) {
      expect(code(f), f).not.toMatch(/IdentityPromptCard|PosterIdentityLine|openIdentityCheck|needsIdentityCheck/);
    }
  });

  it("Settings and the trust marks report a check, never start one for an unverified member", () => {
    expect(code("src/components/profile/profileEditForm/TrustMarksCard.tsx")).not.toMatch(/openIdentityCheck/);
    expect(code("src/components/profile/SettingsTab.tsx")).toMatch(/\["verified", "checking", "with_team"\]\.includes\(identityView\(profile\.idv_status\)\)/);
  });

  it("posting and heading out stay gated", () => {
    expect(newestFunction("enforce_identity_before_post").body).toMatch(/identity_required_to_post/);
    expect(newestFunction("enforce_identity_before_start").body).toMatch(/identity_required_to_start/);
  });

  it("a poster's no-fee cancel: recorded, quoted, honoured by the money sweep and explained to reconciliation alike", () => {
    expect(newestFunction("poster_cancel_job").body).toMatch(/AND NOT v_id_outstanding/);
    expect(code("supabase/functions/create-payment/index.ts")).toMatch(/rpc\("payout_waits_on_identity"/);
    expect(code("supabase/functions/void-cancelled-payments/index.ts")).toMatch(/\|\| noFeeRecorded \? 0 : computeCancellationFee\(job\)/);
    expect(newestFunction("poster_cancel_job").body).toMatch(/INSERT INTO public\.job_cancel_id_waivers/);
    expect(code("supabase/functions/money-reconciliation/index.ts")).toMatch(/\.from\("job_cancel_id_waivers"\)/);
  });

  it("the 16 are restored by the migration: only Stripe's verified, never a test account, no fee touched", () => {
    const m = blankSqlComments(fs.readFileSync(path.join(ROOT, "supabase/migrations/20261031213005_restore_id_members_reset_1027_restated.sql"), "utf8"));
    expect(m).toMatch(/v\.old_value = 'processing' AND v\.new_value = 'verified'/);
    expect(m).toMatch(/p\.is_seed IS NOT TRUE/);
    expect(m).toMatch(/public\.test_accounts ta/);
    expect(m).not.toMatch(/onboarding_fee|idv_attempt_count/);
  });

  it("restoring a verified check needs Stripe's verified for this very member, and starts no new session", () => {
    const start = code("supabase/functions/stripe-idv-start/index.ts");
    expect(start).toMatch(/stored\.status === "verified" && stored\.metadata\?\.user_id === user\.id/);
    expect(start.indexOf("stored.status")).toBeLessThan(start.search(/verificationSessions\.create\s*\(/));
  });

  it("the date of birth is asked for with the key and path Stripe requires", () => {
    const hook = code("supabase/functions/stripe-idv-webhook/index.ts");
    expect(hook).toMatch(/STRIPE_IDENTITY_RESULTS_KEY/);
    expect(hook).toMatch(/"verified_outputs\.dob"/);
  });

  it("no text says the check is free: the setup fee covers it", () => {
    const terms = code("src/pages/info/legal/TermsSection.tsx");
    expect(terms).not.toMatch(/Helpr pays for this check|there is no charge to you/i);
    expect(terms).toMatch(/setup fee covers this check/);
    // The ID paragraph waits for the switch, like Help and Privacy (owner 2026-10-30).
    expect(terms).toMatch(/idOn \? <>\s*<p><strong className="text-foreground">We ask for a photo ID/);
    expect(code("src/components/identity/IdentityCheckSheet.tsx")).not.toMatch(/\bfree\b|no charge/i);
  });

  it("tips wait: every path that opens or takes a tip asks, before any charge", () => {
    for (const [f, before] of [
      ["supabase/functions/create-payment/index.ts", /checkout\.sessions\.create|tipChargeBreakdown\(/],
      ["supabase/functions/auto-tip-charge/index.ts", /paymentIntents\.create/],
      ["supabase/functions/declutter-checkout/index.ts", /tipChargeBreakdown\(/],
    ] as const) {
      const src = code(f);
      const asked = src.search(/const tipIdHold = await checkIdentityHold\(/);
      expect(asked, f).toBeGreaterThan(0);
      expect(src.slice(asked).search(before), `${f}: no charge after the ask`).toBeGreaterThan(0);
    }
  });

  it("the words about the old provider move are gone from the code that stays", () => {
    for (const f of ["src/lib/identityCheckSwitch.ts", "src/lib/identityCheck.ts"]) {
      expect(fs.readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/move to paypal|paypal move/i);
    }
  });
});
