// @mutate scripts/ops-alert-ledger.mjs |     if (it.source_kind === "nightly_red" && !ref.issue) { |     if (false) {
// @mutate scripts/lib/opsAlertLedger.mjs |   const same = found.filter((i) => String(i.title).trim().toLowerCase() === want) | const same = found.filter((i) => String(i.title) === want)
// @mutate scripts/lib/opsAlertLedger.mjs | (r.event === "schedule" \|\| r.event === "workflow_dispatch") | true
// @mutate scripts/ops-alert-ledger.mjs | const green = greenNightlyRunAfter(runs, it.last_seen); | const green = null;
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
import { readdirSync, readFileSync } from "node:fs";
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

/*
 * Q1139 (2026-10-03): a nightly_red item whose issue a PERSON closed could
 * never close. Step 2 rightly refuses a hand close as evidence, but the
 * workflow's next green run then has no issue left to close. Four items sat
 * open that way (press-every-control #2153, loading-states-refresh #2149,
 * prod-audit #1754, staleness-watch #2121). Such an item now closes on the
 * workflow's own newest scheduled/dispatched run on main, green and after its
 * last occurrence; never on a push run (staleness-watch's "Nothing stale"
 * job runs on schedule and dispatch only, so its push runs prove nothing).
 */
const greenAfter = lib.greenNightlyRunAfter as (
  runs: { status: string; conclusion: string; createdAt: string; event: string; url: string }[],
  lastSeen: string,
) => { url: string } | null;

describe("a nightly_red item whose issue a person closed closes on its workflow's own later green nightly run", () => {
  const LAST = "2026-10-02T16:42:20Z";
  const run = (createdAt: string, event: string, conclusion = "success", status = "completed") =>
    ({ createdAt, event, conclusion, status, url: `run-${createdAt}-${event}` });

  it("takes the newest green scheduled or dispatched run after the last occurrence", () => {
    expect(greenAfter([run("2026-10-03T11:20:00Z", "schedule")], LAST)?.url).toBe("run-2026-10-03T11:20:00Z-schedule");
    expect(greenAfter([run("2026-10-03T06:00:00Z", "workflow_dispatch")], LAST)?.url).toBe("run-2026-10-03T06:00:00Z-workflow_dispatch");
  });

  it("refuses a push run, a red newest run, a run in progress and a run before the last occurrence", () => {
    expect(greenAfter([run("2026-10-03T04:42:49Z", "push")], LAST)).toBeNull();
    expect(greenAfter([run("2026-10-03T11:20:00Z", "schedule", "failure"), run("2026-10-03T06:00:00Z", "workflow_dispatch")], LAST)).toBeNull();
    expect(greenAfter([run("2026-10-03T11:20:00Z", "schedule", "", "in_progress")], LAST)).toBeNull();
    expect(greenAfter([run("2026-10-02T11:20:00Z", "schedule")], LAST)).toBeNull();
    expect(greenAfter([], LAST)).toBeNull();
  });

  it("every nightly-red issue title resolves to a real workflow file (the inventory sync looks runs up by)", () => {
    const dir = resolve(__dirname, "../../.github/workflows");
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ file: f, text: readFileSync(resolve(dir, f), "utf8") }));
    const aliases = lib.workflowAliases(files) as Map<string, string>;
    const names = files.flatMap(({ text }) => [...text.matchAll(/workflow-name:\s*["']?([a-z0-9-]+)["']?\s*$/gim)].map((m) => m[1]));
    expect(names.length, "no nightly-issue-sync workflow-name found: the scan is broken").toBeGreaterThan(30);
    const bases = new Set(files.map((f) => f.file.replace(/\.ya?ml$/, "")));
    const unresolved = names.filter((n) => !bases.has(lib.ledgerWorkflowKey({ source_kind: "nightly_red", title: `nightly-red: ${n}` }, aliases)));
    expect(unresolved, "these nightly-red titles map to no workflow file, so a hand-closed issue of theirs could never close").toEqual([]);
  });

  it("sync asks for that run when the issue was closed by anyone but github-actions[bot]", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../scripts/ops-alert-ledger.mjs"), "utf8"));
    const i = src.indexOf('it.source_kind === "nightly_red" && ref.issue');
    expect(i).toBeGreaterThan(0);
    const branch = src.slice(i, src.indexOf('it.source_kind === "workflow" && it.verify_ref', i));
    expect(branch).toMatch(/else if \(iss\.state === "closed"\)/);
    expect(branch).toMatch(/greenNightlyRunAfter\(runs, it\.last_seen\)/);
    expect(branch).toMatch(/"conclusion,status,createdAt,url,event"/);
    // Filtered by event: staleness-watch runs on every push, which pushed its
    // scheduled run out of an unfiltered 20-run list (measured 2026-10-03).
    expect(branch).toMatch(/\["schedule", "workflow_dispatch"\]\.flatMap\(\(event\) =>/);
    expect(branch).toMatch(/"--event", event/);
  });
});
