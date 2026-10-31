/**
 * The confirm sheet's warning line, by side (LEAD-CONFIRM-WORDS, owner 10-31). Moved out of JobConfirmation.tsx so the
 * component stays within the 600-line size limit (componentSizeRatchet). Guard: src/pages/jobs/jobPage/JobPage.test.tsx.
 */
export function posterConfirmWarning(isOwner: boolean, helperConfirmedAt: string | null): string {
  if (!isOwner) return "No-shows or last-minute cancellations after confirming may result in a warning or account restrictions.";
  return helperConfirmedAt
    ? "If you cancel late, your Helpr is paid for their trouble."
    : "There's no late-cancel fee until your Helpr confirms.";
}
