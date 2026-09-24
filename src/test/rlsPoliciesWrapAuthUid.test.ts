/**
 * SI-014: a policy that calls auth.uid() bare is re-evaluated per row
 * (Supabase lint auth_rls_initplan). 20260924063540 re-stated every live one
 * wrapped; from that migration on, every CREATE/ALTER POLICY must write
 * ( SELECT auth.uid() ) instead. Older migrations are history (the live state
 * is what that migration fixed), so the scan starts at it.
 *
 * @mutate supabase/migrations/20260924063540_rls_initplan_wrap_auth_uid.sql | -- SI-014 sentinel (the guard's mutation target; no statement) | CREATE POLICY "x" ON public.messages FOR SELECT USING (auth.uid() = sender_id);
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/migrations";
const FROM = "20260924063540";
const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const scanned = all.filter((f) => f.slice(0, 14) >= FROM);

// One policy statement, up to its terminating semicolon, with comments removed.
const POLICY = /\b(?:CREATE|ALTER)\s+POLICY\b[^;]*;/gi;
const bareUid = (stmt: string) => /auth\.uid\(\)/i.test(stmt.replace(/\(\s*SELECT\s+auth\.uid\(\)(?:\s+AS\s+\w+)?\s*\)/gi, ""));

describe("RLS policies evaluate auth.uid() once per statement (SI-014)", () => {
  it("the inventory is real and starts at the fix", () => {
    expect(all.length).toBeGreaterThan(500);
    expect(scanned[0]?.startsWith(FROM)).toBe(true);
  });
  it("no policy written since the fix calls auth.uid() bare", () => {
    const hits = scanned.flatMap((f) =>
      (readFileSync(`${DIR}/${f}`, "utf8").replace(/--[^\n]*/g, "").match(POLICY) ?? [])
        .filter(bareUid)
        .map((s) => `${f}: ${s.slice(0, 120)}`),
    );
    expect(hits).toEqual([]);
  });
});
