/**
 * "Remember my setup" (owner 2026-10-29): a NEW listing starts from the seller's most recent
 * listing's setup (src/lib/declutter/lastSetup.ts says what is per listing and what is per seller).
 * Applied once, and only to what is still blank or at its default, so nothing the seller already
 * chose is replaced.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SellerHandover } from "@/lib/declutter/api";
import { fetchLastSetup, type LastSetup } from "@/lib/declutter/lastSetup";
import type { FormState } from "./sellForm";

/** The form with the last listing's setup in every field still blank (pure, so it is tested on its own). */
export function applyLastSetup(f: FormState, s: LastSetup): FormState {
  return {
    ...f,
    areaLabel: f.areaLabel.trim() ? f.areaLabel : s.areaLabel,
    pickupAddress: f.pickupAddress.trim() || !s.pickup ? f.pickupAddress : s.pickup.address,
    // Drops are the seller's own yes/no (owner 2026-10-28): carried over only as they set it last time.
    ...(s.dropPct !== null && !f.drops ? { drops: true, dropPct: s.dropPct } : {}),
  };
}

/**
 * Reads the last setup for a NEW listing (`userId` undefined = a saved draft: nothing) and applies it
 * once. Returns whether it was used, for the note.
 */
export function useLastListingSetup(
  userId: string | undefined,
  { setForm, setWays, setCoords }: {
    setForm: (u: (f: FormState) => FormState) => void;
    setWays: (u: (w: SellerHandover[]) => SellerHandover[]) => void;
    setCoords: (u: (c: { lat: number; lng: number; address: string } | null) => { lat: number; lng: number; address: string } | null) => void;
  },
): boolean {
  const last = useQuery({ queryKey: ["declutter", "last-setup", userId], queryFn: () => fetchLastSetup(userId!), enabled: !!userId, staleTime: 60_000 });
  const applied = useRef(false);
  const [used, setUsed] = useState(false);
  useEffect(() => {
    const s = last.data;
    if (!userId || !s || applied.current) return;
    applied.current = true;
    setForm((f) => applyLastSetup(f, s));
    // The default is porch pickup alone; a seller who already ticked something keeps it.
    if (s.ways.length > 0) setWays((w) => (w.length === 1 && w[0] === "porch" ? s.ways : w));
    if (s.pickup) setCoords((c) => c ?? { ...s.pickup! });
    setUsed(true);
  }, [userId, last.data, setForm, setWays, setCoords]);
  // A failed read is extra help lost, not a blocker: the form starts blank as before, and the app's
  // QueryCache reports the error to error_logs.
  return used;
}
