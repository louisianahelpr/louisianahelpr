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
import { describe, expect, it } from "vitest";
import { FAQ_SECTIONS } from "./helpCenterContent";
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
});
