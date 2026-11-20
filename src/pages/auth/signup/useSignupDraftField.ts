import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useLocation } from "react-router-dom";
import { clearSignupDraft, readSignupDraft, writeSignupDraft, type SignupDraftKey } from "@/lib/signupDraft";

/**
 * F259c (audit 11-10): a reload on /signup (a phone dropping the tab) threw away every typed field and sent the member
 * back to a blank step 1. First name, last name and email now live in sessionStorage while the page is open
 * (src/lib/signupDraft.ts), so a reload puts them back. Never the password. This tab only, and the draft is dropped
 * when the page unmounts (account created, or the member left for another page) and on sign-out.
 */
export function useSignupDraftField(key: SignupDraftKey): [string, Dispatch<SetStateAction<string>>] {
  const [value, setValue] = useState(() => readSignupDraft(key));
  useEffect(() => writeSignupDraft(key, value), [key, value]);
  useEffect(() => () => clearSignupDraft(key), [key]);
  return [value, setValue];
}

/**
 * The email field, plus signup-confusion 11-19: Log in's "Create an account" (after a miss) and the Log in | Create
 * account switch carry the typed address in router state (never the URL), so a visitor who started on the wrong form
 * keeps it. Applied once per visit to /signup, so going Back between the two steps never puts it back over an edit.
 */
export function useSignupEmailField(): [string, Dispatch<SetStateAction<string>>] {
  const [email, setEmail] = useSignupDraftField("email");
  const carried = (useLocation().state as { email?: unknown } | null)?.email;
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || typeof carried !== "string" || !carried.trim()) return;
    applied.current = true;
    setEmail(carried.trim());
  }, [carried, setEmail]);
  return [email, setEmail];
}
export { clearSignupDraft } from "@/lib/signupDraft"; // Signup.tsx clears it once the account exists
