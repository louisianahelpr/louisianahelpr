import { useAuthReady } from "@/hooks/useAuthReady";
import { useSectionsOpen } from "@/components/landing/useSectionsOpen";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";

/**
 * Is the ID check on, for THIS viewer, signed in or not?
 *
 * L003 (landing audit 11-09, High): useIdentityCheckOnStore reads the member's own switch answer, which is false for
 * every signed-out visitor, so the public Privacy and Terms pages told guests ID was optional ("if you choose to verify
 * it") while identity_check is on for everyone (prod, 11-09) and the owner's rule (OWNER-DECISIONS.md, 10-30) checks an
 * ID once per account. A guest's answer is whether identity_check is open to EVERYONE (features_open_to_everyone, the
 * answer the landing and the Declutter guest gate read); a member's is their own switch, as before.
 */
export function useIdCheckOnForViewer(): boolean {
  const member = useIdentityCheckOnStore();
  const { user, isReady } = useAuthReady();
  const guest = isReady && !user;
  const open = useSectionsOpen(guest).open;
  return guest ? !!open?.has("identity_check") : member;
}

/** The owner's rule (10-30) in one clause, for the legal pages' short versions. */
export const ID_ONCE_PER_ACCOUNT =
  "a photo ID, checked once per account: the first time you post a job, get hired or take a delivery, list an item, or buy one";
