import { useAuthReady } from "@/hooks/useAuthReady";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";

/**
 * What a SIGNED-OUT visitor (and the build-time prerender of /legal, and any first paint before the session is known)
 * is told about the ID check: ON. identity_check is set to everyone on prod (read 11-09; owner turned ID checks on
 * 11-01), so the static HTML and a guest's page say what is true today (lead, 11-09).
 *
 * A guest cannot read the switch itself: features_open_to_everyone answers only the three section switches
 * (declutter, shops, rentals; lead review 2026-10-19: other rollouts stay private), and useIdentityCheckOnStore is the
 * member's own answer, false signed out. Measured 11-10 on the built page: a guest still read "ID, if you choose to
 * verify it" when the guest answer was read from features_open_to_everyone. If identity_check is ever turned off for
 * everyone, this constant changes with it (Q2788).
 */
export const ID_CHECK_BEFORE_ANSWER = true;

/**
 * Is the ID check on, for THIS viewer, signed in or not?
 *
 * L003 (landing audit 11-09, High): the public Privacy and Terms pages read the member's switch answer, false for every
 * signed-out visitor, so they told guests ID was optional while the owner's rule (OWNER-DECISIONS.md, 10-30) checks an
 * ID once per account. A member reads their own switch, as before; a guest, ID_CHECK_BEFORE_ANSWER.
 */
export function useIdCheckOnForViewer(): boolean {
  const member = useIdentityCheckOnStore();
  const { user, isReady } = useAuthReady();
  if (!isReady || !user) return ID_CHECK_BEFORE_ANSWER;
  return member;
}

/** The owner's rule (10-30) in one clause, for the legal pages' short versions. */
export const ID_ONCE_PER_ACCOUNT =
  "a photo ID, checked once per account: the first time you post a job, get hired or take a delivery, list an item, or buy one";
