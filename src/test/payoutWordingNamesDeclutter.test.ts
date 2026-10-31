/**
 * AUD31-56 (audit 10-31, Money): payout wording named only jobs, though the same bank also gets Declutter sales and
 * delivery pay: the "Payout account verified" notice ("receive payments for completed jobs", sent from both writers,
 * accountUpdated.ts and connectGateSync.ts) and Money's bank card ("when jobs are completed"). Each now names all three.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | You can now get paid for jobs, Declutter sales and deliveries. | You can now receive payments for completed jobs.
 * @mutate supabase/functions/_shared/connectGateSync.ts | You can now get paid for jobs, Declutter sales and deliveries. | You can now receive payments for completed jobs.
 * @mutate src/components/PayoutSetupForm.tsx | when a job, a Declutter sale or a delivery is done. | when jobs are completed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const SITES = [
  "supabase/functions/stripe-webhook/handlers/accountUpdated.ts",
  "supabase/functions/_shared/connectGateSync.ts",
  "src/components/PayoutSetupForm.tsx",
];

describe("AUD31-56: payout wording names everything the bank is paid for", () => {
  it("no site says payouts are for jobs only", () => {
    for (const f of SITES) {
      const src = code(f);
      expect(src.length, f).toBeGreaterThan(1000);
      expect(src, f).not.toMatch(/payments for completed jobs|when jobs are completed/);
    }
  });

  it("both senders of 'Payout account verified' say the same words, naming Declutter sales and deliveries", () => {
    const words = SITES.slice(0, 2).map((f) => /"Your payout account is fully set up! ([^"]+)"/.exec(code(f))?.[1]);
    expect(words[0]).toBe("You can now get paid for jobs, Declutter sales and deliveries.");
    expect(words[1]).toBe(words[0]);
    expect(code(SITES[2])).toContain("when a job, a Declutter sale or a delivery is done.");
  });
});
