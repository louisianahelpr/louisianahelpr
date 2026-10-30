/**
 * Keeps a NEW one-item listing on the device from the first photo (audit posting 1030 #1: a leave or reload threw away
 * the photos, the written listing and every edit, with no warning). Sell a bunch's saving (useDeviceSaved) with one
 * item's record. The tax tick is not kept: it is a statement the seller makes when posting.
 *
 * A listing Post already made a draft for keeps that draft's id, so coming back never makes a second one; a draft that
 * has since gone live or gone away is not reopened.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { fetchItem, type PickupWindow, type SellerHandover } from "@/lib/declutter/api";
import type { BunchPhoto } from "@/lib/declutter/bunch";
import { SELL_ONE_KEY, deviceStore, type SavedPhotos } from "@/lib/declutter/bunchSaved";
import type { FormState } from "./sellForm";
import { useDeviceSaved } from "./useDeviceSaved";

export interface SellOneWork {
  form: FormState;
  coords: { lat: number; lng: number; address: string } | null;
  ways: SellerHandover[];
  windows: PickupWindow[];
  keepUpWanted: boolean;
  autoFreeWanted: number | null;
  createdId: string | null;
}
type SavedSellOne = SavedPhotos & SellOneWork;

const store = deviceStore<SavedSellOne>(SELL_ONE_KEY);
const NOT_SAVED = "We couldn't save your listing on this device, so keep this page open until you've posted it.";

/** `userId` undefined: nothing is kept (a saved draft, or a listing answering a Wanted post). */
export function useSellSaved(
  userId: string | undefined,
  work: SellOneWork,
  held: File[],
  onRestore: (back: SellOneWork & { held: File[] }) => void,
) {
  const keys = useRef(new WeakMap<File, string>());
  const nextKey = useRef(0);
  const keyOf = useCallback((f: File) => {
    let k = keys.current.get(f);
    if (!k) {
      k = `p${Date.now()}-${(nextKey.current += 1)}`;
      keys.current.set(f, k);
    }
    return k;
  }, []);
  const photos = useMemo<BunchPhoto[]>(() => held.map((file) => ({ key: keyOf(file), file })), [held, keyOf]);
  const [restored, setRestored] = useState(false);
  const finished = useRef(false);
  const { form, coords, ways, windows, keepUpWanted, autoFreeWanted, createdId } = work;
  const hasWork = photos.length > 0 || !!createdId || !!form.title.trim() || !!form.description.trim() || !!form.price.trim();
  const { note, clearSaved } = useDeviceSaved<SellOneWork & { photos: BunchPhoto[] }, SavedSellOne>({
    store,
    userId,
    snapshot: { ...work, photos },
    watch: [form, coords, ways, windows, keepUpWanted, autoFreeWanted, createdId, photos],
    plan: ({ photos: keep, ...rest }) => {
      const empty = keep.length === 0 && !rest.createdId && !rest.form.title.trim() && !rest.form.description.trim() && !rest.form.price.trim();
      return finished.current || empty ? null : { photos: keep, meta: rest };
    },
    restore: async ({ saved, photos: back }, stale) => {
      let draftId = saved.createdId;
      if (draftId) {
        try {
          const row = await fetchItem(draftId);
          if (row && row.status !== "draft") {
            // It went live (or was sold or taken down) after this was saved: there is nothing left to bring back.
            await store.clearNow();
            return;
          }
          if (!row) draftId = null;
        } catch (err) {
          // A failed read is not "gone": keep the id, so the next Post updates that draft, or says why it can't.
          console.warn("[declutter] could not check the saved listing's draft", err);
        }
      }
      if (stale()) return;
      back.forEach((p) => keys.current.set(p.file, p.key));
      setRestored(true);
      onRestore({
        form: saved.form,
        coords: saved.coords,
        ways: saved.ways,
        windows: saved.windows,
        keepUpWanted: saved.keepUpWanted,
        autoFreeWanted: saved.autoFreeWanted,
        createdId: draftId,
        held: back.map((p) => p.file),
      });
    },
    warn: hasWork && !finished.current,
    notSaved: NOT_SAVED,
  });

  /** Posted, or the seller started over: nothing is left to bring back. */
  const finish = useCallback(() => {
    finished.current = true;
    return clearSaved();
  }, [clearSaved]);

  return { note, restored, dismissRestored: () => setRestored(false), finish };
}
