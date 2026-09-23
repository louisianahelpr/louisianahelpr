/**
 * GUARD: the hourly core-loop canary (docs/OPEN.md Q61) walks the WHOLE loop,
 * cleans up what it creates, and actually runs every hour with a timeout.
 *
 * WHY. The full journeys run nightly, so a broken core loop could sit unseen
 * for 20+ hours. A canary is only worth its hourly prod traffic if it keeps
 * walking every step of the loop, leaves nothing behind on prod, and keeps
 * firing — and each of those three decays silently: a step dropped from the
 * spec still goes green, a clean-up that stops deleting one table still goes
 * green (and grows prod by a row an hour), and a cron edited to daily or a
 * missing timeout goes green too.
 *
 * WHAT IT READS, all from the tree:
 *   1. STEPS, two-way. LOOP below is Q61's loop, in order. The spec's own
 *      `step("…")` calls (comments blanked) must be exactly LOOP, in order —
 *      a missing step and an extra unlisted one both fail.
 *   2. CLEAN-UP. The "clean up" step sits in a `finally`; it deletes every
 *      table the loop writes (applications from apply, messages from message,
 *      notifications fanned out by both), as the owning account; it re-reads
 *      them and asserts nothing is left; and the one table the spec INSERTS
 *      into directly (jobs) is only ever the persistent checkout fixture.
 *   3. WORKFLOW. core-loop-canary.yml fires exactly hourly, every job declares
 *      timeout-minutes (the canary job <= 45), it runs `--project=canary`,
 *      whose testDir holds the spec, and its notify job reports red through
 *      nightly-issue-sync AND the ops alert ledger under the issue's title,
 *      with a status that reads every leg it needs.
 *   4. STAND-DOWN SET. scripts/canary/shared-accounts-busy.mjs derives the
 *      suites sharing the accounts from the workflow files; it must find them.
 */
// @mutate e2e/canary/core-loop.spec.ts | await step("message", | await test.step("message",
// @mutate e2e/canary/core-loop.spec.ts | [poster, "messages", "content"]] | ]
// @mutate .github/workflows/core-loop-canary.yml | - cron: "47 * * * *" | - cron: "47 5 * * *"
// @mutate .github/workflows/core-loop-canary.yml |     timeout-minutes: 40\n | \n
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { blankComments } from "./helpers/blankNonCode";
import { CANARY_WORKFLOW, sharedAccountWorkflows } from "../../scripts/canary/shared-accounts-busy.mjs";

const ROOT = join(__dirname, "..", "..");
const SPEC_PATH = "e2e/canary/core-loop.spec.ts";
const WORKFLOW_PATH = `.github/workflows/${CANARY_WORKFLOW}`;

/** Q61's loop, in order: sign in -> browse -> open a job -> apply -> message -> test-mode checkout start -> clean up. */
const LOOP = ["sign in", "browse", "open job", "apply", "message", "checkout start", "clean up"];
/** What the loop writes that the canary must remove: apply, message, and what those two fan out. */
const WRITTEN = ["applications", "messages", "notifications"];

const specRaw = readFileSync(join(ROOT, SPEC_PATH), "utf8");
const spec = blankComments(specRaw);
const wfSrc = readFileSync(join(ROOT, WORKFLOW_PATH), "utf8");
const wf = parse(wfSrc) as any;

/** The spec's step names, in source order. */
export function stepsOf(src: string): string[] {
  return [...src.matchAll(/\bstep\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** The body of the step named `name` (from its call to the matching close is approximated by the next step call). */
function stepBody(src: string, name: string): string {
  const at = src.indexOf(`step("${name}"`);
  if (at < 0) return "";
  const next = src.slice(at + 1).search(/\bstep\(\s*"/);
  return next < 0 ? src.slice(at) : src.slice(at, at + 1 + next);
}

/** The source of the named top-level function, up to the next top-level function. */
function fnBody(src: string, name: string): string {
  const at = src.search(new RegExp(`\\n(async )?function ${name}\\b`));
  if (at < 0) return "";
  const next = src.slice(at + 1).search(/\n(async )?function /);
  return next < 0 ? src.slice(at) : src.slice(at, at + 1 + next);
}

/**
 * Tables the clean-up deletes: the `[who, "table", "col"]` tuples removeMarked
 * walks, plus `"delete", \`table?` calls — read ONLY from the two clean-up
 * helpers, so the checkout fixture's own rotation (a jobs delete) is not
 * mistaken for per-run clean-up.
 */
export function deletedTables(src: string): string[] {
  src = `${fnBody(src, "removeMarked")}${fnBody(src, "removeNotifications")}`;
  const out = new Set<string>();
  for (const m of src.matchAll(/\[\s*\w+\s*,\s*"(\w+)"\s*,\s*"\w+"\s*\]/g)) out.add(m[1]);
  for (const m of src.matchAll(/"delete"\s*,\s*`(\w+)\?/g)) out.add(m[1]);
  return [...out].sort();
}

describe("core-loop canary: the spec walks the whole loop", () => {
  it("finds the spec's steps (floor)", () => {
    expect(stepsOf(spec).length).toBeGreaterThan(5);
  });

  it("its steps are exactly Q61's loop, in order (two-way)", () => {
    const got = stepsOf(spec);
    const missing = LOOP.filter((s) => !got.includes(s));
    const extra = got.filter((s) => !LOOP.includes(s));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    expect(got, "the loop's steps run out of order").toEqual(LOOP);
  });

  it("step() is the only way a step is named (a bare test.step escapes this guard)", () => {
    expect(spec.match(/\btest\.step\(\s*"/g) ?? [], "use the typed step() helper so the guard sees it").toEqual([]);
  });
});

describe("core-loop canary: it cleans up what it creates", () => {
  const cleanup = stepBody(spec, "clean up");

  it("the clean-up step runs in a finally, so a red run still cleans up", () => {
    const fin = spec.search(/\bfinally\s*\{/);
    expect(fin, "no finally block in the spec").toBeGreaterThan(0);
    expect(spec.indexOf('step("clean up"'), "the clean up step is not inside the finally").toBeGreaterThan(fin);
  });

  it("deletes every table the loop writes, and nothing it does not know about (two-way)", () => {
    expect(deletedTables(spec)).toEqual([...WRITTEN].sort());
  });

  it("re-reads each table after deleting, and fails on any row left", () => {
    for (const t of WRITTEN) expect(cleanup, `clean-up never re-reads ${t}`).toMatch(new RegExp(`selectAs<[^>]*>\\([\\s\\S]{0,80}\`${t}\\?`));
    expect(cleanup).toMatch(/expect\(left[\s\S]{0,120}\)\.toEqual\(\[\]\)/);
    expect(cleanup, "the pre-run sweep and the clean-up must share one deleter").toMatch(/removeMarked\(/);
    expect(cleanup, "the clean-up never removes the fanned-out notifications").toMatch(/removeNotifications\(/);
    expect(spec.indexOf("removeMarked(api, p, h)"), "no pre-run sweep for a killed run's rows").toBeLessThan(spec.indexOf('step("browse"'));
  });

  it("its only direct insert is the persistent checkout fixture, which is is_seed and parish-less", () => {
    const inserts = [...spec.matchAll(/restAs\(\s*api\s*,\s*\w+\s*,\s*"post"\s*,\s*"(\w+)[?"]/g)].map((m) => m[1]);
    expect(inserts, "a new table insert must be added to the clean-up and to WRITTEN").toEqual(["jobs"]);
    const insert = spec.slice(spec.search(/"post"\s*,\s*"jobs\?/));
    expect(insert.slice(0, 1200)).toMatch(/title:\s*CHECKOUT_FIXTURE_TITLE/);
    expect(insert.slice(0, 1200)).toMatch(/is_seed:\s*true/);
    expect(insert.slice(0, 1200)).toMatch(/parish:\s*null/);
  });

  it("the checkout leg refuses a live Stripe session and never pays", () => {
    const co = stepBody(spec, "checkout start");
    expect(co).toMatch(/cs_test_/);
    expect(co, "the canary must never submit a payment").not.toMatch(/hosted-payment-submit-button|payOnStripeCheckout|#cardNumber"\)\.fill/);
  });
});

describe("core-loop canary: the workflow runs it every hour, bounded", () => {
  it("is scheduled exactly hourly", () => {
    const crons: string[] = (wf.on?.schedule ?? []).map((s: { cron: string }) => s.cron);
    expect(crons).toHaveLength(1);
    expect(crons[0], "one fire per hour, every day").toMatch(/^([0-5]?\d) \* \* \* \*$/);
  });

  it("every job declares a timeout, and the canary job's is bounded", () => {
    const jobs = Object.entries(wf.jobs ?? {}) as [string, { "timeout-minutes"?: number }][];
    expect(jobs.length).toBeGreaterThan(2);
    for (const [name, job] of jobs) expect(job["timeout-minutes"], `${name} has no timeout-minutes`).toBeGreaterThan(0);
    expect(wf.jobs.canary["timeout-minutes"]).toBeLessThanOrEqual(45);
  });

  it("holds its own non-cancelling concurrency group, never prod-load", () => {
    expect(wf.concurrency?.group).toBe("core-loop-canary");
    expect(wf.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("runs --project=canary with one worker, and that project collects the spec", () => {
    const runs = JSON.stringify(wf.jobs.canary.steps);
    expect(runs).toMatch(/playwright test --project=canary --workers=1/);
    const cfg = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");
    expect(cfg).toMatch(/name:\s*"canary",[\s\S]{0,300}testDir:\s*"\.\/e2e\/canary"/);
    expect(SPEC_PATH.startsWith("e2e/canary/")).toBe(true);
  });

  it("reports red through nightly-red AND the ledger, with a status that reads every leg", () => {
    const notify = wf.jobs.notify;
    const needs: string[] = notify.needs;
    const sync = notify.steps.find((s: { uses?: string }) => s.uses === "./.github/actions/nightly-issue-sync");
    expect(sync?.with?.["workflow-name"]).toBe("core-loop-canary");
    for (const leg of needs) expect(sync.with.status, `status ignores ${leg}`).toContain(`needs.${leg}.result`);
    const ledger = JSON.stringify(notify.steps);
    expect(ledger).toMatch(/ops-alert-ledger\.mjs record --source-kind nightly_red/);
    expect(ledger, "the ledger item must carry the issue's title, or the issue's green close never closes it").toContain(
      "nightly-red: core-loop-canary",
    );
  });
});

describe("core-loop canary: it stands down for the suites that share its accounts", () => {
  it("derives those suites from the workflow files", () => {
    const set = sharedAccountWorkflows(join(ROOT, ".github", "workflows"));
    expect(set.length).toBeGreaterThan(5);
    expect(set).toContain("prod-audit.yml");
    expect(set).toContain("e2e-journeys.yml");
    expect(set).not.toContain(CANARY_WORKFLOW);
    // The canary itself carries the shared secrets, so the exclusion is real.
    expect(wfSrc).toMatch(/PLAYWRIGHT_HELPER_EMAIL/);
  });
});
