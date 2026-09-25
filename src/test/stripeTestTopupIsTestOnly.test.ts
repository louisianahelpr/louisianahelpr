/*
 * The TEST balance top-up (scripts/stripe-test-topup.mjs, dispatched by
 * .github/workflows/stripe-test-topup.yml) charges the Stripe platform
 * account. It must only ever do that with a test-mode key, for a bounded
 * amount, and only when someone presses Run.
 *
 * @mutate scripts/stripe-test-topup.mjs | if (!/^(sk|rk)_test_/.test(key)) { | if (false) {
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no declarations
import { checkInputs, MAX_DOLLARS } from "../../scripts/stripe-test-topup.mjs";

const ROOT = resolve(__dirname, "..", "..");

describe("Stripe TEST top-up never touches live mode", () => {
  it("refuses a live key, a missing key and out-of-range amounts", () => {
    expect(checkInputs("sk_live_abc", "100")).toMatch(/not a test-mode key/);
    expect(checkInputs("rk_live_abc", "100")).toMatch(/not a test-mode key/);
    expect(checkInputs(undefined, "100")).toMatch(/not set/);
    expect(checkInputs("sk_test_abc", "0")).toMatch(/whole number/);
    expect(checkInputs("sk_test_abc", String(MAX_DOLLARS + 1))).toMatch(/whole number/);
    expect(checkInputs("sk_test_abc", "12.5")).toMatch(/whole number/);
    expect(checkInputs("sk_test_abc", "500")).toBeNull();
    expect(checkInputs("rk_test_abc", "1")).toBeNull();
  });

  it("the workflow runs only on a manual dispatch", () => {
    const wf = readFileSync(resolve(ROOT, ".github/workflows/stripe-test-topup.yml"), "utf8");
    const on = wf.slice(wf.indexOf("\non:"), wf.indexOf("\npermissions:"));
    expect(on).toMatch(/workflow_dispatch:/);
    expect(on).not.toMatch(/\b(push|schedule|pull_request|workflow_run):/);
  });
});
