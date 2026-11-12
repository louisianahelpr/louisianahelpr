/**
 * Board 189 (the first-job Home) states only what is true (truth rule):
 * - "How you get paid" quotes the shared payout and fee constants, never a typed
 *   number of days or percent;
 * - each job's price is the ONE money component (JobPrice with the job's fee stamp);
 * - every checklist step is read from the member's real profile (payouts =
 *   stripe_payouts_enabled); no "Verify your ID" step: the ID is asked when posting,
 *   when hired or at the first payout, never on a new member's Home (owner 2026-10-30, B49);
 * - the alerts card shows only while job alerts are really off.
 *
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | { days: STANDARD_PAYOUT_DAYS_AFTER_APPROVAL, bankDays: STANDARD_PAYOUT_WINDOW_DAYS } | { days: 2, bankDays: STANDARD_PAYOUT_WINDOW_DAYS }
 * @mutate src/lib/i18n/enHome.ts | it reaches your Helpr account {days} days after the job is approved | it reaches your Helpr account {days} days after approval
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | const payoutsDone = profile?.stripe_payouts_enabled === true; | const payoutsDone = !!profile?.stripe_account_id;
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | feeStamp={{ helper_fee_flat_cents: j.helper_fee_flat_cents, helper_fee_percent: j.helper_fee_percent }} | feeStamp={null}
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx |       {alertsOff && ( |       {true && (
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { enHome } from "@/lib/i18n/enHome";
import { STANDARD_PAYOUT_DAYS_AFTER_APPROVAL, STANDARD_PAYOUT_PHRASE } from "../../supabase/functions/_shared/escrowTiming";
import { STANDARD_PAYOUT_WINDOW, STANDARD_PAYOUT_WINDOW_DAYS } from "@/lib/payoutTiming";

const src = blankComments(readFileSync(join(resolve(__dirname, "..", ".."), "src/pages/home/homeDashboard/FirstJobHome.tsx"), "utf8"));

describe("board 189: the first-job Home says only what is true", () => {
  it("payout copy comes from the shared constants, with no typed day count or fee", () => {
    // F260q: the words live in enHome / esHome; the day counts are passed from the shared constants, and the English
    // sentence filled with them reads the shared phrases word for word.
    const paid = src.slice(src.indexOf('aria-label={tr("home.fj.howPaid")}'));
    expect(paid).toContain('tr("home.fj.paidBody", { days: STANDARD_PAYOUT_DAYS_AFTER_APPROVAL, bankDays: STANDARD_PAYOUT_WINDOW_DAYS })');
    const filled = enHome["home.fj.paidBody"].replace("{days}", String(STANDARD_PAYOUT_DAYS_AFTER_APPROVAL)).replace("{bankDays}", String(STANDARD_PAYOUT_WINDOW_DAYS));
    expect(filled).toContain(`it reaches your Helpr account ${STANDARD_PAYOUT_PHRASE}, and your bank ${STANDARD_PAYOUT_WINDOW} after that.`);
    expect(enHome["home.fj.paidBody"]).not.toMatch(/HELPR_FLAT_FEE|\bfees?\b|\b\d+\s*(days?|%|business)/i);
    // Owner 2026-10-25: no fee rate or name to members.
    expect(paid.slice(0, paid.indexOf("</section>"))).not.toMatch(/HELPR_FLAT_FEE|\bfees?\b/i);
    expect(paid.slice(0, paid.indexOf("</section>"))).not.toMatch(/\b\d+\s*(days?|%|business)/);
  });

  it("prices go through JobPrice with the job's own fee stamp", () => {
    expect(src).toMatch(/<JobPrice[\s\S]*?feeStamp=\{\{ helper_fee_flat_cents: j\.helper_fee_flat_cents, helper_fee_percent: j\.helper_fee_percent \}\}/);
  });

  it("steps read the real profile, and the alerts card waits for alerts to be off", () => {
    expect(src).not.toMatch(/Verify your ID|openIdentityCheck|hasIdBadge/);
    expect(src).toMatch(/const payoutsDone = profile\?\.stripe_payouts_enabled === true;[\s\S]*?done: payoutsDone/);
    expect(src).toMatch(/\{alertsOff && \(/);
    expect(src).toMatch(/prefs\.job_matches === false && prefs\.email_job_matches === false/);
  });

  // AUD31-65 (audit 10-31, Leftovers: first hour): with identity_check on, a new member's "Get your first job" listed
  // "Verify your ID" first and tapping it started the ID check before any hire. Owner rule (memory "ID check timing",
  // restated by the lead 10-31): the ID check happens once, at hire or first payout, never at sign-up, post, buy or
  // list. The checklist has no ID step and opens no ID check.
  it("AUD31-65: the first-job checklist never asks for the ID", () => {
    expect(src).not.toMatch(/Verify your ID/);
    expect(src).not.toMatch(/openIdentityCheck\(/);
    expect(src).toContain('tr("home.fj.skills")');
    expect(enHome["home.fj.skills"]).toBe("Pick what you do");
  });
});
