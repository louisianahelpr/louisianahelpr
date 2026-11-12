/**
 * F342 (whole-app audit 11-10, /declutter/move layout shift 0.258; measured B3g 11-12: "Where buyers pick up" drew open,
 * then folded away, and every step under it jumped up 246px). Lead 11-12: keep "type before the read answers" and keep
 * the step's place instead of hiding it.
 *
 * The setup gate (SellerSetup) has sellers save a pickup first; the step's boxes are only for a saved address that
 * stopped reading. So the step is folded from the first paint that knows the saved pickup, judged on what the saved
 * pickup is about to fill into blank boxes (useSavedPickup applies it in an effect, a frame after that paint, so the
 * boxes alone drew the step open for one frame). Once drawn open (the reads had not answered, or the seller's own
 * address is in the box), it stays open, filled in, so nothing under it moves.
 * Guard: declutterBunchSetup.test.tsx (F342 bunchWhereNeverFolds).
 */
import { useRef } from "react";
import type { SavedPickup } from "./useSavedPickup";
import { AREA_ADDRESS_RE } from "./sellForm";

/** The same address and area rules as the List check (placeProblem in DeclutterBunchView). */
function whereFoldable(saved: SavedPickup | null, pickupAddress: string, areaLabel: string): boolean {
  if (!saved) return false;
  const address = (pickupAddress.trim() ? pickupAddress : saved.address).trim();
  const area = areaLabel.trim() ? areaLabel : saved.areaLabel;
  return address.length >= 5 && address === saved.address && area.trim().length >= 2 && !AREA_ADDRESS_RE.test(area);
}

/**
 * Whether the step is folded now. `drawable`: the page would draw the step this render (signed in, not under 18, and
 * not a finished bunch, which shows only its result, A3-69); a render that draws nothing never counts as drawn open.
 */
export function useWhereFolded(saved: { settled: boolean; pickup: SavedPickup | null }, pickupAddress: string, areaLabel: string, drawable: boolean): boolean {
  const drawnOpen = useRef(false);
  const foldable = whereFoldable(saved.settled ? saved.pickup : null, pickupAddress, areaLabel);
  if (drawable && !foldable) drawnOpen.current = true;
  return foldable && !drawnOpen.current;
}
