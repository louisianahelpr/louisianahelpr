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
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | When you post a job, you pay the job price | Posting a job costs nothing extra: you pay the job budget plus a service fee that only covers card processing
//
// lh-money-escrow review of 7166349cd: the fees answer said "nothing on
// top" (create-payment adds Louisiana sales tax on taxable labor and the
// one-time setup fee on a first funded job), quoted the UNROUNDED $94.30
// (every transfer is floored to the dollar, Q236: $94), and its refund
// sentence left out the kept setup fee.
// Owner 2026-10-25: members never see the fee's rate, name or maths, so the
// fees answer names no Helpr fee, no $100 example and no refund arithmetic.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | When you do a job, every job shows exactly what you will take home before you apply. | When you do a job, Helpr keeps 10% + $0.70 of your pay.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | plus Louisiana sales tax on the labor for taxable job types such as handyman, assembly and the trades. | and nothing on top.
// Delta review (#A): "any sales tax you paid comes back" overstated it: on a
// refund that keeps a fee, tax stays paid on what is kept (owner 10-15).
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | the cancel screen shows exactly what you will get back before you confirm. | you get back what you paid less the card-processing fee Stripe keeps.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | It keeps everything ${TIER_PERKS.pro.name} gives you, moves your head start | It keeps everything ${TIER_PERKS.pro.name} gives you, drops your platform fee to ${TIER_PERKS.plus.platformFeePercent}%, moves your head start
//
// Memberships are off for members (roadmap F4/F4a; feature_switches
// 'memberships' = testers on prod, measured 2026-10-17), so every answer that
// describes a plan or a paid perk must say so in plain words.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | is a membership feature. ${MEMBERSHIPS_PAUSED} For now, every payout goes on the standard schedule. | is a Basic, Pro or Elite membership feature and charges a small percentage fee.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | a: `${MEMBERSHIPS_PAUSED} When they come back: ${TIER_PERKS.plus.name} sits between | a: `${TIER_PERKS.plus.name} sits between
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | a: `${MEMBERSHIPS_PAUSED} No one has a paid membership right now, so there is nothing to cancel. | a: `No one has a paid membership right now, so there is nothing to cancel.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | export const MEMBERSHIPS_PAUSED = "Memberships aren't available right now."; | export const MEMBERSHIPS_PAUSED = "";
import { describe, expect, it } from "vitest";
import { FAQ_SECTIONS, MEMBERSHIPS_PAUSED } from "./helpCenterContent";

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

  it("the fees answer states what a poster pays and names no Helpr fee, rate or refund maths (owner 2026-10-25)", () => {
    const fees = answers.find((x) => x.q === "What fees does Helpr charge?");
    expect(fees).toBeTruthy();
    // What a poster pays besides the job price.
    expect(fees!.a).toMatch(/plus Louisiana sales tax on the labor for taxable job types/);
    expect(fees!.a).toMatch(/first paid job also carries a small one-time account setup fee/);
    expect(fees!.a).not.toMatch(/nothing on top|costs nothing extra/);
    // The Helpr side: the take-home, never the fee.
    expect(fees!.a).toMatch(/every job shows exactly what you will take home before you apply/);
    expect(fees!.a).toMatch(/rounded down to the whole dollar \(tips are paid in full\)/);
    expect(fees!.a).not.toMatch(/\d+%|\$0\.70|on a \$100 job|service fee|card-processing|cancellation fee/);
    // A cancel: the screen shows what comes back, no fee list.
    expect(fees!.a).toMatch(/the cancel screen shows exactly what you will get back before you confirm/);
  });

  it("the membership answer says a plan does not change what you take home, with no fee rate", () => {
    const m = answers.find((x) => x.q === "What does a membership do?");
    expect(m?.a).toMatch(/does not change what you take home/);
    expect(m?.a).not.toMatch(/\d+%|service fee/);
  });

  // Lead 2026-10-25 (item 14): the Terms say "There are no paid memberships
  // right now" (prod: no profile holds a paid tier), so no answer may explain
  // how a membership IS billed or how to cancel one today, as if one could be
  // held. RED on 8ca225a0e3 (both answers did).
  // @mutate src/pages/info/helpCenter/helpCenterContent.ts | There are no paid memberships right now, so nothing is billed for one. | A membership is billed securely through Stripe.
  // @mutate src/pages/info/helpCenter/helpCenterContent.ts | No one has a paid membership right now, so there is nothing to cancel. | Yes — cancel at any time.
  it("while memberships are paused, no answer bills or cancels one as if it could be held", () => {
    const topic = answers.filter((x) => x.topic === "Membership & Billing");
    expect(topic.length).toBeGreaterThan(2);
    const billing = topic.find((x) => /billed/i.test(x.q));
    const cancel = topic.find((x) => /cancel/i.test(x.q));
    expect(billing?.a).toMatch(/There are no paid memberships right now/);
    expect(billing?.a).not.toMatch(/is billed securely/);
    expect(cancel?.a).toMatch(/nothing to cancel/);
    expect(cancel?.a).not.toMatch(/^Yes/);
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
