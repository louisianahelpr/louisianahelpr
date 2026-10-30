/**
 * Step 1 of selling (owner, 2026-10-19: photo-first, as on Mercari / OfferUp):
 * "Add photos" comes before anything else. A photo can only be stored on a
 * saved draft, so before the first save the chosen photos wait on the device
 * (shown from local previews, never uploaded) and go up the moment the details
 * are saved (DeclutterSellView's saveDetails). After that, photos upload as
 * they are added, as before. Claude's listing panel (SellAiDraft.tsx) sits
 * under the photos and works from either kind (owner 2026-10-28).
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { Camera, X } from "lucide-react";
import { photoPublicUrl, type DeclutterPhoto } from "@/lib/declutter/api";
import { DECLUTTER_MAX_PHOTOS, DECLUTTER_MIN_PHOTOS } from "@/lib/declutter/photoRules";

export const MAX_PHOTOS = DECLUTTER_MAX_PHOTOS;
const MIN_PHOTOS = DECLUTTER_MIN_PHOTOS;

/** Board 31a: the first photo is the listing's cover (the gallery and Browse card show photos by position). */
function CoverChip() {
  return (
    <span data-cover-chip="" className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-background/95 px-2 py-0.5 text-ds-12 font-semibold text-foreground">
      Cover
    </span>
  );
}

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
  heldFailed = false,
  refusedNote = null,
  onMakeCover,
  coverUndo = null,
  free = false,
  tipDone = false,
  aiPanel,
}: {
  uploaded: DeclutterPhoto[];
  /** Photos chosen before the first save: on the device only. */
  held: File[];
  onFiles: (files: FileList | null) => void;
  onRemoveUploaded: (photoId: string) => void;
  onRemoveHeld: (index: number) => void;
  uploading: number;
  /** The held photos are ones that failed to upload at Post: each says so. */
  heldFailed?: boolean;
  /** Photos that couldn't be added, by name and why. */
  refusedNote?: string | null;
  /** A held photo becomes the cover. */
  onMakeCover?: (index: number) => void;
  /** The AI moved the cover: says so, and this puts it back. */
  coverUndo?: (() => void) | null;
  free?: boolean;
  /** The listing is written: the photo tip has done its work. */
  tipDone?: boolean;
  /** Claude's listing panel (SellAiDraftPanel), once there is a photo. */
  aiPanel: ReactNode;
}) {
  const previews = useMemo(() => held.map((f) => URL.createObjectURL(f)), [held]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const count = uploaded.length + held.length;
  const addTile = count < MAX_PHOTOS && (
    <li>
      {/* Board 31a: the dashed "Add photos" tile after the photos. */}
      <label
        htmlFor="sell-files"
        data-add-photos=""
        className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[hsl(var(--bark)/0.45)] bg-card text-[hsl(var(--bark))] dark:text-foreground"
      >
        <Camera className="h-6 w-6" aria-hidden />
        <span className="px-1 text-center text-ds-13 font-semibold">{uploading > 0 ? `Adding ${uploading}…` : "Add photos"}</span>
      </label>
    </li>
  );
  return (
    <div className="space-y-3" aria-label="Photos" role="group">
      <input id="sell-files" type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2.5" data-sell-photos="">
        {uploaded.map((p, i) => (
          <li key={p.id} className="relative">
            <img src={photoPublicUrl(p.storage_path)} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover rounded-2xl bg-photo-empty" />
            {i === 0 && <CoverChip />}
            <RemoveButton label={`Remove photo ${i + 1}`} onClick={() => onRemoveUploaded(p.id)} />
          </li>
        ))}
        {previews.map((url, i) => (
          <li key={url} className="relative" data-held-photo="">
            {/* Only a local blob: preview is drawn (CodeQL js/xss-through-dom; the PhotoProof pattern). */}
            {url.startsWith("blob:") && (
              <img src={url} alt={`Photo ${uploaded.length + i + 1}`} className="aspect-square w-full object-cover rounded-2xl bg-photo-empty" />
            )}
            {heldFailed ? (
              <span data-photo-failed="" className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-background/95 px-2 py-0.5 text-ds-12 font-semibold text-destructive-ink">
                Didn't upload
              </span>
            ) : uploaded.length === 0 && i === 0 && <CoverChip />}
            <RemoveButton label={`Remove photo ${uploaded.length + i + 1}`} onClick={() => onRemoveHeld(i)} />
            {onMakeCover && !heldFailed && uploaded.length + i > 0 && (
              <button type="button" onClick={() => onMakeCover(i)} aria-label={`Make photo ${uploaded.length + i + 1} the cover`} className="min-h-11 w-full text-center text-ds-12 font-semibold text-[hsl(var(--sage-ink))]">
                Make cover
              </button>
            )}
          </li>
        ))}
        {addTile}
      </ul>
      <p className="text-ds-13 text-muted-foreground" data-photo-count="">
        {count} of {MAX_PHOTOS}{count < MIN_PHOTOS ? `, at least ${MIN_PHOTOS}` : ""}
        {held.length > 0 && !heldFailed ? " · these go up when you post" : ""}
      </p>
      {coverUndo && (
        <p className="text-ds-13 text-foreground" data-cover-moved="">
          We picked the best photo for the cover.{" "}
          <button type="button" onClick={coverUndo} className="min-h-11 font-semibold text-[hsl(var(--sage-ink))] underline underline-offset-2">Undo</button>
        </p>
      )}
      {refusedNote && <p role="alert" className="text-ds-13 font-semibold text-destructive-ink [overflow-wrap:anywhere]" data-photo-refused="">{refusedNote}</p>}
      {aiPanel}
      {!tipDone && <div className="rounded-[20px] border border-border bg-card p-4">
        <p className="text-ds-15 font-semibold text-foreground">{free ? "Good photos" : "Photos that sell"}</p>
        <p className="mt-1 text-ds-14 text-muted-foreground">
          Daylight, a plain background, and one close-up of any wear. Take your own. Location data is removed from every photo before it's uploaded.
        </p>
      </div>}
    </div>
  );
}
