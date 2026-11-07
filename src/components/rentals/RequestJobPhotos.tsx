/**
 * Q2058 (owner Q42): the Helpr's before/after photos of a repair request's booked job, for the tenant and the
 * landlord alike. rentals_request_job_photos (20261106215556) lists the job's proof paths only to the request's two
 * sides; the tenant may sign exactly those (storage policy "Tenants can read their repair job's proof photos").
 * Nothing renders until the Helpr adds a photo. A failed read shows its own line with a retry.
 */
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchRequestJobPhotos, type RequestJobPhoto } from "@/lib/rentals/api";
import { signProofPhotoUrls } from "@/lib/proofPhotoStorage";
import { RentalsCard } from "./rentalsUi";

interface SignedPhoto extends RequestJobPhoto {
  url: string | null;
}

async function loadPhotos(requestId: string): Promise<SignedPhoto[]> {
  const rows = await fetchRequestJobPhotos(requestId);
  const urls = await signProofPhotoUrls(rows.map((r) => r.photo_path));
  return rows.map((r, i) => ({ ...r, url: urls[i] ?? null }));
}

function Row({ label, photos }: { label: string; photos: SignedPhoto[] }) {
  if (photos.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">{label}</p>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) =>
          p.url ? (
            <img key={p.photo_path} src={p.url} alt={`${label} photo`} className="h-24 w-24 rounded-lg object-cover" />
          ) : (
            <span key={p.photo_path} className="flex h-24 w-24 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
              Photo unavailable
            </span>
          ),
        )}
      </div>
    </div>
  );
}

export default function RequestJobPhotos({ requestId }: { requestId: string }) {
  const q = useQuery({ queryKey: ["rentals-request-job-photos", requestId], queryFn: () => loadPhotos(requestId) });
  if (q.isError) {
    return <ErrorState variant="inline" title="We couldn't load the Helpr's photos." onRetry={() => void q.refetch()} />;
  }
  const photos = q.data ?? [];
  if (photos.length === 0) return null;
  return (
    <RentalsCard title="The Helpr's photos">
      <Row label="Before" photos={photos.filter((p) => p.kind === "before")} />
      <Row label="After" photos={photos.filter((p) => p.kind === "after")} />
    </RentalsCard>
  );
}
