// @mutate src/components/postjob/CheckoutStep.tsx | <span className="text-muted-foreground">Job Budget</span> | <span className="text-muted-foreground">Job Budget</span>{"Your Helpr receives $1 of this"}
/**
 * Owner, 2026-09-24: "On payment break down remove your helpr earns… from this."
 * The poster's Payment Breakdown lists what THEY pay (budget, fee, tax, total).
 * It no longer states what the Helpr receives, in any wording.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "../components/postjob/CheckoutStep.tsx"), "utf8");

describe("checkout Payment Breakdown has no Helpr-pay line", () => {
  it("reads the real breakdown", () => {
    expect(src.length).toBeGreaterThan(10_000);
    expect(src).toContain("Job Budget");
  });
  it("never says what the Helpr receives or earns", () => {
    expect(src.match(/Helprs? (receives?|earns?)\b[^\n]*\$/g) ?? []).toEqual([]);
    expect(src).not.toMatch(/helperTakeHomeDollars/);
  });
});
