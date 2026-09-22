/*
 * CLASS GUARD: a nightly-red report must be FAIL-CLOSED.
 *
 * `.github/actions/nightly-issue-sync` opens a `nightly-red` issue when it is
 * handed `status: failure` and CLOSES that issue when handed `status: success`.
 * It is the only mechanism in this repo that says a scheduled check is red, so
 * the expression feeding it decides whether anyone ever learns.
 *
 * THE TWO WAYS TO WRITE IT, and why only one is safe:
 *
 *   POSITIVE (fail-closed)   needs.x.result == 'success' && 'success' || 'failure'
 *   NEGATIVE (fail-open)     contains(needs.*.result, 'failure') && 'failure' || 'success'
 *
 * A GitHub job result is one of success / failure / cancelled / skipped. The
 * negative form asks only "did anything explicitly FAIL?", so `skipped` and
 * `cancelled` both fall through to 'success' — a run that executed nothing
 * reports green and closes the issue.
 *
 * WHAT THAT COST, found 2026-09-22. `e2e-real-backend.yml` used the negative
 * form. Its `prod-lifecycle` job — the full money loop against production, the
 * highest-stakes check in this repo — is deliberately OFF the push trigger, so
 * on a push it is `skipped`. Every scheduled run of that money loop from
 * 2026-09-07 onward FAILED and opened an issue; the next push to main, of which
 * there are dozens a day, closed it again having run no money loop at all.
 * Issue #1636 lived 3 minutes 25 seconds. #1634 lived 43 seconds. Twelve issues
 * in the label's history are that same pattern.
 *
 * So the money path was broken for fifteen days, the safety net fired correctly
 * every single time, and the report erased itself faster than anyone could read
 * it. A guard that cannot be seen is worse than no guard, because it is
 * trusted.
 *
 * Every other caller in the repo — a11y-webkit-prod, nightly-webkit,
 * press-every-control, prod-freshness, e2e-journeys, prod-audit — already uses
 * the positive form. This holds that line rather than inventing it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const WORKFLOWS = resolve(__dirname, "../../.github/workflows");

describe("nightly-issue-sync reports are fail-closed", () => {
  it("no workflow derives 'success' from the absence of a failure", () => {
    const offenders: string[] = [];

    for (const name of readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"))) {
      const src = readFileSync(join(WORKFLOWS, name), "utf8");
      if (!src.includes("nightly-issue-sync")) continue;

      for (const line of src.split("\n")) {
        const trimmed = line.trim();
        // Only the real expression; the comments above it discuss both forms.
        if (trimmed.startsWith("#") || !trimmed.startsWith("status:")) continue;

        /* Only a verdict read off `needs.<job>.result` carries this hazard: a
           job result has four values and two of them (skipped, cancelled) mean
           "did not run". `uptime.yml` keys off `steps.probe.outputs.status`,
           which is a two-valued signal its own step just produced — not a leg
           that can quietly vanish — so it is correctly not in scope here. */
        if (!trimmed.includes("needs.")) continue;

        /* The tell is `contains(needs.…)` deciding the verdict, or any
           `|| 'success'` tail — both mean the green branch is what happens when
           nothing matched, rather than something a named job earned. */
        if (/contains\(\s*needs\./.test(trimmed) || /\|\|\s*'success'/.test(trimmed)) {
          offenders.push(`${name}: ${trimmed}`);
        }
      }
    }

    expect(
      offenders,
      "This expression closes a nightly-red issue whenever nothing explicitly FAILED — so a run " +
        "whose checks were skipped or cancelled reports green. That is how the production money " +
        "loop stayed red for fifteen days: every scheduled failure opened an issue and the next " +
        "push, with the money job skipped, closed it again.\n\n" +
        "Write it fail-closed instead — name each leg you are reporting on and require it to be " +
        "explicitly successful:\n" +
        "  status: ${{ (needs.a.result == 'success' && needs.b.result == 'success') && 'success' || 'failure' }}\n\n" +
        "and gate the notify job so it does not run at all when the leg it reports on was skipped.\n\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

// The exact expression the money loop reported green with for fifteen days.
// @mutate .github/workflows/e2e-real-backend.yml | status: ${{ (needs.anon-surface.result == 'success' && needs.prod-lifecycle.result == 'success') && 'success' || 'failure' }} | status: ${{ contains(needs.*.result, 'failure') && 'failure' || 'success' }}
