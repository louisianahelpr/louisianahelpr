/**
 * OPS-5 (owner 10-29): which links bring sign-ups and first posts, privacy-safe.
 *
 * CLASS: (1) the newest member_signup_sources table holds only user_id, source, campaign and recorded_at (no email,
 * name, IP or link column) and goes with the account (ON DELETE CASCADE); (2) the newest record_my_signup_source keeps a
 * source only for an account made in the last 2 days, cleans both words to a-z 0-9 . _ - and drops any word with an @ or 7+ digits in a row;
 * (3) the newest admin_signup_source_report refuses a non-admin and counts real members only (is_seed, anonymized_at,
 * is_test_subject); (4) the client mounts the report hook once, in SessionManager. Backend proof:
 * src/test/pglite/memberSignupSource.pglite.mjs (3x replay; NEW_MIGRATION=skip RED 24).
 *
 * @mutate supabase/migrations/20261031220447_member_signup_source_report.sql |   IF v_made IS NULL OR v_made < now() - interval '2 days' THEN |   IF v_made IS NULL THEN
 * @mutate supabase/migrations/20261031220447_member_signup_source_report.sql |   v_source := CASE WHEN position('@' IN coalesce(p_source, '')) > 0 OR | v_source := CASE WHEN false OR
 * @mutate supabase/migrations/20261031220447_member_signup_source_report.sql | OR regexp_replace(coalesce(p_campaign, ''), '[^0-9]', '', 'g') ~ '[0-9]{7,}' THEN NULL |  THEN NULL
 * @mutate supabase/migrations/20261031220447_member_signup_source_report.sql | OR regexp_replace(coalesce(p_source, ''), '[^0-9]', '', 'g') ~ '[0-9]{7,}' THEN 'other' | OR coalesce(p_source, '') ~ '[0-9]{7,}' THEN 'other'
 * @mutate supabase/migrations/20261031220447_member_signup_source_report.sql | OR position('%40' IN coalesce(p_source, '')) > 0 | 
 * @mutate supabase/migrations/20261031220447_member_signup_source_report.sql | OR position('%40' IN coalesce(p_campaign, '')) > 0 | 
 * @mutate supabase/migrations/20261031220447_member_signup_source_report.sql |        AND NOT public.is_test_subject(s.user_id) |        AND true
 * @mutate supabase/migrations/20261031220447_member_signup_source_report.sql |   IF auth.uid() IS NULL OR NOT coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN |   IF auth.uid() IS NULL THEN
 * @mutate supabase/migrations/20261031220447_member_signup_source_report.sql |   recorded_at timestamptz NOT NULL DEFAULT now()\n); |   recorded_at timestamptz NOT NULL DEFAULT now(),\n  email text\n);
 * @mutate src/components/SessionManager.tsx |   useSignupSourceReport(user?.id); |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "");

function newestStatement(re: RegExp): string {
  for (let i = FILES.length - 1; i >= 0; i--) {
    const sql = blankSqlComments(readFileSync(join(MIG, FILES[i]), "utf8"));
    const all = [...sql.matchAll(re)];
    if (all.length) return all[all.length - 1][0];
  }
  return "";
}

describe("sign-up sources are counted with no personal data (OPS-5)", () => {
  it("reads a real inventory", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("the table holds only the member key, two words and a time, and goes with the account", () => {
    const t = newestStatement(/CREATE TABLE IF NOT EXISTS public\.member_signup_sources\s*\([\s\S]*?\n\);/gi);
    expect(t).not.toBe("");
    const cols = [...t.matchAll(/^\s+([a-z_]+)\s+(?:uuid|text|timestamptz)/gim)].map((m) => m[1]).sort();
    expect(cols).toEqual(["campaign", "recorded_at", "source", "user_id"]);
    expect(t).toMatch(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/i);
  });

  it("record_my_signup_source keeps only a new account's cleaned words and never an @", () => {
    const b = body("record_my_signup_source");
    expect(b).not.toBe("");
    expect(b).toMatch(/v_made\s*<\s*now\(\)\s*-\s*interval\s*'2 days'/i);
    // Review 10-31: an @ or a %40, or 7+ digits once separators are dropped ("(555) 123-4567"), is never kept.
    expect(b).toMatch(/position\('@' IN coalesce\(p_source, ''\)\) > 0 OR position\('%40' IN coalesce\(p_source, ''\)\) > 0\s+OR regexp_replace\(coalesce\(p_source, ''\), '\[\^0-9\]', '', 'g'\) ~ '\[0-9\]\{7,\}' THEN 'other'/i);
    expect(b).toMatch(/position\('@' IN coalesce\(p_campaign, ''\)\) > 0 OR position\('%40' IN coalesce\(p_campaign, ''\)\) > 0\s+OR regexp_replace\(coalesce\(p_campaign, ''\), '\[\^0-9\]', '', 'g'\) ~ '\[0-9\]\{7,\}' THEN NULL/i);
    expect((b.match(/\[\^a-z0-9\._-\]/g) ?? []).length).toBe(2);
    expect(b).toMatch(/auth\.uid\(\)/);
  });

  it("the report is admins only and counts real members only", () => {
    const b = body("admin_signup_source_report");
    expect(b).toMatch(/NOT coalesce\(public\.has_role\(auth\.uid\(\), 'admin'::public\.app_role\), false\)/i);
    expect(b).toMatch(/NOT coalesce\(p\.is_seed, false\)/i);
    expect(b).toMatch(/p\.anonymized_at IS NULL/i);
    expect(b).toMatch(/NOT public\.is_test_subject\(s\.user_id\)/i);
  });

  it("the app sends the source once someone is signed in (SessionManager)", () => {
    const src = blankComments(readFileSync(join(REPO, "src", "components", "SessionManager.tsx"), "utf8"));
    expect(src).toMatch(/useSignupSourceReport\(user\?\.id\)/);
  });
});
