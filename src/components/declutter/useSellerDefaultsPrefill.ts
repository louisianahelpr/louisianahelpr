/**
 * A NEW listing starts from the seller's remembered choices (owner request via the lead, 2026-10-30), saved on the
 * account (src/lib/declutter/sellerDefaults.ts), and saves them again when the listing is posted.
 *
 *   - Saved row: "Keep it up until it sells", "Lower the price" with its step, "make it free after" and the ways
 *     buyers get it come from it.
 *   - No row yet: the app's defaults. Keep it up ON and price drops ON (owner: both on by default), never free, and
 *     the last listing's ways and drop step if there was one (SellLastSetup, applied first).
 *   - "Lowest you'll take" fills itself from the saved percent of the asking price (half by default) until the
 *     seller types their own.
 * Applied once, after the last-listing setup has settled, so the two never fight. A saved draft gets none of this.
 * Guard: src/components/declutter/sellerDefaultsPrefill.test.tsx.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SellerHandover } from "@/lib/declutter/api";
import { fetchLastSetup } from "@/lib/declutter/lastSetup";
import { SELLER_DEFAULTS, fetchSellerDefaults, floorFromPct, pctFromFloor, saveSellerDefaults, type SellerDefaults } from "@/lib/declutter/sellerDefaults";
import type { FormState } from "./sellForm";

export function useSellerDefaultsPrefill(
  userId: string | undefined,
  { form, setForm, ways, setWays, setKeepUpWanted, setAutoFreeWanted }: {
    form: FormState;
    setForm: (u: (f: FormState) => FormState) => void;
    ways: SellerHandover[];
    setWays: (u: (w: SellerHandover[]) => SellerHandover[]) => void;
    setKeepUpWanted: (on: boolean) => void;
    setAutoFreeWanted: (days: number | null) => void;
  },
) {
  const saved = useQuery({ queryKey: ["declutter", "seller-defaults", userId], queryFn: () => fetchSellerDefaults(userId!), enabled: !!userId });
  // The same read (and cache entry) as useLastListingSetup, to know when it has settled.
  const last = useQuery({ queryKey: ["declutter", "last-setup", userId], queryFn: () => fetchLastSetup(userId!), enabled: !!userId, staleTime: 60_000 });
  const applied = useRef(false);
  const floorPct = useRef(SELLER_DEFAULTS.floorPct);
  const autoFloor = useRef<string | null>(null);
  const floorEdited = useRef(false);

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
    if (row) {
      floorPct.current = row.floorPct;
      setForm((f) => ({ ...f, drops: row.drops, dropPct: row.dropPct }));
      setWays(() => row.handovers);
    } else {
      setForm((f) => ({ ...f, drops: SELLER_DEFAULTS.drops }));
    }
  }, [userId, saved.isFetched, saved.isError, saved.data, last.isFetched, last.isError, setForm, setWays, setKeepUpWanted, setAutoFreeWanted]);

  // "Lowest you'll take" follows the asking price until the seller changes it (then it is theirs, even cleared).
  useEffect(() => {
    if (!userId || !applied.current || floorEdited.current || form.free || !form.drops) return;
    if (form.floor !== (autoFloor.current ?? "")) {
      floorEdited.current = true;
      return;
    }
    const next = floorFromPct(form.price, floorPct.current);
    if (next === form.floor) return;
    autoFloor.current = next;
    setForm((f) => ({ ...f, floor: next }));
  }, [userId, form.price, form.floor, form.drops, form.free, setForm]);

  /** Called once a new listing is posted: what the seller chose becomes next time's start. A free listing is skipped. */
  async function rememberChoices(keepUp: boolean, freeAfterDays: number | null): Promise<void> {
    if (!userId || form.free) return;
    const d: SellerDefaults = {
      keepUp,
      drops: form.drops,
      dropPct: form.dropPct,
      floorPct: (form.drops && pctFromFloor(form.price, form.floor)) || floorPct.current,
      freeAfterDays,
      handovers: ways,
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
