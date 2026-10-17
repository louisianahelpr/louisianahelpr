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
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | you pay the job price and nothing on top. | you pay the job budget plus a service fee that only covers card processing.
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

const answers = FAQ_SECTIONS.flatMap((s) => s.items.map((i) => ({ topic: s.topic, q: i.q, a: i.a })));

// Phrases only the retired fee model used.
const STALE = [
  /service fee/i,
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

  it("the fees answer states the flat fee and the $100 example from the payout constants", () => {
    const fees = answers.find((x) => x.q === "What fees does Helpr charge?");
    expect(fees).toBeTruthy();
    const phrase = `${HELPR_FLAT_FEE_PERCENT}% + $${(HELPR_FLAT_FEE_CENTS / 100).toFixed(2)}`;
    expect(fees!.a).toContain(phrase);
    expect(fees!.a).toContain(`$${(helprFlatTakeHomeCents(10_000) / 100).toFixed(2)}`);
    expect(fees!.a).toContain("nothing on top");
    // Jobs paid for under the old model keep it (they still exist).
    expect(fees!.a).toMatch(/before October 15, 2026 keeps the fee it was paid under/);
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
