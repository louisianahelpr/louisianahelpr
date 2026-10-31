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
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | it reaches your Helpr account {STANDARD_PAYOUT_PHRASE} | it reaches your Helpr account 2 days after the job
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | const payoutsDone = profile?.stripe_payouts_enabled === true; | const payoutsDone = !!profile?.stripe_account_id;
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | feeStamp={{ helper_fee_flat_cents: j.helper_fee_flat_cents, helper_fee_percent: j.helper_fee_percent }} | feeStamp={null}
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
});
