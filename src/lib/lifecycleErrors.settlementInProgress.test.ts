/**
 * `dispute_settlement_in_progress` (migration 20260915034822, rpc_withdraw_dispute
 * and rpc_decide_dispute) is a DESIGNED refusal: an admin settlement holds the
 * escrow for a few minutes. The withdraw buttons used to toast "please try
 * again" and report every refusal to Sentry as a defect (round-4 review, LOW).
 *
 * The inventory half is derived from source: every file that calls
 * `rpc("rpc_withdraw_dispute"` must route the refusal through
 * `isExpectedLifecycleRefusal` so it is shown, not reported.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as lifecycle from "./lifecycleErrors";

const PG_ERROR = { code: "P0001", message: "dispute_settlement_in_progress", details: null, hint: "An admin is settling…" };

describe("dispute_settlement_in_progress is a designed refusal", () => {
  it("maps to human copy", () => {
    expect(lifecycle.lifecycleErrorMessage(PG_ERROR)).toMatch(/settling this dispute/i);
  });

  it("is recognised as an expected refusal — and an ordinary error is not", () => {
    const isExpected = (lifecycle as { isExpectedLifecycleRefusal?: (e: unknown) => boolean }).isExpectedLifecycleRefusal;
    expect(typeof isExpected).toBe("function");
    expect(isExpected!(PG_ERROR)).toBe(true);
    expect(isExpected!({ code: "42501", message: "only the party who opened this dispute may withdraw it" })).toBe(false);
    expect(isExpected!(null)).toBe(false);
  });

  it("every rpc_withdraw_dispute call site shows the refusal instead of reporting it", () => {
    const files = execFileSync("git", ["grep", "-l", 'rpc("rpc_withdraw_dispute"', "--", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f && !/\.test\.|fixtures/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(2);
    const missing = files.filter((f) => !readFileSync(f, "utf8").includes("isExpectedLifecycleRefusal("));
    expect(missing).toEqual([]);
  });
});

// Proof this guard can fail (scripts/vacuity). Both halves are pinned: the
// designed-refusal list itself, and the derived call-site inventory that must
// route the refusal through it rather than paging Sentry for a working lock.
// @mutate src/lib/lifecycleErrors.ts | const EXPECTED_REFUSALS = ["dispute_settlement_in_progress"] as const; | const EXPECTED_REFUSALS = [] as const;
// @mutate src/components/activity/appliedJobCard/DisputedSection.tsx | const expected = isExpectedLifecycleRefusal(error); | const expected = false;
