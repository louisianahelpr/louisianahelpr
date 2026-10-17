// Q1842 (lh-money-escrow review of 032657f02, should-fix 4): the Help Center
// still told posters they pay "a service fee that only covers card
// processing" and told Helprs their plan lowers the fee (12% Free down to 8%
// Elite). Since roadmap F3 (owner, 2026-10-14/15) the poster pays the job
// price only and the Helpr pays a flat 5% + $0.70 on every plan. This scans
// EVERY answer on the page (the inventory is the page's own FAQ_SECTIONS), so
// a stale fee sentence anywhere fails, and pins the fees answer to the same
// constants the payout paths price with.
// (The Terms keep the old wording until the owner approves new legal text:
// Q1842's Terms half, ~/.lh-shots/sections-1017/OWNER-MORNING-lead.md item 17.)
//
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | Posting a job has no service fee: you pay the job price | Posting a job costs nothing extra: you pay the job budget plus a service fee that only covers card processing
//
// lh-money-escrow review of 7166349cd: the fees answer said "nothing on
// top" (create-payment adds Louisiana sales tax on taxable labor and the
// one-time setup fee on a first funded job), quoted the UNROUNDED $94.30
// (every transfer is floored to the dollar, Q236: $94), and its refund
// sentence left out the kept setup fee.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | const FLAT_TAKE_HOME_ON_100 = floorPayoutDollars(helprFlatTakeHomeCents(10_000) / 100); | const FLAT_TAKE_HOME_ON_100 = (helprFlatTakeHomeCents(10_000) / 100).toFixed(2);
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | plus Louisiana sales tax on the labor for taxable job types such as handyman, assembly and the trades. | and nothing on top.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | , and, on your first paid job, the one-time setup fee. If the mistake | . If the mistake
// Delta review (#A): "any sales tax you paid comes back" overstated it: on a
// refund that keeps a fee, tax stays paid on what is kept (owner 10-15).
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | you get back what you paid (tax included) less | you get back what you paid less
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | It keeps everything ${TIER_PERKS.pro.name} gives you, moves your head start | It keeps everything ${TIER_PERKS.pro.name} gives you, drops your platform fee to ${TIER_PERKS.plus.platformFeePercent}%, moves your head start
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | const FLAT_FEE_PHRASE = `${HELPR_FLAT_FEE_PERCENT}% + $${(HELPR_FLAT_FEE_CENTS / 100).toFixed(2)}`; | const FLAT_FEE_PHRASE = `${HELPR_FLAT_FEE_PERCENT}%`;
//
// Memberships are off for members (roadmap F4/F4a; feature_switches
// 'memberships' = testers on prod, measured 2026-10-17), so every answer that
// describes a plan or a paid perk must say so in plain words.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | is a membership feature. ${MEMBERSHIPS_PAUSED} For now, every payout goes on the standard schedule. | is a Basic, Pro or Elite membership feature and charges a small percentage fee.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | a: `${MEMBERSHIPS_PAUSED} When they come back: ${TIER_PERKS.plus.name} sits between | a: `${TIER_PERKS.plus.name} sits between
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | a: `Yes — cancel at any time from Profile → Membership → Manage. ${MEMBERSHIPS_PAUSED} While they're off, no plan's paid perks are on.`, | a: "Yes — downgrade at any time. Your paid perks stay active through the end of your billing period, then you revert to Free.",
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | export const MEMBERSHIPS_PAUSED = "Memberships aren't available right now."; | export const MEMBERSHIPS_PAUSED = "";
import { describe, expect, it } from "vitest";
import { FAQ_SECTIONS, MEMBERSHIPS_PAUSED } from "./helpCenterContent";
import { HELPR_FLAT_FEE_CENTS, HELPR_FLAT_FEE_PERCENT, helprFlatTakeHomeCents } from "@/lib/helprFlatFee";
import { floorPayoutDollars } from "@/lib/helperEarnings";

const answers = FAQ_SECTIONS.flatMap((s) => s.items.map((i) => ({ topic: s.topic, q: i.q, a: i.a })));

// Phrases only the retired fee model used.
const STALE = [
  // "has no service fee" is today's wording; any other mention is the old model.
  /(?<!no )service fee/i,
  /platform fee (drops|to \d)/i,
  /lowers? the (commission|platform fee)/i,
  /fee reduction/i,
  /lower platform fee/i,
  /reduced \d+% platform fee/i,
  /keep \d+% on a Free account/i,
];

describe("Help Center describes today's job fee (Q1842)", () => {
  it("no answer names a poster service fee or a plan-based fee discount", () => {
    // Inventory floor: the scan reads the real page.
    expect(answers.length).toBeGreaterThan(20);
    const hits = answers.flatMap((x) =>
      STALE.filter((re) => re.test(`${x.q} ${x.a}`)).map((re) => `${x.topic} / ${x.q}: ${re}`));
    expect(hits).toEqual([]);
  });

  it("the fees answer states the flat fee, the floored $100 example, tax, the setup fee and the refund", () => {
    const fees = answers.find((x) => x.q === "What fees does Helpr charge?");
    expect(fees).toBeTruthy();
    const phrase = `${HELPR_FLAT_FEE_PERCENT}% + $${(HELPR_FLAT_FEE_CENTS / 100).toFixed(2)}`;
    expect(fees!.a).toContain(phrase);
    // What the transfer really pays: floored to the whole dollar (Q236).
    const takeHome = floorPayoutDollars(helprFlatTakeHomeCents(10_000) / 100);
    expect(takeHome).toBe(94);
    expect(fees!.a).toMatch(/tips are paid in full/);
    expect(fees!.a).toContain(`on a $100 job you receive $${takeHome}.`);
    expect(fees!.a).toMatch(/rounded down to the whole dollar/);
    expect(fees!.a).not.toMatch(/\$94\.30|nothing on top|costs nothing extra/);
    // What a poster pays besides the job price.
    expect(fees!.a).toMatch(/plus Louisiana sales tax on the labor for taxable job types/);
    expect(fees!.a).toMatch(/first paid job also carries a small one-time account setup fee/);
    // What a cancel refund keeps (tax included in what was paid).
    expect(fees!.a).toMatch(/you get back what you paid \(tax included\) less the card-processing fee Stripe keeps, any cancellation fees owed to your Helprs \(including for crew spots you closed close to the start\), and, on your first paid job, the one-time setup fee\./);
    // Tax is not promised back whole: tax stays paid on what is kept.
    expect(fees!.a).not.toMatch(/tax you paid comes back/);
    // Jobs paid for under the old model keep it (they still exist).
    expect(fees!.a).toMatch(/before the fee changed on October 15, 2026 keeps the fee it was paid under/);
  });

  it("the membership answer says a plan does not change the job fee", () => {
    const m = answers.find((x) => x.q === "What does a membership do?");
    expect(m?.a).toContain(`${HELPR_FLAT_FEE_PERCENT}% + $${(HELPR_FLAT_FEE_CENTS / 100).toFixed(2)}`);
    expect(m?.a).toMatch(/does not change the fee/);
  });

  it("every answer about a plan or a paid perk says memberships aren't available right now", () => {
    // The app's own words (SubscriptionTab's subscribe toast).
    expect(MEMBERSHIPS_PAUSED).toBe("Memberships aren't available right now.");
    // A paid perk or a plan, named anywhere on the page. The inventory is the
    // page itself: the whole Membership & Billing topic plus any answer
    // elsewhere that names a perk only a plan grants.
    const PERK = /\b(instant payout|job boosts?|head start|priority (placement|support)|crown badge|featured badge|paid perks?|membership)\b/i;
    const perkAnswers = answers.filter((x) => x.topic === "Membership & Billing" || PERK.test(x.a));
    expect(perkAnswers.length).toBeGreaterThan(5);
    // Outside the membership topic too (the payout answer names Instant Payout).
    expect(perkAnswers.some((x) => x.topic !== "Membership & Billing")).toBe(true);
    const missing = perkAnswers
      .filter((x) => !x.a.includes(MEMBERSHIPS_PAUSED))
      .map((x) => `${x.topic} / ${x.q}`);
    expect(missing).toEqual([]);
    // No answer still promises a perk stays on through a billing period.
    expect(answers.filter((x) => /perks stay active/i.test(x.a))).toEqual([]);
  });
});
