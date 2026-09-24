/** Mirror ReportDialog's pitch cap so the backend never silently truncates. */
export const MAX_PITCH_LENGTH = 500;

/**
 * Per-job draft key — old single-key behavior meant moving to a different
 * job overwrote your half-written pitch. Scoping by job id keeps each
 * application independent. The `helpr_` prefix is mirrored to Capacitor
 * Preferences (see safeStorage) so a force-quit doesn't lose the draft.
 */
export function pitchDraftKey(jobId: string | undefined | null) {
  return `helpr_apply_pitch_draft_${jobId ?? "unknown"}`;
}

/** Legacy single-key draft from before drafts were per-job. We migrate
 *  it once into the current job's key so an in-flight pitch from the
 *  pre-update build isn't dropped. */
export const LEGACY_PITCH_DRAFT_KEY = "helpr_apply_pitch_draft";

/** localStorage key for the helpr's saved default pitch template. */
export const TEMPLATE_KEY = "helpr_pitch_template";
