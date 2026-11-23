/**
 * CLASS GUARD — H2, owner pop-up 2026-11-22 ~10:25 AM, "One number, small label":
 * a Helpr sees only what they get, with a small grey "after fees" note, the same on
 * every screen; the job's posted price shows only to the person who posted it.
 *
 * Before this, the take-home stood alone (owner 11-01 "Remove you take home"), so a
 * Helpr saw $59 on the Browse card and $156 on the job page with no visible word
 * (whole-app audit 1123 H2, repeat of 1122 #2 High), and the apply sheet's job card
 * still printed the poster's price beside the take-home: two numbers.
 *
 * Inventory from source:
 *  1. SURFACES: every Helpr take-home surface named by the audit renders the ONE
 *     shared AfterFeesNote (src/components/job/AfterFeesNote.tsx), never its own words.
 *  2. Class: every file outside the exempt list that tells a screen reader "Your pay"
 *     (the marker of a Helpr take-home figure since 11-01) renders AfterFeesNote too,
 *     so a new take-home surface cannot ship bare.
 *  3. The note itself: the words "after fees", small (text-ds-11), grey (muted).
 *  4. The apply sheet's job card names no price (the posted price is the poster's).
 *  5. Search: the row's note follows the same rule as the price (take-home only).
 *
 * @mutate src/pages/jobs/AppliedJobCard.tsx |             moneyNote={isGiveawayFixedPayJob(job) ? null : <AfterFeesNote />} |             moneyNote={null}
 * @mutate src/components/dashboard/CompactJobCard.tsx |           {isNet && !isGiveawayFixedPayJob(job) && <AfterFeesNote inline />} |           {null}
 * @mutate src/pages/search/SearchPage.tsx |           priceNote={searchJobPriceIsTakeHome(j, user?.id ?? null) ? <AfterFeesNote /> : null} |           priceNote={null}
 * @mutate src/pages/search/searchJobPrice.ts |   if (viewerId && job.customer_id === viewerId) return false; |   if (false) return false;
 * @mutate src/components/job-card/MineJobFace.tsx |                   {moneyNote} |                   {null}
 * @mutate src/components/messages/chatView/DealCard.tsx |       {!isGiveawayFixedPayJob(job) && <AfterFeesNote />} |       {null}
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |       {!fixedPay && <AfterFeesNote />} |       {null}
 * @mutate src/components/job/AfterFeesNote.tsx | export const AFTER_FEES_WORDS = "after fees"; | export const AFTER_FEES_WORDS = "You take home";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";
import { searchJobPriceIsTakeHome, type PricedJobHit } from "@/pages/search/searchJobPrice";

const ROOT = resolve(__dirname, "../..");
const code = (file: string) => blankComments(readFileSync(resolve(ROOT, file), "utf8"));

/** Each Helpr take-home surface and the rendered note it must carry. */
const SURFACES: Record<string, { what: string; renders: RegExp }> = {
  "src/components/dashboard/JobPrice.tsx": { what: "Browse card chip + job pop-up price", renders: /!showBudget && !isGiveawayFixedPayJob\(feeStamp\) && <AfterFeesNote \/>/g },
  "src/components/dashboard/helprTakeHome.tsx": { what: "JobPriceTakeHome (pop-up title row, Application sent)", renders: /<AfterFeesNote\b[^>]*\/>/g },
  "src/pages/jobs/jobPage/JobPageParts.tsx": { what: "job page HelprPrice", renders: /!fixedPay && <AfterFeesNote \/>/g },
  "src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx": { what: "apply sheet take-home", renders: /<AfterFeesNote \/>/g },
  "src/components/messages/chatView/DealCard.tsx": { what: "chat deal card", renders: /<AfterFeesNote \/>/g },
  "src/components/dashboard/CompactJobCard.tsx": { what: "compact Browse row", renders: /isNet && !isGiveawayFixedPayJob\(job\) && <AfterFeesNote inline \/>/g },
  "src/pages/jobs/AppliedJobCard.tsx": { what: "Working / Applied card face", renders: /moneyNote=\{isGiveawayFixedPayJob\(job\) \? null : <AfterFeesNote \/>\}/g },
  "src/components/job-card/MineJobFace.tsx": { what: "the face that draws AppliedJobCard's money", renders: /\{moneyNote\}/g },
  "src/pages/search/SearchPage.tsx": { what: "Search job row", renders: /priceNote=\{searchJobPriceIsTakeHome\([^)]*\) \? <AfterFeesNote \/> : null\}/g },
};

/** Files that say "Your pay" to a screen reader but are not a job take-home. Exact. */
const EXEMPT: Record<string, string> = {
  "src/components/declutter/DeclutterDeliveryViews.tsx": "Declutter delivery pay (take_home_cents from the server), not a job's posted price; not in the 11-22 decision's job scope",
};

describe("Helpr pay: one number, small \"after fees\" label (owner 2026-11-22)", () => {
  it("every named take-home surface renders the shared AfterFeesNote", () => {
    const missing: string[] = [];
    for (const [file, { what, renders }] of Object.entries(SURFACES)) {
      const n = (code(file).match(renders) ?? []).length;
      if (n < 1) missing.push(`${file} (${what})`);
    }
    expect(missing).toEqual([]);
    expect(Object.keys(SURFACES).length).toBeGreaterThan(8);
  });

  it("no new Helpr take-home ships bare: every \"Your pay\" file renders AfterFeesNote", () => {
    const files = walkSource([resolve(ROOT, "src")])
      .map((f) => relative(ROOT, f))
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"));
    const sayYourPay = files.filter((f) => /sr-only">Your pay\b/.test(code(f)));
    expect(sayYourPay.length).toBeGreaterThan(3);
    const bare = sayYourPay.filter((f) => !EXEMPT[f] && !/<AfterFeesNote\b/.test(code(f)));
    expect(bare).toEqual([]);
    // EXEMPT is exact both ways: an entry that no longer says "Your pay", or now carries the note, comes off.
    const stale = Object.keys(EXEMPT).filter((f) => !sayYourPay.includes(f) || /<AfterFeesNote\b/.test(code(f)));
    expect(stale).toEqual([]);
  });

  it("the note is the words \"after fees\", small and grey, in one place", () => {
    const note = code("src/components/job/AfterFeesNote.tsx");
    expect(note).toMatch(/export const AFTER_FEES_WORDS = "after fees";/);
    expect(note).toMatch(/text-ds-11/);
    expect(note).toMatch(/text-muted-foreground/);
    expect(note).toMatch(/\{AFTER_FEES_WORDS\}/);
  });

  it("the apply sheet's job card names no price (the posted price is the poster's)", () => {
    const src = code("src/components/dashboard/ApplyConfirmDialog.tsx");
    const card = src.slice(src.indexOf("function ApplyJobSummary"), src.indexOf("\n}\n", src.indexOf("function ApplyJobSummary")));
    expect(card.length).toBeGreaterThan(100);
    expect(card).not.toMatch(/budget|\$\$\{|applySheetPrice/);
  });

  it("Search: the note shows only beside a take-home, never the poster's own price, a quote or the giveaway", () => {
    const base: PricedJobHit = { budget: 100, pricing_mode: "fixed", urgent_fee: 0, is_group_job: false, helpers_needed: 1, customer_id: "poster" } as PricedJobHit;
    expect(searchJobPriceIsTakeHome(base, "helpr")).toBe(true);
    expect(searchJobPriceIsTakeHome(base, null)).toBe(true);
    expect(searchJobPriceIsTakeHome(base, "poster")).toBe(false);
    expect(searchJobPriceIsTakeHome({ ...base, pricing_mode: "quote" }, "helpr")).toBe(false);
    expect(searchJobPriceIsTakeHome({ ...base, budget: 0 }, "helpr")).toBe(false);
    expect(searchJobPriceIsTakeHome({ ...base, budget: 60, helper_fee_percent: 5, helper_fee_flat_cents: 700 } as PricedJobHit, "helpr")).toBe(false);
    expect(searchJobPriceIsTakeHome({ ...base, budget: 60, helper_fee_percent: 5, helper_fee_flat_cents: 70 } as PricedJobHit, "helpr")).toBe(true);
  });
});
