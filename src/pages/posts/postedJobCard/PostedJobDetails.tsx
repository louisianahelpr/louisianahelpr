import type { ReactNode } from "react";
import { JobCardPhotoStrip } from "../../../components/job-card/JobCardPhotoStrip";

/**
 * The posted card's own details, below the tracker and beside its photos
 * (owner, 2026-10-07: "material provided, access and parking, job description
 * should be below the tracker near the photo"). Lives here, not in
 * PostedJobCard, so the card stays inside its component-size budget.
 *
 * `break-words` on the description: it is free text, and one unbroken token (a
 * URL, a gate-code string, a pasted address with no spaces) ran straight out
 * of the card and was cut at its edge — measured at 375, 2026-09-07.
 */
export function PostedJobDetails({ description, notes, photos }: { description: string | null; notes: ReactNode; photos: string[] }) {
  if (!description && !notes && photos.length === 0) return null;
  return (
    // No top border: it sat a few px under the title bar's own line, two rules
    // with a sliver between (owner, 2026-10-08: "remove that small gap above the description").
    <div className="px-4 pt-1 pb-3 space-y-3" data-testid="posted-card-details">
      {(description || notes) && (
        <div className="space-y-1.5">
          {description && <p className="text-ds-11 text-muted-foreground leading-relaxed break-words">{description}</p>}
          {notes}
        </div>
      )}
      {photos.length > 0 && (
        <div>
          <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Photos</p>
          <JobCardPhotoStrip urls={photos} size="md" />
        </div>
      )}
    </div>
  );
}
