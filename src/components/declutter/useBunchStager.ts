/**
 * LEAD-BUNCH-34-SLOW (split out of DeclutterBunchView.tsx, componentSizeRatchet): each sorted item's photos go up while
 * the seller looks them over (into the folder of the id its draft will be made with), so List only creates, attaches
 * and publishes. Not during a run: listing sends its own.
 */
import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { BunchItem } from "@/lib/declutter/bunch";
import { BunchStager } from "@/lib/declutter/bunchStage";

export function useBunchStager(
  sellerId: string | undefined,
  items: BunchItem[],
  files: ReadonlyMap<string, File>,
  listing: boolean,
  setItems: Dispatch<SetStateAction<BunchItem[]>>,
): BunchStager | null {
  const stager = useMemo(() => (sellerId ? new BunchStager(sellerId) : null), [sellerId]);
  useEffect(() => {
    if (listing || !stager) return;
    // ONE id per item: an id given out here is saved on its item at once (the app id listing makes its draft with).
    const given = stager.sync(items, files);
    if (given.size > 0) setItems((its) => its.map((it) => (!it.appId && given.has(it.key) ? { ...it, appId: given.get(it.key) } : it)));
  }, [stager, items, files, listing, setItems]);
  return stager;
}
