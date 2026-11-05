/**
 * Job photos on the shareable profile (owner 11-05, share-profile H4). Visitors see the after photos a Helpr picked,
 * only while everyone on that job allows sharing (src/lib/profileLink/jobPhotos.ts). On your own page you pick them:
 * each completed job's after photo has a "Show on my page" toggle; nothing from a job shows until you tick it.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";
import { PhotoTileButton } from "@/components/ui/PhotoTileButton";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { signProofPhotoUrls } from "@/lib/proofPhotoStorage";
import { userFacingError } from "@/lib/userFacingError";
import {
  MY_JOB_PHOTOS_KEY,
  fetchMyJobPhotos,
  fetchPublicJobPhotos,
  jobPhotoMonth,
  jobPhotoUrl,
  publicJobPhotosKey,
  setJobPhotoShown,
} from "@/lib/profileLink/jobPhotos";

const caption = (category: string, month: string) => [jobCategoryLabel(category), jobPhotoMonth(month)].filter(Boolean).join(" · ");

/** What a visitor sees: nothing at all when there are none (or the read fails; the rest of the page stands). */
export function PublicJobPhotos({ handle }: { handle: string }) {
  const q = useQuery({ queryKey: publicJobPhotosKey(handle), queryFn: () => fetchPublicJobPhotos(handle) });
  const [open, setOpen] = useState<number | null>(null);
  const photos = q.data ?? [];
  if (photos.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm" aria-labelledby="pp-job-photos" data-testid="pp-job-photos">
      <h2 id="pp-job-photos" className="flex items-center gap-2 text-ds-17 font-display font-semibold text-foreground">
        <Camera className="h-5 w-5 text-primary" aria-hidden /> From jobs
        <span className="text-ds-13 font-normal text-muted-foreground">{photos.length} {photos.length === 1 ? "photo" : "photos"}</span>
      </h2>
      <ul className="mt-3 grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
        {photos.map((ph, i) => (
          <li key={ph.id}>
            <PhotoTileButton onClick={() => setOpen(i)} aria-label={`Open job photo ${i + 1} of ${photos.length}: ${caption(ph.category, ph.month)}`} className="w-full">
              <img loading="lazy" decoding="async" src={jobPhotoUrl(ph.id, 320)} alt="" className="h-full w-full object-cover" />
            </PhotoTileButton>
            <p className="mt-0.5 truncate text-ds-12 text-muted-foreground">{caption(ph.category, ph.month)}</p>
          </li>
        ))}
      </ul>
      <PhotoLightbox photos={photos.map((ph) => jobPhotoUrl(ph.id, 1200))} lightboxIndex={open} setLightboxIndex={setOpen} />
    </section>
  );
}

/** Your own page: pick which of your job photos show. Hidden when you have none. */
export function MyJobPhotosPicker({ handle }: { handle: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: MY_JOB_PHOTOS_KEY,
    queryFn: async () => {
      const rows = await fetchMyJobPhotos();
      const urls = await signProofPhotoUrls(rows.map((r) => r.photo_path));
      return rows.map((r, i) => ({ ...r, url: urls[i] }));
    },
  });
  const [busy, setBusy] = useState<string | null>(null);
  const rows = (q.data ?? []).filter((r) => !!r.url);
  if (rows.length === 0) return null;
  const toggle = async (jobId: string, path: string, next: boolean) => {
    setBusy(path);
    try {
      await setJobPhotoShown(jobId, path, next);
      await Promise.all([qc.invalidateQueries({ queryKey: MY_JOB_PHOTOS_KEY }), qc.invalidateQueries({ queryKey: publicJobPhotosKey(handle) })]);
    } catch (e) {
      toast.error(userFacingError(e, "We couldn't change that photo on your page. Try again."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card p-4" aria-labelledby="pp-my-job-photos" data-testid="pp-my-job-photos">
      <h2 id="pp-my-job-photos" className="text-ds-15 font-semibold text-foreground">Photos from your jobs</h2>
      <p className="mt-1 text-ds-13 text-muted-foreground">
        Only you see this. Pick the after photos to show on your page. A photo shows only while everyone on that job allows photo sharing.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 min-[900px]:grid-cols-4">
        {rows.map((r) => (
          <li key={`${r.job_id}:${r.photo_path}`} className="flex flex-col gap-1.5">
            <div className="aspect-square overflow-hidden rounded-ds-sm bg-muted">
              <img loading="lazy" decoding="async" src={r.url ?? undefined} alt="" className="h-full w-full object-cover" />
            </div>
            <p className="truncate text-ds-12 text-muted-foreground">{caption(r.category, r.month)}</p>
            <ToggleChip pressed={r.shown} disabled={busy === r.photo_path} onClick={() => void toggle(r.job_id, r.photo_path, !r.shown)}
              aria-label={`Show on my page: ${caption(r.category, r.month)}`}>
              Show on my page
            </ToggleChip>
            {r.shown && !r.consented && (
              <p className="text-ds-12 text-muted-foreground" data-testid="pp-job-photo-waiting">Not showing yet: someone on this job turned off photo sharing.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
