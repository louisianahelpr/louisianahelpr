import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterItemSkeleton, DeclutterItemUnavailable, isItemId } from "@/components/declutter/DeclutterSkeletons";
import ItemView from "@/components/declutter/DeclutterItemView";
import { fetchItem, fetchPhotos } from "@/lib/declutter/api";

/** /declutter/item/:id: the 404 unless the hidden 'declutter' switch is on (DeclutterGate). */
export default function DeclutterItemPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  // B67 (DECL-ITEM-SPEED): the item and its photos are asked for while the gate reads the switch, not after it (one
  // Slow 4G round trip, ~600 ms measured before the photo could start). The same keys and reads ItemView uses, so it
  // finds them in the cache; row security decides what they return either way, the gate only decides what shows.
  useEffect(() => {
    if (!isItemId(id)) return;
    void qc.prefetchQuery({ queryKey: ["declutter", "item", id], queryFn: () => fetchItem(id) });
    void qc.prefetchQuery({ queryKey: ["declutter", "item-photos", id], queryFn: () => fetchPhotos([id]) });
  }, [id, qc]);
  return <DeclutterGate skeleton={isItemId(id) ? <DeclutterItemSkeleton /> : <DeclutterItemUnavailable />}>{id ? <ItemView itemId={id} /> : null}</DeclutterGate>;
}
