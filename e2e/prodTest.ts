/**
 * `test` for every spec that talks to PROD Supabase, metered (docs/OPEN.md Q104).
 *
 * Identical to `@playwright/test` (everything is re-exported) except that
 * `test` carries two auto fixtures:
 *
 *  - worker-scoped `_requestMeter`: wraps this worker's `browser` so EVERY
 *    context it creates is counted — Playwright's own `context`/`page`
 *    fixtures and the specs that call `browser.newContext()` themselves — and
 *    writes the worker's sample to request-budget/ when the worker ends;
 *  - test-scoped `_requestMeterTest`: counts tests, so the budget can be per
 *    test and survive a `-g` filter.
 *
 * scripts/e2e/request-budget.mjs sums the samples per run and fails the run
 * over its budget in e2e/request-budgets.json. src/test/requestBudget.test.ts
 * fails any prod-hitting spec that imports `test` from "@playwright/test"
 * directly — an unmetered spec is load nobody can see.
 */
import { test as base } from "@playwright/test";
import { RequestMeter } from "./requestMeter.mjs";

export * from "@playwright/test";

export const test = base.extend<{ _requestMeterTest: void }, { _requestMeter: RequestMeter }>({
  _requestMeter: [
    async ({ browser }, use, workerInfo) => {
      const meter = new RequestMeter(workerInfo.project.name || "default");
      meter.attachBrowser(browser);
      await use(meter);
      meter.flush();
    },
    { scope: "worker", auto: true },
  ],
  _requestMeterTest: [
    async ({ _requestMeter }, use) => {
      _requestMeter.tests++;
      await use();
      // Flushed after every test too: a worker killed by a timeout never
      // reaches its teardown, and its load must still be on the record.
      _requestMeter.flush();
    },
    { auto: true },
  ],
});
