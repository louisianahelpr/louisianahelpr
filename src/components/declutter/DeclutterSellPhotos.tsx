/**
 * Step 1 of selling (owner, 2026-10-19: photo-first, as on Mercari / OfferUp):
 * "Add photos" comes before anything else. A photo can only be stored on a
 * saved draft, so before the first save the chosen photos wait on the device
 * (shown from local previews, never uploaded) and go up the moment the details
 * are saved (DeclutterSellView's saveDetails). After that, photos upload as
 * they are added, as before. Claude's listing panel (SellAiDraft.tsx) sits
 * under the photos and works from either kind (owner 2026-10-28).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Camera, GripVertical, X } from "lucide-react";
import { photoPublicUrl, type DeclutterPhoto } from "@/lib/declutter/api";
import { DECLUTTER_MAX_PHOTOS, DECLUTTER_MIN_PHOTOS } from "@/lib/declutter/photoRules";
import { usePhotoDrag } from "./SellPhotoDrag";

export const MAX_PHOTOS = DECLUTTER_MAX_PHOTOS;
const MIN_PHOTOS = DECLUTTER_MIN_PHOTOS;
const noMove = () => {};

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

const DROP_TARGET = "rounded-2xl ring-2 ring-[hsl(var(--bark))] ring-offset-2 ring-offset-background";

/** What drags a photo. The photo itself still scrolls the page under a finger. */
function PhotoGrip({ n, index, drag }: { n: number; index: number; drag: ReturnType<typeof usePhotoDrag> }) {
  return (
    <button
      type="button"
      data-photo-grip=""
      aria-label={`Move photo ${n}. Drag it, or use the left and right arrow keys.`}
      className="absolute top-0 left-0 flex h-11 w-11 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      onPointerDown={(e) => drag.startDrag(e, index)}
      onKeyDown={(e) => drag.gripKeys(e, index)}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow" aria-hidden>
        <GripVertical className="h-4 w-4" />
      </span>
    </button>
  );
}

function MakeCover({ n, onClick }: { n: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Make photo ${n} the cover`} className="min-h-11 w-full text-center text-ds-12 font-semibold text-[hsl(var(--sage-ink))]">
      Make cover
    </button>
  );
}

/** One preview per photo for as long as it is held, so moving a photo never redraws it. */
function useHeldPreviews(held: File[]): string[] {
  const urls = useRef(new Map<File, string>());
  const previews = held.map((f) => {
    let url = urls.current.get(f);
    if (!url) {
      url = URL.createObjectURL(f);
      urls.current.set(f, url);
    }
    return url;
  });
  useEffect(() => {
    for (const [f, url] of urls.current) {
      if (!held.includes(f)) {
        URL.revokeObjectURL(url);
        urls.current.delete(f);
      }
    }
  }, [held]);
  useEffect(() => {
    const all = urls.current;
    return () => {
      all.forEach((url) => URL.revokeObjectURL(url));
      all.clear();
    };
  }, []);
  return previews;
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
  onMoveHeld,
  onMoveUploaded,
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
  /** A held photo is dragged to another place. */
  onMoveHeld?: (from: number, to: number) => void;
  /** A photo already on the listing is dragged to another place. */
  onMoveUploaded?: (from: number, to: number) => void;
  /** The AI moved the cover: says so, and this puts it back. */
  coverUndo?: (() => void) | null;
  free?: boolean;
  /** The listing is written: the photo tip has done its work. */
  tipDone?: boolean;
  /** Claude's listing panel (SellAiDraftPanel), once there is a photo. */
  aiPanel: ReactNode;
}) {
  const previews = useHeldPreviews(held);
  const drag = usePhotoDrag(held.length, onMoveHeld ?? noMove);
  const canDrag = !!onMoveHeld && !heldFailed && held.length > 1;
  const uploadedDrag = usePhotoDrag(uploaded.length, onMoveUploaded ?? noMove);
  const canDragUploaded = !!onMoveUploaded && uploaded.length > 1;
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
          <li key={p.id} data-uploaded-photo="" ref={uploadedDrag.tileRef(i)} className="relative" style={uploadedDrag.tileStyle(i)}>
            <div className={uploadedDrag.isTarget(i) ? `relative ${DROP_TARGET}` : "relative"} data-drop-target={uploadedDrag.isTarget(i) ? "" : undefined}>
              <img src={photoPublicUrl(p.storage_path)} alt={`Photo ${i + 1}`} draggable={false} className="aspect-square w-full object-cover rounded-2xl bg-photo-empty" />
              {canDragUploaded && <PhotoGrip n={i + 1} drag={uploadedDrag} index={i} />}
              {i === 0 && <CoverChip />}
              <RemoveButton label={`Remove photo ${i + 1}`} onClick={() => onRemoveUploaded(p.id)} />
            </div>
            {onMoveUploaded && i > 0 && <MakeCover n={i + 1} onClick={() => onMoveUploaded(i, 0)} />}
          </li>
        ))}
        {previews.map((url, i) => (
          <li key={url} data-held-photo="" ref={drag.tileRef(i)} className="relative" style={drag.tileStyle(i)}>
            {/* The chips and X sit on the photo; Make cover sits under it, so its height never moves them. */}
            <div className={drag.isTarget(i) ? `relative ${DROP_TARGET}` : "relative"} data-drop-target={drag.isTarget(i) ? "" : undefined}>
            {/* Only a local blob: preview is drawn (CodeQL js/xss-through-dom; the PhotoProof pattern). */}
            {url.startsWith("blob:") && (
              <img src={url} alt={`Photo ${uploaded.length + i + 1}`} draggable={false} className="aspect-square w-full object-cover rounded-2xl bg-photo-empty" />
            )}
            {canDrag && <PhotoGrip n={uploaded.length + i + 1} drag={drag} index={i} />}
            {heldFailed ? (
              <span data-photo-failed="" className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-background/95 px-2 py-0.5 text-ds-12 font-semibold text-destructive-ink">
                Didn't upload
              </span>
            ) : uploaded.length === 0 && i === 0 && <CoverChip />}
            <RemoveButton label={`Remove photo ${uploaded.length + i + 1}`} onClick={() => onRemoveHeld(i)} />
            </div>
            {onMakeCover && !heldFailed && uploaded.length + i > 0 && <MakeCover n={uploaded.length + i + 1} onClick={() => onMakeCover(i)} />}
          </li>
        ))}
        {addTile}
      </ul>
      <p className="text-ds-13 text-muted-foreground" data-photo-count="">
        {count} of {MAX_PHOTOS}{count < MIN_PHOTOS ? `, at least ${MIN_PHOTOS}` : ""}
        {held.length > 0 && !heldFailed ? " · these go up when you post" : ""}
      </p>
      {(canDrag || canDragUploaded) && <p className="text-ds-13 text-muted-foreground" data-photo-drag-hint="">Drag a photo's handle to change the order.</p>}
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
