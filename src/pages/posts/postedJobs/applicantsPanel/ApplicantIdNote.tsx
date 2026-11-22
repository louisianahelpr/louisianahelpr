import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { APPLICANTS_ID_NOTE } from "@/lib/awardGate";

/**
 * The applicants list's "verifies their ID when they accept" line, shown only while the ID check is on and at least
 * one applicant is not ID-verified yet. ONCE above the list (Jobs audit 11-21, G10): it was repeated on every
 * unverified card ("Andre verifies their ID when they accept."), the same words down the whole list.
 */
export function ApplicantIdNote({ anyUnverified }: { anyUnverified: boolean }) {
  const idOn = useIdentityCheckOnStore();
  if (!idOn || !anyUnverified) return null;
  return (
    <p className="mb-3 text-ds-13 font-sans" style={{ color: "hsl(var(--olivewood))" }} data-applicant-id-note="">
      {APPLICANTS_ID_NOTE}
    </p>
  );
}
