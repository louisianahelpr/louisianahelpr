/**
 * H5 (share-profile audit 11-05, owner: ONE profile link). Every in-app tap on a member's name or photo goes through
 * here. The callers know only the member's id, so the path is /user/<id>, and that route forwards everyone, members
 * included, to the public /u/<handle> page (src/components/profile/PublicProfileForward.tsx, handle_for_user). With no
 * public page (handle_for_user NULL) a member stays on /user/<id>, so Report and Block are never lost; a member who
 * blocked this person stays there too, for Unblock.
 *
 * Guard: src/test/profileLinksGoToTheOnePage.test.tsx (no other file builds a /user/<id> link).
 */
/** F359i (owner 11-12): where a profile link came from. A seller link on a Declutter listing passes "declutter", and
 *  /user/:userId then leads with the seller's Declutter (UserProfile's declutterFirst). */
export const PROFILE_FROM_PARAM = "from";
export const PROFILE_FROM_DECLUTTER = "declutter";

export function memberProfilePath(userId: string, opts?: { from?: typeof PROFILE_FROM_DECLUTTER }): string {
  return opts?.from ? `/user/${userId}?${PROFILE_FROM_PARAM}=${opts.from}` : `/user/${userId}`;
}
