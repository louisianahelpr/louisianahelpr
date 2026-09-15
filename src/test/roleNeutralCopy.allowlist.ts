/**
 * The ONLY places a role word may stand in user-visible copy.
 *
 * Every entry carries a reason. An entry with no `text` exempts the whole file
 * (or path prefix); an entry with `text` exempts only strings containing that
 * substring, so a blanket file exemption is never the default.
 *
 * Adding an entry here is a copy decision, not a way to silence the guard: the
 * rule is that the other party on a job is named by what they DID on that job
 * ("the person who posted this job", "the person doing this job"), never by a
 * role held as an identity. The three reasons below are the only ones that have
 * ever justified an exception.
 */
export type RoleCopyException = {
  /** Repo-relative path, or a path prefix ending in "/". */
  file: string;
  /** When set, only copy containing this substring is exempt. */
  text?: string;
  reason: string;
};

export const ROLE_COPY_ALLOWLIST: readonly RoleCopyException[] = [
  {
    file: "src/",
    text: "Louisiana Helpr",
    reason: "brand name — the company, not a role anyone holds.",
  },
  {
    file: "src/components/admin/",
    reason:
      "admin-only screens. Operators triage by which side of a job a party is on, and the queue labels, CSV headers and refund buttons are their vocabulary; no ordinary user reads them.",
  },
  {
    file: "src/pages/legal/",
    reason:
      "legal pages. Terms, Community Guidelines and Privacy define the contractual parties to a job and their fees; a contract needs the defined term, not a description.",
  },
  {
    file: "src/components/NotificationPanel.tsx",
    text: "cancelled by the poster",
    reason:
      "not copy — a needle matched against STORED notification bodies. Postgres triggers write them (migrations 20260905021859, 20260908155425 and earlier) and every row already in the table says 'cancelled by the poster', so dropping the legacy phrasing would silently remove the quick-action pill from all of them. Reword the trigger in a migration first, then this.",
  },
  {
    file: "src/pages/helpCenter/helpCenterContent.ts",
    text: 'There\'s no separate "poster" or "Helpr" mode',
    reason:
      "the help-center answer that exists to DENY the role distinction. It has to name the two roles in order to say neither is a mode you are in.",
  },
];

/** True when this copy is an approved exception. */
export function isAllowedRoleCopy(file: string, text: string): boolean {
  return ROLE_COPY_ALLOWLIST.some(
    (e) => file.startsWith(e.file) && (e.text === undefined || text.includes(e.text)),
  );
}
