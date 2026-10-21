/**
 * Board 6: the first card of the Browse feed is the big one, with a 16:10
 * picture band over the usual card body (spec §3 "Job card: 16:10 photo").
 * Only the job's OWN first photo earns the band. A job without one keeps the
 * normal card (lead review 2026-10-21: an empty grey block with a lone icon
 * cost half the phone screen for nothing; the category icon is already in the
 * card's header row). Never a stock or placeholder photo.
 */
export function JobCardHeroBand({ photo }: { photo: string | null | undefined }) {
  if (!photo) return null;
  return (
    <div className="relative aspect-[16/10] max-h-64 w-full overflow-hidden bg-muted" data-testid="job-card-hero">
      <img src={photo} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
    </div>
  );
}
