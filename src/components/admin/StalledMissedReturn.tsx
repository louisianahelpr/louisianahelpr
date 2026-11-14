import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useProofPhotoUrls } from "@/hooks/useProofPhotoUrls";
import { formatTimestamp } from "@/lib/format";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { useInAppPhotoViewer } from "@/components/useInAppPhotoViewer";
import { PhotoOpenButton } from "@/components/ui/PhotoOpenButton";

type MissedReport = { reporter_side: "poster" | "helpr"; note: string | null; photos: string[]; created_at: string; resolved_at: string | null };

/**
 * Owner decision #4 (11-08): on a Stuck jobs row, what the poster ("Didn't come back", photos + note) or the Helpr
 * ("Can't come back", note) told us when the continue day was missed (job_missed_returns, 20261108214605). The admin
 * decides the split with the job's own refund / status tools ("Refund or change status in Jobs" on the row).
 * Nothing renders for a stuck job with no report.
 */
export function StalledMissedReturn({ jobId }: { jobId: string }) {
  const q = useQuery({
    queryKey: ["admin-missed-return", jobId],
    queryFn: async () =>
      (unwrap(
        await supabase.from("job_missed_returns").select("reporter_side, note, photos, created_at, resolved_at")
          .eq("job_id", jobId).order("created_at", { ascending: false }).limit(1),
      ) as MissedReport[] | null)?.[0] ?? null,
    staleTime: 30_000,
  });
  // The poster's photos, signed in the shared batch (proofPhotoStorage.ts); an unsigned one shows as text, not a link.
  const urls = useProofPhotoUrls(q.data?.photos ?? []);
  const { open: openPhoto, viewer } = useInAppPhotoViewer(urls, urls.map((_, i) => `Missed-day photo ${i + 1}`));
  if (q.isError) {
    return (
      <>
        <ReportErrorScreen source="StalledMissedReturn" title="Missed-day report failed to load" />
        <p className="text-ds-11 text-destructive-ink">Couldn't load the missed-day report. Refresh to try again.</p>
      </>
    );
  }
  const r = q.data;
  if (!r) return null;
  return (
    <div data-stalled-missed-return={r.reporter_side} className="rounded-ds-md border border-border/60 bg-background/60 p-3 space-y-1 text-ds-11">
      <p className="font-semibold text-foreground">
        {r.reporter_side === "poster" ? "Poster: the Helpr didn't come back" : "Helpr: can't come back"} · {formatTimestamp(r.created_at)}
        {r.resolved_at ? " · reviewed" : ""}
      </p>
      {r.note && <p className="text-muted-foreground break-words">“{r.note}”</p>}
      {r.photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {r.photos.map((p, i) => (
            urls[i] ? (
              <PhotoOpenButton key={p} onClick={() => openPhoto(i)} className="min-h-11 font-semibold text-foreground underline underline-offset-2">
                Photo {i + 1}
              </PhotoOpenButton>
            ) : (
              <span key={p} className="text-muted-foreground">Photo {i + 1} (loading)</span>
            )
          ))}
          {viewer}
        </div>
      )}
      <p className="text-muted-foreground">Nothing moved. Decide the split with Refund or change status in Jobs.</p>
    </div>
  );
}
