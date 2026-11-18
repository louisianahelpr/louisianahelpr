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
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Settings } from "lucide-react";
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
import ShopDashboardProducts from "./ShopDashboardProducts";
import { ShopSectionHead } from "./shopSettingsUi";
import { useLanguage } from "@/lib/i18n/language";

/** The shop's order groups under Shops > Shop (owner, 2026-10-19). */
const SHOP_GROUPS = ["answer", "make", "earlier"] as const;
type ShopGroup = (typeof SHOP_GROUPS)[number];
const SHOP_GROUP_KEY = { answer: "shb.dash.needsYou", make: "shb.dash.toMake", earlier: "shb.dash.done" } as const satisfies Record<ShopGroup, string>;
import { ShopCancelOrder } from "./ShopOrderCancel";
import { t as tr } from "@/lib/i18n/language";
import "@/lib/i18n/enShopsBrowse";

/**
 * A seller's order card title (Area 07 M3): the buyer's first name and the first item, "Ann · 2 × Pecan pralines",
 * "+ N more" for more lines; just the item when the server gives no name (Q2104: a blocked pair or a deleted buyer).
 */
function orderTitle(o: Pick<ShopOrder, "shop_order_lines">, name: string | null | undefined): string {
  const [first, ...rest] = o.shop_order_lines ?? [];
  const one = first ? tr("shb.dash.item", { qty: first.quantity, title: first.title }) : tr("shb.dash.order");
  const item = rest.length > 0 ? tr("shb.dash.more", { item: one, n: rest.length }) : one;
  return name ? tr("shb.dash.title", { name, item }) : item;
}

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
  const { t } = useLanguage();
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
  // Area 07 M3 (design audit 11-18): the card's title is who and what ("Ann · 2 × Pecan pralines"); the stage is the
  // group it sits in and the card's status pill, never the title ("New order from Ann" read as a stage).
  const from = (o: ShopOrder) => orderTitle(o, buyerNames.data?.[o.id]);
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
      toast.success(charged ? t("shb.dash.accepted") : t("shb.dash.acceptedSoon"));
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
      toast.success(t("shb.dash.declined"));
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
      <Frame title={t("shb.tab.shop")} backTo="/shops">
        {/* Q2558: the placeholder IS the "You don't have a shop yet." card (the shorter case), invisible under one
            bone, so it is that card's height at every width (154px measured 2026-11-02 went stale with its words).
            A shop's order list grows below. */}
        <div className="relative" role="status" aria-label={t("shb.dash.loading")}>
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
      <Frame title={t("shb.tab.shop")} backTo="/shops">
        <ErrorState variant="inline" title={t("shb.dash.loadShopFailed")} body={shopsErrorMessage(myId.error)} onRetry={() => void myId.refetch()} />
      </Frame>
    );
  }
  if (!myId.data) {
    return (
      <Frame title={t("shb.tab.shop")} backTo="/shops">
        <NoShopYet embedded={embedded} />
      </Frame>
    );
  }

  const all = orders.data ?? [];
  const waiting = all.filter((o) => o.status === "held");
  const accepted = all.filter((o) => o.status === "accepted");
  const earlier = all.filter((o) => o.status !== "held" && o.status !== "accepted");

  const head = (g: ShopGroup, n: number) => ({ id: `shop-group-${g}`, label: t(SHOP_GROUP_KEY[g]), count: n });
  const toSettings = () => document.getElementById("shop-settings")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <Frame title={t("shb.tab.shop")} backTo={`/shops/${myId.data}`}>
      {/* Area 07 M13 (design audit 11-18: 1440 was a stretched phone column): from lg the orders take the left column
          and Products + Shop settings sit beside them; below lg it is the one column, orders first. */}
      <div className="space-y-6 pb-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start lg:gap-8 lg:space-y-0" data-testid="shop-dashboard-columns">
      <div className="min-w-0 space-y-6">
        {header?.(myId.data)}
        {/* Area 07 M5: the settings sat under every order with no way to them from the top; one link jumps there
            (from lg they are already in view in the side column). */}
        <InlineTextButton onClick={toSettings} className="btn-press inline-flex min-h-11 items-center gap-1.5 text-ds-13 font-semibold text-primary no-underline lg:hidden" data-testid="shop-settings-jump">
          <Settings className="h-4 w-4" aria-hidden /> {t("shb.dash.toSettings")}
        </InlineTextButton>
        {embedded && !orders.isError && (
          <StatusBoxes
            boxes={[
              { key: "answer", label: t(SHOP_GROUP_KEY.answer), count: waiting.length + newRequests, hot: true },
              { key: "make", label: t(SHOP_GROUP_KEY.make), count: accepted.length },
              { key: "earlier", label: t(SHOP_GROUP_KEY.earlier), count: earlier.length },
            ]}
            value={status}
            onToggle={toggleStatus}
            // Area 07 M4: a chip cut at a phone's edge reads as "more to scroll" (the Jobs/Declutter fade).
            fade
          />
        )}
        {/* Only while payouts are not set up (SH12): an accepted order pays out to this account. */}
        <ShopPayoutRow />
        {/* Q2110: the member's own Shops strikes and when each ends (nothing when there are none). */}
        <ShopMyStrikes />
        {/* Q1947: the chat an order card's Message opens (?talk=). */}
        <ShopTalkFromLink />
        {/* Area 07 M4: every group's head is one style, the chip's own words with its count ("Done · 7"). */}
        {show("answer") && (
          <section className="space-y-2" aria-labelledby="shop-group-answer">
            <ShopSectionHead {...head("answer", waiting.length + newRequests)} />
            <ShopCustomRequestsList side="shop" />
            {orders.isError ? (
              <ErrorState variant="inline" title={t("shb.dash.loadOrdersFailed")} body={shopsErrorMessage(orders.error)} onRetry={() => void orders.refetch()} />
            ) : waiting.length === 0 ? (
              <p className="text-ds-13 text-muted-foreground">{t("shb.dash.noNew")}</p>
            ) : (
              <ul className="space-y-3">
                {waiting.map((o) => (
                  <ShopOrderCard key={o.id} order={o} side="shop" heading={from(o)}>
                    <p className="text-ds-11 font-semibold" data-testid="shop-order-time-left">
                      {timeLeftText(o.accept_by, now) ?? t("shb.dash.closing")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={accept.isPending || decline.isPending}
                        onClick={() => { setReason(""); setDeclining(o); }}
                      >
                        {t("shb.dash.decline")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="btn-grad-primary"
                        disabled={accept.isPending || decline.isPending || !timeLeftText(o.accept_by, now)}
                        onClick={() => setAccepting(o)}
                      >
                        {t("shb.dash.accept")}
                      </Button>
                    </div>
                  </ShopOrderCard>
                ))}
              </ul>
            )}
          </section>
        )}
        {orders.isError && !show("answer") && (
          <ErrorState variant="inline" title={t("shb.dash.loadOrdersFailed")} body={shopsErrorMessage(orders.error)} onRetry={() => void orders.refetch()} />
        )}
        {!orders.isError && accepted.length > 0 && show("make") && (
          <section className="space-y-2" aria-labelledby="shop-group-make">
            <ShopSectionHead {...head("make", accepted.length)} />
            <ul className="space-y-3">
              {accepted.map((o) => (
                <ShopOrderCard key={o.id} order={o} side="shop" heading={from(o)}>
                  {user && <ShopHandoverActions order={o} side="shop" userId={user.id} />}
                  <ShopCancelOrder order={o} />
                </ShopOrderCard>
              ))}
            </ul>
          </section>
        )}
        {!orders.isError && earlier.length > 0 && show("earlier") && (
          <section className="space-y-2" aria-labelledby="shop-group-earlier">
            <ShopSectionHead {...head("earlier", earlier.length)} />
            <ul className="space-y-3">
              {earlier.map((o) => (
                <ShopOrderCard key={o.id} order={o} side="shop" heading={from(o)}>
                  {user && o.status === "handed_over" && <ShopHandoverActions order={o} side="shop" userId={user.id} />}
                </ShopOrderCard>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="min-w-0 space-y-6">
        {/* Area 07 M8: the shop's products on its dashboard, not only at the bottom of Edit my shop. */}
        <ShopDashboardProducts shopId={myId.data} />
        {/* Area 07 M5: every setting under one "Shop settings" head, one radio-card look and one save line. */}
        <section className="scroll-mt-4 space-y-6" id="shop-settings" aria-labelledby="shop-settings-head" data-testid="shop-settings">
          <ShopSectionHead id="shop-settings-head" label={t("shb.dash.toSettings")} />
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
        </section>
      </div>
      </div>
      <BrandConfirmDialog
        open={!!accepting}
        onOpenChange={(open) => { if (!open) setAccepting(null); }}
        title={t("shb.dash.acceptTitle")}
        description={
          accepting
            // S047 (Shops audit 11-12): a shop-delivered order also pays the shop its delivery fee (the order card's amount).
            // Area 07 H1: the words come from the dictionary; the amount is the same expression as before.
            ? t(accepting.fulfillment === "shop_delivers" ? "shb.dash.acceptBodyDelivery" : "shb.dash.acceptBody", { amount: formatCents(accepting.items_cents + (accepting.fulfillment === "shop_delivers" ? accepting.delivery_cents ?? 0 : 0)) })
            : ""
        }
        primaryLabel={accept.isPending ? t("shb.dash.accepting") : t("shb.dash.acceptCharge")}
        primaryDisabled={accept.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          if (accepting) accept.mutate(accepting.id);
        }}
        // Area 07 M12: dismiss says "Not now", never a "Cancel" beside order words.
        secondaryLabel={t("shb.dash.notNow")}
      />
      <BrandConfirmDialog
        open={!!declining}
        onOpenChange={(open) => { if (!open) setDeclining(null); }}
        title={t("shb.dash.declineTitle")}
        // Area 07 M12: declining a buyer's order cannot be undone, so it wears the destructive tone.
        primaryTone="sienna"
        description={t("shb.dash.declineBody")}
        primaryLabel={decline.isPending ? t("shb.dash.declining") : t("shb.dash.declineOrder")}
        primaryDisabled={decline.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          if (declining) decline.mutate({ id: declining.id, why: reason });
        }}
        secondaryLabel={t("shb.dash.keepIt")}
      >
        <div className="space-y-1">
          <Label htmlFor="shop-decline-reason">{t("shb.dash.reason")}</Label>
          <Textarea id="shop-decline-reason" value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} placeholder={t("shb.dash.reasonExample")} />
        </div>
      </BrandConfirmDialog>
    </Frame>
  );
}

/** No shop yet. `placeholder`: the loading copy, which must not hide the floating "Open a shop" meanwhile. */
function NoShopYet({ embedded, placeholder = false }: { embedded: boolean; placeholder?: boolean }) {
  const navigate = useNavigate();
  return embedded ? (
    <ShopsNotice title={tr("shb.dash.noShop")}>
      <p>{tr("shb.dash.noShopBody")}</p>
      {/* Its own "Open a shop" is here: the floating one steps aside (owner via the lead, 11-08). */}
      {!placeholder && <HideSectionCreateFab />}
      <SectionActionPill className="mt-3" onClick={() => navigate("/shops/mine")}>{tr("shb.openShop")}</SectionActionPill>
    </ShopsNotice>
  ) : (
    <ShopsNotice title={tr("shb.dash.noShop")}>
      <p>
        {tr("shb.dash.noShopShort")} <Link to="/shops/mine" className="underline">{tr("shb.openShop")}</Link>
      </p>
    </ShopsNotice>
  );
}

/** Before the first order: the handover and delivery choices behind one closed row (the defaults hold meanwhile). */
function HandoverSettingsRow({ shopId }: { shopId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-3" aria-label={tr("shb.set.handover")}>
      <button
        type="button"
        className="btn-press flex w-full items-center gap-3 rounded-2xl border border-border/60 px-4 py-3 text-left"
        aria-expanded={open}
        aria-controls="shop-handover-settings"
        onClick={() => setOpen((v) => !v)}
        data-testid="shop-handover-settings-toggle"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-ds-13 font-semibold">{tr("shb.set.handover")}</span>
          <span className="block text-ds-11 text-muted-foreground">{tr("shb.set.handoverSub")}</span>
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
