import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { useProofPhotoUrls } from "@/hooks/useProofPhotoUrls";
import { ProofPhotoImg } from "@/components/ProofPhotoImg";
import { useInAppPhotoViewer } from "@/components/useInAppPhotoViewer";

/* ── The full before/after gallery, on its own ──────────────────────────────
 *
 * Owner, 2026-09-19 (item 10): on a job card the before & after pictures are a
 * BUTTON on the same row as the other action buttons. A button needs something
 * to open, and what it opens is exactly what PhotoProofGroup's "View all"
 * already opened — so the dialog is lifted out whole rather than written a
 * second time, and the group keeps using it. Nothing about the gallery itself
 * changes.
 *
 * Read-only by design: the uploader is a different control (`PhotoProofCaptureChip`,
 * the row's own ask), and this is the surface for LOOKING at proof.
 */
export const PhotoProofDialog = ({
  open,
  onOpenChange,
  beforeUrls,
  afterUrls,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beforeUrls: string[];
  afterUrls: string[];
}) => {
  const hasBefore = beforeUrls.length > 0;
  const hasAfter = afterUrls.length > 0;
  const beforeSrcs = useProofPhotoUrls(beforeUrls);
  const afterSrcs = useProofPhotoUrls(afterUrls);
  // Owner 11-13: a tap opens the photo in the app's own viewer, never the signed URL in Safari. One viewer for both
  // sides, so a swipe goes from the last before photo to the first after photo.
  const alts = [...beforeUrls.map((_, i) => `Before photo ${i + 1}`), ...afterUrls.map((_, i) => `After photo ${i + 1}`)];
  const { open: openPhoto, viewer } = useInAppPhotoViewer([...beforeSrcs, ...afterSrcs], alts);
  const tile = "block w-full rounded-ds-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero
          title="Photo proof"
        />
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {hasBefore && (
            <div className="space-y-2">
              <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wider">Before</p>
              <div className="grid grid-cols-3 gap-2">
                {beforeUrls.map((url, i) => (
                  <button key={url ?? i} type="button" className={tile} disabled={!beforeSrcs[i]} aria-label={`Open before photo ${i + 1}`} data-proof-photo-open="" onClick={() => openPhoto(i)}>
                    <ProofPhotoImg insideControl src={beforeSrcs[i]} alt={`Before ${i + 1}`} className="w-full aspect-square rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {hasAfter && (
            <div className="space-y-2">
              <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wider">After</p>
              <div className="grid grid-cols-3 gap-2">
                {afterUrls.map((url, i) => (
                  <button key={url ?? i} type="button" className={tile} disabled={!afterSrcs[i]} aria-label={`Open after photo ${i + 1}`} data-proof-photo-open="" onClick={() => openPhoto(beforeUrls.length + i)}>
                    <ProofPhotoImg insideControl src={afterSrcs[i]} alt={`After ${i + 1}`} className="w-full aspect-square rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {!hasBefore && !hasAfter && (
            <p className="text-ds-11 text-muted-foreground text-center py-6">No photos uploaded yet.</p>
          )}
        </div>
        {viewer}
      </DialogContent>
    </Dialog>
  );
};
