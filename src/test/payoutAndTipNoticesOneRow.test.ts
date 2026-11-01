/**
 * NOID-15 (Messages and notices, builder list 10-31): the "Payout sent!" and
 * "You received a tip!" notices were typed `payment`, while payout setup,
 * released payouts and held money were `financial_alerts`. So a Helpr's
 * payouts and tips were split across two Settings switches ("Job payments"
 * and "Payments and tips"), and turning off "Payments and tips" still let
 * every "Payout sent!" through. Each kind now sits under ONE row: payouts and
 * tips are `financial_alerts`, and the Job payments row stops claiming them.
 *
 * Reads the senders with comments blanked (blankComments), so a comment that
 * says `type: "financial_alerts"` can't keep this green.
 *
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | type: "financial_alerts", link: "/profile?tab=earnings", | type: "payment", link: "/profile?tab=earnings",
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | type: "financial_alerts", | type: "payment",
 * @mutate supabase/functions/_shared/heldTipRepay.ts | type: "financial_alerts", | type: "payment",
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(p, "utf8"));

/** The `type:` of every insertNotifications/notifications object that carries `title`. */
function typesForTitle(src: string, title: string): string[] {
  const out: string[] = [];
  let at = src.indexOf(`title: "${title}"`);
  while (at !== -1) {
    // The object ends at its "});" (a "}" alone can be a template's ${...}).
    const close = src.indexOf("});", at);
    const body = src.slice(at, close);
    const m = body.match(/type:\s*"([a-z_]+)"/);
    out.push(m ? m[1] : "(none)");
    at = src.indexOf(`title: "${title}"`, at + 1);
  }
  return out;
}

const SENDERS: Array<{ file: string; title: string }> = [
  { file: "supabase/functions/process-scheduled-payouts/index.ts", title: "Payout sent!" },
  { file: "supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts", title: "You received a tip!" },
  { file: "supabase/functions/_shared/heldTipRepay.ts", title: "You received a tip!" },
];

describe("payouts and tips sit under one notice switch (NOID-15)", () => {
  for (const { file, title } of SENDERS) {
    it(`${file}: every "${title}" notice is financial_alerts`, () => {
      const types = typesForTitle(read(file), title);
      expect(types.length).toBeGreaterThan(0);
      expect(types).toEqual(types.map(() => "financial_alerts"));
    });
  }

  it("floor: the three senders are all still found", () => {
    const found = SENDERS.filter(({ file, title }) => typesForTitle(read(file), title).length > 0);
    expect(found.length).toBeGreaterThan(2);
  });
});
