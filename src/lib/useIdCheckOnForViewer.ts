import { useAuthReady } from "@/hooks/useAuthReady";
import { useSectionsOpen } from "@/components/landing/useSectionsOpen";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";

/**
 * Before the viewer's answer is known (the build-time prerender of /legal, the first paint, a guest's open-to-everyone
 * read still in flight): the ID check is ON. identity_check is set to everyone on prod (read 11-09; owner turned ID
 * checks on 11-01), so the static HTML says what is true today; once the real answer arrives it wins, so the words
 * change only if the switch is ever turned off (lead, 11-09).
 */
export const ID_CHECK_BEFORE_ANSWER = true;

/**
 * Is the ID check on, for THIS viewer, signed in or not?
 *
 * L003 (landing audit 11-09, High): useIdentityCheckOnStore reads the member's own switch answer, which is false for
 * every signed-out visitor, so the public Privacy and Terms pages told guests ID was optional ("if you choose to verify
 * it") while identity_check is on for everyone and the owner's rule (OWNER-DECISIONS.md, 10-30) checks an ID once per
 * account. A guest's answer is whether identity_check is open to EVERYONE (features_open_to_everyone, the answer the
 * landing and the Declutter guest gate read); a member's is their own switch, as before.
 *
 * `start` (default true) lets the landing hold the guest read until its section nears the screen, so the Supabase
 * chunk never joins the landing's first paint (useSectionsOpen's rule).
 */
export function useIdCheckOnForViewer(start = true): boolean {
  const member = useIdentityCheckOnStore();
  const { user, isReady } = useAuthReady();
  const guest = isReady && !user;
  const open = useSectionsOpen(guest && start).open;
  if (!isReady) return ID_CHECK_BEFORE_ANSWER;
  if (guest) return open === null ? ID_CHECK_BEFORE_ANSWER : open.has("identity_check");
  return member;
}

/** The owner's rule (10-30) in one clause, for the legal pages' short versions. */
export const ID_ONCE_PER_ACCOUNT =
  "a photo ID, checked once per account: the first time you post a job, get hired or take a delivery, list an item, or buy one";
