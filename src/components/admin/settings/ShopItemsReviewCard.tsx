import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFeature } from "@/hooks/useFeature";
import {
  fetchPendingShopItems,
  formatItemPrice,
  itemPhotoUrl,
  reviewShopItem,
  SHOP_ITEM_KIND_LABEL,
  SHOP_ITEM_TYPE_LABEL,
  type PendingShopItem,
} from "@/lib/shops/items";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { AdminCard } from "../AdminViewShell";

/**
 * Shop items waiting for an admin (Shops slice 2; docs/specs/local-shops-prep.md
 * L52): a shop's first 3 items, and any item the photo check flagged or could
 * not check, or whose words the banned-list word check flagged. Approve lists
 * it; reject needs a reason, which the owner reads. The server refuses a
 * non-admin, an admin's own item, and approving for a shop that cannot sell
 * right now (shops_admin_review_item), and a decision on a version the admin
 * did not see: the row's submitted_at goes back with it, and an owner who
 * edited and resent the item meanwhile gets 'item_changed' (lh-authz-rls
 * re-review N1), after which the list reloads. Shown only while the 'shops' switch is
 * on for this admin, beside the Declutter review card (the one Shops queue
 * screen, L73, is docs/OPEN.md Q1887).
 */
function whyWaiting(row: PendingShopItem): string {
  if (row.ai_flag_reason) return `Photo check flagged it: ${row.ai_flag_reason}`;
  if (row.text_flag_reason) return `Word check flagged it: ${row.text_flag_reason}`;
  if (row.approved_items < 3) return `New shop (${row.approved_items} of 3 approved items)`;
  if (!row.ai_checked_at) return "The photo check did not run";
  return "Waiting for a review";
}

function PendingItem({ row }: { row: PendingShopItem }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (approve: boolean) => reviewShopItem(row.item_id, row.submitted_at, approve, approve ? null : note.trim()),
    onSuccess: (status) => {
      toast.success(status === "live" ? "Approved: it's on the shop now." : "Rejected. The owner will see your reason.");
      void qc.invalidateQueries({ queryKey: ["shops", "admin-pending-items"] });
    },
    onError: (err) => {
      toast.error(shopsErrorMessage(err));
      // item_changed / item_not_pending: show the version waiting now.
      void qc.invalidateQueries({ queryKey: ["shops", "admin-pending-items"] });
    },
  });
  return (
    <li className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex gap-2 overflow-x-auto">
        {row.photo_paths.map((p) => (
          <img key={p} src={itemPhotoUrl(p)} alt="" className="h-20 w-20 shrink-0 rounded-lg bg-muted object-cover" />
        ))}
      </div>
      <p className="font-semibold [overflow-wrap:anywhere]">{row.title} · {formatItemPrice(row.price_cents)}</p>
      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {row.shop_name} · {SHOP_ITEM_KIND_LABEL[row.kind] ?? row.kind}, {SHOP_ITEM_TYPE_LABEL[row.subtype] ?? row.subtype} · {whyWaiting(row)}
      </p>
      {row.description && <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{row.description}</p>}
      <label className="block text-xs font-medium" htmlFor={`shop-item-note-${row.item_id}`}>Reason, if you reject it (the owner sees this)</label>
      <input
        id={`shop-item-note-${row.item_id}`}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button onClick={() => decide.mutate(true)} disabled={decide.isPending}>Approve</Button>
        <Button variant="outline" onClick={() => decide.mutate(false)} disabled={decide.isPending || !note.trim()}>
          Reject
        </Button>
      </div>
    </li>
  );
}

export function ShopItemsReviewCard() {
  const on = useFeature("shops");
  const pending = useQuery({ queryKey: ["shops", "admin-pending-items"], queryFn: fetchPendingShopItems, enabled: on });
  if (!on) return null;
  return (
    <AdminCard title="Shops: items to review" subtitle="New shops' first 3 items and anything the photo or word check flagged.">
      {pending.isError && !pending.data ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm">{shopsErrorMessage(pending.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void pending.refetch()} disabled={pending.isFetching}>
            Try again
          </Button>
        </div>
      ) : pending.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
      ) : (pending.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <ul className="space-y-3">
          {(pending.data ?? []).map((row) => <PendingItem key={row.item_id} row={row} />)}
        </ul>
      )}
    </AdminCard>
  );
}
