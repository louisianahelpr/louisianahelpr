/**
 * ME-007: TipDialog sent { action: "tip" } with no tipAttemptId, so every tip
 * from it used the server's 10-minute time-bucket key: a deliberate second
 * identical tip inside the bucket silently replayed the first Checkout session,
 * and a retry across the boundary could create two. Every client call that
 * asks create-payment for a tip must carry the per-attempt id. Since PayPal tips
 * (paypal-tip "create", which refuses a request without one), the inventory is
 * every tip request body in src/lib/tipCheckout.ts and every startTipCheckout
 * call (TipDialog, CompletionPrompts).
 *
 * @mutate src/components/TipDialog.tsx | { jobId, amount: tipAmount, tipAttemptId: tipAttemptIdRef.current, helperId, paypal }, | { jobId, amount: tipAmount, helperId, paypal } as never,
 * @mutate src/lib/tipCheckout.ts | body: { action: "create", jobId: req.jobId, amount, tipAttemptId: req.tipAttemptId, | body: { action: "create", jobId: req.jobId, amount,
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : walk(p);
    return /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

const bodies = walk("src").flatMap((f) => {
  const code = readFileSync(f, "utf8");
  return [
    ...code.matchAll(/body:\s*\{[^{}]*action:\s*"tip"[^{}]*\}/g),
    ...code.matchAll(/invoke\("paypal-tip",\s*\{\s*body:\s*\{[^{}]*action:\s*"create"[^{}]*\}/g),
    ...code.matchAll(/startTipCheckout\(\s*\{[^{}]*\}/g),
  ].map((m) => ({ f, body: m[0] }));
});

describe("every tip request carries its attempt id (ME-007)", () => {
  it("the inventory is real", () => {
    expect(bodies.length).toBeGreaterThanOrEqual(4);
    expect(new Set(bodies.map((b) => b.f.replace(/^.*?src\//, "src/")))).toEqual(new Set(["src/lib/tipCheckout.ts", "src/components/TipDialog.tsx", "src/components/CompletionPrompts.tsx"]));
  });
  it("no tip body falls back to the time-bucket key", () => {
    expect(bodies.filter((b) => !/tipAttemptId:/.test(b.body)).map((b) => b.f)).toEqual([]);
  });
});
