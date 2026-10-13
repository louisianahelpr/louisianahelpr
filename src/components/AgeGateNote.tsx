import { cn } from "@/lib/utils";
import { ageGateCopy, type AgeGateKind } from "@/lib/ageGate";

/**
 * The one plain line under a greyed-out Apply or Post a Job (owner,
 * 2026-10-12, Q1586(c)). Render it only when useAgeGate().underAge is true.
 */
export function AgeGateNote({ kind, className }: { kind: AgeGateKind; className?: string }) {
  return (
    <p
      role="note"
      data-age-gate-note={kind}
      className={cn("font-sans text-ds-12 leading-snug text-muted-foreground", className)}
    >
      {ageGateCopy(kind)}
    </p>
  );
}
