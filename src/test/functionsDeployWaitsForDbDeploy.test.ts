// @mutate .github/workflows/functions-deploy.yml | runs?head_sha=${SHA}&per_page=10 | runs?per_page=10
// @mutate .github/workflows/functions-deploy.yml |     timeout-minutes: 60 |     timeout-minutes: 15
/**
 * CLASS GUARD: a workflow that deploys edge functions waits for the SAME
 * commit's db-deploy run to finish before it judges whether the RPCs those
 * functions call exist on prod (issue #1819, nightly-red "main: Vacuity").
 *
 * #1812 (9f2021865) added export_my_data() in a migration and the
 * export-my-data edge function that calls it. functions-deploy's only wait was
 * `check-edge-rpcs-live.mjs --wait 300`, sized for "the migration lands about
 * a minute later". The migration is applied by db-deploy.yml, a separate
 * workflow on the same push, which ran 03:43:36-03:52:13Z. Run 36215687560:
 *
 *   ##[error]public.export_my_data does not exist on prod, but
 *   supabase/functions/export-my-data/index.ts calls it. Land the migration
 *   that creates it first (it auto-applies on merge), then re-run this deploy.
 *
 * at 03:49:02Z, three minutes before db-deploy created it. No function was
 * uploaded: export-my-data answered 404 on prod (measured 2026-09-26 03:57Z),
 * so "Download My Data" failed for everyone, and the privacy journey the
 * Vacuity gate runs against prod was red before any mutation.
 *
 * Inventory: every workflow with a `supabase functions deploy` step.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(__dirname, "..", "..");
const WF_DIR = resolve(ROOT, ".github/workflows");
type Step = { name?: string; run?: string; env?: Record<string, string>; "continue-on-error"?: unknown; if?: string };
type Job = { steps?: Step[]; "timeout-minutes"?: number };
type Workflow = { permissions?: Record<string, string>; jobs: Record<string, Job> };

const deployers = readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, wf: parse(readFileSync(resolve(WF_DIR, f), "utf8")) as Workflow }))
  .flatMap(({ file, wf }) =>
    Object.entries(wf.jobs ?? {})
      .filter(([, job]) => (job.steps ?? []).some((s) => /supabase functions deploy/.test(s.run ?? "")))
      .map(([id, job]) => ({ file, wf, id, job, steps: job.steps ?? [] })),
  );

const isWait = (s: Step) =>
  /actions\/workflows\/db-deploy\.yml\/runs\?head_sha=\$\{SHA\}/.test(s.run ?? "") && s.env?.SHA === "${{ github.sha }}";

describe("edge-function deploys wait for this commit's db-deploy (issue #1819)", () => {
  it("finds every deploying job (inventory floor)", () => {
    expect(deployers.length).toBeGreaterThan(0);
    expect(deployers.map((d) => d.file)).toContain("functions-deploy.yml");
  });

  for (const d of deployers) {
    describe(`${d.file} / ${d.id}`, () => {
      const waitAt = d.steps.findIndex(isWait);
      const rpcCheckAt = d.steps.findIndex((s) => /check-edge-rpcs-live\.mjs/.test(s.run ?? ""));
      const firstDeployAt = d.steps.findIndex((s) => /supabase functions deploy/.test(s.run ?? ""));

      it("has a step that polls db-deploy runs for this exact commit", () => {
        expect(waitAt, "no step reads db-deploy.yml runs?head_sha=${SHA} with SHA=${{ github.sha }}").toBeGreaterThanOrEqual(0);
      });

      it("waits before the RPC check and before any upload, and cannot be skipped past", () => {
        expect(rpcCheckAt).toBeGreaterThanOrEqual(0);
        expect(waitAt).toBeLessThan(rpcCheckAt);
        expect(waitAt).toBeLessThan(firstDeployAt);
        const wait = d.steps[waitAt];
        expect(wait?.["continue-on-error"]).toBeUndefined();
        // Same gate as the RPC check: runs whenever a deploy will happen.
        expect(wait?.if).toBe(d.steps[rpcCheckAt]?.if);
      });

      it("can read Actions runs, and the job outlives the wait", () => {
        expect(d.wf.permissions?.actions).toBe("read");
        const run = d.steps[waitAt]?.run ?? "";
        const maxWaitS = Number(/ELAPSED" -ge (\d{3,})/.exec(run)?.[1] ?? NaN);
        expect(maxWaitS).toBeGreaterThan(20 * 60); // db-deploy took 20 min on 2026-09-26 01:03Z
        expect(Number(d.job["timeout-minutes"])).toBeGreaterThan(maxWaitS / 60 + 5);
      });
    });
  }
});
