/**
 * LEAD-LIST-FOR-SELLER (owner 10-31 ~10:30 PM): listings a hired Helpr wrote on the seller's account wait here, on
 * Selling, for the seller's OK. Approve one, or all at once; only then does a listing go live, through the normal
 * publish path (declutter_approve_listed_for_me runs declutter_publish_item as the seller) and the photo check after
 * it. "Not this one" keeps it off sale. Nothing shows when nothing is waiting.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/declutter/distance";
import { requestAiCheckWithRetry } from "@/lib/declutter/api";
import { approveListedForMe, declineListedForMe, fetchListedForMe, type ApprovalResult } from "@/lib/declutter/listForSeller";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { TaxStatementsCheck } from "./declutterUi";

const KEY = ["declutter", "listed-for-me"] as const;

/** Why one approval stayed waiting, in the words publishing already uses. */
function waitingWhy(r: ApprovalResult): string {
  return rpcErrorMessage("declutter_publish_item", { message: r.error ?? "" }) ?? "It couldn't go up yet. Open it to finish it.";
}

export function ListedForYouCard() {
  const qc = useQueryClient();
  const [ticked, setTicked] = useState(false);
  const { data: rows = [] } = useQuery({ queryKey: KEY, queryFn: fetchListedForMe });

  const approve = useMutation({
    mutationFn: (ids: string[]) => approveListedForMe(ids),
    onSuccess: (out) => {
      const up = out.filter((r) => r.status);
      for (const r of up) void requestAiCheckWithRetry(r.item_id);
      const stuck = out.filter((r) => r.error);
      if (up.length) toast(up.length === 1 ? "Approved. It's on sale now." : `Approved. ${up.length} listings are on sale now.`);
      if (stuck.length) toast(waitingWhy(stuck[0]));
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (e: Error & { userMessage?: string }) => toast(e.userMessage ?? "We couldn't approve that. Try again."),
  });
  const decline = useMutation({
    mutationFn: (id: string) => declineListedForMe(id),
    onSuccess: () => { toast("Removed. It won't go on sale."); void qc.invalidateQueries({ queryKey: ["declutter"] }); },
    onError: (e: Error & { userMessage?: string }) => toast(e.userMessage ?? "We couldn't remove that. Try again."),
  });

  if (rows.length === 0) return null;
  const who = rows[0].helpr_first_name || "Your Helpr";
  const busy = approve.isPending || decline.isPending;

  return (
    <section aria-labelledby="listed-for-you-title" data-listed-for-you="" className="rounded-[20px] border border-border bg-card p-4">
      <h2 id="listed-for-you-title" className="text-base font-semibold">Waiting for your approval</h2>
      <p className="mt-1 text-ds-13 text-muted-foreground">
        {who} wrote {rows.length === 1 ? "this listing" : `these ${rows.length} listings`} for you. Nothing goes on sale until you approve it.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {rows.map((r) => (
          <li key={r.item_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            {/* At least 12rem for the title, so on a phone the two buttons wrap under it instead of crushing it. */}
            <div className="min-w-[12rem] flex-1">
              <p className="truncate text-ds-15 font-medium">{r.title}</p>
              <p className="text-ds-13 text-muted-foreground">
                {r.price_cents === 0 ? "Free" : formatPrice(r.price_cents)}
                {/* The lowest price the Helpr set, so the seller sees it before approving. */}
                {r.floor_price_cents != null && r.floor_price_cents > 0 && r.floor_price_cents < r.price_cents && (
                  <span data-listed-floor=""> · Lowest {formatPrice(r.floor_price_cents)}</span>
                )}
              </p>
            </div>
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => decline.mutate(r.item_id)}>
              Not this one
            </Button>
            <Button className="rounded-full" disabled={busy || !ticked} onClick={() => approve.mutate([r.item_id])}>
              Approve
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 rounded-2xl bg-muted/50 p-3">
        <TaxStatementsCheck id="listed-for-you-tax" checked={ticked} onChange={setTicked} />
      </div>
      {rows.length > 1 && (
        <Button className="mt-3 w-full rounded-full" disabled={busy || !ticked} onClick={() => approve.mutate(rows.map((r) => r.item_id))}>
          Approve all {rows.length}
        </Button>
      )}
    </section>
  );
}
