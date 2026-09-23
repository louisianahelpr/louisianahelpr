/*
 * CLASS GUARD: a scheduled workflow that fails must land somewhere a person
 * will see.
 *
 * ── What this cost, measured 2026-09-23 ─────────────────────────────────────
 * 14 of the repo's scheduled workflows had no failure reporting at all. They
 * fail, the Actions tab turns red, and nobody opens the Actions tab — which is
 * the exact thing the owner said on 2026-09-12 when `nightly-issue-sync` was
 * built. It was built, and then 14 workflows never adopted it.
 *
 * What was actually rotting, found only because the owner asked "what else":
 *
 *   db-drift-detect     RED THREE DAYS RUNNING (09-20, 09-21, 09-22).
 *                       Schema drift between the migrations and prod is the
 *                       thing CLAUDE.md calls "zero migration drift".
 *   db-backup           last SUCCESS 09-21. A nightly backup that has not run
 *                       for two days is a recovery gap, and nothing said so.
 *   security-audit,     all silent.
 *   stripe-webhook-guard  — money.
 *   supabase-usage, write-contract-refresh, edge-function-smoke, and 7 more.
 *
 * `nightly-issue-sync` opens ONE `nightly-red` issue per workflow and closes
 * it on the next green run. The "Nightly reds nobody read" gate then fails
 * while any of them is open for more than a day. None of that can see a
 * workflow that never reports.
 *
 * ── Why a test and not a convention ─────────────────────────────────────────
 * The convention already existed and 14 workflows did not follow it. A
 * convention nobody can enforce is a suggestion. This reads the workflow files
 * themselves, so the NEXT scheduled workflow cannot ship silent.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "..", "..", ".github", "workflows");
const files = readdirSync(DIR).filter((f) => f.endsWith(".yml"));

/** Workflows that run on a cron. Those are the ones nobody is watching live. */
const scheduled = files.filter((f) => /^on:|^\s{2}schedule:/m.test(readFileSync(join(DIR, f), "utf8")) &&
  /\n\s{2}schedule:/.test(readFileSync(join(DIR, f), "utf8")));

/**
 * Allowed to stay silent, each with the reason it is not a gap.
 * An entry here is a claim that a red run is ALREADY visible some other way.
 */
const NO_REPORT_NEEDED: Record<string, string> = {
  // Deliberately empty. Every scheduled workflow in this repo now reports,
  // including `nightly-red-age.yml` — which is the GATE that reads the
  // nightly-red issues, and reports its own result through the same action.
  // That is not circular: it files an issue when the GATE ITSELF breaks, which
  // is the one failure that would otherwise silence every other report.
  //
  // Kept as a mechanism rather than deleted, because the next scheduled
  // workflow may have a real reason — and a reason written down beats a
  // workflow quietly omitted from the check.
};

describe("every scheduled workflow reports a red run", () => {
  it("found the workflows (cannot pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(scheduled.length).toBeGreaterThan(10);
  });

  it("each one either syncs a nightly-red issue or says why it need not", () => {
    const silent = scheduled.filter((f) => {
      if (f in NO_REPORT_NEEDED) return false;
      const src = readFileSync(join(DIR, f), "utf8");
      // Q52: read the `uses:` line, never a comment — db-backup.yml names the
      // action in a comment, so a bare includes() stayed green with the step gone.
      return !/^\s*-?\s*uses:\s*\.\/\.github\/actions\/nightly-issue-sync\b/m.test(src);
    });

    expect(
      silent,
      "These run on a schedule and report NOTHING when they fail. A red run lands " +
        "on the Actions tab, which nobody opens — that is why nightly-issue-sync " +
        "exists. db-drift-detect was red for three consecutive days and db-backup " +
        "had not succeeded for two before anyone noticed. Add a `notify` job using " +
        "./.github/actions/nightly-issue-sync, gated on schedule/workflow_dispatch:\n  " +
        silent.join("\n  "),
    ).toEqual([]);
  });

  it("the allowlists do not rot", () => {
    const stale = Object.keys(NO_REPORT_NEEDED).filter((f) => !files.includes(f));
    expect(stale, `listed but no such workflow — remove: ${stale.join(", ")}`).toEqual([]);
    for (const [f, why] of Object.entries(NO_REPORT_NEEDED)) {
      expect(why.length, `${f} needs a real reason, not a placeholder`).toBeGreaterThan(30);
    }
  });

  it("a broad push trigger does not file an issue on every failed push", () => {
    /**
     * I first wrote this as "a reporting workflow must ONLY file on schedule or
     * dispatch", and the repo proved me wrong. `race-runner.yml` files on push
     * — and that is exactly how it told me, within minutes, that a migration I
     * had just pushed read `public.jobs` without a row lock (#1643). An issue
     * on a narrow push trigger is not noise, it is the fastest feedback there
     * is.
     *
     * The real hazard is a workflow that runs on EVERY push filing an issue
     * every time. `nightly-issue-sync` keeps one issue per workflow and closes
     * it on green, so even that self-limits — but a label that opens and shuts
     * all day is a label people stop reading, and this whole mechanism dies the
     * moment that happens.
     *
     * So the rule is about BREADTH, not about the event: a push trigger with
     * `paths:` is scoped and fine; an unscoped one must gate the notify job on
     * the event.
     */
    /**
     * Unscoped push + reporting, on purpose. Each entry is a claim that an
     * issue on a failed PUSH is the right outcome for that workflow.
     */
    const BROAD_ON_PURPOSE: Record<string, string> = {
      "prod-freshness.yml":
        "a failed push here MEANS vercel.json no longer validates, so no deploy can start — an issue is the correct outcome, not noise, and waiting for the hourly run would hide it",
      "prod-deploy.yml":
        "a failed push here MEANS the production deploy of main failed or the Vercel API could not be read — prod is not shipping, so an issue is the correct outcome, not noise",
      "nightly-red-age.yml":
        "this IS the gate; filing is its job. If it breaks on a push, every other workflow's report goes unread, so it is the last thing that should stay quiet",
    };
    const wrong = files.filter((f) => {
      if (f in BROAD_ON_PURPOSE) return false;
      const src = readFileSync(join(DIR, f), "utf8");
      if (!src.includes("nightly-issue-sync")) return false;
      const push = src.match(/\n {2}push:\n([\s\S]*?)(?=\n {2}\w|\njobs:)/);
      if (!push) return false;
      const scoped = /\n\s{4}paths:/.test(push[1]);
      const gated = /github\.event_name == 'schedule'/.test(src);
      return !scoped && !gated;
    });
    expect(
      wrong,
      "These file a nightly-red issue on an UNSCOPED push trigger, so an ordinary " +
        "failed push opens an issue. Either add `paths:` to the push trigger, or " +
        "gate the notify job on `github.event_name == 'schedule' || " +
        "github.event_name == 'workflow_dispatch'`:\n  " + wrong.join("\n  "),
    ).toEqual([]);
  });
});

// Proof this is able to fail: strip the reporter out of the nightly backup and
// a recovery-critical workflow goes silent again.
// @mutate .github/workflows/db-backup.yml | ./.github/actions/nightly-issue-sync | ./.github/actions/noop-placeholder
