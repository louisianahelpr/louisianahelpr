/**
 * Home's money strip (spec v2 §5.3, boards 7, 11, 51): "Coming to you" and
 * "Held for you", from the Money tab's OWN rules, never a second copy.
 *  - Coming to you = earningsTabHelpers.comingToYou, which EarningsTab now
 *    calls too (the "Approved — reaches your wallet" line): approved jobs whose
 *    transfer has not fired, at take-home less the one-time setup fee once, and
 *    the soonest real payout_scheduled_at.
 *  - Held for you = posterSpend.heldForYou over spentRows(): hired jobs in
 *    escrow, at what the card was charged less refunds and gift-card cover;
 *    never a tip, never a disputed or open job.
 *  - Hidden at $0, while loading, and when a read failed.
 *
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |   const releasing = jobs.filter(isAwaitingTransfer); |   const releasing = jobs.filter(isEarnedJob);
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |   const ahead = dated.filter((d) => Date.parse(d) > now).sort((x, y) => Date.parse(x) - Date.parse(y)); |   const ahead = dated.filter((d) => Date.parse(d) > now).sort((x, y) => Date.parse(y) - Date.parse(x));
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |   const ahead = dated.filter((d) => Date.parse(d) > now).sort( |   const ahead = dated.filter(() => true).sort(
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts | severalDates: days.size > 1 \|\| (dated.length > 0 && dated.length < releasing.length) | severalDates: false
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |     sumHelperTakeHomeDollars(releasing, feeFallbackPercent, firstPayoutFeeDueFrom(releasing, firstPayoutFeeDollars)) * 100, |     sumHelperTakeHomeDollars(releasing, feeFallbackPercent, 0) * 100,
 * @mutate src/lib/posterSpend.ts |     if (!r.job \|\| r.job.payment_status !== "escrow") continue; |     if (!r.job) continue;
 * @mutate src/lib/posterSpend.ts | const HELD_UNTIL_CONFIRM_STATUSES = ["accepted", "in_progress", "revision_requested"] as const; | const HELD_UNTIL_CONFIRM_STATUSES = ["accepted", "in_progress", "revision_requested", "disputed", "open"] as const;
 * @mutate src/lib/posterSpend.ts |     const held = r.cents - r.tipCents - setupFeeCents; |     const held = r.cents - setupFeeCents;
 * @mutate src/lib/posterSpend.ts |     const held = r.cents - r.tipCents - setupFeeCents; |     const held = r.cents - r.tipCents;
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |   if (!hasAccount) return "Add your payout account to get it"; | 
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |   if (c.overdue) return "Approved, not sent yet"; | 
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |   return `Sent ${STANDARD_PAYOUT_PHRASE}`; |   return `Payout ${walletDay(new Date().toISOString())}`;
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx | navigate(money.coming!.hasPayoutAccount \|\| paypal.ready \|\| (setupPaused && !paypal.on) ? "/profile?tab=earnings" : "/profile?tab=payment") | navigate("/profile?tab=earnings")
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |   if (!money.coming && !money.held) return null; |   if (!money.coming && !money.held) return <div data-home-money="empty" />;
 * @mutate src/components/profile/EarningsTab.tsx |   const money = useHomeMoney(user); |   const money = { coming: null, held: null };
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |           label={heldWords(money.held).label} |           label="Held for you"
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { comingToYou } from "@/components/profile/earningsTab/earningsTabHelpers";
import { heldForYou, spentRows, type PosterSpendJob } from "@/lib/posterSpend";
import { HomeMoneyTiles } from "@/pages/home/homeDashboard/HomeMoneyTiles";
// Payout setup OPEN here (owner pause of 2026-10-23 is the `payout_setup` switch):
// this file tests the setup flow itself; the paused state is
// src/components/payouts/payoutSetupPaused.test.tsx.
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));

// Tue Oct 20 2026, noon UTC.
const NOW = Date.parse("2026-10-20T12:00:00Z");
const src = (rel: string) => blankComments(readFileSync(resolve(__dirname, "..", rel), "utf8"));

// A Jobs payout at the viewer's 12% fallback: $50 -> $44; $40 -> $35.20, floored to $35 (Q236).
const earned = (over: Record<string, unknown>) => ({
  id: "e", status: "completed", payment_status: "payout_pending", budget: 50, payout_scheduled_at: "2026-10-23T15:00:00Z", ...over,
});

describe("Coming to you = the Money tab's own rule", () => {
  it("counts approved jobs still awaiting their transfer, takes the setup fee once, and names the SOONEST wallet date", () => {
    const jobs = [
      earned({ id: "a", payout_scheduled_at: "2026-10-24T15:00:00Z" }),
      earned({ id: "b", budget: 40, payout_scheduled_at: "2026-10-23T15:00:00Z" }),
      earned({ id: "paid", payment_status: "released" }),
      earned({ id: "escrow", status: "in_progress", payment_status: "escrow" }),
      earned({ id: "refunded", payment_status: "refunded" }),
    ];
    // $44 + $35, the $2 setup fee off once; two arrival days, so the date is the first.
    expect(comingToYou(jobs, 12, 2, NOW)).toEqual({ cents: 7700, at: "2026-10-23T15:00:00Z", overdue: false, severalDates: true });
    expect(comingToYou(jobs, 12, 0, NOW).cents).toBe(7900);
    expect(comingToYou([earned({})], 12, 0, NOW)).toEqual({ cents: 4400, at: "2026-10-23T15:00:00Z", overdue: false, severalDates: false });
    expect(comingToYou([earned({ payout_scheduled_at: null })], 12, 0, NOW)).toEqual({ cents: 4400, at: null, overdue: false, severalDates: false });
    expect(comingToYou([earned({ payment_status: "released" })], 12, 2, NOW)).toEqual({ cents: 0, at: null, overdue: false, severalDates: false });
  });

  it("a date already passed (no payout account, a payout hold) is never named: overdue, and only a date still ahead is", () => {
    const late = earned({ id: "late", payout_scheduled_at: "2026-10-17T08:18:00Z" });
    expect(comingToYou([late], 12, 0, NOW)).toEqual({ cents: 4400, at: null, overdue: true, severalDates: false });
    expect(comingToYou([late, earned({ id: "next" })], 12, 0, NOW)).toMatchObject({ at: "2026-10-23T15:00:00Z", overdue: true, severalDates: true });
  });

  it("the Money tab shows Home's own tile and Home calls it: the math lives in ONE place", () => {
    // Board 51 (2026-10-20): the Earned card's "Approved" line folded into the tile at the top of
    // the Money tab, so the approved-not-sent money shows once, with one caption.
    const tab = src("components/profile/EarningsTab.tsx");
    expect(tab.length).toBeGreaterThan(5000);
    expect(tab).toContain("const money = useHomeMoney(user);");
    expect(tab).toMatch(/<HomeMoneyTiles\s+money=\{money\}\s+placement="money"/);
    expect(tab).not.toMatch(/filter\(isAwaitingTransfer\)|releasingCents/);
    expect(src("components/profile/earningsTab/EarningsSummaryCard.tsx")).not.toMatch(/Approved — /);
    const home = src("pages/home/homeDashboard/homeMoney.ts");
    expect(home).toMatch(/comingToYou\(earnings\.data\.jobs, pct, firstPayoutFee\)/);
    // The same fee fallback EarningsTab passes: the viewer's own tier.
    expect(home).toMatch(/tierFeePercent\(profile\.subscription_tier \?\? "free", profile\.subscription_expires_at \?\? null\)/);
    expect(home).toMatch(/useProfileEarnings\(uid, !!uid\)/);
  });
});

const posted = (over: Partial<PosterSpendJob & { status: string }>) => ({
  id: "p", status: "accepted", payment_status: "escrow", stripe_payment_intent_id: "pi_1",
  budget: 40, customer_fee_amount: 1.5, urgent_fee: 0, sales_tax_amount: 0, onboarding_fee_amount: 0, ...over,
}) as PosterSpendJob & { status: string };

describe("Held for you = what the card paid for hired jobs that wait on my confirm", () => {
  it("counts accepted, in-progress and sent-back jobs in escrow, at the charge", () => {
    const jobs = [posted({ id: "a" }), posted({ id: "b", status: "in_progress" }), posted({ id: "c", status: "revision_requested" })];
    expect(heldForYou(spentRows(jobs, [], []))).toEqual({ cents: 3 * 4150, jobs: 3 });
  });

  it("never a disputed job, an open job, money already released, or a job with no card charge", () => {
    const jobs = [
      posted({ id: "d", status: "disputed" }),
      posted({ id: "o", status: "open" }),
      posted({ id: "r", status: "completed", payment_status: "payout_pending" }),
      posted({ id: "x", stripe_payment_intent_id: null }),
      // Hired, but the money is already on its way back (a cancel in flight): not held.
      posted({ id: "c", status: "accepted", payment_status: "cancelling" }),
    ];
    expect(heldForYou(spentRows(jobs, [], []))).toEqual({ cents: 0, jobs: 0 });
  });

  it("gift-card cover and refunds come off; a tip (its own charge, paid to the Helpr) is never held", () => {
    const jobs = [posted({ id: "g" })];
    const gifts = [{ job_id: "g", amount: 10 }];
    const refunds = [{ job_id: "g", amount_cents: 500, stripe_payment_intent_id: "pi_1" }];
    const tips = [{ id: "t", job_id: "g", amount: 5, payment_status: "paid", stripe_payment_intent_id: "pi_tip" }];
    // $41.50 charged, $10 of the work paid by gift card, $5 refunded: $26.50 held.
    expect(heldForYou(spentRows(jobs, refunds, gifts, tips))).toEqual({ cents: 2650, jobs: 1 });
  });

  it("the one-time setup fee is never held: it is kept at checkout and no refund returns it (Q1674; lead 2026-10-20)", () => {
    // $40 + $1.50 card fee + $2 setup fee charged; $41.50 waits on the confirm.
    const rows = spentRows([posted({ id: "f", onboarding_fee_amount: 2 })], [], []);
    expect(rows[0].cents).toBe(4350);
    expect(heldForYou(rows)).toEqual({ cents: 4150, jobs: 1 });
  });

  it("Home reads the Spent half's own rows (one read, one key)", () => {
    const home = src("pages/home/homeDashboard/homeMoney.ts");
    expect(home).toMatch(/usePosterSpendData\(uid\)/);
    expect(home).toMatch(/const rows = spentRows\(spend\.data\.jobs, spend\.data\.refunds, spend\.data\.gifts, spend\.data\.tips, spend\.data\.blockFees\);\s*const h = heldForYou\(rows\);\s*const list = heldRows\(rows\);/);
    expect(src("components/profile/earningsTab/SpentSection.tsx")).toMatch(/usePosterSpendData\(user\?\.id\)/);
  });
});

describe("the tiles (boards 7, 11)", () => {
  const show = (money: Parameters<typeof HomeMoneyTiles>[0]["money"]) =>
    render(<MemoryRouter><HomeMoneyTiles money={money} placement="main" /></MemoryRouter>);

  const coming = (over: Partial<NonNullable<Parameters<typeof HomeMoneyTiles>[0]["money"]["coming"]>> = {}) =>
    ({ cents: 9655, at: "2026-10-23T15:00:00Z", overdue: false, severalDates: false, hasPayoutAccount: true, ...over });

  it("both: rust amounts, the real wallet date, the job count", () => {
    show({ coming: coming(), held: { cents: 4000, jobs: 1, only: { title: "Mow two lawns", helper: "Yusef H." } } });
    const comingTile = screen.getByRole("button", { name: /Coming to you/ });
    expect(comingTile.textContent).toContain("$96.55");
    expect(comingTile.textContent).toMatch(/Reaches your wallet Fri, Oct 23/);
    // Owner 2026-10-21: the poster's OWN payment, held for the Helpr; never "Held for you".
    const held = screen.getByRole("button", { name: /^Held for Mow two lawns/ });
    expect(held.textContent).toContain("$40.00");
    expect(held.textContent).toContain("Paid to Yusef H. after you confirm it's done");
    expect(document.body.textContent).not.toMatch(/Held for you/);
    for (const a of document.querySelectorAll("[data-money-amount]")) expect((a as HTMLElement).style.color).toBe("hsl(var(--accent-ink))");
  });

  it("no date on the rows: the rule, never a made-up date; two jobs read plural", () => {
    show({ coming: coming({ cents: 4600, at: null }), held: { cents: 8000, jobs: 2, only: null } });
    expect(screen.getByRole("button", { name: /Coming to you/ }).textContent).toMatch(/Sent \d+ days after the job is approved/);
    expect(screen.getByRole("button", { name: /^Held for 2 jobs/ }).textContent).toContain("Paid to each Helpr after you confirm their job is done");
  });

  it("never a false date: no payout account says so and opens payout setup; a passed date says not sent yet; several days say First", () => {
    const at = (c: ReturnType<typeof coming>) => {
      document.body.innerHTML = "";
      show({ coming: c, held: null });
      return screen.getByRole("button", { name: /Coming to you/ }).textContent ?? "";
    };
    expect(at(coming({ hasPayoutAccount: false, overdue: true, at: null }))).toContain("Add your payout account to get it");
    expect(at(coming({ overdue: true, at: null }))).toContain("Approved, not sent yet");
    expect(at(coming({ overdue: true }))).not.toMatch(/Reaches/);
    expect(at(coming({ severalDates: true }))).toMatch(/First reaches your wallet Fri, Oct 23/);
    expect(src("pages/home/homeDashboard/HomeMoneyTiles.tsx")).toContain('navigate(money.coming!.hasPayoutAccount || setupPaused ? "/profile?tab=earnings" : "/profile?tab=payment")');
  });

  it("a tile with nothing is not drawn, and with nothing at all there is no strip", () => {
    show({ coming: null, held: { cents: 4000, jobs: 1, only: null } });
    expect(screen.queryByRole("button", { name: /Coming to you/ })).toBeNull();
    document.body.innerHTML = "";
    const { container } = show({ coming: null, held: null });
    expect(container.querySelector("[data-home-money]")).toBeNull();
  });

  it("Home places the strip after Next up on phone and atop the right column from 1280 (boards 7, 11)", () => {
    const home = src("pages/home/HomeDashboard.tsx");
    const main = home.indexOf('<HomeMoneyTiles money={money} placement="main" />');
    expect(main).toBeGreaterThan(home.indexOf('data-testid="next-up"'));
    expect(main).toBeLessThan(home.indexOf('<GroupSection title="Coming up">'));
    const side = home.indexOf('<HomeMoneyTiles money={money} placement="side" />');
    expect(side).toBeGreaterThan(home.indexOf("<section data-home-side"));
    expect(side).toBeLessThan(home.indexOf(">Your sections</h2>"));
  });
});
