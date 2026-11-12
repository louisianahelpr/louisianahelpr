/**
 * An item's own photos in the editor (3 to 12): add one, remove one, and on a draft ask for suggestions from them.
 * A live item's photos can change too (S009): new ones get the quick photo check, and it keeps at least 3. Split out
 * of ShopItemEditor.tsx (componentSizeRatchet, train 1112-j); S2-010 stops the picker at 12, S2-012 names each Remove.
 */
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";
import { itemPhotoUrl, type ShopItem } from "@/lib/shops/items";

export default function ShopItemPhotosSection({ photos, draft, busy, suggesting, onSuggest, onAdd, onRemove }: {
  photos: ShopItem["photos"];
  draft: boolean;
  busy: boolean;
  suggesting: boolean;
  onSuggest: () => void;
  onAdd: (f: File) => void;
  onRemove: (photoId: string) => void;
}) {
  const full = photos.length >= 12;
  return (
    <section className="space-y-2" aria-labelledby="item-photos">
      <h4 id="item-photos" className="text-ds-13 font-medium">Photos (3 to 12)</h4>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex">
          <span className="sr-only">Add a photo</span>
          {/* S2-010: an item holds up to 12 photos; the control says so and stops at 12. */}
          <HiddenFileInput
            peer
            accept="image/*"
            disabled={busy || full}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onAdd(f);
            }}
          />
          <span className={`inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-ds-13 peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${full ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer"}`} aria-hidden>
            {full ? "12 photos (the most)" : "Add a photo"}
          </span>
        </label>
        {draft && (
          <Button type="button" variant="outline" size="sm" disabled={busy || photos.length === 0} onClick={onSuggest}>
            <Sparkles className="mr-1 h-4 w-4" aria-hidden />
            {suggesting ? "Looking…" : "Suggest details from my photos"}
          </Button>
        )}
      </div>
      {!draft && <p className="text-ds-11 text-muted-foreground">New photos get our quick photo check. The item stays on your shop unless it flags one.</p>}
      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <li key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-muted">
              <img src={itemPhotoUrl(p.storage_path)} alt="" className="h-full w-full object-cover" />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="absolute bottom-1 right-1 px-2 text-ds-11"
                // S009: a live item keeps 3 photos (the server says so too).
                disabled={busy || (!draft && photos.length <= 3)}
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => onRemove(p.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
