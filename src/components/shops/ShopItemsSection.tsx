/**
 * /shops/mine, below the shop form: the owner's items and the shop's daily
 * order limit (Shops slice 2; docs/specs/local-shops-prep.md L20-L22, L52).
 * Every item that is not withdrawn, with where it stands (draft, waiting for
 * a review, listed, not approved), Edit and Take down. The server decides
 * every rule (shops_* RPCs) and this shows its words.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import {
  fetchDailyOrderCap,
  fetchShopItems,
  formatItemPrice,
  readinessLabel,
  setDailyOrderCap,
  SHOP_ITEM_TYPE_LABEL,
  withdrawShopItem,
  type ShopItem,
  type ShopItemStatus,
} from "@/lib/shops/items";
import { shopsErrorMessage } from "@/lib/shops/errors";
import ShopItemEditor from "./ShopItemEditor";

const STATUS_LABEL: Record<ShopItemStatus, string> = {
  draft: "Draft",
  pending_review: "Waiting for a review",
  live: "Listed",
  withdrawn: "Taken down",
  rejected: "Not approved",
};

function DailyCap({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const cap = useQuery({ queryKey: ["shops", "daily-cap", shopId], queryFn: () => fetchDailyOrderCap(shopId) });
  const [value, setValue] = useState<string | null>(null);
  // The browser hands a half-typed number ("1e") back as "": never read that as "no limit".
  const [badInput, setBadInput] = useState(false);
  const shown = value ?? (cap.data != null ? String(cap.data) : "");
  // An empty box removes a saved limit only as its own, named action
  // (lh-silent-failure review should-fix 3).
  const clearing = shown.trim() === "" && cap.data != null;
  const save = useMutation({
    mutationFn: () => {
      if (badInput || (shown.trim() !== "" && !/^\d+$/.test(shown.trim()))) throw new Error("invalid_daily_cap");
      return setDailyOrderCap(shown.trim() === "" ? null : Number(shown));
    },
    onSuccess: () => {
      toast.success(clearing ? "The daily limit is removed." : "Saved.");
      setValue(null);
      void qc.invalidateQueries({ queryKey: ["shops", "daily-cap", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  return (
    <div className="space-y-1.5">
      <Label htmlFor="shop-daily-cap">Most orders you take a day (optional)</Label>
      <div className="flex gap-2">
        <Input
          id="shop-daily-cap"
          type="number"
          min={1}
          max={200}
          className="min-w-0"
          value={shown}
          disabled={cap.isLoading || cap.isError}
          onChange={(e) => {
            setBadInput(e.target.validity.badInput);
            setValue(e.target.value);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending || cap.isLoading || cap.isError || value === null}
          onClick={() => save.mutate()}
        >
          {clearing ? "Remove limit" : "Save"}
        </Button>
      </div>
      {cap.isError && (
        <p className="text-sm" role="alert">
          {shopsErrorMessage(cap.error)}{" "}
          <button type="button" className="underline" onClick={() => void cap.refetch()}>Try again</button>
        </p>
      )}
      <p className="text-xs text-muted-foreground">Once a day is full, buyers can't pick it. Your order days are your open days above.</p>
    </div>
  );
}

function ItemRow({ item, onEdit, onTakeDown, busy }: { item: ShopItem; onEdit: () => void; onTakeDown: () => void; busy: boolean }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-semibold [overflow-wrap:anywhere]">{item.title}</p>
        <p className="text-xs text-muted-foreground">
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

export default function ShopItemsSection({ shopId, ownerId }: { shopId: string; ownerId: string }) {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId) });
  const [editing, setEditing] = useState<string | "new" | null>(null);
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
    <section className="space-y-4 pb-8" aria-labelledby="shop-my-items">
      <h2 id="shop-my-items" className="text-base font-semibold">Items</h2>
      <DailyCap shopId={shopId} />
      {items.isLoading ? (
        <div role="status" aria-label="Loading your items" className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : items.isError ? (
        <p className="text-sm" role="alert">{shopsErrorMessage(items.error)}</p>
      ) : editing && editing !== "new" && !open ? (
        // The open item left the list (taken down elsewhere, or the list did
        // not reload): say so with a way back, never a loader with no exit
        // (lh-silent-failure review should-fix 4).
        items.isFetching ? (
          <Skeleton className="h-40 w-full rounded-2xl" role="status" aria-label="Loading the item" />
        ) : (
          <div className="space-y-2" role="status">
            <p className="text-sm">This item isn't available any more.</p>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>Back to your items</Button>
          </div>
        )
      ) : editing ? (
        <ShopItemEditor
          key={editing}
          ownerId={ownerId}
          item={open}
          onCreated={(itemId) => setEditing(itemId)}
          onDone={() => setEditing(null)}
        />
      ) : (
        <>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet. Add the things you make, bake or grow.</p>
          ) : (
            <ul className="space-y-2">
              {list.map((i) => (
                <ItemRow key={i.id} item={i} busy={withdraw.isPending} onEdit={() => setEditing(i.id)} onTakeDown={() => setTakeDown(i)} />
              ))}
            </ul>
          )}
          <Button type="button" className="btn-grad-primary w-full" onClick={() => setEditing("new")}>
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
