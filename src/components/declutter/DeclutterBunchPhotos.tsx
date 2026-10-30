/**
 * One item's photos on Sell a bunch (audit 10-30, finding 3). Tap a photo to see it big, then make it the cover, remove
 * it, split it off or move it to another item, picked by its picture, since two items can share a name. The tick on a
 * photo chooses several to move or split together. "Add photo" joins this item without going through the photo tool.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import type { BunchItem } from "@/lib/declutter/bunch";
import { focusSheetItself } from "./focusSheetItself";

/** Another item on the list, as a choice: its name and first photo. */
export interface BunchOther {
  key: string;
  name: string;
  photoKey?: string;
}

const thumbImg = "aspect-square w-full bg-photo-empty object-cover";

function ItemPicker({ others, urls, onPick, label }: { others: BunchOther[]; urls: Map<string, string>; onPick: (key: string) => void; label: (name: string) => string }) {
  return (
    <ul className="space-y-1.5" data-bunch-picker="">
      {others.map((o) => {
        const url = o.photoKey ? urls.get(o.photoKey) : undefined;
        return (
          <li key={o.key}>
            <button type="button" aria-label={label(o.name)} onClick={() => onPick(o.key)} data-bunch-pick={o.key}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-card p-1.5 text-left text-ds-14 font-medium hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-photo-empty">
                {url?.startsWith("blob:") && <img src={url} alt="" loading="lazy" decoding="async" className={thumbImg} />}
              </span>
              <span className="min-w-0 break-words">{o.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The whole photo, read from the file; the small preview if the browser can't draw the file itself (some HEIC). */
function useFullPhoto(file: File | undefined): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

function PhotoSheet({ photoKey, position, itemName, isCover, canSplit, file, thumb, others, urls, onClose, onCover, onRemove, onSplit, onMove }: {
  photoKey: string;
  position: number;
  itemName: string;
  isCover: boolean;
  canSplit: boolean;
  file: File | undefined;
  thumb: string | undefined;
  others: BunchOther[];
  urls: Map<string, string>;
  onClose: () => void;
  onCover: (k: string) => void;
  onRemove: (k: string) => void;
  onSplit: (keys: string[]) => void;
  onMove: (keys: string[], to: string) => void;
}) {
  const webDesktop = useIsWebDesktop();
  const full = useFullPhoto(file);
  const [broken, setBroken] = useState(false);
  const src = !broken && full ? full : thumb;
  const act = (run: () => void) => { run(); onClose(); };
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself} data-bunch-photo-sheet=""
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[520px]" : ""}`}>
        <SheetHero title={`${itemName}, photo ${position}`} />
        {src && <img src={src} alt={`${itemName}, photo ${position}`} onError={() => setBroken(true)} className="mt-2 max-h-[45dvh] w-full rounded-xl bg-photo-empty object-contain" data-bunch-big-photo="" />}
        <div className="mt-3 flex flex-wrap gap-2">
          {!isCover && <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => act(() => onCover(photoKey))}>Make cover</Button>}
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => act(() => onRemove(photoKey))}>Remove photo</Button>
          {canSplit && <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => act(() => onSplit([photoKey]))}>Split into a new item</Button>}
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onClose}>Done</Button>
        </div>
        {others.length > 0 && (
          <div className="mt-4 space-y-2 pb-2">
            <p className="text-ds-13 font-medium">Move this photo to</p>
            <ItemPicker others={others} urls={urls} label={(n) => `Move this photo to ${n}`} onPick={(to) => act(() => onMove([photoKey], to))} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function BunchPhotos({ item, name, others, urls, files, onMove, onSplit, onRemove, onCover, onAdd }: {
  item: BunchItem;
  name: string;
  others: BunchOther[];
  urls: Map<string, string>;
  files: Map<string, File>;
  onMove: (photoKeys: string[], toKey: string) => void;
  onSplit: (photoKeys: string[]) => void;
  onRemove: (photoKey: string) => void;
  onCover: (photoKey: string) => void;
  onAdd: (files: FileList | null) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [big, setBig] = useState<string | null>(null);
  const live = chosen.filter((k) => item.photoKeys.includes(k));
  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const showing = big && item.photoKeys.includes(big) ? big : null;
  const addId = `add-photo-${item.key}`;
  return (
    <div className="space-y-2">
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {item.photoKeys.map((k, i) => {
          const url = urls.get(k);
          const on = live.includes(k);
          return (
            <li key={k} className="relative" data-bunch-photo-failed={item.failedPhoto === k ? "" : undefined}>
              <button type="button" aria-label={`See ${name}, photo ${i + 1}`} onClick={() => setBig(k)} data-bunch-photo={k}
                className={`block aspect-square w-full overflow-hidden rounded-xl bg-photo-empty ring-offset-2 ring-offset-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "ring-2 ring-[hsl(var(--bark))]" : ""}`}>
                {url?.startsWith("blob:") && <img src={url} alt="" loading="lazy" decoding="async" className={thumbImg} data-bunch-thumb="" />}
                {item.failedPhoto === k
                  ? <span className="absolute inset-x-1 bottom-1 rounded-lg bg-background px-1 py-0.5 text-center text-ds-12 font-semibold text-foreground">Not sent</span>
                  : i === 0 && <span className="absolute inset-x-1 bottom-1 rounded-lg bg-background px-1 py-0.5 text-center text-ds-12 font-semibold text-foreground" data-bunch-cover="">Cover</span>}
              </button>
              <button type="button" aria-pressed={on} aria-label={`Choose ${name}, photo ${i + 1}`} onClick={() => toggle(k)} data-bunch-tick={k}
                className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full border border-border shadow ${on ? "btn-grad-primary" : "bg-background text-foreground"}`} aria-hidden>
                  {on && <Check className="h-4 w-4" />}
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <input id={addId} type="file" accept="image/*" multiple className="peer sr-only" aria-label={`Add a photo to ${name}`}
            onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }} />
          <label htmlFor={addId} data-bunch-add-photo=""
            className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-border text-center text-ds-12 font-medium text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
            <Plus className="h-4 w-4" aria-hidden />
            Add photo
          </label>
        </li>
      </ul>
      {live.length > 0 && (
        <div className="space-y-2" data-bunch-chosen="">
          {others.length > 0 && (
            <>
              <p className="text-ds-13 font-medium">Move {live.length === 1 ? "this photo" : `these ${live.length} photos`} to</p>
              <ItemPicker others={others} urls={urls} label={(n) => `Move ${live.length === 1 ? "this photo" : `these ${live.length} photos`} to ${n}`} onPick={(to) => { onMove(live, to); setChosen([]); }} />
            </>
          )}
          {live.length < item.photoKeys.length && (
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => { onSplit(live); setChosen([]); }}>Split into a new item</Button>
          )}
        </div>
      )}
      {showing && (
        <PhotoSheet
          photoKey={showing}
          position={item.photoKeys.indexOf(showing) + 1}
          itemName={name}
          isCover={item.photoKeys[0] === showing}
          canSplit={item.photoKeys.length > 1}
          file={files.get(showing)}
          thumb={urls.get(showing)}
          others={others}
          urls={urls}
          onClose={() => setBig(null)}
          onCover={onCover}
          onRemove={onRemove}
          onSplit={onSplit}
          onMove={onMove}
        />
      )}
    </div>
  );
}
