import { CategoryIcon } from "@/components/job/CategoryIcon";

/**
 * Board 6: the first card of the Browse feed is the big one, with a 16:10
 * picture band over the usual card body (spec §3 "Job card: 16:10 photo").
 * The picture is the job's own first photo; a job without one shows its
 * category icon on the quiet photo fill (spec §9.33 "no-photo cards use the
 * category icon on the subtle fill"), never a stock or placeholder photo.
 */
export function JobCardHeroBand({ photo, category }: { photo: string | null | undefined; category: string }) {
  return (
    <div className="relative aspect-[16/10] max-h-64 w-full overflow-hidden bg-muted" data-testid="job-card-hero">
      {photo ? (
        <img src={photo} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <CategoryIcon category={category} className="h-10 w-10 text-primary/70" strokeWidth={1.75} />
        </div>
      )}
    </div>
  );
}
