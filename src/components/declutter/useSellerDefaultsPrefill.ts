/**
 * A NEW listing starts from the seller's remembered choices (owner request via the lead, 2026-10-30), saved on the
 * account (src/lib/declutter/sellerDefaults.ts), and saves them again when the listing is posted.
 *
 *   - Saved row: "Keep it up until it sells", "Lower the price" with its step, "make it free after" and the ways
 *     buyers get it come from it.
 *   - No row yet: the app's defaults. Keep it up ON and price drops ON (owner: both on by default), never free, and
 *     the last listing's ways and drop step if there was one (SellLastSetup, applied first).
 *   - The lowest price is the saved percent of the asking price (half by default).
 * Applied once, after the last-listing setup has settled, so the two never fight. A saved draft gets none of this.
 * Guard: src/components/declutter/declutterSellLastSetup.test.tsx.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SellerHandover } from "@/lib/declutter/api";
import { fetchLastSetup } from "@/lib/declutter/lastSetup";
import { SELLER_DEFAULTS, fetchSellerDefaults, floorFromPct, saveSellerDefaults, type SellerDefaults } from "@/lib/declutter/sellerDefaults";
import type { FormState } from "./sellForm";

export function useSellerDefaultsPrefill(
  userId: string | undefined,
  { form, setForm, ways, setWays, setKeepUpWanted, setAutoFreeWanted, offersWanted, setOffersWanted, keptFor }: {
    form: FormState;
    setForm: (u: (f: FormState) => FormState) => void;
    ways: SellerHandover[];
    setWays: (u: (w: SellerHandover[]) => SellerHandover[]) => void;
    setKeepUpWanted: (on: boolean) => void;
    setAutoFreeWanted: (days: number | null) => void;
    /** LEAD-OFFERS-CHOICE part (2): the form's own "Accept offers", started from the saved default and saved at Post. */
    offersWanted?: boolean;
    setOffersWanted?: (on: boolean) => void;
    /**
     * LEAD-BUNCH-DROPS-IGNORED (owner 2026-10-31, prod c87b7de4): a listing brought back from this device is not
     * prefilled again, but the choices made in Settings still win over what was kept: the kept form held price drops
     * ON from before the seller turned them off in Settings, so the listing went up with drop_pct 5 and the live sheet
     * promised drops. The seller's id for a kept new listing, else undefined.
     */
    keptFor?: string;
  },
) {
  const readFor = userId ?? keptFor;
  const saved = useQuery({ queryKey: ["declutter", "seller-defaults", readFor], queryFn: () => fetchSellerDefaults(readFor!), enabled: !!readFor });
  // The same read (and cache entry) as useLastListingSetup, to know when it has settled.
  const last = useQuery({ queryKey: ["declutter", "last-setup", userId], queryFn: () => fetchLastSetup(userId!), enabled: !!userId, staleTime: 60_000 });
  const applied = useRef(false);
  const floorPct = useRef(SELLER_DEFAULTS.floorPct);

  useEffect(() => {
    if (!userId || applied.current) return;
    // A failed read of either is extra help lost: the form still starts from the app's defaults.
    const savedDone = saved.isFetched || saved.isError;
    const lastDone = last.isFetched || last.isError;
    if (!savedDone || !lastDone) return;
    applied.current = true;
    const row = saved.data ?? null;
    setKeepUpWanted(row ? row.keepUp : SELLER_DEFAULTS.keepUp);
    setAutoFreeWanted(row ? row.freeAfterDays : SELLER_DEFAULTS.freeAfterDays);
    setOffersWanted?.(row ? row.acceptsOffers : SELLER_DEFAULTS.acceptsOffers);
    if (row) {
      floorPct.current = row.floorPct;
      setForm((f) => ({ ...f, drops: row.drops, dropPct: row.dropPct }));
      setWays(() => row.handovers);
    } else {
      setForm((f) => ({ ...f, drops: SELLER_DEFAULTS.drops }));
    }
  }, [userId, saved.isFetched, saved.isError, saved.data, last.isFetched, last.isError, setForm, setWays, setKeepUpWanted, setAutoFreeWanted, setOffersWanted]);

  // A kept listing: the saved row's drop choices, keep-up and free-after replace the kept ones, once, after the restore.
  const keptApplied = useRef(false);
  useEffect(() => {
    if (!keptFor || userId || keptApplied.current || !(saved.isFetched || saved.isError)) return;
    keptApplied.current = true;
    const row = saved.data ?? null;
    if (!row) return;
    applied.current = true;
    floorPct.current = row.floorPct;
    setKeepUpWanted(row.keepUp);
    setAutoFreeWanted(row.freeAfterDays);
    setOffersWanted?.(row.acceptsOffers);
    setForm((f) => ({ ...f, drops: row.drops, dropPct: row.dropPct }));
  }, [keptFor, userId, saved.isFetched, saved.isError, saved.data, setForm, setKeepUpWanted, setAutoFreeWanted, setOffersWanted]);

  // The lowest price is the saved share of the asking price: a new listing has no box for it (owner 2026-10-30); one
  // listing's is changed in Manage after it's posted.
  useEffect(() => {
    if (!userId || !applied.current || form.free || !form.drops) return;
    const next = floorFromPct(form.price, floorPct.current);
    if (next !== form.floor) setForm((f) => ({ ...f, floor: next }));
  }, [userId, form.price, form.floor, form.drops, form.free, setForm]);

  /** Called once a new listing is posted: what the seller chose becomes next time's start. A free listing is skipped. */
  async function rememberChoices(keepUp: boolean, freeAfterDays: number | null): Promise<void> {
    if (!userId || form.free) return;
    const d: SellerDefaults = {
      keepUp,
      drops: form.drops,
      dropPct: form.dropPct,
      floorPct: floorPct.current,
      freeAfterDays,
      handovers: ways,
      // LEAD-OFFERS-CHOICE: the form's own Accept offers switch, or the saved choice for a caller without one.
      acceptsOffers: offersWanted ?? saved.data?.acceptsOffers ?? SELLER_DEFAULTS.acceptsOffers,
    };
    try {
      await saveSellerDefaults(userId, d);
    } catch (err) {
      // Remembering is extra: the listing is already posted. Logged, never a blocker or a second error toast.
      console.warn("[declutter] could not save the seller's listing choices", err);
    }
  }

  return { rememberChoices };
}
