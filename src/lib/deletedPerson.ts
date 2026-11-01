/**
 * Q369 (owner, 2026-09-24): ONE label for a person whose account was deleted.
 * Users see "Former member"; admin screens see "Deleted account". Everywhere.
 *
 * Deletion anonymises rather than removes (20260901033011): jobs, reviews,
 * group-helper slots and kept messages stand with a NULL person id. That null
 * is the deleted state — render one of these two labels for it, never a
 * role word ("Former Helpr"), a placeholder ("a neighbor", "Unknown") or a
 * one-off phrasing. Guard: src/test/deletedPersonLabel.test.ts.
 */
export const FORMER_MEMBER_LABEL = "Former member";
export const ADMIN_DELETED_ACCOUNT_LABEL = "Deleted account";

/**
 * A poster's first name for a sentence ("Message Sam", "Sam hasn't replied yet"), or "" when only a placeholder is
 * known: the "a neighbor" fallback (POSTER_NAME_FALLBACK, a missed name read) or FORMER_MEMBER_LABEL. Taking the first
 * word of those printed "Message a" and "a hasn't replied yet" (B40, 10-31; ApplyBody fixed the same for "Say hi to a").
 */
export function posterFirstName(name: string | null | undefined): string {
  const t = (name ?? "").trim();
  if (!t || t.toLowerCase() === "a neighbor" || t === FORMER_MEMBER_LABEL) return "";
  return t.split(/\s+/)[0];
}
