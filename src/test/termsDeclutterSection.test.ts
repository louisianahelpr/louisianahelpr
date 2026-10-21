/**
 * Q2308 (owner approved the Declutter terms 2026-10-22; source docs/specs/declutter-terms-draft.md): the Terms
 * tab carries a Declutter section, and the numbers it states are the ones the code charges and enforces. Each
 * number is derived HERE from its source (the buyer's fee from src/lib/declutter/money.ts, the photo limits from
 * photoRules.ts, the delivery price, the haul-away wait and limit, and the strike length from the NEWEST effective
 * SQL definitions, comments blanked, any dollar-quote tag), so a change to one side fails here until the other
 * follows. Also: no draft markers or citations leak into the published copy.
 *
 * @mutate src/pages/info/legal/TermsSection.tsx | a buyer&apos;s fee of 5% of the item total + $0.70 | a buyer&apos;s fee of 15% of the item total
 * @mutate src/pages/info/legal/TermsSection.tsx | at least 1 and at most 12 photos | at least 3 and at most 12 photos
 * @mutate src/pages/info/legal/TermsSection.tsx | $10, plus $2 for each road mile, plus $20 for each large item and $40 for each extra-large item | $10, plus $3 for each road mile, plus $20 for each large item and $40 for each extra-large item
 * @mutate src/pages/info/legal/TermsSection.tsx | an item unsold 14 days after | an item unsold 30 days after
 * @mutate src/pages/info/legal/TermsSection.tsx | Up to 10 items from one pickup address | Up to 12 items from one pickup address
 * @mutate src/pages/info/legal/TermsSection.tsx | Each strike lasts 1 year. | Each strike lasts 6 months.
 * @mutate src/pages/info/legal/TermsSection.tsx |       anchorId="declutter" |       anchorId="secondhand"
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

  it("the buyer's fee is the one checkout charges", () => {
    const fixed = checkoutAmounts([0]).premiumCents;
    const pct = (checkoutAmounts([10_000]).premiumCents - fixed) / 100;
    expect(section).toContain(`a buyer&apos;s fee of ${pct}% of the item total + $${(fixed / 100).toFixed(2)}`);
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

  it("no draft marker, citation or HTML comment reaches the published Terms", () => {
    for (const bad of ["OWNER TO CONFIRM", "[OWNER", "<!--", "MASTER-LIST", "docs/specs"]) expect(section).not.toContain(bad);
  });
});
