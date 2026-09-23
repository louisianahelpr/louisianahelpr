/**
 * Q182 (F-SEC-04) — open_jobs_browse stays a SECURITY DEFINER view, on purpose,
 * and the reasons it is safe stay true.
 *
 * WHY DEFINER (full argument: migration 20260923191120, which also puts it on
 * the view as a COMMENT). As `security_invoker = true` the view reads jobs with
 * the caller's own rights: anon has no SELECT on jobs, authenticated cannot
 * SELECT offered_to_helper_id, and no jobs RLS policy admits a stranger's open
 * job — so guest AND signed-in browse would fail (measured in PGlite on a
 * ledger-shaped schema: "permission denied for table jobs" for both roles).
 * Opening the table instead would hand out the raw columns this view masks.
 *
 * A definer view bypasses jobs' RLS, so it is only safe while:
 *   1. its projection is PINNED — no new column rides out unreviewed;
 *   2. the private columns stay wrapped: location through mask_job_location,
 *      coordinates through round(…, 2), the offeree through its CASE;
 *   3. its row filter keeps the browse rules (open, has an owner, funded);
 *   4. the reason still holds: no jobs SELECT policy admits arbitrary callers.
 *      If that ever changes, invoker becomes possible — re-evaluate Q182.
 * (SELECT-only grants and CREATE-OR-REPLACE-only redefinition are pinned in
 * src/test/offeredHelperPrivacy.test.ts.)
 *
 * Reads the NEWEST definition in the ledger (the view lives inside an
 * `EXECUTE $view$ … $view$` block, so any dollar tag is accepted); comments are
 * blanked with the shared helper.
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate supabase/migrations/20260915045110_hide_offered_helper_from_non_posters.sql | CREATE OR REPLACE VIEW public.open_jobs_browse\nWITH (security_invoker = false) | CREATE OR REPLACE VIEW public.open_jobs_browse\nWITH (security_invoker = true)
// @mutate supabase/migrations/20260915045110_hide_offered_helper_from_non_posters.sql |     round(latitude, 2) AS latitude, |     latitude,
// @mutate supabase/migrations/20260915045110_hide_offered_helper_from_non_posters.sql |     credential_tier,\n    require_photo_proof\n   FROM jobs |     credential_tier,\n    require_photo_proof,\n    is_seed\n   FROM jobs
// @mutate supabase/migrations/20260312230239_44ebecc0-fa86-48da-af48-936d4c12e1a1.sql | USING (\n  auth.uid() = customer_id\n  OR auth.uid() = helper_id\n); | USING (\n  status = 'open'::job_status\n  OR auth.uid() = customer_id\n  OR auth.uid() = helper_id\n);
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = resolve(__dirname, "..", "..", "supabase", "migrations");

function files(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

/** The newest `CREATE [OR REPLACE] VIEW public.open_jobs_browse …` text. */
function newestView(): { file: string; sql: string } {
  let out: { file: string; sql: string } | null = null;
  for (const f of files()) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?open_jobs_browse\b/gi)) {
      const rest = sql.slice(m.index!);
      // Ends at the dollar tag closing an EXECUTE block, or the statement's `;`.
      const end = rest.search(/\$\w*\$|;/);
      out = { file: f, sql: end === -1 ? rest : rest.slice(0, end) };
    }
  }
  if (!out) throw new Error("open_jobs_browse is defined in no migration");
  return out;
}

/** Top-level comma split (ignores commas inside parens / CASE … END). */
function splitProjection(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let caseDepth = 0;
  let cur = "";
  const tokens = list.split(/(\bcase\b|\bend\b|[(),])/i);
  for (const t of tokens) {
    const lt = t.toLowerCase();
    if (t === "(") depth++;
    else if (t === ")") depth--;
    else if (lt === "case") caseDepth++;
    else if (lt === "end") caseDepth--;
    if (t === "," && depth === 0 && caseDepth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += t;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function projection(viewSql: string): Array<{ name: string; expr: string }> {
  const m = /\bas\s+select\s+([\s\S]*?)\bfrom\s+(?:public\.)?jobs\b/i.exec(viewSql);
  if (!m) throw new Error("could not read the view's SELECT list");
  return splitProjection(m[1]).map((expr) => {
    const alias = /\bas\s+(\w+)\s*$/i.exec(expr);
    const name = alias ? alias[1] : expr.trim().split(/\s+/).pop()!;
    return { name, expr: expr.replace(/\s+/g, " ").trim() };
  });
}

/** The reviewed projection. Changing it is a privacy review, not a refactor. */
const PINNED_COLUMNS = [
  "id", "title", "description", "category", "budget", "date_needed", "location",
  "is_urgent", "urgent_fee", "is_flexible_schedule", "is_recurring", "is_group_job",
  "helpers_needed", "estimated_hours", "start_time", "photos", "special_requirements",
  "status", "created_at", "updated_at", "boosted_at", "boost_expires_at", "expires_at",
  "recurrence_interval", "recurrence_end_date", "parent_job_id", "payment_status",
  "customer_id", "offered_to_helper_id", "direct_offer_status", "direct_offer_expires_at",
  "applicant_count", "pricing_mode", "latitude", "longitude", "parish", "credential_tier",
  "require_photo_proof",
];

/** Live jobs SELECT policies, replayed from the ledger. */
function liveJobsSelectPolicies(): Map<string, string> {
  const live = new Map<string, string>();
  for (const f of files()) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    const events: Array<{ at: number; apply: () => void }> = [];
    for (const m of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+(?:public\.)?jobs\b/gi)) {
      events.push({ at: m.index!, apply: () => live.delete(m[1]) });
    }
    for (const m of sql.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+(?:public\.)?jobs\b([^;]*);/gi)) {
      events.push({ at: m.index!, apply: () => live.set(m[1], m[2]) });
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
  }
  return new Map([...live].filter(([, body]) => /\bfor\s+(select|all)\b/i.test(body)));
}

describe("open_jobs_browse stays a pinned SECURITY DEFINER view (Q182)", () => {
  const view = newestView();
  const cols = projection(view.sql);

  it("is still security_invoker = false, and the ledger documents why", () => {
    expect(view.sql).toMatch(/security_invoker\s*=\s*(false|off)/i);
    const documented = files().some((f) =>
      /comment\s+on\s+view\s+public\.open_jobs_browse\s+is\s+'SECURITY DEFINER on purpose \(Q182\)/i.test(
        readFileSync(join(MIGRATIONS, f), "utf8"),
      ),
    );
    expect(documented, "the COMMENT ON VIEW explaining Q182 is missing").toBe(true);
  });

  it("projects exactly the reviewed columns — nothing new rides out past jobs' RLS", () => {
    expect(cols.length).toBeGreaterThan(30);
    expect(cols.map((c) => c.name)).toEqual(PINNED_COLUMNS);
  });

  it("keeps the private columns wrapped", () => {
    const expr = (n: string) => cols.find((c) => c.name === n)?.expr ?? "";
    expect(expr("location")).toMatch(/\bmask_job_location\s*\(\s*location\s*\)/i);
    expect(expr("latitude")).toMatch(/^round\s*\(\s*latitude\s*,\s*2\s*\)/i);
    expect(expr("longitude")).toMatch(/^round\s*\(\s*longitude\s*,\s*2\s*\)/i);
    expect(expr("offered_to_helper_id")).toMatch(/^case\b[\s\S]*\belse\s+null(::uuid)?\s+end\b/i);
  });

  it("keeps the browse row rules (open, owned, funded, early-access, seed, credential tier)", () => {
    const where = /\bfrom\s+(?:public\.)?jobs\b\s+where\s+([\s\S]*)$/i.exec(view.sql)?.[1] ?? "";
    expect(where).toMatch(/status\s*=\s*'open'/i);
    expect(where).toMatch(/customer_id\s+is\s+not\s+null/i);
    expect(where).toMatch(/payment_status\s*=\s*any/i);
    expect(where).toMatch(/early_access_cutoff\s*\(\)/i);
    expect(where).toMatch(/seed_jobs_hidden_publicly\s*\(\)/i);
    expect(where).toMatch(/my_credential_tier\s*\(\)/i);
  });

  it("the reason still holds: no jobs SELECT policy admits an arbitrary caller", () => {
    // Every live SELECT policy must be scoped to the caller (auth.uid()) or to
    // admins. A policy that admits anyone to open jobs would make an invoker
    // view possible — and would itself need the masking review Q182 did.
    const policies = liveJobsSelectPolicies();
    expect(policies.size).toBeGreaterThan(2);
    const broad = [...policies].filter(([, body]) => {
      const using = /using\s*\(([\s\S]*)\)/i.exec(body)?.[1] ?? "";
      if (/has_role\s*\([\s\S]{0,80}?'admin'/i.test(using)) return false;
      // Each OR-branch must mention the caller; a branch without auth.uid()
      // (e.g. `status = 'open'`) admits strangers.
      return using.split(/\bor\b/i).some((branch) => !/auth\.uid\s*\(\s*\)|user_may_see_job_address/i.test(branch));
    });
    expect(broad.map(([n]) => n), "re-evaluate Q182: a jobs SELECT policy now admits arbitrary callers").toEqual([]);
  });
});
