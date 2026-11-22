/**
 * Deep audit 1122 #4: a money amount that must read exactly what it is, gift card and credit amounts above all.
 * Whole dollars when whole ("$25"), cents when there are some ("$20.85"). Never rounded to the dollar: a gift of
 * $20.85 read "$21" on the Stripe page, the gift card email and the recipient's notice. Pure: no Deno, no network.
 */
export function exactDollars(cents: number): string {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  const fraction = c % 100 !== 0;
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: fraction ? 2 : 0, maximumFractionDigits: 2 })}`;
}
