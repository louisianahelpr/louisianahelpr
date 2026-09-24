/**
 * Q346 — the hire columns are not client-writable. Hiring goes through the
 * hire RPCs, and only through them.
 *
 * WHAT WAS BROKEN (prod, measured 2026-09-24T04:24Z with
 * scripts/probes/direct-patch-hire.prod.mjs): with a plain PostgREST PATCH /
 * POST and a seed account's JWT,
 *   A  a poster set jobs.helper_id=<someone who never applied>, status=accepted
 *   B  a direct-offer target set jobs.helper_id=self, status=accepted
 *   C  a poster re-pointed jobs.offered_to_helper_id at someone else
 *   D  a poster INSERTed a group_job_helpers row for anyone
 * — all 200/201 with the row written. No application, no consent, no
 * are_users_blocked check (Q345 put those in the RPCs; these doors skip them).
 *
 * THE CLASS: a hire-shaped write (a person newly put on a job, a job newly
 * `accepted`, an offer newly pointed at someone, a crew seat) arriving from a
 * client seat instead of a SECURITY DEFINER hire RPC. Three layers:
 *   1. DB: trg_hire_columns_rpc_only exists on both tables with the right
 *      events, its function is SECURITY INVOKER (a definer would make
 *      current_user always the owner and the gate inert) and its gate is the
 *      request role, and it refuses each hire-shaped write.
 *   2. DB: every function whose effective definition makes a hire-shaped write
 *      is SECURITY DEFINER — the trigger lets exactly those through, so an
 *      invoker one would either be refused (broken hiring) or be a new door.
 *   3. Client: no `.from("jobs").update/upsert(...)` in src/ writes helper_id
 *      (non-null), offered_to_helper_id or status "accepted", and nothing in
 *      src/ writes group_job_helpers except delete.
 * Behavioural proof, red-before / green-after, 3x replay:
 * scripts/probes/hire-columns-rpc-only.pglite.mjs. Live re-run:
 * scripts/probes/direct-patch-hire.prod.mjs.
 */
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FN = "enforce_hire_columns_rpc_only";
const TRIGGER = "trg_hire_columns_rpc_only";

/** Last CREATE/DROP of TRIGGER on each table, across all migrations in order. */
function triggerState(): Map<string, string | null> {
  const state = new Map<string, string | null>();
  const re = new RegExp(
    `(create\\s+trigger\\s+${TRIGGER}\\s+([\\s\\S]*?)\\s+on\\s+(?:public\\.)?(\\w+)([^;]*))|(drop\\s+trigger\\s+(?:if\\s+exists\\s+)?${TRIGGER}\\s+on\\s+(?:public\\.)?(\\w+))`,
    "gi",
  );
  for (const f of migrationFiles(MIG_DIR)) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(re)) {
      if (m[1]) state.set(m[3].toLowerCase(), `${m[2]} ${m[4]}`.replace(/\s+/g, " ").toLowerCase());
      else state.set(m[6].toLowerCase(), null);
    }
  }
  return state;
}

describe("Q346 layer 1: the trigger refuses client hire writes", () => {
  const defs = effectiveDefs(MIG_DIR);
  const def = defs.get(FN);
  const body = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ").toLowerCase();

  it("the function exists and is not dropped after its definition", () => {
    expect(def, `${FN} is not defined by any migration`).toBeTruthy();
    for (const f of migrationFiles(MIG_DIR)) {
      if (f <= (def?.file ?? "")) continue;
      const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
      expect(sql, `${f} drops ${FN}`).not.toMatch(new RegExp(`drop\\s+function\\s+(if\\s+exists\\s+)?(public\\.)?${FN}\\b`, "i"));
    }
  });

  it("is SECURITY INVOKER and gates on the request role, not on auth.uid()", () => {
    expect(body).not.toMatch(/security\s+definer/);
    expect(body).toMatch(/if current_user::text not in \('authenticated', 'anon'\) then return new; end if;/);
  });

  it("refuses jobs.helper_id newly set", () => {
    expect(body).toMatch(/if new\.helper_id is not null and new\.helper_id is distinct from old\.helper_id then raise exception 'hire_requires_rpc/);
  });
  it("refuses jobs.status newly 'accepted'", () => {
    expect(body).toMatch(/if new\.status::text = 'accepted' and old\.status::text is distinct from 'accepted' then raise exception 'hire_requires_rpc/);
  });
  it("refuses jobs.offered_to_helper_id newly pointed", () => {
    expect(body).toMatch(/if new\.offered_to_helper_id is not null and new\.offered_to_helper_id is distinct from old\.offered_to_helper_id then raise exception 'hire_requires_rpc/);
  });
  it("refuses a group_job_helpers INSERT and a crew helper_id re-point", () => {
    expect(body).toMatch(/if tg_op = 'insert' then raise exception 'hire_requires_rpc/);
    expect(body).toMatch(/if new\.helper_id is distinct from old\.helper_id then raise exception 'hire_requires_rpc/);
  });

  it("is attached BEFORE UPDATE on jobs and BEFORE INSERT OR UPDATE on group_job_helpers", () => {
    const state = triggerState();
    expect(state.get("jobs")).toMatch(/^before update\b.*for each row execute function (public\.)?enforce_hire_columns_rpc_only/);
    expect(state.get("group_job_helpers")).toMatch(/^before insert or update\b.*for each row execute function (public\.)?enforce_hire_columns_rpc_only/);
  });
});

describe("Q346 layer 2: every hire-writing function is a definer the trigger lets through", () => {
  const defs = effectiveDefs(MIG_DIR);
  const droppedAfter = new Map<string, string>();
  for (const f of migrationFiles(MIG_DIR)) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)) droppedAfter.set(m[1].toLowerCase(), f);
  }
  // An UPDATE of jobs whose SET list assigns helper_id a non-NULL value,
  // offered_to_helper_id a non-NULL value, or status 'accepted'; or any INSERT
  // into group_job_helpers.
  const JOBS_UPDATE = /update\s+(?:public\.)?jobs\b(?:\s+\w+)?\s+set\s+([^;]*?)(?:\bwhere\b|;|\breturning\b)/gi;
  const HIRE_SET = /(?<![\w.])(?:helper_id|offered_to_helper_id)\s*=\s*(?!null\b)|(?<![\w.])status\s*=\s*'accepted'/i;
  const writers = new Map<string, string>();
  for (const [name, def] of defs) {
    const dropped = droppedAfter.get(name);
    if (dropped && dropped > def.file) continue;
    const code = blankSqlComments(def.stmt);
    const sets = [...code.matchAll(JOBS_UPDATE)].some((m) => HIRE_SET.test(m[1]));
    if (sets || /insert\s+into\s+(?:public\.)?group_job_helpers\b/i.test(code)) writers.set(name, code);
  }

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(100);
    // accept_application, accept_group_application, respond_to_direct_offer
    // at the least.
    expect(writers.size).toBeGreaterThan(2);
    for (const n of ["accept_application", "accept_group_application", "respond_to_direct_offer"]) {
      expect(writers.has(n), `${n} not recognised as a hire writer — the scan is blind`).toBe(true);
    }
  });

  it("each is SECURITY DEFINER", () => {
    const invoker = [...writers].filter(([, code]) => !/security\s+definer/i.test(code)).map(([n]) => n);
    expect(invoker, "hire-writing functions that would run as the client and be refused (or be a new door)").toEqual([]);
  });
});

describe("Q346 layer 3: the client never writes a hire column", () => {
  const files = walkSource([join(ROOT, "src")]).filter((f) => !/\.test\.tsx?$|\/src\/test\//.test(f));
  const FORBIDDEN = /(?<![\w.])helper_id\s*:\s*(?!null\b)|offered_to_helper_id\s*:|status\s*:\s*["']accepted["']/;
  let jobsWrites = 0;
  const hits: string[] = [];
  for (const f of files) {
    const src = readSource(f);
    if (!src) continue;
    const code = blankComments(src);
    for (const m of code.matchAll(/\.from\(\s*["'](jobs|group_job_helpers)["']\s*\)/g)) {
      const chainEnd = code.indexOf(";", m.index!);
      const chain = code.slice(m.index!, chainEnd === -1 ? undefined : chainEnd);
      const verb = /\.(update|upsert|insert)\s*\(/.exec(chain);
      if (!verb) continue;
      const line = code.slice(0, m.index!).split("\n").length;
      const where = `${relative(ROOT, f)}:${line}`;
      if (m[1] === "group_job_helpers") {
        hits.push(`${where} writes group_job_helpers (${verb[1]})`);
        continue;
      }
      if (verb[1] === "insert") continue; // a new job: trg_jobs_insert_column_lock + the INSERT policy own it
      jobsWrites++;
      if (FORBIDDEN.test(chain)) hits.push(`${where} ${verb[1]}s a hire column on jobs`);
    }
  }

  it("the scan sees the client's jobs writes", () => {
    expect(files.length).toBeGreaterThan(800);
    expect(jobsWrites).toBeGreaterThan(10);
  });

  it("no client write sets jobs.helper_id / offered_to_helper_id / status accepted, or writes a crew seat", () => {
    expect(hits).toEqual([]);
  });
});

// Layer 1: each refusal and each structural property, broken one at a time.
// @mutate supabase/migrations/20260924044812_recurring_helper_rpc_only.sql | IF current_user::text NOT IN ('authenticated', 'anon') THEN | IF true THEN
// @mutate supabase/migrations/20260924044812_recurring_helper_rpc_only.sql | LANGUAGE plpgsql\nSET search_path | LANGUAGE plpgsql SECURITY DEFINER\nSET search_path
// @mutate supabase/migrations/20260924044812_recurring_helper_rpc_only.sql | IF NEW.helper_id IS NOT NULL AND NEW.helper_id IS DISTINCT FROM OLD.helper_id THEN | IF false THEN
// @mutate supabase/migrations/20260924044812_recurring_helper_rpc_only.sql | IF NEW.status::text = 'accepted' AND OLD.status::text IS DISTINCT FROM 'accepted' THEN | IF false THEN
// @mutate supabase/migrations/20260924044812_recurring_helper_rpc_only.sql | IF NEW.offered_to_helper_id IS NOT NULL | IF false AND NEW.offered_to_helper_id IS NOT NULL
// @mutate supabase/migrations/20260924044812_recurring_helper_rpc_only.sql | IF TG_OP = 'INSERT' THEN | IF false THEN
// @mutate supabase/migrations/20260924042503_hire_columns_rpc_only.sql | BEFORE INSERT OR UPDATE ON public.group_job_helpers | BEFORE UPDATE ON public.group_job_helpers
// @mutate supabase/migrations/20260924042503_hire_columns_rpc_only.sql | BEFORE UPDATE ON public.jobs | AFTER UPDATE ON public.jobs
// Layer 3: a client hire write planted.
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts | .update({ helper_confirmed_at: confirmedAt, response_deadline: null }) | .update({ helper_confirmed_at: confirmedAt, helper_id: app.helper_id })
