/**
 * Owner 2026-10-30, on the "GIVE AWAY!!" job: "remove You take home". On that one
 * job the figure stands alone at $50, with no setup-fee line; "You take home"
 * stays on every other job (owner rule 2026-10-25). Mounts the real components.
 *
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |         : !fixedPay && <p className="mt-1 text-ds-12 font-semibold text-muted-foreground">You take home</p>} |         : <p className="mt-1 text-ds-12 font-semibold text-muted-foreground">You take home</p>}
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |     firstPayoutFee > 0 && !disputed && !fixedPay ? setupFeeWords(firstPayoutFee) : null, |     firstPayoutFee > 0 && !disputed ? setupFeeWords(firstPayoutFee) : null,
 * @mutate src/components/dashboard/helprTakeHome.tsx |       {!fixedPay && "You take home "}<span className="font-semibold |       {"You take home "}<span className="font-semibold
 * @mutate src/components/dashboard/helprTakeHome.tsx |         {!fixedPay && <span className="sr-only">You take home </span>}${formatPriceFloor(net)} |         <span className="sr-only">You take home </span>${formatPriceFloor(net)}
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx |       {!isGiveawayFixedPayJob(confirmApplyJob) && ( |       {true && (
 * @mutate src/components/messages/chatView/DealCard.tsx |       {!isGiveawayFixedPayJob(job) && <p className="font-sans text-ds-11 text-muted-foreground">you take home</p>} |       <p className="font-sans text-ds-11 text-muted-foreground">you take home</p>
 * @mutate src/pages/tips/TipMoment.tsx | isGiveawayFixedPayJob(job) ? "Job" : "Job, you take home" | "Job, you take home"
 * @mutate src/components/dashboard/CompactJobCard.tsx | isNet && !isGiveawayFixedPayJob(job) ? "you earn " | isNet ? "you earn "
 * @mutate src/components/profile/ScheduleTab.tsx |   const amountTitle = isPosted ? "Your budget for this job" : fixedPay ? undefined : |   const amountTitle = isPosted ? "Your budget for this job" :
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { EnrichedJob } from "@/components/dashboard/types";
import { ApplyEarningsBreakdown } from "./applyConfirmDialog/ApplyEarningsBreakdown";
import { JobPriceTakeHome, type TakeHomeJob } from "./helprTakeHome";
import { HelprPrice, HelprMoneyNotes } from "@/pages/jobs/jobPage/JobPageParts";
import { blankComments } from "@/test/helpers/blankNonCode";

const owed = vi.hoisted(() => ({ cents: 200 }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({
  useFirstPayoutFeeCents: () => owed.cents,
  useFirstPayoutFeeDollars: () => owed.cents / 100,
  useFirstPayoutFeeKnown: () => true,
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: { subscription_tier: "free", onboarding_fee_paid: false } }) }));

const base = { id: "j", title: "t", budget: 60, urgent_fee: 0, is_group_job: false, helpers_needed: 1, status: "open", helper_fee_percent: 5 };
const giveaway = { ...base, helper_fee_flat_cents: 700 };
const ordinary = { ...base, helper_fee_flat_cents: 70 };
const WORDS = /take[\s-]?home/i;

function textOf(ui: React.ReactElement): string {
  const { container } = render(<MemoryRouter>{ui}</MemoryRouter>);
  const text = container.textContent ?? "";
  cleanup();
  return text;
}

describe("the giveaway shows $50 with no words; every other job keeps them", () => {
  beforeEach(() => { owed.cents = 200; });
  afterEach(cleanup);

  const surfaces: Array<[string, (j: typeof giveaway) => React.ReactElement]> = [
    ["the job page's amount and notes", (j) => <><HelprPrice job={j as never} /><HelprMoneyNotes job={j as never} hired={false} /></>],
    ["the sentence (quick view, Application sent)", (j) => <JobPriceTakeHome job={j as TakeHomeJob} after=", paid once it's confirmed done" />],
    ["the bare figure (job sheet)", (j) => <JobPriceTakeHome job={j as TakeHomeJob} bare />],
    ["the apply sheet", (j) => <ApplyEarningsBreakdown confirmApplyJob={j as unknown as EnrichedJob} platformFee={12} />],
  ];

  for (const [name, ui] of surfaces) {
    it(`${name}: $50 and no words on the giveaway, even with the setup fee owed`, () => {
      const text = textOf(ui(giveaway));
      // Floor: the surface rendered (an empty render has none of the words either).
      expect(text.length).toBeGreaterThan(2);
      expect(text).toContain("$50");
      expect(text).not.toMatch(WORDS);
      expect(text).not.toMatch(/setup fee/i);
      expect(text).not.toContain("$48");
    });

    it(`${name}: an ordinary job keeps its words and its $54`, () => {
      const text = textOf(ui(ordinary));
      expect(text).toContain("$54");
      expect(text).toMatch(WORDS);
    });
  }

  it("the chat's job card, the tip screen and the schedule's title drop their words on the giveaway (source: both need a full conversation or schedule to mount)", () => {
    const root = resolve(__dirname, "../../..");
    const deal = blankComments(readFileSync(resolve(root, "src/components/messages/chatView/DealCard.tsx"), "utf8"));
    expect(deal).toContain('{!isGiveawayFixedPayJob(job) && <p className="font-sans text-ds-11 text-muted-foreground">you take home</p>}');
    const tip = blankComments(readFileSync(resolve(root, "src/pages/tips/TipMoment.tsx"), "utf8"));
    expect(tip).toContain('isGiveawayFixedPayJob(job) ? "Job" : "Job, you take home"');
    const compact = blankComments(readFileSync(resolve(root, "src/components/dashboard/CompactJobCard.tsx"), "utf8"));
    expect(compact).toContain('isNet && !isGiveawayFixedPayJob(job) ? "you earn "');
    const schedule = blankComments(readFileSync(resolve(root, "src/components/profile/ScheduleTab.tsx"), "utf8"));
    expect(schedule).toContain('const amountTitle = isPosted ? "Your budget for this job" : fixedPay ? undefined :');
  });
});
