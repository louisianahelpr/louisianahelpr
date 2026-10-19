/**
 * Step 1 of selling (owner, 2026-10-19: photo-first, as on Mercari / OfferUp):
 * "Add photos" comes before anything else. A photo can only be stored on a
 * saved draft, so before the first save the chosen photos wait on the device
 * (shown from local previews, never uploaded) and go up the moment the details
 * are saved (DeclutterSellView's saveDetails). After that, photos upload as
 * they are added, as before. "Fill in from my photos" needs uploaded photos.
 */
import { useEffect, useMemo } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { photoPublicUrl, type DeclutterPhoto } from "@/lib/declutter/api";

export const MAX_PHOTOS = 12;
const MIN_PHOTOS = 3;

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="absolute top-0 right-0 w-11 h-11 flex items-center justify-center" onClick={onClick} aria-label={label}>
      <span className="w-7 h-7 rounded-full bg-background/90 text-foreground shadow flex items-center justify-center" aria-hidden>
        <X className="w-4 h-4" />
      </span>
    </button>
  );
}

export function SellPhotos({
  uploaded,
  held,
  onFiles,
  onRemoveUploaded,
  onRemoveHeld,
  uploading,
  ai,
}: {
  uploaded: DeclutterPhoto[];
  /** Photos chosen before the first save: on the device only. */
  held: File[];
  onFiles: (files: FileList | null) => void;
  onRemoveUploaded: (photoId: string) => void;
  onRemoveHeld: (index: number) => void;
  uploading: number;
  /** "Fill in from my photos": only once photos are on a saved draft. */
  ai: { busy: boolean; run: () => void } | null;
}) {
  const previews = useMemo(() => held.map((f) => URL.createObjectURL(f)), [held]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const count = uploaded.length + held.length;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby="sell-photos">
      <h2 id="sell-photos" className="text-base font-semibold">1. Photos ({count} of {MIN_PHOTOS} to {MAX_PHOTOS})</h2>
      <p className="text-xs text-muted-foreground">Start with photos: good ones sell faster. Take your own, and location data is removed from every photo before it's uploaded.</p>
      <input id="sell-files" type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2" data-sell-photos="">
        {count < MAX_PHOTOS && (
          <li>
            {/* The first tile is the way in, as on Mercari: big, dashed, impossible to miss. */}
            <label
              htmlFor="sell-files"
              data-add-photos=""
              className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[hsl(var(--bark)/0.45)] bg-[hsl(var(--olive)/0.12)] text-[hsl(var(--bark))] dark:text-foreground"
            >
              <Camera className="h-7 w-7" aria-hidden />
              <span className="px-1 text-center text-xs font-semibold">{uploading > 0 ? `Adding ${uploading}…` : "Add photos"}</span>
            </label>
          </li>
        )}
        {uploaded.map((p, i) => (
          <li key={p.id} className="relative">
            <img src={photoPublicUrl(p.storage_path)} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover rounded-xl bg-muted" />
            <RemoveButton label={`Remove photo ${i + 1}`} onClick={() => onRemoveUploaded(p.id)} />
          </li>
        ))}
        {previews.map((url, i) => (
          <li key={url} className="relative" data-held-photo="">
            <img src={url} alt={`Photo ${uploaded.length + i + 1}`} className="aspect-square w-full object-cover rounded-xl bg-muted" />
            <RemoveButton label={`Remove photo ${uploaded.length + i + 1}`} onClick={() => onRemoveHeld(i)} />
          </li>
        ))}
      </ul>
      {held.length > 0 && <p className="text-xs text-muted-foreground">These go up when you save the details below.</p>}
      {ai && (
        <>
          <Button type="button" variant="outline" size="sm" disabled={ai.busy} onClick={ai.run}>
            {ai.busy ? "Looking at your photos…" : "Fill in from my photos"}
          </Button>
          <p className="text-xs text-muted-foreground">The photo tool fills in the name, description, category, size and condition. You can change anything, then save.</p>
        </>
      )}
    </section>
  );
}
