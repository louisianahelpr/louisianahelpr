/**
 * CLASS CHECK: a job nobody paid for never shows in Posts or Post a Job
 * (2026-09-27).
 *
 * Owner, 2026-09-27: "Finish paying should not even be a thing." ... "Unpaid
 * jobs should not show in post anywhere. Even hidden." A job row exists
 * before Checkout (payment_status 'unpaid'); if the poster cancels, the
 * sweeper marks it 'abandoned'; a declined card marks it 'failed'. None of
 * the three is a post. A cancelled checkout goes back to the local draft
 * ("Load Draft"), never to a half-made job.
 *
 * FOUND 2026-09-27: Posts showed never-paid rows behind a "Finish Paying"
 * notice, Post a Job listed them under "Finish Paying" and in the Repost
 * list, a declined card's notification linked to /posts?job=<the hidden
 * job>, and enforce_open_job_limit counted 'failed' jobs toward the 5-job cap
 * the poster could not see.
 *
 * THE CHECK, one list (src/lib/neverPaidStatuses.ts) read by every layer:
 *   - no Finish Paying / Fund & Publish surface left in src/;
 *   - Posts' filter (jobIsUnfundedDraft) hides every never-paid status;
 *   - the Repost query and both open-cap mirrors filter by the same list;
 *   - the newest migration defining enforce_open_job_limit excludes all of it;
 *   - the failed-payment notification sends the poster to Post a Job.
 * Shown red on the pre-change tree for each part.
 *
 * @mutate src/lib/neverPaidStatuses.ts | "unpaid", "abandoned", "failed" | "unpaid", "abandoned"
 * @mutate src/hooks/useRecentPostedJobs.ts | .or(`payment_status.is.null,payment_status.not.in.(${NEVER_PAID_STATUSES.join(",")})`) | .or(`payment_status.is.null,payment_status.not.in.(unpaid,abandoned)`)
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | link: "/post-job", | link: `/posts?job=${failedJob.id}`,
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts |       return; |       void 0;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { NEVER_PAID_STATUSES } from "@/lib/neverPaidStatuses";
import { jobIsUnfundedDraft } from "@/components/job-card/activityFilters";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("a job nobody paid for never shows in Posts or Post a Job", () => {
  it("the list is the three statuses a job has before or instead of payment", () => {
    expect([...NEVER_PAID_STATUSES].sort()).toEqual(["abandoned", "failed", "unpaid"]);
  });

  it("no Finish Paying surface is left in src/", () => {
    const files = walk(join(REPO, "src"));
    // 952 non-test source files on 2026-09-27; a floor so an empty walk cannot pass.
    expect(files.length).toBeGreaterThan(900);
    const hits = files.flatMap((f) => {
      // Comments may quote the owner ("Finish paying should not even be a
      // thing"); only code and copy count.
      const src = blankComments(readFileSync(f, "utf8"));
      return [/Finish Paying/i, /Fund & Publish/, /data-unpaid-draft/, /useFundExistingJob/, /useUnpaidJobDrafts/]
        .filter((re) => re.test(src))
        .map((re) => `${relative(REPO, f)}: ${re}`);
    });
    expect(hits).toEqual([]);
  });

  it("Posts hides every never-paid status and keeps paid ones", () => {
    for (const s of NEVER_PAID_STATUSES) expect(jobIsUnfundedDraft({ payment_status: s }), s).toBe(true);
    for (const s of ["escrow", "payout_pending", "released", "refunded", null, undefined]) {
      expect(jobIsUnfundedDraft({ payment_status: s }), String(s)).toBe(false);
    }
  });

  it.each([
    "src/hooks/useRecentPostedJobs.ts",
    "src/pages/post-job/useJobSubmit.ts",
    "src/pages/post-job/useJobFormEffects.ts",
  ])("%s filters payment_status by NEVER_PAID_STATUSES, not a hand-typed list", (file) => {
    const src = read(file);
    expect(src).toMatch(/payment_status[\s\S]{0,80}NEVER_PAID_STATUSES\.join/);
    expect(src, "a literal status list drifts from the shared one").not.toMatch(/\(\s*'?unpaid'?\s*,\s*'?abandoned'?\s*\)/);
  });

  it("the live open-job cap excludes every never-paid status", () => {
    const dir = join(REPO, "supabase", "migrations");
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => /CREATE OR REPLACE FUNCTION public\.enforce_open_job_limit/i.test(readFileSync(join(dir, f), "utf8")))
      .pop();
    expect(latest, "no migration defines enforce_open_job_limit").toBeTruthy();
    const body = readFileSync(join(dir, latest!), "utf8");
    const notIn = body.match(/payment_status[^)]*\)\s*NOT IN\s*\(([^)]*)\)/i)?.[1] ?? "";
    for (const s of NEVER_PAID_STATUSES) expect(notIn, `${latest} counts '${s}' jobs toward the cap`).toContain(`'${s}'`);
  });

  // Q769: the notice moved from payment_intent.payment_failed (a decline is
  // retryable inside the open session) to checkout.session.expired.
  it("a declined card sends the poster to Post a Job, not to a hidden post", () => {
    const src = read("supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts");
    expect(src).toMatch(/link:\s*"\/post-job"/);
    expect(src).not.toMatch(/link:\s*`\/posts\?job=/);
  });

  it("the 'job isn't posted' notice goes out only when the job was really marked failed", () => {
    // lh-money-escrow review of 15921ea17: the notice went out BEFORE the
    // state guard, so a declined boost on a live, funded job told the poster
    // to post (and pay for) it again. The expiry handler notifies only off
    // the row its guarded update returned, and only when that row is failed.
    const src = blankComments(read("supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts"));
    const update = src.indexOf('.in("payment_status", ["unpaid", "failed"])');
    const notify = src.indexOf("insertNotifications(supabase");
    expect(update).toBeGreaterThan(0);
    expect(notify, "notification sent before the guarded update").toBeGreaterThan(update);
    expect(src.slice(update, notify)).toMatch(/if \(released && released\.payment_status === "failed"/);
  });
});
