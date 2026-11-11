import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
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
export { clearSignupDraft } from "@/lib/signupDraft"; // Signup.tsx clears it once the account exists
