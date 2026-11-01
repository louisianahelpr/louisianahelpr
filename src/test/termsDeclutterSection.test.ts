/**
 * Q2308 (owner approved the Declutter terms 2026-10-22; source docs/specs/declutter-terms-draft.md): the Terms
 * tab carries a Declutter section, and the numbers it states are the ones the code charges and enforces. Each
 * number is derived HERE from its source (the photo limits from
 * photoRules.ts, the delivery price, the haul-away wait and limit, and the strike length from the NEWEST effective
 * SQL definitions, comments blanked, any dollar-quote tag), so a change to one side fails here until the other
 * follows. Also: no draft markers or citations leak into the published copy.
 *
 * Owner 2026-10-25, re-confirmed for Declutter 2026-10-27 (issue #3672): members never see a fee number, fee
 * name or fee maths; the Terms keep at most one general sentence, no numbers. So the buyer's fee (derived from
 * src/lib/declutter/money.ts) is pinned ABSENT: no fee sentence in the section carries an amount or a percent,
 * and the one-time account setup fee sentence stays.
 *
 * @mutate src/pages/info/legal/TermsSection.tsx | the item price plus a buyer&apos;s fee, once per checkout | the item price plus a buyer&apos;s fee of 5% of the item total + $0.70, once per checkout
 * @mutate src/pages/info/legal/TermsSection.tsx | everything back, delivery included. | everything back, the $24 delivery fee too.
 * @mutate src/pages/info/legal/TermsSection.tsx | at least 1 and at most 12 photos | at least 3 and at most 12 photos
 * @mutate src/pages/info/legal/TermsSection.tsx | $6, plus $1.50 for each road mile, plus $20 for each large item and $40 for each extra-large item | $6, plus $3 for each road mile, plus $20 for each large item and $40 for each extra-large item
 * @mutate src/pages/info/legal/TermsSection.tsx | an item unsold 14 days after | an item unsold 30 days after
 * @mutate src/pages/info/legal/TermsSection.tsx | Up to 10 items from one pickup address | Up to 12 items from one pickup address
 * @mutate src/pages/info/legal/TermsSection.tsx | Each strike lasts 1 year. | Each strike lasts 6 months.
 * @mutate src/pages/info/legal/TermsSection.tsx |       anchorId="declutter" |       anchorId="secondhand"
 * Q2415 (owner 2026-10-27: list without payout setup; set it up at the first PAID sale, money held until then):
 * @mutate src/pages/info/legal/TermsSection.tsx | Sellers can list without setting up payouts. A seller sets up payouts with Stripe at their first paid sale | Sellers set up payouts with Stripe before their first listing
 * @mutate src/pages/info/legal/TermsSection.tsx | and the sale money is held until that setup is finished. | and the sale money is paid out at once.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkoutAmounts } from "@/lib/declutter/money";
import { DECLUTTER_MAX_PHOTOS, DECLUTTER_MIN_PHOTOS } from "@/lib/declutter/photoRules";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const terms = blankComments(readFileSync(join(REPO, "src/pages/info/legal/TermsSection.tsx"), "utf8"));
const defs = effectiveDefs(join(REPO, "supabase", "migrations"));
const sql = (fn: string): string => {
  const d = defs.get(fn);
  if (!d) throw new Error(`${fn}: no live definition`);
  return blankSqlComments(d.stmt);
};
const dollars = (cents: number) => `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;

/** The Declutter section's own text: from its anchor to the next PolicySection. */
function declutterSection(): string {
  const at = terms.indexOf('anchorId="declutter"');
  if (at < 0) return "";
  const end = terms.indexOf("<PolicySection", at);
  return terms.slice(at, end < 0 ? undefined : end);
}

describe("Q2308: the Terms' Declutter section states the numbers the code enforces", () => {
  const section = declutterSection();

  it("exists, with its rows, and reads real SQL", () => {
    expect(section, 'no PolicySection with anchorId="declutter" in TermsSection.tsx').not.toBe("");
    expect((section.match(/<PolicyRowItem/g) ?? []).length).toBeGreaterThan(10);
    expect(defs.size).toBeGreaterThan(500);
  });

  it("states no fee number: the buyer's fee rule never appears, and no sentence naming a fee carries an amount (issue #3672)", () => {
    const fixed = checkoutAmounts([0]).premiumCents;
    const pct = (checkoutAmounts([10_000]).premiumCents - fixed) / 100;
    expect(fixed).toBeGreaterThan(0);
    expect(pct).toBeGreaterThan(0);
    for (const bad of [`$${(fixed / 100).toFixed(2)}`, `${fixed}¢`, `${fixed} cents`, `${fixed}c `, `${pct}% of the item`, `${pct}% +`, "% +"]) {
      expect(section, `the Declutter Terms state the buyer's fee rule (${bad})`).not.toContain(bad);
    }
    // Every sentence that names a fee or a charge is free of amounts and percents.
    const text = section.replace(/<[^>]*>/g, " ").replace(/&apos;/g, "'").replace(/\s+/g, " ");
    const sentences = text.split(/(?<=[.;:])\s+/).filter((s) => /\bfees?\b|card cost|charge/i.test(s));
    expect(sentences.length).toBeGreaterThan(2);
    expect(sentences.filter((s) => /\$\d|\d\s*%|\d\s*¢|\d+ cents/.test(s))).toEqual([]);
    // The one fee a member may see stays, without a number here.
    expect(section).toContain("The one-time account setup fee is charged once per account");
  });

  it("the photo limits are the sell flow's", () => {
    expect(section).toContain(`at least ${DECLUTTER_MIN_PHOTOS} and at most ${DECLUTTER_MAX_PHOTOS} photos`);
  });

  it("the Helpr delivery price is the newest declutter_delivery_price_cents", () => {
    const body = sql("declutter_delivery_price_cents");
    const base = body.match(/SELECT\s+(\d+)\s*\+\s*(\d+)\s*\*/i);
    const size = body.match(/'large'\s+THEN\s+(\d+)\s+WHEN\s+'xl'\s+THEN\s+(\d+)/i);
    expect(base && size, "delivery price shape changed").toBeTruthy();
    const [b, m] = [Number(base![1]), Number(base![2])];
    const [l, x] = [Number(size![1]), Number(size![2])];
    expect(section).toContain(
      `${dollars(b)}, plus ${dollars(m)} for each road mile, plus ${dollars(l)} for each large item and ${dollars(x)} for each extra-large item`,
    );
  });

  it("the haul-away wait and trip limit are the newest declutter_link_haul_away's", () => {
    const body = sql("declutter_link_haul_away");
    const days = body.match(/interval\s+'(\d+)\s+days'/i);
    const max = body.match(/cardinality\([^)]*\)\s*>\s*(\d+)/i);
    expect(days && max, "haul-away shape changed").toBeTruthy();
    expect(section).toContain(`an item unsold ${days![1]} days after`);
    expect(section).toContain(`Up to ${max![1]} items from one pickup address`);
  });

  it("a Declutter strike lasts what declutter_strike_expiry sets", () => {
    const m = sql("declutter_strike_expiry").match(/interval\s+'(\d+)\s+year'/i);
    expect(m, "strike expiry shape changed").toBeTruthy();
    expect(section).toContain(`Each strike lasts ${m![1]} year.`);
  });

  // Q2415: the built rule (payout_after_hire, owner 2026-10-27) lets a seller list with no payout account; the
  // money from a paid sale waits as 'no_account' until setup. The Terms must say exactly that, and the listing
  // RPCs must still not read the payout account (if a listing gate comes back, this sentence must change).
  it("payout setup comes at the first paid sale, not before the first listing (Q2415)", () => {
    expect(section).not.toMatch(/before (their|your) first listing/i);
    expect(section).toContain("Sellers can list without setting up payouts.");
    expect(section).toContain("sets up payouts with Stripe at their first paid sale");
    expect(section).toContain("the sale money is held until that setup is finished.");
    for (const fn of ["declutter_publish_item", "declutter_create_item"]) {
      expect(sql(fn), `${fn} gates a listing on the payout account`).not.toMatch(/stripe_account_id|stripe_payouts_enabled|payouts_enabled/);
    }
  });

  it("no draft marker, citation or HTML comment reaches the published Terms", () => {
    for (const bad of ["OWNER TO CONFIRM", "[OWNER", "<!--", "MASTER-LIST", "docs/specs"]) expect(section).not.toContain(bad);
  });
});
