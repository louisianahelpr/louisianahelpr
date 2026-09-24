/**
 * AL-012: account deletion keeps the deleted poster's jobs (the helper and
 * applicants still see them) and rewrites the description. Every job surface
 * renders that text raw, so it must be a sentence a person can read, never an
 * internal bracketed marker. Pins the newest migration that defines
 * purge_user_data.
 *
 * @mutate supabase/migrations/20260924072554_redacted_job_description_is_user_copy.sql |            description          = 'This job''s details were removed when the poster closed their account.', -- AL-012 user copy |            description          = '[removed at account deletion]', -- AL-012 user copy
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");

describe("purge_user_data leaves user-readable copy in a retained job (AL-012)", () => {
  const defs = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ f, sql: readFileSync(resolve(DIR, f), "utf8") }))
    .filter(({ sql }) => /CREATE OR REPLACE FUNCTION public\.purge_user_data\(/i.test(sql));

  it("finds the definitions", () => {
    expect(defs.length).toBeGreaterThanOrEqual(3);
  });

  it("the newest one writes a sentence, not a marker", () => {
    const { f, sql } = defs[defs.length - 1];
    const lit = sql.match(/^\s*description\s*=\s*'((?:[^']|'')*)'/m)?.[1];
    expect(lit, f).toBeTruthy();
    expect(lit!, f).not.toMatch(/^\[/);
    expect(lit!.split(" ").length, f).toBeGreaterThanOrEqual(5);
  });
});
