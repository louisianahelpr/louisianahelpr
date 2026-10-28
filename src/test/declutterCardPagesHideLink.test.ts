/**
 * Every card-only Declutter Stripe page hides Link (audit 2026-10-28 #22).
 *
 * The deep audit (~/.lh-shots/declutter-deep-audit-1028, shots 23 and 37)
 * found the card-saving page and the pay page showing a green Link button and
 * a PRE-TICKED "Save my information with Link" box that then demanded a phone
 * number, although each session named `payment_method_types: ["card"]` only.
 * Stripe folds Link into card unless the session says
 * `wallet_options: { link: { display: "never" } }` (Checkout Session API,
 * stripe-node 18.5.0 types: Checkout.SessionCreateParams.WalletOptions).
 *
 * Inventory from source: every `checkout.sessions.create(` in every
 * supabase/functions/declutter-* function, comments blanked. Each one that
 * names `["card"]` alone must set the Link display to "never". The delivery
 * tip session names TIP_PAYMENT_METHOD_TYPES (card + Link on purpose, Q383)
 * and is not card-only, so it is outside this class.
 *
 * @mutate supabase/functions/declutter-card/index.ts |       wallet_options: { link: { display: "never" } },\n      client_reference_id: user.id, |       client_reference_id: user.id,
 * @mutate supabase/functions/declutter-checkout/index.ts |       wallet_options: { link: { display: "never" } },\n      // One line, the raise |       // One line, the raise
 * @mutate supabase/functions/declutter-checkout/index.ts |       wallet_options: { link: { display: "never" } },\n      line_items: lineItems, |       line_items: lineItems,
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FUNCTIONS = "supabase/functions";
const CREATE = "checkout.sessions.create(";

/** The argument text of every `checkout.sessions.create(` call, balanced on parens outside strings. */
function checkoutCalls(src: string): string[] {
  const out: string[] = [];
  for (let at = src.indexOf(CREATE); at !== -1; at = src.indexOf(CREATE, at + 1)) {
    let depth = 0;
    let quote: string | null = null;
    let i = at + CREATE.length - 1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === "\\") { i++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) break;
    }
    out.push(src.slice(at, i + 1));
  }
  return out;
}

const sessions: { file: string; call: string }[] = [];
for (const dir of readdirSync(FUNCTIONS)) {
  if (!dir.startsWith("declutter-")) continue;
  const file = join(FUNCTIONS, dir, "index.ts");
  if (!existsSync(file)) continue;
  for (const call of checkoutCalls(blankComments(readFileSync(file, "utf8")))) sessions.push({ file, call });
}
const cardOnly = sessions.filter(({ call }) => /\bpayment_method_types:\s*\[\s*"card"\s*\]/.test(call));

describe("card-only Declutter Stripe pages hide Link (audit 2026-10-28 #22)", () => {
  it("finds the card-saving page, the pay page and the raise page", () => {
    // FLOOR: declutter-card (setup) + declutter-checkout order and raise sessions.
    expect(cardOnly.length).toBeGreaterThan(2);
    expect(cardOnly.map((s) => s.file).sort()).toEqual([
      "supabase/functions/declutter-card/index.ts",
      "supabase/functions/declutter-checkout/index.ts",
      "supabase/functions/declutter-checkout/index.ts",
    ]);
  });

  it("each card-only session sets wallet_options.link.display to never", () => {
    for (const { file, call } of cardOnly) {
      expect(call, `${file}: ${call.slice(0, 120)}`).toMatch(/\bwallet_options:\s*\{\s*link:\s*\{\s*display:\s*"never"\s*\}\s*\}/);
    }
  });
});
