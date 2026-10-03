// @mutate scripts/open-done-when.mjs | if (!nightly) return { ok: true, note: `issue #${n} is CLOSED` }; | if (true) return { ok: true, note: `issue #${n} is CLOSED` };
// @mutate scripts/open-done-when.mjs | return issueMarkerHolds(issue, handClosedNightly ? nightlyRunsFor(issue.title) : null); | return { ok: String(issue.state) === "closed", note: "" };
/*
 * A done-when `issue #N closed` marker on a NIGHTLY-RED issue holds only when
 * the workflow's own green run closed it, or, if a person closed it, when that
 * workflow's newest scheduled/dispatched run on main is green and started
 * after the issue opened (Q1139's rule, shared via greenNightlyRunAfter).
 *
 * 2026-10-03, owner: "make sure all the done work is ticked and correct".
 * open-done-when listed 25 [~] items READY on main; 15 of them rested on
 * nightly-red issues closed BY HAND on 2026-10-02 (#1582 press-every-control,
 * #1654 loading-states-refresh, #1754 prod-audit, #2071 staleness-watch)
 * while those workflows were still red. Ticking them would have been wrong.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import { issueMarkerHolds } from "../../scripts/open-done-when.mjs";

const NIGHTLY = [{ name: "nightly-red" }];
const OPENED = "2026-10-02T04:00:00Z";
const issue = (over: Record<string, unknown>) => ({ number: 1582, title: "nightly-red: press-every-control", state: "closed", labels: NIGHTLY, created_at: OPENED, closed_by: { login: "louisianahelpr" }, ...over });
const run = (createdAt: string, event: string, conclusion = "success") => ({ createdAt, event, conclusion, status: "completed", url: `run-${event}-${createdAt}` });

describe("done-when issue markers: a hand-closed nightly-red issue is not evidence", () => {
  it("an open issue never holds", () => {
    expect(issueMarkerHolds(issue({ state: "open" }), null).ok).toBe(false);
  });

  it("a nightly-red issue closed by its own green run holds; closed by a person, it does not", () => {
    expect(issueMarkerHolds(issue({ closed_by: { login: "github-actions[bot]" } }), null).ok).toBe(true);
    expect(issueMarkerHolds(issue({}), []).ok).toBe(false);
    expect(issueMarkerHolds(issue({}), null).ok).toBe(false);
  });

  it("a hand-closed one holds only on the workflow's newest green nightly run after it opened", () => {
    expect(issueMarkerHolds(issue({}), [run("2026-10-03T11:20:00Z", "schedule")]).ok).toBe(true);
    expect(issueMarkerHolds(issue({}), [run("2026-10-03T04:42:00Z", "push")]).ok).toBe(false);
    expect(issueMarkerHolds(issue({}), [run("2026-10-02T03:00:00Z", "schedule")]).ok).toBe(false);
    expect(issueMarkerHolds(issue({}), [run("2026-10-03T11:20:00Z", "schedule", "failure"), run("2026-10-03T06:00:00Z", "workflow_dispatch")]).ok).toBe(false);
  });

  it("an issue that is not nightly-red: closed is closed, whoever closed it", () => {
    expect(issueMarkerHolds(issue({ labels: [{ name: "owner-question" }] }), null).ok).toBe(true);
  });

  it("the checker evaluates every issue marker through that rule, with the issue's closed_by and labels", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../scripts/open-done-when.mjs"), "utf8"));
    const i = src.indexOf('if (mk.kind === "issue") {');
    expect(i, "the issue-marker branch is gone").toBeGreaterThan(0);
    const branch = src.slice(i, i + 700);
    expect(branch).toMatch(/gh", \["api", `repos\/\{owner\}\/\{repo\}\/issues\/\$\{mk\.number\}`\]/);
    expect(branch).toMatch(/return issueMarkerHolds\(issue, handClosedNightly \? nightlyRunsFor\(issue\.title\) : null\);/);
  });
});
