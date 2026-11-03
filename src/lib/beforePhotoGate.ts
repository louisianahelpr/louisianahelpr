/**
 * THE ONE SENTENCE FOR THE BEFORE-PHOTO GATE ON "START WORKING".
 *
 * Exported because two surfaces say it and they must not drift: the client's
 * disabled "Start working" reason (JobTracking), and the copy for
 * `tracker_requires_before_photo`, which is what
 * `enforce_job_tracking_arrival_gate()` raises when a write reaches the server
 * anyway (20260919195158). It NAMES THE CONTROL that clears it — the "Before
 * Photo" chip in the card's action row — because a disabled button whose
 * reason does not say what to press is the defect, not the gate.
 */
export const BEFORE_PHOTO_GATE_REASON =
  'Tap "Before photo" and add one before you start working — it\'s the record of how the job looked when you got there.';
