/**
 * F067 (owner UI audit 11-09; lead go-ahead 11-09): the official Helpr support account's public page read like any
 * member's: "Hire me", "New on Helpr" and the generic handle "neighbor", while its bio says "Message me". Its handle
 * is helpr-support now (20261109191035; the old /u/neighbor still opens it through the retired-handle link), and its
 * page shows a "Helpr team" badge and a "Message support" button (the support form; profiles have no Message button,
 * owner) in place of "New on Helpr" and "Hire me".
 * Guard: src/test/helprTeamProfile.test.tsx.
 */
export const HELPR_TEAM_HANDLE = "helpr-support";

export function isHelprTeam(handle: string | null | undefined): boolean {
  return handle === HELPR_TEAM_HANDLE;
}
