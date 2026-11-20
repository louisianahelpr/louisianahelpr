import { signupUrlFor } from "@/lib/jobIntent";

/**
 * Owner 2026-11-20 (ease batch, items 1 and 6): a guest, or someone whose sign-up email is not verified yet, can START
 * a job post. Every field is kept on the device as the post-a-job draft (useDraftJob's `helpr_draft_job`, a tracked
 * safeStorage key, so it survives a reload, the email round-trip and, in the app, a restart). At the end they are
 * asked to sign up; the sign-up carries `/post-job?resume=draft` as its redirect (rememberSignupRedirect, spent by
 * postAuthDestination once the email is verified), and Post a job then loads the draft and opens its last step.
 * Guard: src/test/guestPostDraftSurvivesSignup.test.tsx.
 */
export const GUEST_POST_RESUME_PATH = "/post-job?resume=draft";

/** The ?reason= Signup reads to say the post is kept (signupSubtitle). */
const GUEST_POST_REASON = "post";

/** Where a guest's "Sign up to post" goes. */
export function guestPostSignupUrl(): string {
  return `${signupUrlFor(GUEST_POST_RESUME_PATH)}&reason=${GUEST_POST_REASON}`;
}

/** True on the page the verified sign-up comes back to. */
export function wantsDraftResume(params: URLSearchParams): boolean {
  return params.get("resume") === "draft";
}
