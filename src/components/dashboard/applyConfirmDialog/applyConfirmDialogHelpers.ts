/** Mirror ReportDialog's pitch cap so the backend never silently truncates. */
export const MAX_PITCH_LENGTH = 500;

/**
 * Per-ACCOUNT, per-job draft key. Scoping by job id keeps each application
 * independent; scoping by user id keeps one account's words out of another's
 * form on a shared device (owner, 2026-10-09: her saved "plz" pre-filled her
 * father's application on the same browser — the keys had no user in them).
 * The `helpr_` prefix is mirrored to Capacitor Preferences (see safeStorage)
 * so a force-quit doesn't lose the draft. No user, no key: nothing is read
 * or written signed out.
 */
export function pitchDraftKey(userId: string | null | undefined, jobId: string | undefined | null): string | null {
  return userId && jobId ? `helpr_apply_pitch_draft_${userId}_${jobId}` : null;
}

/** The account's saved default pitch ("Save as my default pitch"). */
export function pitchTemplateKey(userId: string | null | undefined): string | null {
  return userId ? `helpr_pitch_template_${userId}` : null;
}

/**
 * Keys from before pitches were per-account. Their owner is unknowable, so
 * they are dropped rather than adopted — adopting is exactly how one person's
 * pitch reached another's form. Per-job unscoped drafts
 * (`helpr_apply_pitch_draft_<jobId>`) are simply never read again.
 */
export const OLD_SHARED_PITCH_KEYS = ["helpr_pitch_template", "helpr_apply_pitch_draft"] as const;
