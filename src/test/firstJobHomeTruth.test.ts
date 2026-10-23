/**
 * Board 189 (the first-job Home) states only what is true (truth rule):
 * - "How you get paid" quotes the shared payout and fee constants, never a typed
 *   number of days or percent;
 * - each job's price is the ONE money component (JobPrice with the job's fee stamp);
 * - every checklist step is read from the member's real profile (ID = Stripe
 *   Identity via hasIdBadge; payouts = stripe_payouts_enabled);
 * - the alerts card shows only while job alerts are really off.
 *
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | it reaches your Helpr account {STANDARD_PAYOUT_PHRASE} | it reaches your Helpr account 2 days after the job
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | const payoutsDone = profile?.stripe_payouts_enabled === true \|\| paypal.ready; | const payoutsDone = !!profile?.stripe_account_id \|\| paypal.ready;
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | feeStamp={{ helper_fee_flat_cents: j.helper_fee_flat_cents }} | feeStamp={null}
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx |       {alertsOff && ( |       {true && (
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(join(resolve(__dirname, "..", ".."), "src/pages/home/homeDashboard/FirstJobHome.tsx"), "utf8"));

describe("board 189: the first-job Home says only what is true", () => {
  it("payout copy comes from the shared constants, with no typed day count or fee", () => {
    const paid = src.slice(src.indexOf('aria-label="How you get paid"'));
    expect(paid).toMatch(/\{STANDARD_PAYOUT_PHRASE\}/);
    expect(paid).toMatch(/\{STANDARD_PAYOUT_WINDOW\}/);
    expect(paid).toMatch(/\{HELPR_FLAT_FEE_PHRASE\}/);
    expect(paid.slice(0, paid.indexOf("</section>"))).not.toMatch(/\b\d+\s*(days?|%|business)/);
  });

  it("prices go through JobPrice with the job's own fee stamp", () => {
    expect(src).toMatch(/<JobPrice[\s\S]*?feeStamp=\{\{ helper_fee_flat_cents: j\.helper_fee_flat_cents \}\}/);
  });

  it("steps read the real profile, and the alerts card waits for alerts to be off", () => {
    expect(src).toMatch(/done: hasIdBadge\(profile\?\.idv_status\)/);
    expect(src).toMatch(/const payoutsDone = profile\?\.stripe_payouts_enabled === true;[\s\S]*?done: payoutsDone/);
    expect(src).toMatch(/\{alertsOff && \(/);
    expect(src).toMatch(/prefs\.job_matches === false && prefs\.email_job_matches === false/);
  });
});
