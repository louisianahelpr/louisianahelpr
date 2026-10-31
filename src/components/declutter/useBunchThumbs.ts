/**
 * Sell a bunch's previews: one small copy per photo, made one at a time so up to 80 photos never decode together,
 * and released when the photo leaves the list or the page closes. The screen re-renders every few previews, not for
 * each one. Until a photo's preview is ready its card shows an empty square.
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { BunchPhoto } from "@/lib/declutter/bunch";
import { bunchThumbnail } from "@/lib/declutter/photos";

const SHOW_EVERY = 4;

/**
 * LEAD-BUNCH-34-SLOW: `paused` while a sort makes each photo's small copy (Sell a bunch shows that copy, so the full photo
 * isn't decoded twice at once); `ready` = the photos that already have one, skipped here.
 */
function useBunchThumbs(photos: BunchPhoto[], { paused = false, ready }: { paused?: boolean; ready?: ReadonlyMap<string, string> } = {}): Map<string, string> {
  const [shown, setShown] = useState<Map<string, string>>(() => new Map());
  const made = useRef(new Map<string, string>());
  const wanted = useRef(new Set<string>());
  const queue = useRef<BunchPhoto[]>([]);
  const running = useRef(false);
  const closed = useRef(false);
  const readyNow = useRef(ready);
  readyNow.current = ready;

  useEffect(() => {
    closed.current = false;
    const held = made.current;
    return () => {
      closed.current = true;
      held.forEach((url) => URL.revokeObjectURL(url));
      held.clear();
    };
  }, []);

  useEffect(() => {
    const now = new Set(photos.map((p) => p.key));
    let removed = false;
    for (const [key, url] of made.current) {
      if (now.has(key)) continue;
      URL.revokeObjectURL(url);
      made.current.delete(key);
      removed = true;
    }
    if (removed) setShown(new Map(made.current));
    for (const p of photos) if (!wanted.current.has(p.key)) queue.current.push(p);
    wanted.current = now;
    if (running.current || paused) return;
    running.current = true;
    void (async () => {
      let sinceShown = 0;
      while (queue.current.length > 0 && !closed.current) {
        const p = queue.current.shift()!;
        if (!wanted.current.has(p.key) || readyNow.current?.has(p.key)) continue;
        const url = URL.createObjectURL(await bunchThumbnail(p.file));
        if (closed.current || !wanted.current.has(p.key)) {
          URL.revokeObjectURL(url);
          continue;
        }
        made.current.set(p.key, url);
        sinceShown += 1;
        if (sinceShown >= SHOW_EVERY) {
          sinceShown = 0;
          setShown(new Map(made.current));
        }
      }
      running.current = false;
      if (!closed.current && sinceShown > 0) setShown(new Map(made.current));
    })();
  }, [photos, paused]);

  return shown;
}

/**
 * LEAD-BUNCH-34-SLOW (split out of DeclutterBunchView.tsx, componentSizeRatchet): while sorting, each photo's thumbnail
 * is its small copy (set through the returned setter), shown the moment it is made; useBunchThumbs fills in the rest
 * once sorting is done. A copy is released when its photo leaves the list or the page closes.
 */
export function useSortingThumbs(photos: BunchPhoto[], sorting: boolean): [Map<string, string>, Dispatch<SetStateAction<ReadonlyMap<string, string>>>] {
  const [copyUrls, setCopyUrls] = useState<ReadonlyMap<string, string>>(() => new Map());
  const made = useBunchThumbs(photos, { paused: sorting, ready: copyUrls });
  const thumbs = useMemo(() => new Map([...copyUrls, ...made]), [copyUrls, made]);
  useEffect(() => {
    const now = new Set(photos.map((p) => p.key));
    if (![...copyUrls.keys()].some((k) => !now.has(k))) return;
    setCopyUrls((m) => {
      const kept = new Map<string, string>();
      for (const [k, url] of m) {
        if (now.has(k)) kept.set(k, url);
        else URL.revokeObjectURL(url);
      }
      return kept;
    });
  }, [photos, copyUrls]);
  const copyUrlsNow = useRef(copyUrls);
  copyUrlsNow.current = copyUrls;
  useEffect(() => () => copyUrlsNow.current.forEach((url) => URL.revokeObjectURL(url)), []);
  return [thumbs, setCopyUrls];
}
