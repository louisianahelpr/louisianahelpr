// @mutate scripts/ops-alert-ledger.mjs |     if (it.source_kind === "nightly_red" && !ref.issue) { |     if (false) {
// @mutate scripts/lib/opsAlertLedger.mjs |   const same = found.filter((i) => String(i.title).trim().toLowerCase() === want) | const same = found.filter((i) => String(i.title) === want)
/*
 * CLASS GUARD (docs/OPEN.md Q42): a nightly_red ledger item can always close.
 *
 * main-red-watch.yml records "nightly-red: main: <Workflow>" with only a
 * run_url, and ops_alert_apply overwrites sample_ref, so the item lost the
 * issue number that `sync` step 2 closes by. Measured 2026-09-23: "main:
 * staleness watch" and "main: vacuity" stayed open after their issues were
 * closed green by github-actions[bot]. sync now finds the issue by its exact
 * (case-insensitive: the ledger stores the lower-cased title) title.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as lib from "../../scripts/lib/opsAlertLedger.mjs";

const find = lib.newestNightlyIssueByTitle as (repo: string, title: string, run: (a: string[]) => unknown) => { number: number } | null;

describe("nightly_red ledger items without an issue number still close", () => {
  const issues = [
    { number: 1681, title: "nightly-red: main: Vacuity" },
    { number: 1685, title: "nightly-red: main: Vacuity" },
    { number: 1690, title: "nightly-red: main: Vacuity extra" },
  ];
  const run = (a: string[]) => (a[0] === "issue" ? issues : { number: Number(a[1].split("/").pop()) });

  it("finds the newest issue with the exact title, whatever the case", () => {
    expect(issues.length).toBeGreaterThan(1);
    expect(find("o/r", "nightly-red: main: vacuity", run)?.number).toBe(1685);
    expect(find("o/r", "nightly-red: main: nothing", run)).toBeNull();
  });

  it("sync consults it for a nightly_red item with no issue ref", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../scripts/ops-alert-ledger.mjs"), "utf8"));
    const i = src.indexOf('it.source_kind === "nightly_red" && !ref.issue');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 800)).toMatch(/newestIssueByTitle\(repo, it\.title\)/);
    expect(src.slice(i, i + 800)).toMatch(/closed_at\) > new Date\(it\.last_seen\)/);
  });
});
