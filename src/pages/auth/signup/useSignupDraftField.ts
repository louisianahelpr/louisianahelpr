import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * F259c (audit 11-10): a reload on /signup (a phone dropping the tab) threw away every typed field and sent the member
 * back to a blank step 1. First name, last name and email now live in sessionStorage while the page is open, so a
 * reload puts them back. Never the password. This tab only (sessionStorage), and the draft is dropped when the page
 * unmounts (account created, or the member left for another page). Every storage call is in try/catch: a private
 * window or blocked storage just means no draft.
 */
export type SignupDraftKey = "firstName" | "lastName" | "email";

const storageKey = (key: SignupDraftKey) => `lh-signup-draft:${key}`;

function read(key: SignupDraftKey): string {
  try {
    return window.sessionStorage.getItem(storageKey(key)) ?? "";
  } catch {
    return ""; // storage blocked: start empty, as before
  }
}

export function useSignupDraftField(key: SignupDraftKey): [string, Dispatch<SetStateAction<string>>] {
  const [value, setValue] = useState(() => read(key));
  useEffect(() => {
    try {
      if (value) window.sessionStorage.setItem(storageKey(key), value);
      else window.sessionStorage.removeItem(storageKey(key));
    } catch {
      // storage blocked or full: the field still works, it just is not kept over a reload
    }
  }, [key, value]);
  useEffect(() => () => {
    try {
      window.sessionStorage.removeItem(storageKey(key));
    } catch {
      // storage blocked: nothing was kept
    }
  }, [key]);
  return [value, setValue];
}
