/**
 * THE TERMS NAME STRIPE AS THE 1099-K ISSUER AND DISCLOSE THE ONE-TIME SETUP
 * FEE IN THE FEE LIST (owner 2026-10-21, via the lead).
 *
 * 1. The Terms' tax section said "Helpr issues Form 1099-K". Helpr issues none:
 *    Stripe does (the Rules page and the Money page already say so;
 *    rulesTellTheTruthAbout1099). No Terms sentence may name Helpr (or "we")
 *    as the one who issues, sends or files a 1099.
 * 2. The one-time account setup fee (platform_settings.onboarding_fee_cents,
 *    taken from a Helpr's first payout by release-payout /
 *    process-scheduled-payouts, or added to a first post's checkout by
 *    create-payment) was missing from the "Fee model" row, whose "Total
 *    platform take" named only the Helpr fee. The owner kept the fee and asked
 *    for it there. The amount is the live setting (feeLabel), never a literal.
 *
 * Source scan with comments blanked (blankComments), scoped to the Fee model row.
 *
 * @mutate src/pages/info/legal/TermsSection.tsx | <p>Stripe issues <strong className="text-foreground">Form 1099-K</strong> | <p>Helpr issues <strong className="text-foreground">Form 1099-K</strong>
 * @mutate src/pages/info/legal/TermsSection.tsx | A Helpr pays it out of their first payout; | A Helpr pays it once;
 * @mutate src/pages/info/legal/TermsSection.tsx | {feeLabel ? `${feeLabel}, ` : ""}once per account. {idOn | $2, once per account. {idOn
 * @mutate src/pages/info/legal/TermsSection.tsx | the one-time account setup fee and the service fee above. | the service fee above.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const terms = blankComments(
  readFileSync(resolve(__dirname, "../pages/info/legal/TermsSection.tsx"), "utf8"),
);
/** The Terms' visible words: JSX tags dropped, whitespace collapsed. */
function stripTags(src: string): string {
  // Until nothing changes (CodeQL js/incomplete-multi-character-sanitization): one pass can leave a tag behind.
  let out = src;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^>]+>/g, "");
  }
  return out;
}
const words = stripTags(terms).replace(/\s+/g, " ");

function feeModelRow(): string {
  const start = terms.indexOf('title="Fee model"');
  expect(start, "the Terms have a Fee model row").toBeGreaterThan(-1);
  const end = terms.indexOf("<PolicyRowItem", start);
  expect(end).toBeGreaterThan(start);
  return terms.slice(start, end);
}

describe("the Terms name Stripe as the 1099-K issuer", () => {
  it("the tax section says Stripe issues Form 1099-K", () => {
    expect(terms).toContain('<p>Stripe issues <strong className="text-foreground">Form 1099-K</strong> when federal thresholds are met');
  });

  it("no sentence names Helpr or we as the one who issues, sends or files a 1099", () => {
    const mentions = words.match(/[^.]*1099[^.]*/g) ?? [];
    // Inventory floor: the Terms talk about the 1099 in more than one place, so
    // an empty scan (the wrong file, or the words gone) cannot pass silently.
    expect(mentions.length).toBeGreaterThan(1);
    const claims = mentions.filter((s) =>
      /\b(Helpr|[Ww]e)\b[^.]*\b(issues?|sends?|files?|provides?|mails?)\b[^.]*1099/.test(s),
    );
    expect(claims).toEqual([]);
  });
});

describe("the Terms fee list discloses the one-time setup fee from the first payout", () => {
  it("the Fee model row names the fee, the first payout, and that it is charged once", () => {
    const row = feeModelRow();
    const paras = row.match(/<p>/g) ?? [];
    expect(paras.length).toBeGreaterThan(3);
    expect(row).toContain('<strong className="text-foreground">One-time account setup fee:</strong>');
    expect(row).toContain("A Helpr pays it out of their first payout;");
    expect(row).toContain("It is never charged twice.");
    expect(row).toContain("the one-time account setup fee and the service fee above.");
  });

  it("the amount is the live platform setting, never a hard-coded dollar figure", () => {
    const row = feeModelRow();
    const line = row.slice(row.indexOf("One-time account setup fee:"));
    const setupPara = line.slice(0, line.indexOf("</p>"));
    expect(setupPara).toContain("{feeLabel ? `${feeLabel}, ` : \"\"}");
    expect(setupPara).not.toMatch(/\$\d/);
    expect(terms).toContain("const feeLabel = formatFeeLabel(useOnboardingFeeCents());");
  });
});
