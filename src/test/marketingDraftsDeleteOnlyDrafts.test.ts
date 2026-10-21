/**
 * Q1557, owner 2026-10-21: delete the social-post drafts, and ONLY drafts. The
 * migration's one DELETE is scoped to status = 'draft'; a scheduled or posted
 * row is never touched.
 *
 * @mutate supabase/migrations/20261021111313_delete_marketing_drafts.sql | DELETE FROM public.marketing_content WHERE status = 'draft'; | DELETE FROM public.marketing_content;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const sql = blankSqlComments(readFileSync(join(resolve(__dirname, "..", ".."), "supabase/migrations/20261021111313_delete_marketing_drafts.sql"), "utf8"));

describe("Q1557 deletes marketing drafts only", () => {
  it("has exactly one DELETE, scoped to status = 'draft'", () => {
    const deletes = sql.match(/\bDELETE\s+FROM\b[^;]*;/gi) ?? [];
    expect(deletes).toEqual(["DELETE FROM public.marketing_content WHERE status = 'draft';"]);
    expect(sql).not.toMatch(/\b(TRUNCATE|DROP\s+TABLE)\b/i);
  });
});
