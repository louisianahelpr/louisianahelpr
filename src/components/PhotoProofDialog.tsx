import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { useProofPhotoUrls, PENDING_PHOTO_SRC } from "@/hooks/useProofPhotoUrls";

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
                  <a key={url ?? i} href={beforeSrcs[i] ?? undefined} target="_blank" rel="noopener noreferrer">
                    <img loading="lazy" decoding="async" src={beforeSrcs[i] ?? PENDING_PHOTO_SRC} alt={`Before ${i + 1}`} className="w-full aspect-square rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
              </div>
            </div>
          )}
          {hasAfter && (
            <div className="space-y-2">
              <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wider">After</p>
              <div className="grid grid-cols-3 gap-2">
                {afterUrls.map((url, i) => (
                  <a key={url ?? i} href={afterSrcs[i] ?? undefined} target="_blank" rel="noopener noreferrer">
                    <img loading="lazy" decoding="async" src={afterSrcs[i] ?? PENDING_PHOTO_SRC} alt={`After ${i + 1}`} className="w-full aspect-square rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
              </div>
            </div>
          )}
          {!hasBefore && !hasAfter && (
            <p className="text-ds-11 text-muted-foreground text-center py-6">No photos uploaded yet.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
