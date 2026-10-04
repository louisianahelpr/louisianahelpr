/**
 * Q1206 (lh-authz-rls review 2026-10-04): prod-deploy.yml ships the web app
 * without waiting for db-deploy, so the app can name
 * applications.offer_message_flagged_hidden before the migration that adds it
 * has run. PostgREST then answers the whole read with 42703, and the
 * applicant list (useApplicantsState) and the applied-jobs list
 * (useActivityData) would come back empty with an error. readApplicationRows
 * retries once without the newer columns.
 */
// @mutate src/lib/applicationColumns.ts |   if (first.error?.code === "42703") return run(APPLICATION_READABLE_COLUMNS_BEHIND_DB); |
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APPLICATION_COLUMNS_AHEAD_OF_DB, APPLICATION_READABLE_COLUMNS, readApplicationRows } from "./applicationColumns";

type Res = { data: unknown[] | null; error: { code?: string; message?: string } | null };

describe("readApplicationRows: a web build ahead of the database still reads applications", () => {
  it("retries without the newer columns when the database answers 42703", async () => {
    const asked: string[] = [];
    const res = await readApplicationRows<Res>(async (columns) => {
      asked.push(columns);
      return asked.length === 1
        ? { data: null, error: { code: "42703", message: 'column applications.offer_message_flagged_hidden does not exist' } }
        : { data: [{ id: "a1" }], error: null };
    });
    expect(res).toEqual({ data: [{ id: "a1" }], error: null });
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBe(APPLICATION_READABLE_COLUMNS);
    for (const c of APPLICATION_COLUMNS_AHEAD_OF_DB) {
      expect(asked[0].split(", ")).toContain(c);
      expect(asked[1].split(", ")).not.toContain(c);
    }
    expect(asked[1].split(", ").length).toBe(asked[0].split(", ").length - APPLICATION_COLUMNS_AHEAD_OF_DB.length);
  });

  it("reads once when the database has every column, and passes any other error through untouched", async () => {
    let calls = 0;
    const ok = await readApplicationRows<Res>(async () => (calls++, { data: [], error: null }));
    expect(ok.error).toBeNull();
    expect(calls).toBe(1);
    calls = 0;
    const denied = await readApplicationRows<Res>(async () => (calls++, { data: null, error: { code: "42501" } }));
    expect(denied.error?.code).toBe("42501");
    expect(calls).toBe(1);
  });

  it("both client reads of applications rows go through it", () => {
    for (const f of ["src/hooks/useActivityData.ts", "src/components/job-card/activityActions/useApplicantsState.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).toMatch(/readApplicationRows\(\(columns\) => supabase\.from\("applications"\)\.select\(columns\)/);
    }
  });
});
