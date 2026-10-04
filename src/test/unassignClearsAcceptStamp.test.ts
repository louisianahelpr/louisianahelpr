/*
 * CLASS GUARD (lh-authz-rls re-review of Q1180, 2026-10-03, finding #1): a job
 * that loses its Helpr keeps no acceptance of the Helpr who left.
 *
 * decline_job_offer reopened confirmed and in-progress jobs with
 * helper_confirmed_at / helper_dayof_confirmed_at still set (PGlite R1-R3).
 * The poster's next Hire then made an offer born confirmed: the new Helpr
 * never tapped Accept, the poster was never told, the other applicants were
 * never closed, and the row was eligible for auto_start_due_jobs and priced as
 * committed by poster_cancel_job. report_helper_no_show had the same hole
 * (first review, F3). Both are fixed in 20261003193541.
 *
 * The rule, for every UPDATE of jobs that sets helper_id to NULL — in every
 * function the migrations leave defined, every edge function and the app —
 * it also clears helper_confirmed_at, or it is listed in UNCONFIRMED_ONLY with
 * the predicate that proves the row it reopens was never confirmed. Both lists
 * are exact: an entry whose function no longer unassigns, or whose proof is
 * gone, is red. Red first: on origin/main of 2026-10-03 (before
 * 20261003193541) it names decline_job_offer and report_helper_no_show, the two
 * holes the reviews found.
 */
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql |      OR v_job_status IS DISTINCT FROM 'accepted'\n     OR v_job_confirmed IS NOT NULL THEN |      OR v_job_status IS DISTINCT FROM 'accepted' THEN
// @mutate supabase/migrations/20261002055930_series_cancel_locks_parent_first.sql |          response_deadline = NULL,\n         helper_confirmed_at = NULL, |          response_deadline = NULL,
// @mutate supabase/functions/auto-expire-jobs/index.ts |         .is("helper_confirmed_at", null)\n        .select("id"); |         .select("id");
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));

/**
 * Functions that unassign WITHOUT clearing the stamp, each with the predicate
 * (on its comment-blanked body) proving the row was never confirmed.
 */
const UNCONFIRMED_ONLY: Record<string, { proof: RegExp; why: string }> = {
  expire_unanswered_offers: {
    proof: /AND j\.helper_confirmed_at IS NULL\s+FOR UPDATE SKIP LOCKED;/,
    why: "the locked re-read takes only rows with helper_confirmed_at IS NULL",
  },
  decline_job_offer: {
    proof: /OR v_job_status IS DISTINCT FROM 'accepted'\s+OR v_job_confirmed IS NOT NULL THEN\s+RAISE EXCEPTION 'offer_not_active';/,
    why: "refuses anything but a live, unconfirmed offer before it reopens (20261003193541)",
  },
};

/** Client and edge writes (supabase-js) that unassign, with their proof. */
const UNCONFIRMED_ONLY_TS: Record<string, { proof: RegExp; why: string }> = {
  "supabase/functions/auto-expire-jobs/index.ts": {
    proof: /\.update\(\{ status: "open", helper_id: null \}\)[\s\S]{0,200}?\.is\("helper_confirmed_at", null\)/,
    why: "the conditional write matches only helper_confirmed_at IS NULL",
  },
};

const UNASSIGN_SQL = /\bhelper_id\s*=\s*NULL\b/i;
const CLEARS_SQL = /\bhelper_confirmed_at\s*=\s*NULL\b/i;

function sqlUnassigns(): { fn: string; clears: boolean }[] {
  const out: { fn: string; clears: boolean }[] = [];
  for (const [fn, d] of defs) {
    const code = blankSqlComments(d.stmt);
    for (const m of code.matchAll(/\bUPDATE\s+(?:public\.)?jobs\b[\s\S]*?;/gi)) {
      if (UNASSIGN_SQL.test(m[0])) out.push({ fn, clears: CLEARS_SQL.test(m[0]) });
    }
  }
  return out;
}

function walk(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$|__tests__|(^|\/)test\//.test(f))
    .map((f) => join(dir, f));
}

function tsUnassigns(): { file: string; clears: boolean }[] {
  const out: { file: string; clears: boolean }[] = [];
  for (const file of [...walk(join(ROOT, "supabase", "functions")), ...walk(join(ROOT, "src"))]) {
    const code = blankComments(readFileSync(file, "utf8"));
    for (const m of code.matchAll(/\.update\(\{([^}]*)\}\)/g)) {
      if (/\bhelper_id:\s*null\b/.test(m[1])) out.push({ file: relative(ROOT, file), clears: /\bhelper_confirmed_at:\s*null\b/.test(m[1]) });
    }
  }
  return out;
}

describe("a job that loses its Helpr keeps no acceptance of the Helpr who left (Q1180 re-review #1)", () => {
  it("every SQL unassign clears helper_confirmed_at, or proves the row was never confirmed", () => {
    const found = sqlUnassigns();
    // seven functions unassign today (measured 2026-10-03): the inventory must be real
    expect(found.length).toBeGreaterThanOrEqual(7);
    const unproven = found
      .filter((u) => !u.clears)
      .filter((u) => !(UNCONFIRMED_ONLY[u.fn] && UNCONFIRMED_ONLY[u.fn].proof.test(blankSqlComments(defs.get(u.fn)!.stmt))))
      .map((u) => u.fn);
    expect(unproven, "unassigns without clearing helper_confirmed_at and without a proof").toEqual([]);
  });

  it("every UNCONFIRMED_ONLY entry is still needed (exact list)", () => {
    const keepers = new Set(sqlUnassigns().filter((u) => !u.clears).map((u) => u.fn));
    expect(Object.keys(UNCONFIRMED_ONLY).sort()).toEqual([...keepers].sort());
  });

  it("every app and edge-function unassign clears the stamp, or proves the row was never confirmed (exact list)", () => {
    const found = tsUnassigns();
    const keepers = [...new Set(found.filter((u) => !u.clears).map((u) => u.file))].sort();
    expect(keepers).toEqual(Object.keys(UNCONFIRMED_ONLY_TS).sort());
    for (const [file, { proof }] of Object.entries(UNCONFIRMED_ONLY_TS)) {
      expect(blankComments(readFileSync(join(ROOT, file), "utf8")), `${file}: the never-confirmed predicate is gone`).toMatch(proof);
    }
  });
});
