/**
 * "Suggest a category" (I1, 20261015051141_category_suggestions; owner
 * decision 2026-10-14). The fast half of the proof, read from the NEWEST
 * definitions the migrations leave (effectiveDefs), so a later restatement
 * that drops a gate fails here:
 *
 *   1. Every RPC starts with PERFORM public.require_feature('suggest_category')
 *      (hidden switch, server side), and the switch is created 'testers'.
 *   2. suggest_category refuses banned callers, takes the caller from
 *      auth.uid() in its own body (never a parameter), and is capped per day.
 *   3. The admin RPCs check has_role(..., 'admin') and the review writes
 *      admin_audit_log.
 *   4. The table is closed to clients: RLS on, no policy, anon/authenticated
 *      revoked; every RPC is revoked FROM PUBLIC, anon.
 *   5. The client button and admin card render nothing without the switch.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/tradeCategoriesAndSuggestions.pglite.mjs
 * (43 PASS on the migrations; NEW_MIGRATION=skip 0 PASS / 43 FAIL; 8 planted
 * defects each caught, measured 2026-10-15).
 */
// @mutate supabase/migrations/20261015051141_category_suggestions.sql | BEGIN\n  PERFORM public.require_feature('suggest_category');\n  IF v_uid IS NULL THEN | BEGIN\n  IF v_uid IS NULL THEN
// @mutate supabase/migrations/20261015051141_category_suggestions.sql |   IF public.is_caller_banned() THEN | IF false THEN
// @mutate supabase/migrations/20261015051141_category_suggestions.sql | REVOKE ALL ON FUNCTION public.suggest_category(text, text) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.suggest_category(text, text) FROM PUBLIC;
// @mutate supabase/migrations/20261015051141_category_suggestions.sql | VALUES ('suggest_category', 'testers', | VALUES ('suggest_category', 'off',
// @mutate supabase/migrations/20261015051141_category_suggestions.sql |   INSERT INTO public.admin_audit_log | INSERT INTO public.audit_nothing
// @mutate supabase/migrations/20261015051141_category_suggestions.sql |   PERFORM pg_advisory_xact_lock(hashtext('suggest_category'), hashtext(v_uid::text)); |   PERFORM 1;
// @mutate supabase/migrations/20261015051141_category_suggestions.sql |   SELECT * INTO v_row FROM public.category_suggestions WHERE id = p_id;\n |   SELECT * INTO v_row FROM public.category_suggestions WHERE id = p_id FOR UPDATE;\n
// @mutate src/components/SuggestCategory.tsx |   if (!on) return null; |   if (false) return null;
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

let featureOn = false;
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => featureOn }));
vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ isLoading: false, isError: false, data: [] }),
  useMutation: () => ({ mutate: () => undefined, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: () => undefined }),
}));

const { SuggestCategory } = await import("@/components/SuggestCategory");
const { CategorySuggestionsCard } = await import("@/components/admin/settings/CategorySuggestionsCard");

afterEach(cleanup);

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261015051141_category_suggestions.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const RPCS = ["suggest_category", "admin_list_category_suggestions", "admin_review_category_suggestion"];

describe("Suggest a category: hidden, gated, closed (20261015051141)", () => {
  it("reads a real inventory (floor)", () => {
    for (const fn of RPCS) expect(DEFS.has(fn), fn).toBe(true);
    expect(RPCS.length).toBeGreaterThan(2);
  });

  it("1. every RPC starts with require_feature('suggest_category'); the switch is created for testers", () => {
    for (const fn of RPCS) {
      expect(body(fn), fn).toMatch(/\bBEGIN\s+PERFORM\s+public\.require_feature\('suggest_category'\);/i);
    }
    expect(flat(MIG)).toContain("VALUES ('suggest_category', 'testers',");
  });

  it("2. suggest_category: banned refused, caller from auth.uid(), daily cap", () => {
    const b = flat(body("suggest_category"));
    expect(b).toContain("IF public.is_caller_banned() THEN RAISE EXCEPTION 'account_restricted'");
    expect(b).toContain("v_uid uuid := (SELECT auth.uid());");
    expect(b).toContain("VALUES (v_uid, p_area, v_text)");
    expect(b).toMatch(/interval '24 hours'\) >= 5 THEN RAISE EXCEPTION 'rate_limited'/);
    // Serialized per caller BEFORE the repeat check, or parallel calls pass the
    // cap (lh-authz-rls review #4; PGlite has one connection, so this is static).
    const lock = b.indexOf("PERFORM pg_advisory_xact_lock(hashtext('suggest_category'), hashtext(v_uid::text));");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(b.indexOf("SELECT s.id INTO v_id"));
    // Phone numbers and bare domains are refused without needing an @ or : (review #3).
    expect(b).toContain("OR v_text ~ '[0-9][0-9 ().-]{5,}[0-9]'");
  });

  it("2b. the review serializes on the words BEFORE it locks any row (review #5: no deadlock)", () => {
    const r = flat(body("admin_review_category_suggestion"));
    const words = r.indexOf("PERFORM pg_advisory_xact_lock(hashtext('review_category_suggestion'), hashtext(v_row.suggested_in || '|' || v_row.normalized));");
    const firstRowLock = r.indexOf("FOR UPDATE");
    expect(words).toBeGreaterThan(-1);
    expect(firstRowLock).toBeGreaterThan(words);
    // The status check reads the row AFTER the lock, so a decision made while
    // this one waited is seen.
    expect(r.indexOf("IF v_row.status <> 'pending' THEN")).toBeGreaterThan(firstRowLock);
  });

  it("3. admin RPCs check the admin role; the review is audited", () => {
    for (const fn of ["admin_list_category_suggestions", "admin_review_category_suggestion"]) {
      expect(flat(body(fn)), fn).toMatch(/public\.has_role\(.*'admin'::app_role\), false\) THEN RAISE EXCEPTION 'not_authorized'/);
    }
    expect(flat(body("admin_review_category_suggestion"))).toContain(
      "INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details) VALUES (v_uid, 'review_category_suggestion'",
    );
  });

  it("4. table closed to clients; every RPC revoked FROM PUBLIC, anon", () => {
    expect(MIG).toMatch(/ALTER TABLE public\.category_suggestions ENABLE ROW LEVEL SECURITY;/);
    expect(MIG).toMatch(/REVOKE ALL ON TABLE public\.category_suggestions FROM PUBLIC, anon, authenticated;/);
    expect(MIG).not.toMatch(/CREATE\s+POLICY[^;]*\bON\s+public\.category_suggestions\b/i);
    expect(MIG).not.toMatch(/GRANT\s+[^;]*\bON\s+(?:TABLE\s+)?public\.category_suggestions\b[^;]*\b(anon|authenticated|PUBLIC)\b/i);
    for (const fn of RPCS) {
      expect(MIG, fn).toMatch(new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.${fn}\([^)]*\) FROM PUBLIC, anon;`));
    }
  });

  it("5. the button and the admin card render nothing without the switch", () => {
    featureOn = false;
    const off1 = render(<SuggestCategory area="jobs" />);
    expect(off1.container.textContent).toBe("");
    const off2 = render(<CategorySuggestionsCard />);
    expect(off2.container.textContent).toBe("");
    cleanup();
    featureOn = true;
    const on1 = render(<SuggestCategory area="jobs" />);
    expect(on1.container.textContent).toMatch(/Suggest a category/);
  });
});
