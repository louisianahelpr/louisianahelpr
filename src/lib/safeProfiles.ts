/**
 * Picking the right row out of a `get_safe_profiles` result.
 *
 * The RPC matches EITHER `profiles.user_id` OR `profiles.id` (deliberately —
 * see 20260817230000_get_safe_profiles_resolve_by_profile_id.sql: Messages
 * needs it because `messages.sender_id` has no foreign key and prod stores
 * profile ids there, and profiles RLS means this SECURITY DEFINER function is
 * the only lever those callers have).
 *
 * Those are two key spaces over ONE table, so a single uuid can be person A's
 * `user_id` and person B's `id` at the same time. Live on prod today:
 * `6bdc1f67-ae1f-46a0-8edf-4035629a6147` is Audit Helper's auth id and also Eli
 * Thibodeaux's `profiles.id`. A caller that took row [0] therefore got a
 * confident, error-free, completely wrong human — which is exactly how the
 * applicant-vetting screen came to show one person's name, avatar, bio and
 * trust record for a different person who had applied.
 *
 * So: never index a single-id lookup positionally. Ask for the row that answers
 * the id you asked by.
 *
 * This helper matches `user_id` ONLY, and that is deliberate. A "fall back to a
 * profile_id match when no user_id row came back" rule looks safer than it is:
 * `get_safe_profiles` also filters out unapproved and banned rows, so the true
 * owner's row can be legitimately absent — and then the fallback returns the
 * colliding stranger instead. That is not hypothetical either. It is the exact
 * prod case: Audit Helper is `temp_banned`, so his row is withheld (correctly),
 * and a profile_id fallback would hand back Eli Thibodeaux — reconstructing the
 * very bug this module exists to prevent.
 *
 * Callers that genuinely hold an id of unknown provenance — today only the
 * Messages inbox, whose `messages.sender_id` has no FK — must not use this.
 * They index the whole result by BOTH ids (see `loadConversations.ts`), which
 * is safe because they never ask "who is this one id?" in the first place.
 */
export type SafeProfileIdRow = {
  user_id?: string | null;
  profile_id?: string | null;
};

/**
 * Return the row that genuinely answers `requestedId`, or null.
 *
 * Only a `user_id` match counts. Any other row — including one whose
 * `profile_id` happens to equal `requestedId` — belongs to someone else and is
 * dropped. No row is a far better answer than the wrong person's row: an honest
 * "profile unavailable" costs a poster nothing, while a confident wrong
 * identity is how a stranger gets vetted as somebody else.
 */
export function pickRequestedProfile<T extends SafeProfileIdRow>(
  rows: readonly T[] | null | undefined,
  requestedId: string | null | undefined,
): T | null {
  if (!requestedId) return null;
  return (rows ?? []).find((r) => r?.user_id === requestedId) ?? null;
}
