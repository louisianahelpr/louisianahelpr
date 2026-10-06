/**
 * One-shot note for the account-choice question (Q446) when its dialog's code
 * failed to download. The app's stale-download recovery (src/lib/chunkReload.ts)
 * reloads the page before the import's own catch can run, which loses the
 * question, so SocialAuthButtons writes this BEFORE the download and clears it
 * once the code arrives; after a reload the buttons (Log In and Sign Up alike)
 * read it once and say why the person is back. A timestamp only, no account
 * data; ignored after 2 minutes.
 */
const ACCOUNT_CHOICE_RETRY_KEY = "helpr_account_choice_retry";
const MAX_AGE_MS = 2 * 60 * 1000;

export const ACCOUNT_CHOICE_RETRY_COPY =
  "We couldn't finish that sign-in, so no account was made. Tap Apple or Google again to continue.";

export function markAccountChoiceRetry(): void {
  try {
    sessionStorage.setItem(ACCOUNT_CHOICE_RETRY_KEY, String(Date.now()));
  } catch {
    // Silent by design: storage blocked (private mode). Only the explanatory
    // line after a reload is lost; the next tap still asks the question.
  }
}

export function takeAccountChoiceRetry(now = Date.now()): boolean {
  try {
    const at = Number(sessionStorage.getItem(ACCOUNT_CHOICE_RETRY_KEY));
    sessionStorage.removeItem(ACCOUNT_CHOICE_RETRY_KEY);
    return Number.isFinite(at) && at > 0 && now - at < MAX_AGE_MS;
  } catch {
    // Silent by design: storage blocked; no note to show, nothing to act on.
    return false;
  }
}
