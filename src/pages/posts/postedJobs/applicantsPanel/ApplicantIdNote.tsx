import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { formatName } from "@/lib/utils";
import { applicantIdNote } from "@/lib/awardGate";

/**
 * The applicant row's "verifies their ID when they accept" note, shown only while
 * the ID check is on (owner 2026-10-23: it is off) and the applicant is not
 * ID-verified yet.
 */
export function ApplicantIdNote({ fullName, idVerified }: { fullName: string | null | undefined; idVerified: boolean | null | undefined }) {
  const idOn = useIdentityCheckOnStore();
  if (!idOn || idVerified === true) return null;
  return (
    <span className="block mt-0.5 text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood))" }} data-applicant-id-note="">
      {applicantIdNote(formatName(fullName, ""))}
    </span>
  );
}
