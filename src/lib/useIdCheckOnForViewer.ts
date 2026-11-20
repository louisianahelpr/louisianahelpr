import { useAuthReady } from "@/hooks/useAuthReady";
import { useIdentityCheckLastAnswerStore } from "@/lib/identityCheckSwitch";
import { useGuestIdCheckAnswer } from "@/lib/guestIdCheckAnswer";

/**
 * What a SIGNED-OUT visitor (and the build-time prerender of /legal, and any first paint before the session is known)
 * is told about the ID check: ON. identity_check is set to everyone on prod (read 11-09; owner turned ID checks on
 * 11-01), so the static HTML and a guest's page say what is true today (lead, 11-09).
 *
 * Q2788: this is now only the answer BEFORE the server's. A guest asks identity_check_on_for_everyone() (migration
 * 20261115181414: one boolean, granted to anon; features_open_to_everyone still answers only the section switches), so
 * if the owner turns ID checks off for everyone, a guest reads that once the answer is in. Until then, and when the
 * read fails or the function is not deployed yet, a guest reads this.
 */
export const ID_CHECK_BEFORE_ANSWER = true;

/**
 * Is the ID check on, for THIS viewer, signed in or not?
 *
 * L003 (landing audit 11-09, High): the public Privacy and Terms pages read the member's switch answer, false for every
 * signed-out visitor, so they told guests ID was optional while the owner's rule (OWNER-DECISIONS.md, 10-30) checks an
 * ID once per account. A member reads their own switch, as before; a guest, ID_CHECK_BEFORE_ANSWER.
 *
 * Page settle (prod-audit 11-15, /profile?tab=legal at 375, CLS 0.035): a member read FALSE between the session
 * arriving and IdentityCheckMount's answer (the store's "not published yet" value), so the Terms short version painted
 * without the ID sentence and then grew it, pushing every line below it down 64px. Until the member's switch has a
 * real answer (useIdentityCheckLastAnswerStore: null = not known, kept through a failed refetch) the member reads what
 * the page already said before the session was known, ID_CHECK_BEFORE_ANSWER; a real "off" still turns it off,
 * and a failed refetch after an answer keeps that answer instead of reading as off.
 * Guard: src/pages/info/legal/termsIdLineHoldsUntilAnswer.test.tsx.
 */
export function useIdCheckOnForViewer(): boolean {
  const memberAnswer = useIdentityCheckLastAnswerStore();
  const { user, isReady } = useAuthReady();
  const guestAnswer = useGuestIdCheckAnswer(isReady && !user);
  if (!isReady) return ID_CHECK_BEFORE_ANSWER;
  if (!user) return guestAnswer ?? ID_CHECK_BEFORE_ANSWER;
  return memberAnswer ?? ID_CHECK_BEFORE_ANSWER;
}

/** The owner's rule (10-30) in one clause, for the legal pages' short versions. */
export const ID_ONCE_PER_ACCOUNT =
  "a photo ID, checked once per account: the first time you post a job, get hired or take a delivery";
