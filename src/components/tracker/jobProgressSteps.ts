/** The tracker's step names, apart from jobProgressState's derivation (B51: JobProgress draws on Home's first screen). */
export const JOB_PROGRESS_STEPS = ["Posted", "Offered", "Hired", "Confirmed", "On the way", "Arrived", "Working", "Done"] as const;
/**
 * The full names as the tracker DRAWS them: each long word carries a soft hyphen (U+00AD, invisible unless the word
 * breaks there), so in a 368-639px tracker (/payment-success and the job page's side panel at 1440: 382 and ~420px) a
 * name too wide for its column breaks onto a second line ("Con-" / "firmed") instead of showing "Conf." (audit
 * 2026-10-29 A2-L15). Measured in Montserrat 11px: the widest piece is "On the" at 38.1px; a 368px tracker's narrowest
 * column is (368 - 7 x 4) / 8.5 = 40px. The accessible names keep JOB_PROGRESS_STEPS. Guard: src/test/trackerFullWordsFromMidWidth.test.tsx.
 */
export const JOB_PROGRESS_DRAWN = ["Post\u00ADed", "Of\u00ADfered", "Hired", "Con\u00ADfirmed", "On the way", "Ar\u00ADrived", "Work\u00ADing", "Done"] as const;
/**
 * THE SIX STEPS THE TRACKER DRAWS (owner pick, 11-08, design audit A JP3: "Hired, Confirmed, On the way, Arrived,
 * Working, Done"; Posted and Offered belong to the applicants view). The job's state keeps all eight stages
 * (jobProgressState.ts); the bar draws from JOB_TRACKER_FIRST on, and draws nothing before a hire.
 * Guard: src/test/jobTrackerSixSteps.test.tsx.
 */
export const JOB_TRACKER_FIRST = 2;
