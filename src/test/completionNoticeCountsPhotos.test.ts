/**
 * THE "MARKED THE JOB COMPLETE" NOTICE SAYS HOW MANY PHOTOS ARE WAITING (owner, 2026-10-23, Q2361; report "ben also
 * did not receive any before or after pictures", Mow two lawns 7c6deb77).
 *
 * The newest definition of notify_poster_on_status_change (the trigger that writes the poster's bell row when the
 * Helpr marks the job done) counts jobs.proof_after_urls and says 'finished "<job>" and added N after photo(s).
 * Review them and confirm.'; with none it keeps the old sentence. Behaviour, 3x replay and the red check:
 * src/test/pglite/noticeCountsTheAfterPhotos.pglite.mjs.
 *
 * @mutate supabase/migrations/20261023151519_notice_counts_the_after_photos.sql | WHERE COALESCE(btrim(p.path), '') <> ''); | WHERE false);
 * @mutate supabase/migrations/20261023151519_notice_counts_the_after_photos.sql |   v_helper_name := COALESCE(v_helper_name, 'Your Helpr'); |
 * @mutate supabase/migrations/20261023151519_notice_counts_the_after_photos.sql | '. Review them and confirm.'; | '. Please review and confirm.';
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";

describe("the completion notice counts the after photos (Q2361)", () => {
  const def = effectiveDefs(join(process.cwd(), "supabase/migrations")).get("notify_poster_on_status_change");
  const fn = blankSqlComments(def?.stmt ?? "");

  it("the newest definition is read", () => {
    expect(fn.length).toBeGreaterThan(500);
  });

  it("counts proof_after_urls on the completed branch and names the count", () => {
    expect(fn).toMatch(/v_after := \(SELECT count\(\*\) FROM unnest\(COALESCE\(NEW\.proof_after_urls, '\{\}'::text\[\]\)\) AS p\(path\) WHERE COALESCE\(btrim\(p\.path\), ''\) <> ''\);/);
    expect(fn).toMatch(/IF v_after > 0 THEN\s+v_msg := v_helper_name \|\| ' finished "' \|\| NEW\.title \|\| '" and added ' \|\| v_after::text/);
    expect(fn).toMatch(/' after photo' ELSE ' after photos' END \|\| '\. Review them and confirm\.';/);
  });

  it("a Helpr with no profiles row never makes the sentence NULL (it would roll the completion back)", () => {
    expect(fn).toMatch(/v_helper_name := COALESCE\(v_helper_name, 'Your Helpr'\);/);
  });

  it("keeps the old sentence when there are no after photos, and the old title", () => {
    expect(fn).toMatch(/v_msg := v_helper_name \|\| ' has finished "' \|\| NEW\.title \|\| '"\. Please review and confirm\.';/);
    expect(fn).toMatch(/v_title := v_helper_name \|\| ' marked the job complete';/);
  });
});
