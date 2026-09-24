/**
 * ME-007: TipDialog sent { action: "tip" } with no tipAttemptId, so every tip
 * from it used the server's 10-minute time-bucket key: a deliberate second
 * identical tip inside the bucket silently replayed the first Checkout session,
 * and a retry across the boundary could create two. Every client call that
 * asks create-payment for a tip must carry the per-attempt id.
 *
 * @mutate src/components/TipDialog.tsx | tipAttemptId: tipAttemptIdRef.current, native | native
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : walk(p);
    return /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

const bodies = walk("src").flatMap((f) =>
  [...readFileSync(f, "utf8").matchAll(/body:\s*\{[^{}]*action:\s*"tip"[^{}]*\}/g)].map((m) => ({ f, body: m[0] })),
);

describe("every tip request carries its attempt id (ME-007)", () => {
  it("the inventory is real", () => expect(bodies.length).toBeGreaterThanOrEqual(2));
  it("no tip body falls back to the time-bucket key", () => {
    expect(bodies.filter((b) => !/tipAttemptId:/.test(b.body)).map((b) => b.f)).toEqual([]);
  });
});
