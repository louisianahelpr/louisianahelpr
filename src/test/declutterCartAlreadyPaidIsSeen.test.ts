/**
 * LEAD-TOAST (lead 10-31): Pay in the Declutter cart, on an order the server says is already paid, told the buyer
 * with toast.success("This order is already paid."). toast.success renders NOTHING (src/lib/toastPolicy.ts swallows
 * success/info/message without an action), so the tap looked dead. The line must go through a channel that renders:
 * the bare toast() callable (or error/warning).
 *
 * Read from source, comments blanked: the exact call site in DeclutterTradeViews.tsx.
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |               toast("This order is already paid."); |               toast.success("This order is already paid.");
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const src = blankComments(readFileSync(resolve(ROOT, "src/components/declutter/DeclutterTradeViews.tsx"), "utf8"));

describe("Cart Pay on an already-paid order says so where the buyer can see it", () => {
  it("reads the real cart source (the Pay handler is there)", () => {
    expect(src).toMatch(/startCheckoutPayment\(/);
    expect(src.length).toBeGreaterThan(5000);
  });

  it("the already-paid line goes through a toast channel that renders", () => {
    const calls = [...src.matchAll(/\btoast(\.[a-z]+)?\(\s*"This order is already paid\."/g)];
    expect(calls.length).toBe(1);
    const channel = calls[0][1] ?? "";
    expect(["", ".error", ".warning"]).toContain(channel);
  });
});
