/**
 * Audit #55 (lead 2026-10-21): the Rules page said "We send 1099s when
 * thresholds are met". Helpr sends none: Stripe issues the 1099-K. The line now
 * matches the Money page, and the Rules tab's "Updated" moved to the change.
 *
 * @mutate src/pages/info/legal/CommunitySection.tsx | Stripe issues the 1099-K when federal thresholds are met. | We send 1099s when thresholds are met.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LAST_UPDATED } from "@/pages/info/legal/legalSections";

const ROOT = resolve(__dirname, "..", "..");
const rules = readFileSync(join(ROOT, "src/pages/info/legal/CommunitySection.tsx"), "utf8");

describe("the Rules page tells the truth about the 1099", () => {
  it("names Stripe as the issuer and never claims Helpr sends 1099s", () => {
    expect(rules).toContain("Stripe issues the 1099-K when federal thresholds are met.");
    expect(rules).not.toMatch(/We send 1099/);
  });
  it("its Updated date is the month of this change", () => {
    expect(LAST_UPDATED.community).toBe("Oct 2026");
  });
});
