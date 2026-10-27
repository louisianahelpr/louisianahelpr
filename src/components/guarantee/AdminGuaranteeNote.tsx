/**
 * The admin's dispute card, for a dispute born of a Helpr Guarantee request (owner 2026-10-27; migration
 * 20261027200455): the poster's note and photos (a platform filing carries no evidence of its own, so they live on
 * the request), what the poster said after the fix, and the money rule: the refund is the job price only, fees
 * kept, so Quick Refund is refused and the decision goes through Record decision (execute-dispute-split).
 */
import { useQuery } from "@tanstack/react-query";
import { useProofPhotoUrls } from "@/hooks/useProofPhotoUrls";
import { fetchGuaranteeClaim } from "@/lib/guarantee";

export function AdminGuaranteeNote({ jobId }: { jobId: string }) {
  const claim = useQuery({ queryKey: ["guarantee", jobId], queryFn: () => fetchGuaranteeClaim(jobId) });
  const c = claim.data;
  const urls = useProofPhotoUrls(c?.photo_paths ?? []);
  if (claim.isError) {
    return <p className="text-ds-11 text-destructive">Couldn't read whether this came from a Helpr Guarantee request. Refresh before deciding.</p>;
  }
  if (!c || (c.status !== "disputed" && c.status !== "escalating")) return null;
  return (
    <div data-admin-guarantee="" className="p-3 rounded-ds-sm bg-muted/40 border border-border space-y-1.5">
      <p className="text-ds-13 text-foreground font-medium">Helpr Guarantee request</p>
      <p className="text-ds-11 text-muted-foreground break-words">"{c.note}"</p>
      {c.poster_reject_note && <p className="text-ds-11 text-muted-foreground break-words">After the fix: "{c.poster_reject_note}"</p>}
      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map((u, i) => (u ? <img key={c.photo_paths[i]} src={u} alt={`Guarantee photo ${i + 1}`} className="h-16 w-16 rounded object-cover" /> : null))}
        </div>
      )}
      <p className="text-ds-11 text-foreground">The refund is the job price only; fees are kept. Use Record decision (Quick Refund is refused).</p>
    </div>
  );
}
