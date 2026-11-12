/**
 * /shops/dashboard: the shop owner's dashboard, M1 skeleton (SH7). Orders
 * waiting for an answer with the time left to answer (the card hold drops
 * after 24 hours), Accept (the buyer's card is charged) and Decline with a
 * reason (the hold drops, nothing is charged), the rest of the shop's orders,
 * and the cancel rule buyers read before paying (O2 presets). Later slices
 * add items and stats. M2 (20261018211820) adds the handover on each accepted
 * order (ShopHandoverActions), the payout line on handed-over ones and the
 * handover choice (ShopHandoverModePicker). No visual pass yet.
 */
import { HideSectionCreateFab } from "@/components/sections/createFabHidden";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { SectionActionPill } from "@/components/ui/SectionActionPill";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchMyShopId } from "@/lib/shops/api";
import { fetchMyCustomRequests } from "@/lib/shops/customRequests";
import {
  acceptOrder,
  declineOrder,
  fetchShopOrders,
  fetchShopOrderBuyerNames,
  shopDashboardOrdersKey,
  formatCents,
  timeLeftText,
  type ShopOrder,
} from "@/lib/shops/orders";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopsNotice } from "./shopsUi";
import { ShopOrderCard } from "./ShopOrderCard";
import { ShopTalkFromLink } from "./ShopTalk";
import CancelPolicyPicker from "./ShopCancelPolicyPicker";
import ShopPayoutRow, { useShopPayoutRowSettled } from "./ShopPayoutRow";
import ShopMyStrikes from "./ShopMyStrikes";
import HandoverModePicker from "./ShopHandoverModePicker";
import ShopDeliveryPicker from "./ShopDeliveryPicker";
import CustomOrdersPicker from "./ShopCustomOrdersPicker";
import ShopCustomRequestsList from "./ShopCustomRequestsList";
import { ShopHandoverActions } from "./ShopHandoverActions";
import { StatusBoxes, useStatusFilter } from "@/components/sections/StatusBoxes";

/** The shop's order groups under Shops > Shop (owner, 2026-10-19). */
const SHOP_GROUPS = ["answer", "make", "earlier"] as const;
type ShopGroup = (typeof SHOP_GROUPS)[number];
const SHOP_GROUP_LABEL: Record<ShopGroup, string> = { answer: "Needs you", make: "To make", earlier: "Done" };
import { ShopCancelOrder } from "./ShopOrderCancel";

const REASON_MAX = 200;

/** Re-renders once a minute so the time left to answer stays current. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/**
 * `embedded`: rendered inside the Shops section's Shop tab (no page frame of
 * its own), with the status boxes on top filtering the three groups below.
 * Standalone (/shops/dashboard) it is unchanged. `header` sits above the
 * boxes (the See my shop / Share my shop row); `footer` below the settings.
 */
export default function ShopDashboardView({ embedded = false, header, footer }: { embedded?: boolean; header?: (shopId: string) => ReactNode; footer?: ReactNode } = {}) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const now = useMinuteTick();
  const [accepting, setAccepting] = useState<ShopOrder | null>(null);
  const [declining, setDeclining] = useState<ShopOrder | null>(null);
  const [reason, setReason] = useState("");
  const myId = useQuery({ queryKey: ["shops", "mine"], queryFn: fetchMyShopId });
  const orders = useQuery({
    // S028: its own key; the badge read seeds the shared one with shorter rows (see shopDashboardOrdersKey).
    queryKey: shopDashboardOrdersKey(user?.id ?? null),
    queryFn: () => fetchShopOrders(user!.id),
    enabled: !!user?.id && !!myId.data,
  });
  // Q2104: who ordered (first names only). A failed read leaves the headings without a name; the orders still show.
  const orderIds = (orders.data ?? []).map((o) => o.id);
  const buyerNames = useQuery({
    queryKey: ["shops", "shop-orders", user?.id ?? null, "buyer-names", orderIds],
    queryFn: () => fetchShopOrderBuyerNames(orderIds),
    enabled: orderIds.length > 0,
  });
  const from = (o: ShopOrder, base: string, word: string) => {
    const name = buyerNames.data?.[o.id];
    return name ? `${base} ${word} ${name}` : base;
  };
  const [status, toggleStatus] = useStatusFilter(SHOP_GROUPS);
  const show = (g: ShopGroup) => status === null || status === g;
  // S2-017 (Shops audit 2): new custom requests need an answer (they end after 7 days), so they count in "Waiting for
  // your answer" and show at the top. Same query key as ShopCustomRequestsList: one fetch.
  const requests = useQuery({ queryKey: ["shops", "custom-requests"], queryFn: fetchMyCustomRequests });
  const newRequests = (requests.data ?? []).filter((r) => r.role === "shop" && r.status === "requested").length;
  const Frame = embedded ? EmbeddedFrame : AppPage;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["shops", "shop-orders"] });

  // The payout row's "is setup offered" answer joins this screen's loading gate (it renders above the orders).
  const payoutSettled = useShopPayoutRowSettled();
  const accept = useMutation({
    mutationFn: (id: string) => acceptOrder(id),
    onSuccess: ({ charged }) => {
      toast.success(charged ? "Accepted. The buyer's card is charged." : "Accepted. The charge finishes within a few minutes.");
      setAccepting(null);
      refresh();
    },
    onError: (err) => {
      toast.error(shopsErrorMessage(err));
      setAccepting(null);
      refresh();
    },
  });
  const decline = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => declineOrder(id, why),
    onSuccess: () => {
      toast.success("Declined. The buyer's card was not charged.");
      setDeclining(null);
      setReason("");
      refresh();
    },
    onError: (err) => {
      toast.error(shopsErrorMessage(err));
      refresh();
    },
  });

  if (myId.isLoading || (!!myId.data && (orders.isLoading || !payoutSettled))) {
    return (
      <Frame title="Shop" backTo="/shops">
        {/* Q2558: the placeholder IS the "You don't have a shop yet." card (the shorter case), invisible under one
            bone, so it is that card's height at every width (154px measured 2026-11-02 went stale with its words).
            A shop's order list grows below. */}
        <div className="relative" role="status" aria-label="Loading your shop's orders">
          <div className="invisible" aria-hidden>
            <NoShopYet embedded={embedded} placeholder />
          </div>
          <Skeleton className="absolute inset-0 rounded-2xl" />
        </div>
      </Frame>
    );
  }
  if (myId.isError) {
    return (
      <Frame title="Shop" backTo="/shops">
        <ErrorState variant="inline" title="We couldn't load your shop." body={shopsErrorMessage(myId.error)} onRetry={() => void myId.refetch()} />
      </Frame>
    );
  }
  if (!myId.data) {
    return (
      <Frame title="Shop" backTo="/shops">
        <NoShopYet embedded={embedded} />
      </Frame>
    );
  }

  const all = orders.data ?? [];
  const waiting = all.filter((o) => o.status === "held");
  const accepted = all.filter((o) => o.status === "accepted");
  const earlier = all.filter((o) => o.status !== "held" && o.status !== "accepted");

  return (
    <Frame title="Shop" backTo={`/shops/${myId.data}`}>
      <div className="space-y-6 pb-6">
        {header?.(myId.data)}
        {embedded && !orders.isError && (
          <StatusBoxes
            boxes={[
              { key: "answer", label: SHOP_GROUP_LABEL.answer, count: waiting.length + newRequests, hot: true },
              { key: "make", label: SHOP_GROUP_LABEL.make, count: accepted.length },
              { key: "earlier", label: SHOP_GROUP_LABEL.earlier, count: earlier.length },
            ]}
            value={status}
            onToggle={toggleStatus}
          />
        )}
        {/* Only while payouts are not set up (SH12): an accepted order pays out to this account. */}
        <ShopPayoutRow />
        {/* Q2110: the member's own Shops strikes and when each ends (nothing when there are none). */}
        <ShopMyStrikes />
        {/* Q1947: the chat an order card's Message opens (?talk=). */}
        <ShopTalkFromLink />
        {show("answer") && <ShopCustomRequestsList side="shop" />}
        {orders.isError ? (
          <ErrorState variant="inline" title="We couldn't load your orders." body={shopsErrorMessage(orders.error)} onRetry={() => void orders.refetch()} />
        ) : (
          <>
            {show("answer") && <section className="space-y-2" aria-labelledby="shop-waiting">
              <h2 id="shop-waiting" className="text-ds-13 font-semibold">Waiting for your answer</h2>
              {waiting.length === 0 ? (
                <p className="text-ds-13 text-muted-foreground">No new orders right now.</p>
              ) : (
                <ul className="space-y-3">
                  {waiting.map((o) => (
                    <ShopOrderCard key={o.id} order={o} side="shop" heading={from(o, "New order", "from")}>
                      <p className="text-ds-11 font-semibold" data-testid="shop-order-time-left">
                        {timeLeftText(o.accept_by, now) ?? "The time to answer has passed; this order is closing."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={accept.isPending || decline.isPending}
                          onClick={() => { setReason(""); setDeclining(o); }}
                        >
                          Decline
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="btn-grad-primary"
                          disabled={accept.isPending || decline.isPending || !timeLeftText(o.accept_by, now)}
                          onClick={() => setAccepting(o)}
                        >
                          Accept
                        </Button>
                      </div>
                    </ShopOrderCard>
                  ))}
                </ul>
              )}
            </section>}
            {accepted.length > 0 && show("make") && (
              <section className="space-y-2" aria-labelledby="shop-accepted">
                <h2 id="shop-accepted" className="text-ds-13 font-semibold">Accepted: make these</h2>
                <ul className="space-y-3">
                  {accepted.map((o) => (
                    <ShopOrderCard key={o.id} order={o} side="shop" heading={from(o, "Accepted order", "for")}>
                      {user && <ShopHandoverActions order={o} side="shop" userId={user.id} />}
                      <ShopCancelOrder order={o} />
                    </ShopOrderCard>
                  ))}
                </ul>
              </section>
            )}
            {earlier.length > 0 && show("earlier") && (
              <section className="space-y-2" aria-labelledby="shop-earlier">
                <h2 id="shop-earlier" className="text-ds-13 font-semibold">Earlier orders</h2>
                <ul className="space-y-3">
                  {earlier.map((o) => (
                    <ShopOrderCard key={o.id} order={o} side="shop" heading={from(o, "Order", "from")}>
                      {user && o.status === "handed_over" && <ShopHandoverActions order={o} side="shop" userId={user.id} />}
                    </ShopOrderCard>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {/* Shops audit 11-10 F12: a shop with no order yet sees one closed "Pickup and delivery" row, not two
            long pickers before anything has happened; the first order opens them for good. */}
        {all.length > 0 ? (
          <>
            <HandoverModePicker shopId={myId.data} />
            <ShopDeliveryPicker shopId={myId.data} />
          </>
        ) : (
          <HandoverSettingsRow shopId={myId.data} />
        )}
        <CancelPolicyPicker shopId={myId.data} />
        <CustomOrdersPicker shopId={myId.data} />
        {footer}
      </div>
      <BrandConfirmDialog
        open={!!accepting}
        onOpenChange={(open) => { if (!open) setAccepting(null); }}
        title="Accept this order?"
        description={
          accepting
            // S047 (Shops audit 11-12): a shop-delivered order also pays the shop its delivery fee (the order card's amount).
            ? `The buyer's card is charged now, and you get ${formatCents(accepting.items_cents + (accepting.fulfillment === "shop_delivers" ? accepting.delivery_cents ?? 0 : 0))} for it${accepting.fulfillment === "shop_delivers" ? ", delivery included" : ""}. Only accept if you can have it ready on the date.`
            : ""
        }
        primaryLabel={accept.isPending ? "Accepting…" : "Accept and charge"}
        primaryDisabled={accept.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          if (accepting) accept.mutate(accepting.id);
        }}
        secondaryLabel="Cancel"
      />
      <BrandConfirmDialog
        open={!!declining}
        onOpenChange={(open) => { if (!open) setDeclining(null); }}
        title="Decline this order?"
        description="The hold on the buyer's card drops and nothing is charged."
        primaryLabel={decline.isPending ? "Declining…" : "Decline order"}
        primaryDisabled={decline.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          if (declining) decline.mutate({ id: declining.id, why: reason });
        }}
        secondaryLabel="Keep it"
      >
        <div className="space-y-1">
          <Label htmlFor="shop-decline-reason">Reason for the buyer (optional)</Label>
          <Textarea id="shop-decline-reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} placeholder="Booked up that day" />
        </div>
      </BrandConfirmDialog>
    </Frame>
  );
}

/** No shop yet. `placeholder`: the loading copy, which must not hide the floating "Open a shop" meanwhile. */
function NoShopYet({ embedded, placeholder = false }: { embedded: boolean; placeholder?: boolean }) {
  const navigate = useNavigate();
  return embedded ? (
    <ShopsNotice title="You don't have a shop yet.">
      <p>Open a free shop for your business or the things you make. Its orders show here.</p>
      {/* Its own "Open a shop" is here: the floating one steps aside (owner via the lead, 11-08). */}
      {!placeholder && <HideSectionCreateFab />}
      <SectionActionPill className="mt-3" onClick={() => navigate("/shops/mine")}>Open a shop</SectionActionPill>
    </ShopsNotice>
  ) : (
    <ShopsNotice title="You don't have a shop yet.">
      <p>
        Open a free shop and its orders show here. <Link to="/shops/mine" className="underline">Open a shop</Link>
      </p>
    </ShopsNotice>
  );
}

/** Before the first order: the handover and delivery choices behind one closed row (the defaults hold meanwhile). */
function HandoverSettingsRow({ shopId }: { shopId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-3" aria-label="Pickup and delivery">
      <button
        type="button"
        className="btn-press flex w-full items-center gap-3 rounded-2xl border border-border/60 px-4 py-3 text-left"
        aria-expanded={open}
        aria-controls="shop-handover-settings"
        onClick={() => setOpen((v) => !v)}
        data-testid="shop-handover-settings-toggle"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-ds-13 font-semibold">Pickup and delivery</span>
          <span className="block text-ds-11 text-muted-foreground">Buyers pick up from you unless you change it.</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform${open ? " rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div id="shop-handover-settings" className="space-y-6">
          <HandoverModePicker shopId={shopId} />
          <ShopDeliveryPicker shopId={shopId} />
        </div>
      )}
    </section>
  );
}

/** The Shop tab's frame: no page header (the section's top bar is above it). */
function EmbeddedFrame({ children }: { title: string; backTo?: string; children: ReactNode }) {
  return <div className="flex flex-col gap-4" data-testid="shops-shop-tab">{children}</div>;
}
