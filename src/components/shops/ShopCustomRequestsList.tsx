/**
 * Custom orders (20261106202917): the member's requests, on their side. The buyer (My orders) reads each ask, the
 * shop's price when it comes, and can withdraw an open one; the shop (dashboard) reads each ask and can decline it.
 * Withdraw and decline go through shop-checkout close_request (it also closes the buyer's unpaid page for a price).
 * The shop sends its price from here (ShopCustomQuoteForm, 20261106205852) and the buyer orders a price from here
 * (ShopCustomOrderForm: the ready date, then Stripe's page).
 * Nothing shows while the member has no request on that side.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { parseLocalDate } from "@/lib/dateUtils";
import { fetchMyCustomRequests, type CustomRequest } from "@/lib/shops/customRequests";
import { closeCustomRequest, formatCents } from "@/lib/shops/orders";
import { shopsErrorMessage } from "@/lib/shops/errors";
import ShopCustomQuoteForm from "./ShopCustomQuoteForm";
import ShopCustomOrderForm from "./ShopCustomOrderForm";

const STATUS_WORDS: Record<CustomRequest["status"], { buyer: string; shop: string }> = {
  requested: { buyer: "Waiting for the shop's price", shop: "New request" },
  quoted: { buyer: "The shop sent a price", shop: "Price sent" },
  accepted: { buyer: "Ordered", shop: "Ordered" },
  declined: { buyer: "The shop declined", shop: "Declined" },
  withdrawn: { buyer: "You withdrew it", shop: "The buyer withdrew it" },
  expired: { buyer: "The price expired", shop: "The price expired" },
  lapsed: { buyer: "The shop didn't answer in time", shop: "Not answered in time" },
};
const OPEN = new Set<CustomRequest["status"]>(["requested", "quoted"]);

function dayText(iso: string): string {
  return parseLocalDate(iso.slice(0, 10)).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/**
 * S2-021 (Shops audit 2): an unanswered request ends 7 days after it was sent (shops_custom_request_lapse,
 * 20261112091830), so both sides see the day. A full date-time read in the member's own clock, not a UTC slice.
 */
export function answerByText(createdAt: string, side: "buyer" | "shop"): string {
  const end = new Date(new Date(createdAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  const day = end.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return side === "shop" ? `, answer by ${day}` : `, the shop has until ${day}`;
}

export default function ShopCustomRequestsList({ side }: { side: "buyer" | "shop" }) {
  const qc = useQueryClient();
  // The one request whose price form (shop) or order form (buyer) is open.
  const [openId, setOpenId] = useState<string | null>(null);
  // S2-023 (Shops audit 2): Decline and Withdraw can't be undone (and Decline tells the buyer), so each asks first.
  const [closing, setClosing] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["shops", "custom-requests"], queryFn: fetchMyCustomRequests });
  const close = useMutation({
    mutationFn: (id: string) => closeCustomRequest(id),
    onSuccess: () => toast(side === "buyer" ? "Request withdrawn." : "Request declined. The buyer is told."),
    onError: (err) => toast.error(shopsErrorMessage(err)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["shops", "custom-requests"] }),
  });
  // S2-017: open requests (the ones that need someone to act) first; S2-024: closed ones fold under "Earlier".
  const mine = (list.data ?? []).filter((r) => r.role === side);
  const open = mine.filter((r) => OPEN.has(r.status));
  const earlier = mine.filter((r) => !OPEN.has(r.status));
  // S2-024 (Shops audit 2): a failed read says so, with Try again, instead of showing nothing (a shop could not tell
  // its requests were missing). An empty read still shows nothing: the orders around it stand on their own.
  if (list.isError) {
    return (
      <section className="space-y-2" role="alert" aria-labelledby={`shop-custom-requests-${side}`} data-testid="shop-custom-requests-error">
        <h2 id={`shop-custom-requests-${side}`} className="text-ds-13 font-semibold">Custom requests</h2>
        <p className="text-ds-13 text-destructive-ink">We couldn't load your custom requests.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void list.refetch()}>Try again</Button>
      </section>
    );
  }
  if (mine.length === 0) return null;
  const card = (r: CustomRequest) => (
    <li key={r.id} className="space-y-1 rounded-2xl border border-border bg-card p-4" data-testid="shop-custom-request">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{side === "buyer" ? (r.shop_name ?? "A shop") : "A buyer's request"}</p>
        {r.quote_cents !== null && <p className="shrink-0 text-ds-13 font-semibold">{formatCents(r.quote_cents)}</p>}
      </div>
      <p className="text-ds-11 text-muted-foreground">
        {STATUS_WORDS[r.status][side]}
        {r.status === "quoted" && r.expires_at ? `, good until ${dayText(r.expires_at)}` : ""}
        {r.status === "requested" ? answerByText(r.created_at, side) : ""}
      </p>
      <p className="text-ds-13 whitespace-pre-line [overflow-wrap:anywhere]">{r.description}</p>
      {r.wanted_date && <p className="text-ds-13">Wanted by {dayText(r.wanted_date)}</p>}
      {r.quote_note && <p className="text-ds-13 whitespace-pre-line [overflow-wrap:anywhere]">Shop's note: {r.quote_note}</p>}
      {openId === r.id && side === "shop" && r.status === "requested" && (
        <ShopCustomQuoteForm requestId={r.id} onDone={() => setOpenId(null)} />
      )}
      {openId === r.id && side === "buyer" && r.status === "quoted" && (
        <ShopCustomOrderForm request={r} onDone={() => setOpenId(null)} />
      )}
      {OPEN.has(r.status) && openId !== r.id && (
        <div className="flex flex-wrap gap-2">
          {side === "shop" && r.status === "requested" && (
            <Button type="button" size="sm" className="btn-grad-primary" onClick={() => setOpenId(r.id)}>Send a price</Button>
          )}
          {side === "buyer" && r.status === "quoted" && (
            <Button type="button" size="sm" className="btn-grad-primary" onClick={() => setOpenId(r.id)}>Order at this price</Button>
          )}
          <Button type="button" size="sm" variant="outline" disabled={close.isPending} onClick={() => setClosing(r.id)}>
            {side === "buyer" ? "Withdraw request" : "Decline"}
          </Button>
        </div>
      )}
    </li>
  );
  return (
    <section className="space-y-2" aria-labelledby={`shop-custom-requests-${side}`}>
      <h2 id={`shop-custom-requests-${side}`} className="text-ds-13 font-semibold">Custom requests</h2>
      {open.length > 0 && <ul className="space-y-3">{open.map(card)}</ul>}
      {earlier.length > 0 && (
        <details className="space-y-3" open={open.length === 0} data-testid="shop-custom-requests-earlier">
          <summary className="cursor-pointer text-ds-13 text-muted-foreground">Earlier ({earlier.length})</summary>
          <ul className="mt-3 space-y-3">{earlier.map(card)}</ul>
        </details>
      )}
      <BrandConfirmDialog
        open={closing !== null}
        onOpenChange={(o) => { if (!o) setClosing(null); }}
        title={side === "buyer" ? "Withdraw this request?" : "Decline this request?"}
        description={side === "buyer" ? "The shop won't send a price for it. This can't be undone." : "The buyer is told. This can't be undone."}
        primaryLabel={side === "buyer" ? "Withdraw request" : "Decline request"}
        onPrimary={() => { if (closing) close.mutate(closing); setClosing(null); }}
        secondaryLabel="Keep it"
      />
    </section>
  );
}
