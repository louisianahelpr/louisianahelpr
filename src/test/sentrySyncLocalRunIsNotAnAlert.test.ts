import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { missingSentryEnvIsAlert } from "../../scripts/lib/sentryLedgerSync.mjs";

/**
 * Ops ledger item 42166b2c "Sentry alerts are not synced" was reopened 6 times
 * (last 2026-09-26 18:21Z, sample "…not all set") while every prod-errors.yml
 * run read Sentry fine: the bumps came from local `ops-alert-ledger.mjs sync`
 * runs, which never have the repo secrets. Missing credentials are an alert
 * in CI only; locally the step is skipped and says so.
 *
 * @mutate scripts/lib/sentryLedgerSync.mjs |   return env.GITHUB_ACTIONS === "true"; |   return true;
 */
describe("sentry sync: missing credentials alert only in CI", () => {
  it("CI with no credentials is an alert", () => {
    expect(missingSentryEnvIsAlert({ GITHUB_ACTIONS: "true" })).toBe(true);
  });
  it("a local run with no credentials is not", () => {
    expect(missingSentryEnvIsAlert({})).toBe(false);
  });
  it("the sync consults it before recording the warning", () => {
    const src = blankComments(readFileSync(join(__dirname, "../../scripts/ops-alert-ledger.mjs"), "utf8"));
    expect(src).toMatch(/else if \(!missingSentryEnvIsAlert\(process\.env\)\)/);
  });
});
