/**
 * Q2076: a notice that tells a poster they can "post it again" opens the Repost prefill of THAT job, never a blank
 * Post a job form. The failed-bank-payment cancel (cancel_job_after_failed_bank_payment) said "You can post it again
 * any time" and linked to '/post-job'; the job is 'failed', hidden from My Posts, so the poster retyped everything.
 * It now links '/post-job?rebook=' || v_job.id::text, the Repost link My Posts, the job page and Completed use.
 *
 * Class: every effective SQL function (rewrites included, newest definition) whose code says "post it again" and
 * links into '/post-job' must link with '?rebook='. (A "post it again" with no Post a job link, like the Declutter
 * Wanted sweep's, is not a job repost and is out of scope.)
 * Behaviour (real Postgres, base = prod's live definition by md5): src/test/pglite/failedBankCancelRepostsTheJob.pglite.mjs
 * (46 PASS; 15 FAIL on prod's definition; nothing but the poster notice's sentence and link moves).
 *
 * @mutate supabase/migrations/20261103010231_failed_bank_cancel_reposts_the_job.sql |       '/post-job?rebook=' \|\| v_job.id::text | '/post-job'
 * @mutate supabase/migrations/20261103010231_failed_bank_cancel_reposts_the_job.sql | Tap here to post it again with the details filled in. | You can post it again any time.
 * @mutate src/pages/post-job/useJobFormEffects.ts |     const rebookId = searchParams.get("rebook"); |     const rebookId = searchParams.get("repost");
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const FN = "cancel_job_after_failed_bank_payment";

describe("Q2076: a 'post it again' notice opens the Repost prefill of its job", () => {
  it("the failed-bank cancel's poster notice links to /post-job?rebook=<this job> and says the details come filled in", () => {
    const d = effectiveDefs("supabase/migrations").get(FN);
    expect(d, `no live ${FN}`).toBeTruthy();
    const body = blankSqlComments(d!.stmt).replace(/\s+/g, " ");
    const poster = body.indexOf("'Bank payment failed, job cancelled',");
    const helpr = body.indexOf("FOREACH v_helper IN ARRAY v_told LOOP");
    // Inventory floor: the real function, with both notices.
    expect(poster).toBeGreaterThan(-1);
    expect(helpr).toBeGreaterThan(poster);
    const notice = body.slice(poster, helpr);
    expect(notice).toContain("'warning', '/post-job?rebook=' || v_job.id::text );");
    expect(notice).toContain("Tap here to post it again with the details filled in.");
    expect(notice).not.toMatch(/any time/);
  });

  it("every SQL notice that says 'post it again' and links into Post a job links with ?rebook=", () => {
    const offenders: string[] = [];
    let repostNotices = 0;
    for (const [name, def] of effectiveDefs("supabase/migrations")) {
      const code = blankSqlComments(def.stmt);
      if (!/post it again/i.test(code)) continue;
      const links = code.match(/'\/post-job[^']*'/g) ?? [];
      if (links.length === 0) continue;
      repostNotices += 1;
      for (const l of links) if (!l.startsWith("'/post-job?rebook=")) offenders.push(`${name} (${def.file}): ${l}`);
    }
    expect(repostNotices).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("Post a job pre-fills from ?rebook=<id> by reading that job by id (no status filter, so a cancelled job loads)", () => {
    const src = blankComments(readFileSync("src/pages/post-job/useJobFormEffects.ts", "utf8"));
    expect(src.length, "inventory floor: the file was read").toBeGreaterThan(13000);
    const at = src.indexOf('const rebookId = searchParams.get("rebook");');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("}, [searchParams]);", at));
    expect(block).toContain('.eq("id", rebookId).single()');
    expect(block).not.toMatch(/\.(eq|neq|in|not)\("status"/);
  });
});
