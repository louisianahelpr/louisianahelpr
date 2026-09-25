/**
 * `test` for every spec that talks to PROD Supabase, metered and paced
 * (docs/OPEN.md Q104).
 *
 * Identical to `@playwright/test` (everything is re-exported) except that
 * `test` carries two auto fixtures:
 *
 *  - worker-scoped `_requestMeter`: wraps this worker's `browser` so EVERY
 *    context it creates is counted — Playwright's own `context`/`page`
 *    fixtures and the specs that call `browser.newContext()` themselves — and
 *    writes the worker's sample to request-budget/ when the worker ends. It
 *    also PACES: every `page.goto` / `page.reload` waits until the current
 *    wall-clock minute has room under the label's `ceilingPerMinute`
 *    (e2e/request-budgets.json), shared between the run's workers. A spec that
 *    walks surface after surface back to back is held between surfaces instead of
 *    sending 700 requests in one minute (e2e/requestMeter.mjs `pace`);
 *  - test-scoped `_requestMeterTest`: counts tests, so the budget can be per
 *    test and survive a `-g` filter, and holds the test's start at the same
 *    gate. Every hold lengthens the running test's (or hook's) timeout by the
 *    hold, so pacing never turns into a timeout.
 *
 * scripts/e2e/request-budget.mjs sums the samples per run and fails the run
 * over its budget in e2e/request-budgets.json. src/test/requestBudget.test.ts
 * fails any prod-hitting spec that imports `test` from "@playwright/test"
 * directly — an unmetered spec is load nobody can see.
 */
import { test as base } from "@playwright/test";
import { RequestMeter, ceilingFor } from "./requestMeter.mjs";

export * from "@playwright/test";

export const test = base.extend<{ _requestMeterTest: void }, { _requestMeter: RequestMeter }>({
  _requestMeter: [
    async ({ browser }, use, workerInfo) => {
      const label = workerInfo.project.name || "default";
      const meter = new RequestMeter(label);
      meter.attachBrowser(browser);
      meter.paceTo(ceilingFor(label), { workers: workerInfo.config.workers });
      // A hold lengthens whatever is running it (a test, or a beforeAll that
      // navigates) by exactly the hold, so pacing never turns into a timeout.
      meter.onPaceWait = (ms) => {
        let running;
        try {
          running = base.info();
        } catch {
          return; // not inside a test or a hook: there is no timeout to lengthen
        }
        if (running.timeout > 0) running.setTimeout(running.timeout + ms);
      };
      await use(meter);
      meter.flush();
    },
    { scope: "worker", auto: true },
  ],
  _requestMeterTest: [
    async ({ _requestMeter }, use) => {
      _requestMeter.tests++;
      await _requestMeter.pace();
      await use();
      // Flushed after every test too: a worker killed by a timeout never
      // reaches its teardown, and its load must still be on the record.
      _requestMeter.flush();
    },
    { auto: true },
  ],
});
