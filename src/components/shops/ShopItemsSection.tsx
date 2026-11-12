/**
 * /shops/mine, below the shop form: the owner's items and the shop's daily
 * order limit (Shops slice 2; docs/specs/local-shops-prep.md L20-L22, L52).
 * Every item that is not withdrawn, with where it stands (draft, waiting for
 * a review, listed, not approved), Edit and Take down. The server decides
 * every rule (shops_* RPCs) and this shows its words.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import {
  fetchShopItems,
  formatItemPrice,
  readinessLabel,
  SHOP_ITEM_TYPE_LABEL,
  withdrawShopItem,
  type ShopItem,
  type ShopItemStatus,
} from "@/lib/shops/items";
import { shopsErrorMessage } from "@/lib/shops/errors";
import ShopItemEditor from "./ShopItemEditor";
import ShopItemOptionsEditor from "./ShopItemOptionsEditor";
import ShopItemPreorderEditor from "./ShopItemPreorderEditor";
import { fetchItemOptions } from "@/lib/shops/variants";
import ShopDailyCap from "./ShopDailyCap";

const STATUS_LABEL: Record<ShopItemStatus, string> = {
  draft: "Draft",
  pending_review: "Waiting for a review",
  live: "Listed",
  withdrawn: "Taken down",
  rejected: "Not approved",
};

function ItemRow({ item, onEdit, onTakeDown, busy }: { item: ShopItem; onEdit: () => void; onTakeDown: () => void; busy: boolean }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-semibold [overflow-wrap:anywhere]">{item.title}</p>
        <p className="text-ds-11 text-muted-foreground">
          {STATUS_LABEL[item.status]} · {formatItemPrice(item.price_cents)} · {SHOP_ITEM_TYPE_LABEL[item.subtype] ?? "Item"} · {readinessLabel(item)}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onEdit} disabled={busy}>Edit</Button>
        <Button type="button" size="sm" variant="outline" onClick={onTakeDown} disabled={busy}>
          {item.status === "draft" ? "Delete" : "Take down"}
        </Button>
      </div>
    </li>
  );
}

/**
 * `startAdding`: every "Add an item" (the shop page's for an owner's empty shop, audit 2026-10-28 P5-2, and the
 * one under this list) lands on /shops/mine#add-item, and ShopEditView renders this section ALONE there as its own
 * screen titled "Add an item" (shops audit 11-10 F4: the editor sat at the very bottom of "Edit my shop", under the
 * pickup address, FAQs and daily limit). `onTitle` gives that screen its title ("Add an item", then "Edit item" once
 * the new item is saved); `onLeave` takes the member back to "Edit my shop" when they are done.
 */
export default function ShopItemsSection({ shopId, ownerId, startAdding = false, onTitle, onLeave }: {
  shopId: string;
  ownerId: string;
  startAdding?: boolean;
  onTitle?: (title: string) => void;
  onLeave?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId) });
  // Which items have option lists (the Options section below the editor reads the same query).
  const options = useQuery({ queryKey: ["shops", "item-options", shopId], queryFn: () => fetchItemOptions(shopId) });
  // One gate (oneLoadingGatePerScreen): the rows and which of them have options paint together.
  const listLoading = items.isLoading || options.isLoading;
  const [editing, setEditing] = useState<string | "new" | null>(startAdding ? "new" : null);
  useEffect(() => {
    if (startAdding) onTitle?.(editing === "new" ? "Add an item" : "Edit item");
  }, [startAdding, editing, onTitle]);
  // Done on the "Add an item" screen: back to "Edit my shop" (its list shows the new item).
  const stopEditing = () => (startAdding && onLeave ? onLeave() : setEditing(null));
  const [takeDown, setTakeDown] = useState<ShopItem | null>(null);
  const withdraw = useMutation({
    mutationFn: (itemId: string) => withdrawShopItem(itemId),
    onSuccess: () => {
      setTakeDown(null);
      toast.success("Taken down.");
      void qc.invalidateQueries({ queryKey: ["shops", "items"] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const list = items.data ?? [];
  const open = editing === "new" ? null : list.find((i) => i.id === editing) ?? null;

  return (
    <section className="space-y-4 pb-8" aria-labelledby={startAdding ? undefined : "shop-my-items"} aria-label={startAdding ? "Item" : undefined}>
      {!startAdding && <h2 id="shop-my-items" className="text-base font-semibold">Items</h2>}
      {!startAdding && <ShopDailyCap shopId={shopId} />}
      {listLoading ? (
        <div role="status" aria-label="Loading your items" className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : items.isError && !items.data ? (
        // Only when there is nothing to show: a failed background reload
        // keeps the list, and an open editor stays mounted with its unsaved
        // words (lh-silent-failure re-review).
        <div className="space-y-2" role="alert">
          <p className="text-ds-13">{shopsErrorMessage(items.error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void items.refetch()} disabled={items.isFetching}>
            Try again
          </Button>
        </div>
      ) : editing && editing !== "new" && !open ? (
        // The open item left the list (taken down elsewhere, or the list did
        // not reload): say so with a way back, never a loader with no exit
        // (lh-silent-failure review should-fix 4).
        items.isFetching ? (
          <Skeleton className="h-40 w-full rounded-2xl" role="status" aria-label="Loading the item" />
        ) : items.isError ? (
          // A reload that failed right after a save leaves a list without the
          // new item: say the list could not load, never "isn't available"
          // for an item that exists (lh-silent-failure re-review, finding 1).
          <div className="space-y-2" role="alert">
            <p className="text-ds-13">{shopsErrorMessage(items.error)}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void items.refetch()}>
                Try again
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={stopEditing}>Back to your items</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2" role="status">
            <p className="text-ds-13">This item isn't available any more.</p>
            <Button type="button" variant="outline" onClick={stopEditing}>Back to your items</Button>
          </div>
        )
      ) : editing ? (
        <>
          <ShopItemEditor
            key={editing}
            ownerId={ownerId}
            item={open}
            hasOptions={!!open && !!options.data?.has(open.id)}
            onCreated={(itemId) => setEditing(itemId)}
            onDone={stopEditing}
            titleHidden={startAdding}
          />
          {/* Variants (20261106165310): option lists for a saved item. S2-003: not for a download, whose checkout
              charges one price and never asks for an option. */}
          {open && open.kind !== "digital" && <ShopItemOptionsEditor shopId={shopId} itemId={open.id} basePriceCents={open.price_cents} />}
          {/* Preorders (20261108184654): sell a made, home-food or farm item before it is made. */}
          {open && <ShopItemPreorderEditor shopId={shopId} item={open} hasOptions={!!options.data?.has(open.id)} />}
        </>
      ) : (
        <>
          {items.isError ? (
            // The list on screen is the last one that loaded; a failed reload
            // says so (lh-silent-failure re-review, finding 2).
            <div className="flex items-center gap-2" role="alert">
              <p className="text-ds-13 text-muted-foreground">Couldn't refresh your items.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void items.refetch()} disabled={items.isFetching}>
                Try again
              </Button>
            </div>
          ) : null}
          {list.length === 0 ? (
            <p className="text-ds-13 text-muted-foreground">No items yet. Add the things you make, bake or grow.</p>
          ) : (
            <ul className="space-y-2">
              {list.map((i) => (
                <ItemRow key={i.id} item={i} busy={withdraw.isPending} onEdit={() => setEditing(i.id)} onTakeDown={() => setTakeDown(i)} />
              ))}
            </ul>
          )}
          <Button type="button" className="btn-grad-primary w-full" onClick={() => navigate("/shops/mine#add-item")}>
            Add an item
          </Button>
        </>
      )}
      <BrandConfirmDialog
        open={!!takeDown}
        onOpenChange={(next) => {
          if (!next && !withdraw.isPending) setTakeDown(null);
        }}
        title={takeDown?.status === "draft" ? "Delete this draft?" : "Take this item down?"}
        description="It leaves your shop and its photos are removed."
        primaryLabel={withdraw.isPending ? "Working…" : takeDown?.status === "draft" ? "Delete" : "Take down"}
        primaryTone="sienna"
        primaryDisabled={withdraw.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          if (takeDown) withdraw.mutate(takeDown.id);
        }}
        secondaryLabel="Cancel"
      />
    </section>
  );
}
