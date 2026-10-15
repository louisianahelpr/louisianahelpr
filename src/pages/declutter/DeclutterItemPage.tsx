import { useParams } from "react-router-dom";
import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterItemSkeleton, DeclutterItemUnavailable, isItemId } from "@/components/declutter/DeclutterSkeletons";
import ItemView from "@/components/declutter/DeclutterItemView";

/** /declutter/item/:id: the 404 unless the hidden 'declutter' switch is on (DeclutterGate). */
export default function DeclutterItemPage() {
  const { id } = useParams<{ id: string }>();
  return <DeclutterGate skeleton={isItemId(id) ? <DeclutterItemSkeleton /> : <DeclutterItemUnavailable />}>{id ? <ItemView itemId={id} /> : null}</DeclutterGate>;
}
