/**
 * THE POSTER'S OWN REOPEN FILES NO "HELPR CANCELLED" NOTICE (audit 2026-10-29 A2-B15).
 *
 * The bug, measured on prod in the audit (AA9 chunk 1a, aa9-ns-pafter-card-375.png): after the poster reported a
 * no-show, the poster's own card said "Eli cancelled. They won't be coming." record_backout_notice (live body read
 * 2026-10-29, pg_proc.prosrc, equal to 20261027185146's) filed every reopen of a confirmed job as 'helper_cancelled'
 * for the poster, including report_helper_no_show's reopen, which only the poster can run.
 *
 * The fix (20261029162907): the trigger is the one place every reopen passes through, so the rule lives there for
 * the whole class (no-show report, poster blocking the Helpr, any future poster-run reopen): when auth.uid() is the
 * job's poster, no notice. The unconfirmed repost (not the poster's choice) is checked first and still files.
 * PGlite proof (applied 3x; old body RED, 15 checks): src/test/pglite/posterOwnReopenNoBackoutNotice.pglite.mjs.
 *
 * The body is read as the migrations leave it (effectiveDefs: the newest CREATE, any dollar-quote tag).
 *
 * @mutate supabase/migrations/20261029162907_poster_own_reopen_files_no_backout_notice.sql |       WHEN auth.uid() IS NOT NULL AND auth.uid() = OLD.customer_id THEN NULL\n |
 * @mutate supabase/migrations/20261029162907_poster_own_reopen_files_no_backout_notice.sql |     IF v_kind IS NULL THEN\n      RETURN NULL;\n    END IF;\n |
 * @mutate supabase/migrations/20261029162907_poster_own_reopen_files_no_backout_notice.sql | auth.uid() = OLD.customer_id THEN NULL | auth.uid() = OLD.helper_id THEN NULL
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const sql = blankSqlComments(defs.get("record_backout_notice")?.stmt ?? "").replace(/\s+/g, " ");

describe("the poster's own reopen files no backout notice for the poster (A2-B15)", () => {
  it("the inventory is real: the trigger function is defined and the parser found its body", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(sql).toContain("INSERT INTO public.backout_notices");
    expect(sql).toContain("'helper_cancelled'");
  });

  it("in the reopen branch, the poster's own act yields no kind, after the repost and before helper_cancelled", () => {
    const m = sql.match(/v_kind := CASE (.*?) END;/);
    expect(m, "the reopen branch's CASE").not.toBeNull();
    const kase = m![1];
    const own = kase.search(/WHEN auth\.uid\(\) IS NOT NULL AND auth\.uid\(\) = OLD\.customer_id THEN NULL/);
    expect(own, "a WHEN for auth.uid() = OLD.customer_id that yields NULL").toBeGreaterThan(-1);
    expect(kase.indexOf("'helper_unconfirmed'")).toBeGreaterThan(-1);
    expect(kase.indexOf("'helper_unconfirmed'")).toBeLessThan(own);
    expect(own).toBeLessThan(kase.indexOf("'helper_cancelled'"));
  });

  it("a NULL kind returns before anything is written or emailed", () => {
    const ret = sql.search(/IF v_kind IS NULL THEN RETURN NULL; END IF;/);
    expect(ret).toBeGreaterThan(-1);
    expect(ret).toBeLessThan(sql.indexOf("INSERT INTO public.backout_notices"));
    expect(ret).toBeLessThan(sql.indexOf("send_backout_email"));
  });
});
