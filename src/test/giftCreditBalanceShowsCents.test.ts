/**
 * CLASS GUARD (deep audit 1122 #4): a gift card or credit amount is real money, so it shows its cents.
 *
 * WHAT WAS BROKEN: /profile?tab=gift_card showed a card stored as $20.85 as "$21" (and $41.22 as "$41"):
 * CreditCard.tsx printed `credit.amount` through `formatPrice` from @/lib/format, the WHOLE-DOLLAR formatter
 * meant for budgets a poster typed. The gift card maker's preview did the same to a custom amount ($10.56
 * charged, "$11" on the card), and the server said the same gift's amount with `toFixed(0)` on the Stripe
 * checkout page, in the gift card email and in the recipient's "sent you a $21 credit" notice
 * (lh-money-escrow review of this fix).
 *
 * INVENTORY FROM SOURCE: every tracked non-test .ts/.tsx under src/ and supabase/functions/, comments blanked.
 * An offender is
 *   - a call to the whole-dollar `formatPrice(` / `formatPriceFloor(` from @/lib/format (under any local name; a
 *     file that takes `formatPrice` from the cents-keeping Declutter formatter is exempt for that name), or
 *   - a `.toFixed(0)` (rounds to the dollar),
 * where EITHER the call's argument / line names a gift card or credit value (gift / credit / redeem / voucher /
 * balance) OR the file itself is a gift card or credit file (its path says gift card or credit), because there
 * every amount is a card's. The exact formatters (`formatPriceExact`, Declutter's `formatPrice`, the edge
 * functions' `exactDollars`) are the fix.
 */
// @mutate src/pages/profile/giftCards/CreditCard.tsx | ${formatPriceExact(Number(credit.amount))} | ${formatPrice(Number(credit.amount))}
// @mutate src/pages/profile/giftCards/GiftCardPreview.tsx | `$${formatPriceExact(amount!)}` | `$${formatPrice(amount!)}`
// @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | sent you a ${exactDollars(amountCents)} credit | sent you a $${(amountCents / 100).toFixed(0)} credit
// @mutate supabase/functions/_shared/giftCardEmail.ts |   const amount = exactDollars(opts.amountCents); |   const amount = `$${(opts.amountCents / 100).toFixed(0)}`;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const MONEY_WORDS = /gift|credit|redeem|voucher|balance/i;
const CARD_FILE = /gift.?card|credit/i;
/** Declutter's formatter keeps cents ("$40.50"); a file that imports it under the name formatPrice is fine. */
const CENTS_FORMATPRICE = /import\s*\{[^}]*\bformatPrice\b[^}]*\}\s*from\s*["']@\/lib\/declutter\/(distance|formatPrice)["']/;
const WHOLE_DOLLAR_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/format["']/g;

/** The argument text of every call to `name(` in `code`, by balanced parentheses, with the line it starts on. */
function calls(code: string, name: string): { arg: string; line: string }[] {
  const out: { arg: string; line: string }[] = [];
  const re = new RegExp(`(?<![\\w.$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(`, "g");
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
    }
    const ls = code.lastIndexOf("\n", m.index) + 1;
    const le = code.indexOf("\n", m.index);
    out.push({ arg: code.slice(start, i - 1), line: code.slice(ls, le < 0 ? undefined : le) });
  }
  return out;
}

/** Local names this file calls the whole-dollar formatters by (`formatPrice`, `formatPrice as fmt`, ...). */
function wholeDollarNames(code: string): string[] {
  const names = new Set<string>();
  for (const m of code.matchAll(WHOLE_DOLLAR_IMPORT)) {
    for (const part of m[1].split(",")) {
      const spec = part.trim().match(/^(?:type\s+)?(formatPrice|formatPriceFloor)(?:\s+as\s+(\w+))?$/);
      if (spec) names.add(spec[2] ?? spec[1]);
    }
  }
  // An unimported bare formatPrice( is the whole-dollar one unless Declutter's was imported under that name.
  if (!CENTS_FORMATPRICE.test(code)) names.add("formatPrice");
  names.add("formatPriceFloor");
  return [...names];
}

function wholeDollarCardAmounts(path: string, source: string): string[] {
  const code = blankComments(source);
  const cardFile = CARD_FILE.test(path) && !path.includes("/declutter/");
  const hits: string[] = [];
  for (const name of wholeDollarNames(code)) {
    for (const { arg } of calls(code, name)) {
      if (cardFile || MONEY_WORDS.test(arg)) hits.push(`${path}: ${name}(${arg.trim()})`);
    }
  }
  for (const m of code.matchAll(/\.toFixed\(\s*0\s*\)/g)) {
    const ls = code.lastIndexOf("\n", m.index!) + 1;
    const le = code.indexOf("\n", m.index!);
    const line = code.slice(ls, le < 0 ? undefined : le);
    if (cardFile || MONEY_WORDS.test(line)) hits.push(`${path}: ${line.trim()}`);
  }
  return hits;
}

const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/");
const EDGE = execFileSync("git", ["ls-files", "-z", "--", "supabase/functions"], { encoding: "utf8" }).split("\0").filter(Boolean);
const SOURCES = [...trackedFiles("src"), ...EDGE].filter(isSource).map((f) => ({ f, src: readFileSync(f, "utf8") }));

describe("gift card and credit amounts show their cents (deep audit 1122 #4)", () => {
  it("no gift card or credit amount is rounded to the dollar, in the app or the edge functions", () => {
    const offenders = SOURCES.flatMap(({ f, src }) => wholeDollarCardAmounts(f, src));
    expect(offenders, "use formatPriceExact (app) / exactDollars (edge) for a gift card or credit amount").toEqual([]);
  });

  it("the inventory is real: gift card and credit amounts printed with an exact formatter", () => {
    // CreditCard (the balance), GiftCardPreview, giftChargeSentence, BudgetSection's gift line, CheckoutStep's
    // applied-gift line, PosterCancelFeeLine's gift/card split, and the edge functions' gift messages.
    let exact = 0;
    for (const { f, src } of SOURCES) {
      const code = blankComments(src);
      const cardFile = CARD_FILE.test(f) && !f.includes("/declutter/");
      for (const name of ["formatPriceExact", "exactDollars"]) {
        for (const { arg, line } of calls(code, name)) if (cardFile || MONEY_WORDS.test(arg) || MONEY_WORDS.test(line)) exact++;
      }
    }
    expect(SOURCES.length).toBeGreaterThan(1000);
    expect(exact).toBeGreaterThan(9);
  });

  it("the scanner flags the original bug shapes and passes the fixes", () => {
    const bug = 'import { formatPrice } from "@/lib/format";\nconst x = <p>${formatPrice(Number(credit.amount))}</p>;';
    expect(wholeDollarCardAmounts("src/pages/profile/X.tsx", bug)).toHaveLength(1);
    const aliased = 'import { formatPrice as fmt } from "@/lib/format";\nconst x = fmt(giftAmount);';
    expect(wholeDollarCardAmounts("src/pages/X.tsx", aliased)).toHaveLength(1);
    const inCardFile = 'import { formatPrice } from "@/lib/format";\nconst x = `$${formatPrice(amount!)}`;';
    expect(wholeDollarCardAmounts("src/pages/profile/giftCards/GiftCardPreview.tsx", inCardFile)).toHaveLength(1);
    const edge = "message: `sent you a $${(amountCents / 100).toFixed(0)} credit`,";
    expect(wholeDollarCardAmounts("supabase/functions/stripe-webhook/handlers/x.ts", edge)).toHaveLength(1);
    const declutter = 'import { formatPrice } from "@/lib/declutter/distance";\nconst y = formatPrice(g.amountCents);';
    expect(wholeDollarCardAmounts("src/components/declutter/DeclutterGiftPicker.tsx", declutter)).toEqual([]);
    const budget = 'import { formatPrice } from "@/lib/format";\nconst z = formatPrice(job.budget);';
    expect(wholeDollarCardAmounts("src/pages/jobs/X.tsx", budget)).toEqual([]);
  });
});
