/**
 * S054 (Shops audit 2026-11-12): a NEW item's "Start with photos" panel. The photos are held on the device (nothing is
 * uploaded here); "Suggest details from my photos" asks the AI to fill kind/type/title/description, and the editor's
 * first save adds the held photos to the new item. Split out of ShopItemEditor.tsx (componentSizeRatchet).
 * Guard: src/components/shops/shopItemPhotosFirst.test.tsx.
 */
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";
import { safeImageSrc } from "@/components/reviewPanel/types";

/** The most photos a new item holds before its first save (the item's own limit). */
const MAX_HELD = 12;

/** A held (not yet uploaded) photo's preview; its object URL is let go when it leaves. */
function HeldPhoto({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // A soft tile while the local preview is made (never an empty box; photoPlaceholderEverywhere). Only a blob:/https:
  // preview reaches the DOM (safeImageSrc, as Review photos do; CodeQL js/xss-through-dom).
  const shown = src ? safeImageSrc(src) : undefined;
  return shown ? <img src={shown} alt="" className="h-full w-full object-cover" /> : <span className="block h-full w-full bg-muted" aria-hidden />;
}

export default function ShopItemStartPhotos({ held, setHeld, busy, suggesting, onSuggest }: {
  held: File[];
  setHeld: (next: (h: File[]) => File[]) => void;
  busy: boolean;
  suggesting: boolean;
  onSuggest: () => void;
}) {
  return (
    <section className="space-y-2" aria-labelledby="item-start-photos" data-testid="item-start-photos">
      <h4 id="item-start-photos" className="text-sm font-medium">Start with photos</h4>
      <p className="text-xs text-muted-foreground">Add photos and we'll suggest the details. They go on the item when you save it.</p>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex">
          <span className="sr-only">Add photos</span>
          <HiddenFileInput
            peer
            accept="image/*"
            multiple
            disabled={busy || held.length >= MAX_HELD}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              // S2-011: say so when photos past 12 are left out (they were dropped silently).
              const over = held.length + files.length - MAX_HELD;
              if (over > 0) toast(`An item can have up to 12 photos. ${over} of them ${over === 1 ? "was" : "were"} left out.`);
              setHeld((h) => [...h, ...files].slice(0, MAX_HELD));
            }}
          />
          <span className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring" aria-hidden>
            Add photos
          </span>
        </label>
        <Button type="button" variant="outline" size="sm" disabled={busy || held.length === 0} onClick={onSuggest}>
          <Sparkles className="mr-1 h-4 w-4" aria-hidden />
          {suggesting ? "Looking…" : "Suggest details from my photos"}
        </Button>
      </div>
      {held.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {held.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative aspect-square overflow-hidden rounded-xl bg-muted">
              <HeldPhoto file={f} />
              <Button type="button" size="sm" variant="outline" className="absolute bottom-1 right-1 px-2 text-xs" disabled={busy}
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => setHeld((h) => h.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
