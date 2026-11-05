import type { APIRequestContext } from "@playwright/test";
import { SUPABASE_URL, rest, type Session } from "./fixtures";

/**
 * Throw away the account's half-finished job post (OPS-3) after a journey that
 * fills Post a job and never posts.
 *
 * WHY (Q1035, 2026-11-04). Post a job keeps a draft on the account
 * (save_my_job_post_draft, src/lib/jobPostDraftAccount.ts) as the poster types,
 * and the hourly job-post-draft-reminder cron sends one "Finish your job post?"
 * notice and email for it. Measured on prod 2026-11-04 ~8:13 PM CT: the shared
 * poster seat held a draft from the 01:23Z journeys run, reminded_at null. The
 * live sweep skips is_seed accounts, so nothing was sent, but a test that leaves
 * its typing behind on a shared account is one flag away from a reminder: every
 * journey that fills the form and does not post clears it here. Guard
 * src/test/journeysClearTheirJobDraft.test.ts.
 *
 * Call it AFTER the page's context is closed, so no debounced autosave lands
 * behind the clear. It clears, then reads the draft back as the member, and
 * clears again if a late save got in. Throws when the draft is still there.
 */
export async function clearJobPostDraft(request: APIRequestContext, session: Session): Promise<void> {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const cleared = await request.post(`${SUPABASE_URL}/rest/v1/rpc/clear_my_job_post_draft`, { headers: rest(session), data: {} });
    if (!cleared.ok()) {
      last = `clear_my_job_post_draft answered ${cleared.status()} ${(await cleared.text()).slice(0, 200)}`;
    } else {
      const read = await request.post(`${SUPABASE_URL}/rest/v1/rpc/my_job_post_draft`, { headers: rest(session), data: {} });
      const body = (await read.text()).trim();
      if (read.ok() && (body === "" || body === "null")) return;
      last = `my_job_post_draft still answered ${read.status()} ${body.slice(0, 120)}`;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(`the journey's job-post draft was not cleared: ${last}`);
}
