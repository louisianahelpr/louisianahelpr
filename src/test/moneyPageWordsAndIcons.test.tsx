/**
 * Deep audit 11-22 #34: the Money page labelled two different amounts "On its way". The top tile's "On its way" is the
 * approved pay not sent yet (owner F266a, 11-11: "On its way / Waiting for approval / Held in a dispute"); the Wallet
 * card below said "$123.45 on its way · reaches your bank Sun, Nov 23" for a Stripe payout already in transit. And the
 * Wallet's Pending figure wore a loading spinner (Loader2, not spinning), so "$66.00 clearing soon" looked like it was
 * still loading.
 *
 * Fix: the owner's tile name stays; the Wallet's in-transit line says "payout sent · reaches your bank <day>", and
 * Pending wears a clock.
 *
 * CLASS GUARDS: (1) no Wallet sentence reuses the tile's "on its way"; (2) every <Loader2> / <LoaderCircle> in src/
 * spins (animate-spin): a still spinner used as a status icon reads as "loading".
 *
 * @mutate src/components/profile/earningsTab/WalletCard.tsx |   if (onWay) return `payout sent · reaches your bank | if (onWay) return `on its way · reaches your bank
 * @mutate src/components/profile/earningsTab/WalletCard.tsx |             <Clock className="w-3 h-3" |             <Loader2 className="w-3 h-3"
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { availableLine } from "@/components/profile/earningsTab/WalletCard";
import type { StripePayoutData } from "@/components/profile/earningsTab/types";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

describe("deep audit 11-22 #34: one meaning for 'On its way' on the Money page", () => {
  it("a Stripe payout in transit says it was sent, never 'on its way'", () => {
    const arrival = Date.UTC(2026, 10, 22, 18) / 1000;
    const data = {
      payouts_enabled: true,
      payouts: [{ id: "po_1", amount: 12345, currency: "usd", status: "in_transit", arrival_date: arrival, method: "standard", created: arrival - 86400, description: null }],
    } as unknown as StripePayoutData;
    const line = availableLine(data, false);
    expect(line).toBe("payout sent · reaches your bank Sun, Nov 22");
    expect(line).not.toMatch(/on its way/i);
  });

  it("the Wallet card's own words never say 'on its way'", () => {
    const wallet = blankComments(readFileSync(join(process.cwd(), "src/components/profile/earningsTab/WalletCard.tsx"), "utf8"));
    expect(wallet).not.toMatch(/on its way/i);
    expect(wallet).toContain("<Clock ");
  });
});

/** Each `<Loader2 …>` / `<LoaderCircle …>` element's attribute text, up to its closing `>`. */
export function loaderElements(code: string): string[] {
  return [...code.matchAll(/<(?:Loader2|LoaderCircle)\b[^>]*>/g)].map((m) => m[0]);
}

describe("CLASS: a loading spinner always spins", () => {
  it("the parser tells a still spinner from a spinning one", () => {
    expect(loaderElements('<Loader2 className="w-3 h-3" />').every((e) => /animate-spin/.test(e))).toBe(false);
    expect(loaderElements('<Loader2\n  className="w-4 h-4 animate-spin"\n/>').every((e) => /animate-spin/.test(e))).toBe(true);
  });

  it("every <Loader2>/<LoaderCircle> in src/ carries animate-spin", () => {
    const root = process.cwd();
    let n = 0;
    const still: string[] = [];
    for (const f of walkSource([join(root, "src")]).filter((x) => x.endsWith(".tsx") && !/\.test\.tsx$|\/src\/test\//.test(x))) {
      for (const el of loaderElements(blankComments(readFileSync(f, "utf8")))) {
        n++;
        if (!/animate-spin/.test(el)) still.push(`${relative(root, f)}: ${el.slice(0, 80)}`);
      }
    }
    expect(n).toBeGreaterThan(50);
    expect(still).toEqual([]);
  });
});
