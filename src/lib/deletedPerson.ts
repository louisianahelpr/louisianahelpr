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
