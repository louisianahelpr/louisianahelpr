import { useState } from "react";
import { PhotoProofDialog } from "@/components/PhotoProofDialog";
import { useProofPhotoUrls } from "@/hooks/useProofPhotoUrls";
import { ProofPhotoImg } from "@/components/ProofPhotoImg";

/**
 * The Helpr's before and after photos, to look at (Tester 6, 10-30: they showed only in the approve sheet, so the
 * poster's job page and collapsed card, and the Helpr's own page after release, showed none).
 *
 * Read-only: the one thing it opens is the photo gallery. Approving and releasing stay on the card's own controls.
 * The caller decides who may see it (job parties only); the values are storage paths, signed here at display time.
 * Nothing draws when no photo exists yet, and each side appears as soon as it is submitted.
 *
 * The clicks stop here: on the card this sits inside a row whose tap opens the job, and React bubbles the dialog's
 * clicks through its portal to that row.
 */
export function JobProofPhotos({
  beforeUrls,
  afterUrls,
  variant = "page",
}: {
  beforeUrls: readonly string[] | null | undefined;
  afterUrls: readonly string[] | null | undefined;
  /** "page": a titled section with two large tiles. "card": a compact row for a collapsed job card. */
  variant?: "page" | "card";
}) {
  const [open, setOpen] = useState(false);
  const before = (beforeUrls ?? []).filter(Boolean);
  const after = (afterUrls ?? []).filter(Boolean);
  const tiles = [
    before[0] ? { label: "Before", value: before[0], count: before.length } : null,
    after[0] ? { label: "After", value: after[0], count: after.length } : null,
  ].filter((t) => t !== null);
  const srcs = useProofPhotoUrls(tiles.map((t) => t.value));
  if (tiles.length === 0) return null;

  const card = variant === "card";
  const body = (
    <button
      type="button"
      data-job-proof-open=""
      aria-label="See the before and after photos"
      onClick={() => setOpen(true)}
      className={`rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${card ? "flex min-h-11 items-center gap-2 text-left" : `grid w-full gap-2 ${tiles.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}`}
    >
      {tiles.map((t, i) => (
        <span
          key={t.label}
          className={`relative block overflow-hidden bg-muted ${card ? "h-11 w-11 shrink-0 rounded-lg" : "aspect-[16/10] rounded-xl"}`}
        >
          <ProofPhotoImg insideControl src={srcs[i]} alt="" className="h-full w-full object-cover" />
          {!card && (
            <span className="absolute left-2 top-2 rounded-full bg-card px-2.5 py-0.5 text-ds-11 font-bold text-foreground">
              {t.count > 1 ? `${t.label} · ${t.count}` : t.label}
            </span>
          )}
        </span>
      ))}
      {card && <span className="min-w-0 text-ds-13 font-semibold text-foreground">{tiles.length === 2 ? "Before and after photos" : `${tiles[0].label} photo`}</span>}
    </button>
  );

  return (
    <div data-job-proof-photos={variant} onClick={(e) => e.stopPropagation()} className={card ? undefined : "space-y-2"}>
      {!card && <h3 className="text-ds-14 font-semibold">Photos from the job</h3>}
      {body}
      {/* Mounted when asked for: it signs every photo, the tiles only the first of each. */}
      {open && <PhotoProofDialog open onOpenChange={setOpen} beforeUrls={before} afterUrls={after} />}
    </div>
  );
}
