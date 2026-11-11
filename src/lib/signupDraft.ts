/**
 * F259c (audit 11-10): the sign-up draft (first name, last name, email; never the password) kept in sessionStorage
 * so a reload on /signup does not lose it. Read and written by useSignupDraftField; cleared when the account is
 * created (Signup.tsx), when the page unmounts, and on sign-out (authSignOut.ts). Every call is in try/catch: a private
 * window or blocked storage just means no draft.
 */
export type SignupDraftKey = "firstName" | "lastName" | "email";

const KEYS: readonly SignupDraftKey[] = ["firstName", "lastName", "email"];

export const signupDraftStorageKey = (key: SignupDraftKey) => `lh-signup-draft:${key}`;

export function readSignupDraft(key: SignupDraftKey): string {
  try {
    return window.sessionStorage.getItem(signupDraftStorageKey(key)) ?? "";
  } catch {
    return ""; // storage blocked: start empty, as before
  }
}

export function writeSignupDraft(key: SignupDraftKey, value: string): void {
  try {
    if (value) window.sessionStorage.setItem(signupDraftStorageKey(key), value);
    else window.sessionStorage.removeItem(signupDraftStorageKey(key));
  } catch {
    // storage blocked or full: the field still works, it just is not kept over a reload
  }
}

/** Drops one field's draft, or all of them. */
export function clearSignupDraft(only?: SignupDraftKey): void {
  for (const key of only ? [only] : KEYS) {
    try {
      window.sessionStorage.removeItem(signupDraftStorageKey(key));
    } catch {
      // storage blocked: nothing was kept
    }
  }
}
