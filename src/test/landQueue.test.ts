/**
 * The land queue (owner, 2026-10-05: "make it a queue so if it fails the others
 * will be fixed before their run"). Only the head of the queue is brought up to
 * date and re-checked; a failed head leaves the queue and the next moves up;
 * land.sh puts every landing in line and leaves BEHIND to the queue.
 *
 * @mutate scripts/land-queue.mjs | steps.push({ action: "update", number: pr.number }); | steps.push({ action: "update", number: pr.number }); continue;
 * @mutate scripts/land-queue.mjs | checks: [...new Set(failed.map((c) => c.name))] }); | checks: [] }); return steps;
 * @mutate scripts/land-queue.mjs | if (pr.mergeStateStatus === "DIRTY") { | if (pr.mergeStateStatus === "DIRTYX") {
 * @mutate scripts/land-queue.mjs | const again = cancelled.filter((c) => (c.attempt ?? 1) > 1); | const again = cancelled;
 * @mutate scripts/land.sh | --add-label land-queue >/dev/null 2>&1 \|\| | --add-label other >/dev/null 2>&1 \|\|
 * @mutate scripts/land.sh | if [ "$MSS" = DIRTY ]; then | if [ "$MSS" = DIRTY ] \|\| [ "$MSS" = BEHIND ]; then
 * @mutate scripts/land-queue.mjs |     if (/no (?:required )?checks reported on the '[^']*' branch/.test(err)) return []; |     if (false) return [];
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
// @ts-expect-error — plain .mjs script, no declaration file
import { planQueue, QUEUE_LABEL, queuedChecks, GATE_CHECKS, checksFromGh, mergeOrWait } from "../../scripts/land-queue.mjs";
import { REQUIRED_CHECKS } from "./helpers/requiredChecks";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const pass = [{ name: "Vitest unit tests", bucket: "pass" }];
const pending = [{ name: "Vitest unit tests", bucket: "pending" }];

describe("the land queue decides one head at a time", () => {
  it("rebases only the head when several PRs are behind main", () => {
    const steps = planQueue([
      { number: 1, mergeStateStatus: "BEHIND", checks: pass },
      { number: 2, mergeStateStatus: "BEHIND", checks: pass },
    ]);
    expect(steps).toEqual([{ action: "update", number: 1 }]);
  });

  it("drops a failed head and moves the next one up", () => {
    const steps = planQueue([
      { number: 1, mergeStateStatus: "BLOCKED", checks: [{ name: "Test", bucket: "fail" }, { name: "Test", bucket: "fail" }] },
      { number: 2, mergeStateStatus: "BEHIND", checks: pass },
    ]);
    expect(steps).toEqual([
      { action: "fail", number: 1, checks: ["Test"] },
      { action: "update", number: 2 },
    ]);
  });

  it("passes over a conflicting PR (land.sh rebases it) without stopping the line", () => {
    const steps = planQueue([
      { number: 1, mergeStateStatus: "DIRTY", checks: pass },
      { number: 2, mergeStateStatus: "CLEAN", checks: pass },
    ]);
    expect(steps.map((s: { action: string }) => s.action)).toEqual(["skip", "merge"]);
  });

  it("waits on a head whose checks are still running, and holds the line behind it", () => {
    const steps = planQueue([
      { number: 1, mergeStateStatus: "BLOCKED", checks: pending },
      { number: 2, mergeStateStatus: "BEHIND", checks: pass },
    ]);
    expect(steps).toEqual([{ action: "wait", number: 1 }]);
  });

  it("re-runs a cancelled check once, then treats a second cancel as a failure", () => {
    const first = planQueue([{ number: 1, mergeStateStatus: "BLOCKED", checks: [{ name: "Test", bucket: "cancel", runId: "9", attempt: 1 }] }]);
    expect(first).toEqual([{ action: "rerun", number: 1, runIds: ["9"] }]);
    const second = planQueue([{ number: 1, mergeStateStatus: "BLOCKED", checks: [{ name: "Test", bucket: "cancel", runId: "9", attempt: 2 }] }]);
    expect(second).toEqual([{ action: "fail", number: 1, checks: ["Test"] }]);
  });

  it("merges a clean head and says idle when nothing is queued", () => {
    expect(planQueue([{ number: 3, mergeStateStatus: "CLEAN", checks: pass }])).toEqual([{ action: "merge", number: 3 }]);
    expect(planQueue([])).toEqual([{ action: "idle" }]);
  });
});

describe("the queue is wired", () => {
  it("land.sh labels every landing and leaves BEHIND to the queue", () => {
    const land = read("scripts/land.sh");
    expect(QUEUE_LABEL).toBe("land-queue");
    expect(land).toMatch(/gh pr edit "\$BR" --remove-label land-queue-failed --add-label land-queue >\/dev\/null 2>&1 \|\|/);
    expect(land).toMatch(/if \[ "\$MSS" = DIRTY \]; then/);
    expect(land).not.toMatch(/"\$MSS" = BEHIND \]/);
    // The queue has no pull_request trigger: land.sh wakes it on joining and while it waits.
    expect(land.match(/gh workflow run land-queue\.yml --ref main/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the workflow wakes when any required check from this repo finishes", () => {
    const wf = read(".github/workflows/land-queue.yml");
    const fromRepo = REQUIRED_CHECKS.filter((c) => c.workflow);
    expect(fromRepo.length).toBeGreaterThan(3);
    for (const c of fromRepo) {
      const name = /^name:\s*(.+)$/m.exec(read(c.workflow!))![1].trim().replace(/^["']|["']$/g, "");
      expect(wf, `land-queue.yml must listen for workflow_run of "${name}"`).toContain(`"${name}"`);
    }
    expect(wf).toMatch(/node scripts\/land-queue\.mjs/);
    expect(wf).toMatch(/GH_TOKEN: \$\{\{ secrets\.REFRESH_PR_TOKEN \|\| github\.token \}\}/);
  });
});

// 2026-10-06: #2450 merged with its migration-replay gate red (auto-merge waits
// only for required checks) and db-deploy then refused the migration.
// @mutate scripts/land-queue.mjs |   return [...required, ...all.filter((c) => GATE_CHECKS.includes(c.name) && !names.has(c.name))]; |   return [...required];
// @mutate scripts/land-queue.mjs |         gh(["pr", "merge", n, "--disable-auto"]); |         void n;
describe("migration gate checks count in the queue", () => {
  it("a gate check on the PR joins the required ones, once", () => {
    const required = [{ name: "Vitest unit tests", bucket: "pass" }];
    const all = [...required, { name: GATE_CHECKS[0], bucket: "fail" }, { name: "Some report", bucket: "fail" }];
    expect(queuedChecks(required, all).map((c: { name: string }) => c.name)).toEqual(["Vitest unit tests", GATE_CHECKS[0]]);
  });

  it("a red gate check drops the PR from the queue like a red required check", () => {
    const checks = queuedChecks([{ name: "Vitest unit tests", bucket: "pass" }], [{ name: GATE_CHECKS[0], bucket: "fail" }]);
    expect(planQueue([{ number: 1, mergeStateStatus: "CLEAN", checks }])[0]).toMatchObject({ action: "fail", number: 1 });
  });

  it("the fail step turns the PR's auto-merge off", () => {
    const src = readFileSync(join(process.cwd(), "scripts/land-queue.mjs"), "utf8");
    const fail = src.slice(src.indexOf('case "fail":'), src.indexOf('case "rerun":'));
    expect(fail).toMatch(/gh\(\["pr", "merge", n, "--disable-auto"\]\)/);
  });

  it("every gate check is a real job name, in a workflow the queue wakes on", () => {
    const dir = join(process.cwd(), ".github/workflows");
    const queueYml = readFileSync(join(dir, "land-queue.yml"), "utf8");
    for (const gate of GATE_CHECKS as string[]) {
      const file = readdirSync(dir).find((f) => new RegExp(`^\\s+name: ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(readFileSync(join(dir, f), "utf8")));
      expect(file, `no workflow job is named "${gate}"`).toBeTruthy();
      const wfName = /^name:\s*(.+)$/m.exec(readFileSync(join(dir, file as string), "utf8"))![1].trim();
      expect(queueYml, `land-queue.yml must wake on "${wfName}"`).toContain(`"${wfName}"`);
    }
  });

  // Land queue run 37569414168 (2026-10-07 04:01Z) crashed: a PR pushed a
  // moment earlier had no checks registered, gh exited 1 with nothing on
  // stdout, and the advancer threw. That PR is PENDING: the queue waits on it.
  it("a PR whose checks have not registered yet reads as pending (the queue waits), never a crash", () => {
    const ghError = (stderr: string, stdout = "") => () => {
      throw Object.assign(new Error("Command failed: gh pr checks"), { status: 1, stdout, stderr });
    };
    expect(checksFromGh(ghError("no required checks reported on the 'land/crew-hire-before-payout-d916aa74' branch\n"))).toEqual([]);
    expect(checksFromGh(ghError("no checks reported on the 'land/x' branch\n"))).toEqual([]);
    // still prints the JSON while checks run or one failed
    expect(checksFromGh(ghError("", '[{"name":"Vitest","bucket":"pending","link":""}]'))).toEqual([{ name: "Vitest", bucket: "pending", link: "" }]);
    // any other failure with no body is a real read failure
    expect(() => checksFromGh(ghError("HTTP 502: Bad Gateway"))).toThrow(/gh pr checks/);
    const steps = planQueue([{ number: 7, mergeStateStatus: "BLOCKED", checks: queuedChecks(checksFromGh(ghError("no required checks reported on the 'land/y' branch")), []) }]);
    expect(steps).toEqual([{ action: "wait", number: 7 }]);
  });
});

// Q1487: Land queue run 37606345222 crashed when its own `gh pr merge` was
// refused as "not mergeable" (the PR's state moved after readQueue).
// @mutate scripts/land-queue.mjs |     if (/not mergeable/i.test(text)) { |     if (false) {
// @mutate scripts/land-queue.mjs |       mergeOrWait(() => gh(["pr", "merge", n, "--rebase"])); |       gh(["pr", "merge", n, "--rebase"]);
describe("the queue's own merge refused as not mergeable is a wait, not a crash (Q1487)", () => {
  const refused = () => {
    const e = Object.assign(new Error("Command failed: gh pr merge 2564 --rebase"), {
      stderr: "GraphQL: Pull Request is not mergeable (mergePullRequest)\n",
    });
    throw e;
  };
  it("answers wait and logs it", () => {
    const logs: string[] = [];
    expect(mergeOrWait(refused, (l: string) => logs.push(l))).toBe("wait");
    expect(logs.join("\n")).toMatch(/not mergeable/);
  });
  it("still throws on any other gh failure", () => {
    expect(() => mergeOrWait(() => { throw Object.assign(new Error("boom"), { stderr: "HTTP 502" }); }, () => {})).toThrow("boom");
  });
  it("act() routes the merge through mergeOrWait", () => {
    const src = readFileSync(join(process.cwd(), "scripts/land-queue.mjs"), "utf8");
    expect(src).toMatch(/case "merge":\s*mergeOrWait\(\(\) => gh\(\["pr", "merge", n, "--rebase"\]\)\);/);
  });
});
