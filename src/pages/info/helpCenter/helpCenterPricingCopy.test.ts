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
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | plus Louisiana sales tax on the labor for taxable job types (auto and appliance repair). | and nothing on top.
// Delta review (#A): "any sales tax you paid comes back" overstated it: on a
// refund that keeps a fee, tax stays paid on what is kept (owner 10-15).
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | the cancel screen shows exactly what you will get back before you confirm. | you get back what you paid less the card-processing fee Stripe keeps.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts |  Every payout goes on the standard schedule.` |  Every payout goes on the standard schedule. Elite drops your platform fee to 8%.`
//
// Memberships are RETIRED (owner 2026-11-04): no answer names a plan, a tier or
// a paid perk at all, and the Membership & Billing topic is gone.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts |     topic: "Declutter", |     topic: "Membership & Billing", items: [{ q: "What does a membership do?", a: "Elite adds a crown badge." }] }, { topic: "Declutter",
// @mutate src/pages/info/helpCenter/helpCenterContent.ts |  Every payout goes on the standard schedule.` |  Instant Payout is a membership feature.`
// Q1834 (2026-11-04): the owner removed suggested prices from Post a job on
// 2026-10-08 (BudgetSection.tsx) and the range table had no caller, so no
// answer may still promise a suggested price or range.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | a: "You set the price. Pick what the job is worth to you.", | a: "You set the price. We suggest a typical range for the category, and you can take the suggested amount in one tap.",
import { describe, expect, it } from "vitest";
import { FAQ_SECTIONS } from "./helpCenterContent";

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

  it("memberships are retired: no topic, question or answer names a plan, a tier or a paid perk (owner 2026-11-04)", () => {
    // Inventory floor: the page still has its topics and answers.
    expect(FAQ_SECTIONS.length).toBeGreaterThan(5);
    expect(answers.length).toBeGreaterThan(20);
    const PLAN = /\b(memberships?|subscriptions?|Pro|Plus|Elite|Basic|instant payout|paid perks?|crown badge|featured badge|head start|priority (placement|support))\b/;
    const hits = [
      ...FAQ_SECTIONS.filter((s) => PLAN.test(s.topic)).map((s) => `topic: ${s.topic}`),
      ...answers.filter((x) => PLAN.test(x.q) || PLAN.test(x.a)).map((x) => `${x.topic} / ${x.q}`),
    ];
    expect(hits).toEqual([]);
  });
});

describe("no answer promises a suggested job price (Q1834)", () => {
  it("the help center never says it suggests a price or a range", () => {
    expect(answers.length).toBeGreaterThan(20);
    const promising = answers.filter((x) => /\bsuggest(ed|s)?\b[^.]*\b(price|range|amount)\b|\btypical range\b/i.test(x.a));
    expect(promising.map((x) => x.q)).toEqual([]);
  });
});
