/**
 * Q2496 (Jobs audit 10-30 item 2): a guest who taps a job, signs up in one browser
 * (Facebook's in-app browser) and opens the confirmation email in another (Safari)
 * used to land on /home with no job: the job intent lives in the first browser's
 * storage, and the scanner-safe confirm link (on for everyone, prod read 11-02)
 * carried only the token. Now the sign-up's redirect_to carries `?job=<id>`, the
 * auth email hook copies a valid job id into the confirm link, and the Check your
 * email page sends the confirmed member to that job when this browser has none.
 *
 * @mutate supabase/functions/_shared/confirmLink.ts |  if (jobId && JOB_ID.test(jobId)) url.searchParams.set("job", jobId);\n |
 * @mutate supabase/functions/_shared/confirmLink.ts |    return url.pathname === CONFIRM_LINK_PATH && JOB_ID.test(job) ? job.toLowerCase() : null; |    return job \|\| null;
 * @mutate supabase/functions/auth-email-hook/index.ts | confirmLinkUrl(getAppUrl(), emailData.token_hash, 'signup', confirmLinkJobFromRedirect(emailData.redirect_to)) | confirmLinkUrl(getAppUrl(), emailData.token_hash, 'signup')
 * @mutate src/lib/jobIntent.ts |  const job = id ?? linkJobId; |  const job = id;
 * @mutate src/pages/auth/Signup.tsx | emailRedirectTo: getSignupConfirmRedirect(peekJobIntent()), | emailRedirectTo: getSignupConfirmRedirect(),
 * @mutate src/pages/auth/SignupPending.tsx | navigate(postAuthDestination("/home", confirmLinkJob(location.search)), { replace: true }) | navigate(postAuthDestination(), { replace: true })
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { confirmLinkJob, confirmLinkJobFromRedirect, confirmLinkUrl } from "../../supabase/functions/_shared/confirmLink";
import { postAuthDestination, rememberJobIntent } from "@/lib/jobIntent";
import { safeStorage } from "@/lib/safeStorage";

const JOB = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const APP = "https://www.louisianahelpr.com";
const code = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("a sign-up finished in another browser keeps the shared job (Q2496)", () => {
  beforeEach(() => {
    safeStorage.removeItem("helpr.jobIntent");
  });

  it("the hook reads a job id only from the confirm page's own redirect", () => {
    expect(confirmLinkJobFromRedirect(`${APP}/signup-pending?job=${JOB}`)).toBe(JOB);
    expect(confirmLinkJobFromRedirect(`${APP}/signup-pending?job=${JOB.toUpperCase()}`)).toBe(JOB);
    expect(confirmLinkJobFromRedirect(`${APP}/signup-pending`)).toBeNull();
    expect(confirmLinkJobFromRedirect(`${APP}/somewhere-else?job=${JOB}`)).toBeNull();
    expect(confirmLinkJobFromRedirect(`${APP}/signup-pending?job=../../admin`)).toBeNull();
    expect(confirmLinkJobFromRedirect("not a url")).toBeNull();
    expect(confirmLinkJobFromRedirect(undefined)).toBeNull();
  });

  it("the confirm link carries a valid job id, and nothing else", () => {
    const withJob = new URL(confirmLinkUrl(APP, "abcDEF123_-xyz", "signup", JOB));
    expect(withJob.searchParams.get("job")).toBe(JOB);
    expect(withJob.searchParams.get("token_hash")).toBe("abcDEF123_-xyz");
    expect(new URL(confirmLinkUrl(APP, "abcDEF123_-xyz", "signup", "evil")).searchParams.has("job")).toBe(false);
    expect(new URL(confirmLinkUrl(APP, "abcDEF123_-xyz", "signup")).searchParams.has("job")).toBe(false);
    expect(confirmLinkJob(`?token_hash=x&type=signup&job=${JOB}`)).toBe(JOB);
    expect(confirmLinkJob("?job=nope")).toBeNull();
  });

  it("after confirming: this browser's intent wins, else the link's job, else Home", () => {
    expect(postAuthDestination("/home", JOB)).toBe(`/home?quickApply=${JOB}`);
    expect(postAuthDestination("/home", null)).toBe("/home");
    rememberJobIntent("other-job");
    expect(postAuthDestination("/home", JOB)).toBe("/home?quickApply=other-job");
  });

  it("the sign-up, the resend and the hook all pass the job along", () => {
    expect(code("src/pages/auth/Signup.tsx")).toContain("emailRedirectTo: getSignupConfirmRedirect(peekJobIntent()),");
    expect(code("src/pages/auth/SignupPending.tsx")).toContain("emailRedirectTo: getSignupConfirmRedirect(peekJobIntent() ?? confirmLinkJob(location.search)),");
    expect(code("src/pages/auth/SignupPending.tsx")).toContain('navigate(postAuthDestination("/home", confirmLinkJob(location.search)), { replace: true })');
    expect(code("supabase/functions/auth-email-hook/index.ts")).toContain("confirmLinkUrl(getAppUrl(), emailData.token_hash, 'signup', confirmLinkJobFromRedirect(emailData.redirect_to))");
  });
});
