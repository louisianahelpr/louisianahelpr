import { Camera } from "lucide-react";
import { hasRequiredProof, requiredProof } from "@/lib/photoProofPolicy";

/**
 * "Before & after photos are required on this job" — the one red line that says
 * a job is short of the proof its budget demands.
 *
 * It used to live inside PhotoProofGroup's panel. Item 10 (owner, 2026-09-19)
 * replaced that panel on the job cards with a Photos chip + PhotoProofDialog,
 * and the dialog shows photos and nothing else — so on the DISPUTED card the
 * line silently disappeared. That is the one card where it matters most: a
 * poster weighing a dispute is weighing exactly this evidence, and its absence
 * reads as "proof is fine" rather than "proof is missing".
 *
 * Exported so the panel and the cards share ONE definition of the rule instead
 * of the cards re-deriving it. Renders nothing when the proof requirement is
 * met or not in force, so a host can mount it unconditionally.
 */
/**
 * WHO IS BEING TOLD (owner, 2026-09-19, on a POSTER's disputed card).
 *
 * `requiredProof().reason` is written to the HELPER — "…they're the proof that
 * releases your payment" — because the helper is the only person who can act
 * on it. The poster's disputed card mounts this same note, and on their screen
 * "your payment" is not merely imprecise: the poster is the one the money
 * leaves, and there is no control on their card that could satisfy the
 * requirement, because they are not who uploads work proof.
 *
 * The rule is unchanged and still has exactly ONE definition
 * (`src/lib/photoProofPolicy.ts`, owned elsewhere — nothing here re-derives
 * which photos are required or whether they are missing). What changes is only
 * the sentence, per audience, and only the poster's variant is new.
 */
export type ProofNoteAudience = "helper" | "poster";

/** What the poster is told instead. It states the FACT rather than an
 *  instruction, because the poster has nothing to tap: the control that fixes
 *  it is on the Helpr's card. */
export const POSTER_PROOF_MISSING_NOTE =
  "Your Helpr hasn't filed the before & after photos for this job.";

export const PhotoProofRequirementNote = ({
  budget = 0,
  beforeUrls,
  afterUrls,
  audience = "helper",
  className = "",
}: {
  budget?: number;
  beforeUrls: string[];
  afterUrls: string[];
  /** Default "helper" — every pre-existing call site is the Helpr's own card
   *  and its copy is byte-for-byte unchanged. */
  audience?: ProofNoteAudience;
  className?: string;
}) => {
  if (hasRequiredProof({ budget }, beforeUrls, afterUrls)) return null;
  const { reason } = requiredProof({ budget });
  if (!reason) return null;
  const text = audience === "poster" ? POSTER_PROOF_MISSING_NOTE : reason;
  return (
    <p className={`text-ds-11 text-[hsl(var(--destructive-ink))] flex items-center gap-1 ${className}`}>
      <Camera className="w-3 h-3" /> {text}
    </p>
  );
};
