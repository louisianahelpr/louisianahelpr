/**
 * AM-004: the admin Audit Log is for "who did what to whom". audit_role_changes
 * must skip the automatic default-role bookkeeping of signup and account
 * deletion (no acting user, non-admin role) while still logging EVERY change
 * to the admin role and every change a signed-in user makes. Pins the newest
 * migration defining the trigger function. Behaviour proven in PGlite
 * (~/.lh-pglite/am004.mjs) on 2026-09-24.
 *
 * @mutate supabase/migrations/20260924073032_audit_role_changes_skips_automatic_default_roles.sql |   IF auth.uid() IS NULL AND COALESCE(NEW.role, OLD.role)::text <> 'admin' THEN -- AM-004 skip automatic default roles |   IF auth.uid() IS NULL THEN -- AM-004 skip automatic default roles
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");

describe("audit_role_changes logs admin actions, not signup bookkeeping (AM-004)", () => {
  const defs = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ f, sql: readFileSync(resolve(DIR, f), "utf8") }))
    .filter(({ sql }) => /CREATE OR REPLACE FUNCTION public\.audit_role_changes\(\)/i.test(sql));

  it("finds the definition", () => {
    expect(defs.length).toBeGreaterThanOrEqual(1);
  });

  it("the skip needs BOTH no actor AND a non-admin role", () => {
    const { f, sql } = defs[defs.length - 1];
    const skip = sql.match(/IF auth\.uid\(\) IS NULL([^\n]*)THEN\s+RETURN/)?.[1] ?? "";
    expect(skip, f).toMatch(/<> 'admin'/);
  });
});
