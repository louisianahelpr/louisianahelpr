/**
 * One-shot note for the account-choice question (Q446) when its dialog's code
 * failed to download. The app's stale-download recovery (src/lib/chunkReload.ts)
 * reloads the page before the import's own catch can run, which loses the
 * question, so SocialAuthButtons writes this BEFORE the download and clears it
 * once the code arrives; after a reload the buttons (Log In and Sign Up alike)
 * read it once and say why the person is back. A timestamp only, no account
 * data; ignored after 2 minutes.
 */
const SIGNIN_RETRY_KEY = "helpr_signin_retry_note";
const MAX_AGE_MS = 2 * 60 * 1000;

export const ACCOUNT_CHOICE_RETRY_COPY =
  "We couldn't finish that sign-in, so no account was made. Tap Apple or Google again to continue.";

export function markAccountChoiceRetry(): void {
  noteAt = 0; // this page's note (if any) is answered by the new attempt
  try {
    sessionStorage.setItem(SIGNIN_RETRY_KEY, String(Date.now()));
  } catch {
    // Silent by design: storage blocked (private mode). Only the explanatory
    // line after a reload is lost; the next tap still asks the question.
  }
}

/**
 * The note's timestamp for THIS page load, read once from storage. A page can
 * mount the buttons more than once (a discarded first render, a remount; on
 * /signup it lost the note 1 run in 3, seen in a browser 2026-10-05), so the
 * first read is remembered for the document, and storage is cleared after
 * the render commits (clearAccountChoiceRetry). A reload is a new document.
 */
let noteAt: number | null = null;

export function peekAccountChoiceRetry(now = Date.now()): boolean {
  if (noteAt === null) {
    try {
      noteAt = Number(sessionStorage.getItem(SIGNIN_RETRY_KEY)) || 0;
    } catch {
      // Silent by design: storage blocked; no note to show, nothing to act on.
      noteAt = 0;
    }
  }
  return noteAt > 0 && now - noteAt < MAX_AGE_MS;
}

export function clearAccountChoiceRetry(): void {
  try {
    sessionStorage.removeItem(SIGNIN_RETRY_KEY);
  } catch {
    // Silent by design: storage blocked, so there is no note to clear.
  }
}
