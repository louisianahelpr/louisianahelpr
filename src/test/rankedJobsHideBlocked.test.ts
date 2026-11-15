/**
 * Blocks hide jobs on the new member Home's "Jobs near you", on the Browse map and in the welcome emails, both
 * directions.
 *
 * get_ranked_open_jobs and get_open_jobs_for_map return no poster id, so no client can drop a blocked poster's job;
 * the RPCs have to. And the
 * service role has no session, so an edge function that calls it (welcome-emails) gets every job and must drop the
 * member's block partners itself, failing closed when the block read fails.
 *
 *   1. The newest definition of each of the two RPCs carries NOT EXISTS a user_blocks row between auth.uid() and the
 *      job's poster, in BOTH directions. Behaviour proven in src/test/pglite/rankedJobsHideBlocked.pglite.mjs
 *      (2026-11-15: NEW_MIGRATION=skip: 10 FAIL; applied 3x: ALL PASS; the superseded
 *      20261115023248, which restated the pre-mask bodies, fails its masking-plus-blocking checks, measured 2026-11-15).
 *      Q2807 (20261115064940): the same filter in get_public_open_jobs (the landing teaser) and in
 *      public_profile_by_handle's open-jobs list; and enqueue_instant_job_match skips a member in a block with the
 *      poster, either direction, BEFORE anything is queued. Behaviour proven in
 *      src/test/pglite/teaserProfileMatchHideBlocked.pglite.mjs (2026-11-15: NEW_MIGRATION=skip: 15 FAIL; applied 3x:
 *      ALL PASS).
 *   2. CLASS: every edge function that calls get_ranked_open_jobs reads user_blocks (both columns) and filters on it.
 *      The sender's behaviour (both directions, items too, fail closed) is proven in
 *      src/test/edge/welcome-emails.test.ts.
 *
 * @mutate supabase/migrations/20261115063613_ranked_jobs_hide_blocked_keep_guest_mask.sql | OR (b.blocker_id = j.customer_id AND b.blocked_id = (SELECT auth.uid()))\n      )\n  ) | )\n  )
 * @mutate supabase/migrations/20261115063613_ranked_jobs_hide_blocked_keep_guest_mask.sql | SELECT 1 FROM public.user_blocks b\n         WHERE | SELECT 1 FROM public.ban_settlement_queue b\n         WHERE false AND
 * @mutate supabase/migrations/20261115063613_ranked_jobs_hide_blocked_keep_guest_mask.sql | )\n          OR (b.blocker_id = j.customer_id AND b.blocked_id = (SELECT auth.uid()))\n    ) | )\n    )
 * @mutate supabase/migrations/20261115063613_ranked_jobs_hide_blocked_keep_guest_mask.sql | SELECT 1 FROM public.user_blocks b\n       WHERE | SELECT 1 FROM public.ban_settlement_queue b\n       WHERE false AND
 * @mutate supabase/migrations/20261115064940_teaser_profile_instant_match_hide_blocked.sql | OR (b.blocker_id = j.customer_id AND b.blocked_id = (SELECT auth.uid()))\n    )\n  ORDER BY | )\n  ORDER BY
 * @mutate supabase/migrations/20261115064940_teaser_profile_instant_match_hide_blocked.sql | OR (b.blocker_id = j.customer_id AND b.blocked_id = (SELECT auth.uid()))\n         )\n       ORDER BY j.date_needed | )\n       ORDER BY j.date_needed
 * @mutate supabase/migrations/20261115064940_teaser_profile_instant_match_hide_blocked.sql | OR (b.blocker_id = v_uid AND b.blocked_id = v_job.customer_id) | OR false
 * @mutate supabase/migrations/20261115064940_teaser_profile_instant_match_hide_blocked.sql | CONTINUE WHEN EXISTS ( | CONTINUE WHEN false AND EXISTS (
 * @mutate supabase/functions/welcome-emails/index.ts |           .from("user_blocks") |           .from("user_profiles")
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "@/test/helpers/trackedFiles";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const squash = (s: string) => s.replace(/\s+/g, " ");

describe("the job-browse RPCs with no poster id hide jobs across a block, both directions", () => {
  const defs = effectiveDefs(resolve(REPO, "supabase/migrations"));
  for (const fn of ["get_ranked_open_jobs", "get_open_jobs_for_map", "get_public_open_jobs", "public_profile_by_handle"]) it(`${fn}: the newest definition filters user_blocks between auth.uid() and the poster, either direction`, () => {
    const def = defs.get(fn);
    expect(def, `${fn} has a definition`).toBeTruthy();
    const body = squash(blankSqlComments(def!.stmt));
    const at = body.search(/AND NOT EXISTS \( SELECT 1 FROM public\.user_blocks \w+ WHERE /);
    expect(at, `${def!.file}: an AND NOT EXISTS (SELECT 1 FROM public.user_blocks … ) condition`).toBeGreaterThan(-1);
    const clause = body.slice(at, at + 260);
    const b = /user_blocks (\w+) WHERE/.exec(clause)![1];
    const me = "\\(SELECT auth\\.uid\\(\\)\\)";
    expect(clause).toMatch(new RegExp(`${b}\\.blocker_id = ${me} AND ${b}\\.blocked_id = j\\.customer_id`));
    expect(clause).toMatch(new RegExp(`${b}\\.blocker_id = j\\.customer_id AND ${b}\\.blocked_id = ${me}`));
  });
});

describe("enqueue_instant_job_match never queues a member in a block with the poster (Q2807)", () => {
  const defs = effectiveDefs(resolve(REPO, "supabase/migrations"));
  it("the newest definition skips a blocked pair, either direction, before the queue insert", () => {
    const def = defs.get("enqueue_instant_job_match");
    expect(def, "enqueue_instant_job_match has a definition").toBeTruthy();
    const body = squash(blankSqlComments(def!.stmt));
    const at = body.search(/CONTINUE WHEN EXISTS \( SELECT 1 FROM public\.user_blocks \w+ WHERE /);
    expect(at, `${def!.file}: a CONTINUE WHEN EXISTS (SELECT 1 FROM public.user_blocks … ) skip`).toBeGreaterThan(-1);
    expect(at, "the skip comes before INSERT INTO public.job_match_queue").toBeLessThan(body.indexOf("INSERT INTO public.job_match_queue"));
    const clause = body.slice(at, at + 260);
    const b = /user_blocks (\w+) WHERE/.exec(clause)![1];
    expect(clause).toMatch(new RegExp(`${b}\\.blocker_id = v_job\\.customer_id AND ${b}\\.blocked_id = v_uid`));
    expect(clause).toMatch(new RegExp(`${b}\\.blocker_id = v_uid AND ${b}\\.blocked_id = v_job\\.customer_id`));
  });
});

describe("CLASS: an edge function that reads get_ranked_open_jobs drops the member's block partners itself", () => {
  const dir = resolve(REPO, "supabase/functions");
  const callers = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => resolve(dir, d.name, "index.ts"))
    .filter((f) => existsSync(f) && /\.rpc\(\s*["']get_ranked_open_jobs["']/.test(blankComments(readFileSync(f, "utf8"))));

  it("finds the callers (inventory floor)", () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  for (const f of callers) {
    it(`${f.slice(dir.length + 1)} reads user_blocks in both directions and filters with it`, () => {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src).toMatch(/\.from\(\s*["']user_blocks["']\s*\)/);
      expect(src).toMatch(/blocker_id\.eq\.[^,`]+,blocked_id\.eq\./);
      expect(src).toMatch(/blockedWith\.has\(/);
    });
  }
});
