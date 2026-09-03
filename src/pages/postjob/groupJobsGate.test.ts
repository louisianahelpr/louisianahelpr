import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { GROUP_JOBS_ENABLED } from "@/lib/groupJobs";

const root = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const migrations = () =>
  readdirSync(resolve(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));

/**
 * Group jobs are WITHDRAWN. See `src/lib/groupJobs.ts` for the five breakages.
 *
 * These are tripwires, not unit tests: each one exists so that turning the flag
 * back on without the work behind it fails here rather than in production, and
 * so that the withdrawal cannot be half-undone (control back, coercion gone).
 */
describe("group jobs — withdrawal gate", () => {
  it("only opens Group once the roster can hold per-member lifecycle state", () => {
    // The blocker for helper #2 is not the RLS policy, it is that `jobs`
    // carries SCALAR helper_arrived_at / helper_completed_at and the schema
    // cannot represent N arrivals. Widening the policy without moving that
    // state onto `group_job_helpers` also defeats
    // `enforce_helper_completion_gates` and
    // `enforce_helper_jobs_column_whitelist`, both of which early-return on
    // `auth.uid() IS DISTINCT FROM OLD.helper_id` — so helpers 2..N could
    // complete a job with no verified arrival, no proof photos and no
    // 30-minute floor.
    //
    // So the assertion is a LINK, not a constant: if the flag is on, a
    // migration must have added per-member completion state to the roster
    // table.
    if (!GROUP_JOBS_ENABLED) {
      expect(read("src/lib/groupJobs.ts")).toMatch(
        /export const GROUP_JOBS_ENABLED = false;/,
      );
      return;
    }
    const withRosterLifecycle = migrations().filter((f) => {
      const sql = read(`supabase/migrations/${f}`);
      return (
        /alter\s+table\s+(public\.)?group_job_helpers/i.test(sql) &&
        /helper_completed_at/i.test(sql)
      );
    });
    expect(
      withRosterLifecycle.length,
      "GROUP_JOBS_ENABLED is true but no migration gives group_job_helpers per-member completion state — helpers 2..N still cannot mark complete, and widening the jobs UPDATE policy without it defeats both completion-gate triggers",
    ).toBeGreaterThan(0);
  });

  it("keeps the segmented control and the insert payload agreeing", () => {
    // Both halves of the withdrawal have to move together. The control being
    // absent is not enough on its own — `isGroupJob` is rehydrated from a
    // saved draft (useJobEntry:123) and from an AI-builder payload
    // (useJobEntry:96) — and the coercion being absent is not enough either,
    // because then the control offers something the submit silently discards.
    const logistics = read("src/components/postjob/LogisticsSection.tsx");
    const submit = read("src/pages/postjob/jobSubmitHelpers.ts");

    // STRUCTURE, NOT A SOURCE STRING. This read
    //   toContain('GROUP_JOBS_ENABLED ? [{ key: "group", label: "Group" }')
    // and broke the moment the segmented controls were unified, because the
    // shared SegmentedControl takes `value:` where this hand-rolled one took
    // `key:`. The GATE was never touched — but a renamed property and a DELETED
    // gate fail this test identically, so the one thing it exists to detect
    // became indistinguishable from routine refactoring. A tripwire whose
    // alarm cannot be told apart from noise gets disabled by whoever is
    // unblocking the build, which is how a withdrawn feature comes back.
    //
    // What must hold is narrow and survives renaming: the "group" option may
    // only be produced by an expression guarded on GROUP_JOBS_ENABLED.
    expect(
      logistics,
      'the "group" segment must be produced only behind GROUP_JOBS_ENABLED',
    ).toMatch(/GROUP_JOBS_ENABLED\s*\?[\s\S]{0,120}?["']group["']/);
    expect(logistics).toContain("{GROUP_JOBS_ENABLED && isGroupJob && (");
    expect(submit).toContain("is_group_job: GROUP_JOBS_ENABLED && isGroupJob,");
    expect(submit).toContain(
      "helpers_needed: GROUP_JOBS_ENABLED && isGroupJob ? parseInt(helpersNeeded) || 2 : 1,",
    );
  });

  it("backs the client withdrawal with a server-side refusal", () => {
    // This app ships its UI bundled inside the .ipa/.apk, so every App Store
    // build already on a phone keeps rendering the Group segment until that
    // user updates. A client-only withdrawal withdraws the feature from nobody
    // who already has it.
    if (GROUP_JOBS_ENABLED) return;
    const gated = migrations().filter((f) => {
      const sql = read(`supabase/migrations/${f}`);
      return /reject_new_group_jobs/i.test(sql) && /create\s+trigger/i.test(sql);
    });
    expect(
      gated.length,
      "GROUP_JOBS_ENABLED is false but no migration installs the reject_new_group_jobs trigger — an older bundled build can still post a group job",
    ).toBeGreaterThan(0);
  });

  it("leaves no money path that pays 1-of-N and marks the job settled", () => {
    // All three writers that can move a group job's escrow must refuse a
    // multi-member roster rather than pay `jobs.helper_id` its 1/N share and
    // flip the job terminal. process-scheduled-payouts is the only one that
    // may pay, because it fans out across the roster and holds the job in
    // payout_pending until every slot is settled.
    const releasePayout = read("supabase/functions/release-payout/index.ts");
    const disputeSplit = read("supabase/functions/execute-dispute-split/index.ts");
    const createPayment = read("supabase/functions/create-payment/index.ts");

    expect(releasePayout).toMatch(/is_group_job && \(job\.helpers_needed \?\? 1\) > 1/);
    expect(disputeSplit).toMatch(/if \(job\.is_group_job\)/);
    // The one that used to pay 1/N. Its guard must sit inside
    // admin_release_dispute, ahead of the transfer.
    const disputeAction = createPayment.slice(
      createPayment.indexOf('if (action === "admin_release_dispute")'),
      createPayment.indexOf('if (action === "admin_refund_dispute")'),
    );
    expect(disputeAction).not.toHaveLength(0);
    expect(disputeAction).toMatch(/is_group_job && \(job\.helpers_needed \?\? 1\) > 1/);
    expect(disputeAction.indexOf("group_job_helpers")).toBeLessThan(
      disputeAction.indexOf("transferToHelper"),
    );
  });
});
