// Q1868 (lh-authz-rls review of 96ba87037, should-fix 4): quote_insert_job
// inserts jobs as the SECURITY DEFINER owner, so the jobs INSERT policy's
// WITH CHECK never runs for it. Its callers (book_accepted_quote,
// switch_quote_request_to_set_price) re-check every clause by hand today:
// ownership (poster = caller), business_id (never written, so NULL) and the
// blocked pair on the direct offer. A clause added to the policy later would
// silently not apply to quote jobs.
//
// So this pins, read from what the migrations leave in the database:
//   * the set of jobs policies that govern INSERT (FOR INSERT or FOR ALL) is
//     exactly "Customers can create jobs";
//   * its newest WITH CHECK, whitespace-normalised, is exactly the text below
//     (measured live 2026-10-17 on prod, pg_policies.with_check:
//     ((( SELECT auth.uid() AS uid) = customer_id) AND (business_id IS NULL)
//     AND ((offered_to_helper_id IS NULL) OR (NOT are_users_blocked(customer_id,
//     offered_to_helper_id)))));
//   * the effective quote_insert_job / book_accepted_quote /
//     switch_quote_request_to_set_price still mirror each clause.
// A policy change turns this red until the quote path is re-reviewed and the
// pin is moved here, on purpose.
//
// @mutate supabase/migrations/20261001222911_remove_idv_requirement.sql |     AND business_id IS NULL\n | \n
// @mutate supabase/migrations/20261015091114_job_quotes.sql |   IF public.are_users_blocked(v_uid, v_q.quoter_id) THEN\n    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';\n  END IF;\n\n  -- Whole dollars | \n  -- Whole dollars
// @mutate supabase/migrations/20261015091114_job_quotes.sql |   VALUES (p_req.poster_id, p_req.title, | VALUES ((SELECT auth.uid()), p_req.title,
// @mutate supabase/migrations/20261015091114_job_quotes.sql |   v_job := public.quote_insert_job(v_req, p_budget, NULL); |   v_job := public.quote_insert_job(v_req, p_budget, v_req.poster_id);
// @mutate supabase/migrations/20261015091114_job_quotes.sql |                            offered_to_helper_id, direct_offer_expires_at) |                            offered_to_helper_id, direct_offer_expires_at, is_seed)
// @mutate supabase/migrations/20261001222911_remove_idv_requirement.sql | DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs; | DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs;\nCREATE POLICY jobs_open_insert ON public.jobs FOR INSERT WITH CHECK (true);
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync } from "./helpers/trackedFiles";

const MIG = join(resolve(process.cwd()), "supabase", "migrations");

/** The newest "Customers can create jobs" WITH CHECK, whitespace-normalised. */
const PINNED_WITH_CHECK =
  "(SELECT auth.uid()) = customer_id AND business_id IS NULL AND (offered_to_helper_id IS NULL OR NOT are_users_blocked(customer_id, offered_to_helper_id))";

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

/** Replay every migration: CREATE POLICY sets, DROP POLICY removes, ALTER POLICY is recorded. */
function jobsPolicies() {
  const policies = new Map<string, { file: string; stmt: string; altered: string[] }>();
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
    const code = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    // Quoted or bare policy names, and a quoted or bare schema (lh-authz-rls
    // review of 9a2314d66, should-fix 5: an unquoted name was invisible).
    const re = /\b(create|drop|alter)\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|\w+)\s+on\s+(?:"?public"?\s*\.\s*)?"?(\w+)"?[\s\S]*?;/gi;
    for (const m of code.matchAll(re)) {
      if (m[3].toLowerCase() !== "jobs") continue;
      const name = m[2].replace(/^"|"$/g, "");
      const verb = m[1].toLowerCase();
      if (verb === "drop") policies.delete(name);
      else if (verb === "create") policies.set(name, { file: f, stmt: m[0], altered: [] });
      else policies.get(name)?.altered.push(`${f}: ${m[0]}`);
    }
  }
  return policies;
}

/** FOR INSERT or FOR ALL (no FOR clause means ALL). */
const governsInsert = (stmt: string) => {
  const m = stmt.match(/\bfor\s+(all|select|insert|update|delete)\b/i);
  return !m || /^(all|insert)$/i.test(m[1]);
};

function withCheck(stmt: string): string {
  const i = stmt.search(/\bwith\s+check\s*\(/i);
  if (i < 0) return "";
  const open = stmt.indexOf("(", i);
  let depth = 0;
  for (let j = open; j < stmt.length; j++) {
    if (stmt[j] === "(") depth++;
    else if (stmt[j] === ")" && --depth === 0) return stmt.slice(open + 1, j);
  }
  return "";
}

describe("quote_insert_job mirrors the jobs INSERT policy (Q1868)", () => {
  const policies = jobsPolicies();
  const defs = effectiveDefs(MIG);

  it("reads the surviving jobs policies (exactly prod's count, measured live 2026-10-17: 9)", () => {
    expect(policies.size).toBe(9);
  });

  it("exactly one jobs policy governs INSERT, and no migration ALTERs it", () => {
    const insert = [...policies].filter(([, p]) => governsInsert(p.stmt)).map(([n]) => n);
    expect(insert).toEqual(["Customers can create jobs"]);
    expect(policies.get("Customers can create jobs")!.altered).toEqual([]);
  });

  it("its newest WITH CHECK is the pinned text (re-review quote_insert_job before moving the pin)", () => {
    const p = policies.get("Customers can create jobs")!;
    expect(norm(withCheck(p.stmt))).toBe(norm(PINNED_WITH_CHECK));
  });

  // The whole column list (lh-authz-rls should-fix 6): five jobs BEFORE INSERT
  // locks skip a definer RPC's owner, so a newly written column is re-reviewed here.
  it("quote_insert_job writes exactly its reviewed columns, the request's poster as customer_id", () => {
    const stmt = blankSqlComments(defs.get("quote_insert_job")!.stmt);
    const cols = (stmt.match(/insert\s+into\s+public\.jobs\s*\(([^)]*)\)/i)?.[1] ?? "").split(",").map((c) => c.trim());
    expect(cols).toEqual([
      "customer_id", "title", "description", "category", "date_needed", "start_time", "estimated_hours",
      "location", "latitude", "longitude", "parish", "budget", "offered_to_helper_id", "direct_offer_expires_at",
    ]);
    expect(stmt).toMatch(/VALUES\s*\(\s*p_req\.poster_id\s*,/i);
  });

  it("book_accepted_quote checks the caller is the poster and the pair is not blocked before inserting", () => {
    const stmt = blankSqlComments(defs.get("book_accepted_quote")!.stmt);
    const insertAt = stmt.indexOf("quote_insert_job(");
    expect(insertAt).toBeGreaterThan(0);
    const before = stmt.slice(0, insertAt);
    expect(before).toMatch(/v_req\.poster_id\s+IS\s+DISTINCT\s+FROM\s+v_uid/i);
    expect(before).toMatch(/are_users_blocked\(\s*v_uid\s*,\s*v_q\.quoter_id\s*\)/i);
  });

  it("switch_quote_request_to_set_price checks the poster and offers the job to nobody", () => {
    const stmt = blankSqlComments(defs.get("switch_quote_request_to_set_price")!.stmt);
    const insertAt = stmt.indexOf("quote_insert_job(");
    expect(stmt.slice(0, insertAt)).toMatch(/v_req\.poster_id\s+IS\s+DISTINCT\s+FROM\s+v_uid/i);
    expect(stmt).toMatch(/quote_insert_job\(\s*v_req\s*,\s*p_budget\s*,\s*NULL\s*\)/i);
  });
});
