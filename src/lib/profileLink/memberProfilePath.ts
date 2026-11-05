/**
 * H5 (share-profile audit 11-05, owner: ONE profile link). Every in-app tap on a member's name or photo goes through
 * here. The callers know only the member's id, so the path is /user/<id>, and that route forwards everyone, members
 * included, to the public /u/<handle> page (src/components/profile/PublicProfileForward.tsx, handle_for_user). With no
 * public page (handle_for_user NULL) a member stays on /user/<id>, so Report and Block are never lost; a member who
 * blocked this person stays there too, for Unblock.
 *
 * Guard: src/test/profileLinksGoToTheOnePage.test.tsx (no other file builds a /user/<id> link).
 */
export function memberProfilePath(userId: string): string {
  return `/user/${userId}`;
}
