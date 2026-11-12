/**
 * Order from a shop (Shops M1; docs/specs/local-shops-prep.md L17-L22, L37/F1,
 * L41 + O2). Shown on a shop's page to everyone but its owner, while the shop
 * sells and is not paused.
 *
 * The buyer picks quantities of the live items, a ready date (closed weekdays,
 * full days and days before the longest lead time are greyed out, the same
 * rules shops_request_order applies), reads the shop's cancel rule BEFORE
 * paying, and is sent to Stripe's page, where the card is HELD, not charged.
 * The shop has 24 hours to accept; only then is the card charged.
 *
 * Delivery (20261106180902): when the shop delivers, the buyer picks pickup or
 * delivery and types the drop-off address; shop-checkout geocodes it, the SQL
 * refuses one past the shop's radius and adds the shop's fee.
 *
 * Helpr delivery (slice 3; shop-checkout 'helpr_quote', 20261106223244): when the shop offers it, the buyer can
 * have a Helpr deliver instead. The price ($6 + $1.50 a road mile from the shop) is looked up on the server for
 * the typed address BEFORE the order; the order sends that price and the server refuses it if it moved.
 *
 * The server re-checks every rule (shops_request_order): nothing here is the
 * protection. Styling is today's shared components only (no visual pass yet).
 */
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DatePickerField } from "@/components/DatePickerField";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { fetchShopItems, formatItemPrice } from "@/lib/shops/items";
import { fetchItemOptions } from "@/lib/shops/variants";
import { deliveryAddressProblem, fetchDeliveryOffer, fetchHelprDeliveryQuote, type HelprQuote } from "@/lib/shops/delivery";
import {
  buyerFeeCents,
  cancelPolicyText,
  ORDER_HOLD_TEXT,
  earliestReadyDate,
  fetchOrderTerms,
  firstOpenReadyDate,
  formatCents,
  readyDateProblem,
  requestOrder,
  SHOP_SERVICE_FEE_INCLUDED,
} from "@/lib/shops/orders";
import { isLouisianaZip } from "@/lib/shipping/policy";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { useFirstPayoutFeeCents, useFirstPayoutFeeKnown } from "@/hooks/useFirstPayoutFee";
import { ShopsNotice } from "./shopsUi";
import ShopMyStrikes from "./ShopMyStrikes";
import { HandoverModeNote } from "./ShopHandoverModePicker";
import ShopOrderOptions, { QuantityStepper } from "./ShopOrderOptions";
import { chosenLines, MAX_PER_LINE, maxFor, orderableItems, preorderMax, useShopCart } from "./shopCart";
import { fetchItemPreorders, preorderLabel, requestPreorder } from "@/lib/shops/preorders";
import { PreorderChargeBox } from "./ShopPreorderBits";

const NOTE_MAX = 500;

export default function ShopOrderSheet({ shopId }: { shopId: string }) {
  // The first-time account setup fee shop-checkout adds (20261105181603 B; Declutter's BuyerTotal reads the same hook).
  const setupFeeOwed = useFirstPayoutFeeCents();
  const setupFeeKnown = useFirstPayoutFeeKnown();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // One heading id per instance (A0-L1), for whichever state is showing.
  const headId = useId();
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId), enabled: !!shopId });
  const terms = useQuery({ queryKey: ["shops", "order-terms", shopId], queryFn: () => fetchOrderTerms(shopId), enabled: !!shopId });
  // Items with option lists (variants): their combinations, prices and stock.
  const options = useQuery({ queryKey: ["shops", "item-options", shopId], queryFn: () => fetchItemOptions(shopId), enabled: !!shopId });
  // Preorders (20261108184654): ordered one item at a time, paid in full now, ready on the shop's ready-by date.
  const preorders = useQuery({ queryKey: ["shops", "item-preorders", shopId], queryFn: () => fetchItemPreorders(shopId), enabled: !!shopId });
  // S026: the page's one order (ShopCartProvider), shared with the item sheet and the Review order bar.
  const { qty, setQty } = useShopCart();
  const [readyDate, setReadyDate] = useState("");
  const [note, setNote] = useState("");
  const [opening, setOpening] = useState(false);
  // H8 (b): where an at-home carpet or furniture cleaning is done (taxed there).
  const [svc, setSvc] = useState({ line1: "", city: "", postal_code: "" });
  // Delivery: the shop's offer (its own query; a failed read just offers pickup), the buyer's choice and address.
  const offer = useQuery({ queryKey: ["shops", "delivery-offer", shopId], queryFn: () => fetchDeliveryOffer(shopId), enabled: !!shopId });
  const [wantsDelivery, setWantsDelivery] = useState(false);
  const [addr, setAddr] = useState({ line1: "", line2: "", city: "", postal_code: "" });
  // Helpr delivery: the buyer's choice and the server's price for ONE address (a changed address needs a new price).
  const [wantsHelpr, setWantsHelpr] = useState(false);
  const [quote, setQuote] = useState<{ for: string; q: HelprQuote } | null>(null);
  const [quoting, setQuoting] = useState(false);

  const orderable = useMemo(
    // A closed or full preorder can't be ordered (its card says so). Digital downloads are bought on their own
    // (ShopDigitalBuy), never in a dated order.
    () => orderableItems(items.data, preorders.data),
    [items.data, preorders.data],
  );
  const chosen = chosenLines(orderable, options.data, qty);
  // A preorder is ordered on its own: one item, no day to pick, pickup only (v1).
  const preorder = chosen.length === 1 ? preorders.data?.get(chosen[0].item.id) ?? null : null;
  const preorderChosen = chosen.some((l) => preorders.data?.has(l.item.id));
  const leadDays = chosen.reduce((m, l) => Math.max(m, l.item.lead_time_days), 0);
  const itemsCents = chosen.reduce((sum, l) => sum + l.unit * l.n, 0);
  const t = terms.data;
  const dateProblem = t && readyDate ? readyDateProblem(readyDate, t, leadDays) : null;
  const firstDate = t ? firstOpenReadyDate(t, leadDays) : null;

  if (items.isLoading || terms.isLoading || options.isLoading || preorders.isLoading) {
    return (
      <section className="space-y-2" aria-labelledby={headId} role="status" aria-label="Loading ordering">
        <h2 id={headId} className="text-sm font-semibold">Order</h2>
        <Skeleton className="h-32 w-full rounded-2xl" />
      </section>
    );
  }
  if (terms.isError || !t || options.isError || preorders.isError) {
    return (
      <section className="space-y-2" aria-labelledby={headId}>
        <h2 id={headId} className="text-sm font-semibold">Order</h2>
        <div role="alert" className="space-y-2">
          <p className="text-sm">{shopsErrorMessage(terms.error ?? options.error ?? preorders.error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { void terms.refetch(); void options.refetch(); void preorders.refetch(); }} disabled={terms.isFetching || options.isFetching || preorders.isFetching}>
            Try again
          </Button>
        </div>
      </section>
    );
  }
  if (orderable.length === 0) return null;
  if (t.open_weekdays.length === 0) {
    return (
      <ShopsNotice title="This shop hasn't set its open days yet.">
        <p>Ordering opens once it picks the days it fills orders.</p>
      </ShopsNotice>
    );
  }

  const policy = cancelPolicyText(t.cancel_policy, t.ready_tap_cancel);
  const feeCents = itemsCents > 0 ? buyerFeeCents(itemsCents) : 0;
  const setupFeeCents = itemsCents > 0 ? setupFeeOwed : 0;
  const atHome = chosen.some((l) => l.item.at_buyer === true);
  // One address per calculation: an at-home cleaning is ordered on its own (the server refuses a mix too).
  const atHomeMixed = atHome && chosen.length > 1;
  const svcOk = svc.line1.trim().length >= 3 && svc.city.trim().length >= 2 && /^[0-9]{5}$/.test(svc.postal_code.trim()) && isLouisianaZip(svc.postal_code);
  // Restack (l106 + delivery): work done at the buyer's place has nothing to deliver (the server refuses it too).
  const delivers = offer.data?.delivers === true && !atHome && !preorderChosen;
  const helprOffered = offer.data?.helpr_delivery === true && !atHome && !preorderChosen;
  const delivering = delivers && wantsDelivery;
  const helpring = helprOffered && wantsHelpr;
  const deliveryCents = delivering ? offer.data?.fee_cents ?? 0 : 0;
  const addrProblem = delivering || helpring ? deliveryAddressProblem(addr) : null;
  const dropoff = { line1: addr.line1.trim(), ...(addr.line2.trim() ? { line2: addr.line2.trim() } : {}), city: addr.city.trim(), postal_code: addr.postal_code.trim() };
  const addrKey = JSON.stringify(dropoff);
  // The price shown is the price sent: only a quote for the address as typed now counts.
  const helprCents = helpring && quote && quote.for === addrKey ? quote.q.delivery_cents : null;
  const canSend = preorder
    ? note.length <= NOTE_MAX && !opening
    : !preorderChosen && chosen.length > 0 && !!readyDate && dateProblem === null && note.length <= NOTE_MAX && !opening && addrProblem === null
      && (!atHome || (svcOk && !atHomeMixed)) && (!helpring || helprCents !== null);
  const choose = (how: "pickup" | "shop" | "helpr") => {
    setWantsDelivery(how === "shop");
    setWantsHelpr(how === "helpr");
  };
  const lookUpHelprPrice = async () => {
    setQuoting(true);
    try {
      const q = await fetchHelprDeliveryQuote(shopId, dropoff);
      setQuote({ for: addrKey, q });
    } catch (err) {
      toast.error(shopsErrorMessage(err));
    } finally {
      setQuoting(false);
    }
  };

  const send = async () => {
    setOpening(true);
    try {
      const url = preorder ? await requestPreorder({
        shopId, itemId: preorder.item_id, quantity: chosen[0].n, readyBy: preorder.ready_by, note,
        terms: { cancel_policy: t.cancel_policy, ready_tap_cancel: t.ready_tap_cancel },
      }) : await requestOrder({
        shopId,
        lines: chosen.map((l) => (l.variantId ? { item_id: l.item.id, variant_id: l.variantId, quantity: l.n } : { item_id: l.item.id, quantity: l.n })),
        readyDate,
        note,
        // The cancel terms shown above: shop-checkout refuses (terms_changed) if the shop changed them since.
        terms: { cancel_policy: t.cancel_policy, ready_tap_cancel: t.ready_tap_cancel },
        ...(atHome ? { serviceAddress: { line1: svc.line1.trim(), city: svc.city.trim(), postal_code: svc.postal_code.trim() } } : {}),
        ...(delivering
          ? { delivery: dropoff }
          : {}),
        ...(helpring && helprCents !== null ? { delivery: dropoff, helprCents } : {}),
      });
      await openExternalUrl(url, () => {
        setOpening(false);
        void qc.invalidateQueries({ queryKey: ["shops", "my-orders"] });
        navigate("/shops/orders");
      });
    } catch (err) {
      // terms_changed included: the toast says so and the terms above reload before the buyer pays.
      toast.error(shopsErrorMessage(err));
      // delivery_rate_changed: the old Helpr price is gone; the buyer looks it up again before sending.
      if ((err as { message?: unknown } | null)?.message === "delivery_rate_changed") setQuote(null);
      setOpening(false);
      void qc.invalidateQueries({ queryKey: ["shops", "order-terms", shopId] });
      void qc.invalidateQueries({ queryKey: ["shops", "item-preorders", shopId] });
    }
  };

  return (
    <section id="shop-order-sheet" className="scroll-mt-20 space-y-4 rounded-2xl border border-border bg-card p-4" aria-labelledby={headId}>
      <div className="space-y-1">
        <h2 id={headId} className="text-sm font-semibold">Order</h2>
        {preorder ? <p className="text-xs text-muted-foreground">This is a preorder: you pay in full now.</p> : (
          <p className="text-xs text-muted-foreground">{ORDER_HOLD_TEXT}</p>
        )}
      </div>
      {/* Q2110: a buyer with Shops strikes sees them here, and at the strike limit the day Shops opens again. */}
      <ShopMyStrikes />

      <ul className="space-y-3">
        {orderable.map((i) => {
          const opts = options.data?.get(i.id);
          if (opts) {
            return (
              <ShopOrderOptions key={i.id} item={i} options={opts} qty={qty} maxPerLine={MAX_PER_LINE}
                onQty={(key, n) => setQty((q) => ({ ...q, [key]: n }))} />
            );
          }
          const pre = preorders.data?.get(i.id);
          // A preorder is ordered on its own: while one kind is chosen, the other kind's steppers stay at 0.
          const locked = (qty[i.id] ?? 0) === 0 && chosen.length > 0 && (pre ? true : preorderChosen);
          return (
            <li key={i.id} className="flex items-center justify-between gap-3" data-order-item={i.id}>
              <div className="min-w-0">
                <p className="text-sm font-semibold [overflow-wrap:anywhere]">{i.title}</p>
                <p className="text-xs text-muted-foreground">{formatItemPrice(i.price_cents)} each{pre ? ` · ${preorderLabel(pre)}` : ""}</p>
                {locked && <p className="text-xs text-muted-foreground">{pre ? "Preorders are ordered on their own." : "Order this separately from your preorder."}</p>}
              </div>
              <QuantityStepper label={i.title} max={locked ? 0 : pre ? preorderMax(pre) : maxFor(i)} value={qty[i.id] ?? 0}
                onChange={(n) => setQty((q) => ({ ...q, [i.id]: n }))} />
            </li>
          );
        })}
      </ul>

      {preorder ? null : (
      <div className="space-y-1">
        <Label htmlFor="shop-order-date">Ready date</Label>
        <DatePickerField
          id="shop-order-date"
          value={readyDate}
          onChange={setReadyDate}
          min={earliestReadyDate(t, leadDays)}
          isDateDisabled={(iso) => readyDateProblem(iso, t, leadDays) !== null}
          placeholder={firstDate ? "Pick the day you'll pick it up" : "No open days in the next 90 days"}
          aria-invalid={dateProblem !== null}
          aria-describedby="shop-order-date-help"
        />
        <p id="shop-order-date-help" className="text-xs text-muted-foreground">
          {dateProblem === "too_soon"
            ? "That's too soon for what you picked. Pick a later day."
            : dateProblem === "closed"
              ? "The shop doesn't fill orders on that day."
              : dateProblem === "full"
                ? "That day is full. Pick another day."
                : dateProblem === "too_far"
                  ? "Pick a day in the next 90 days."
                  : "Greyed-out days are closed, full or too soon."}
        </p>
      </div>
      )}

      {atHome && (
        <fieldset className="space-y-2" data-testid="shop-order-service-address">
          <legend className="text-sm font-semibold">Where the work will be done</legend>
          {atHomeMixed && (
            <p className="text-xs text-destructive-ink">Work done at your place is ordered on its own. Order the other items separately.</p>
          )}
          <div className="space-y-1">
            <Label htmlFor="shop-order-svc-line1">Street address</Label>
            <Input id="shop-order-svc-line1" autoComplete="address-line1" maxLength={120} value={svc.line1}
              onChange={(e) => setSvc((a) => ({ ...a, line1: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="shop-order-svc-city">City</Label>
              <Input id="shop-order-svc-city" autoComplete="address-level2" maxLength={60} value={svc.city}
                onChange={(e) => setSvc((a) => ({ ...a, city: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shop-order-svc-zip">ZIP code</Label>
              <Input id="shop-order-svc-zip" autoComplete="postal-code" inputMode="numeric" maxLength={5} value={svc.postal_code}
                onChange={(e) => setSvc((a) => ({ ...a, postal_code: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Louisiana only. Sales tax is figured for this address. The shop sees it only after it accepts your order.</p>
        </fieldset>
      )}

      <div className="space-y-1">
        <Label htmlFor="shop-order-note">Note for the shop (optional)</Label>
        <Textarea
          id="shop-order-note"
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Flavors, names on a cake, pickup time you'd like"
        />
        <p className="text-xs text-muted-foreground">{note.length}/{NOTE_MAX}. No phone numbers, emails or links.</p>
      </div>

      {delivers || helprOffered ? (
        <div className="space-y-2" data-testid="shop-order-delivery">
          <p className="text-sm font-semibold">How you'll get it</p>
          <div className={`grid gap-2 ${delivers && helprOffered ? "grid-cols-3" : "grid-cols-2"}`} role="group" aria-label="How you'll get it">
            <Button type="button" variant={!wantsDelivery && !wantsHelpr ? "default" : "outline"}
              className={`${!wantsDelivery && !wantsHelpr ? "btn-grad-primary " : ""}h-auto whitespace-normal py-2`}
              aria-pressed={!wantsDelivery && !wantsHelpr} onClick={() => choose("pickup")}>
              Pickup
            </Button>
            {delivers ? (
              <Button type="button" variant={wantsDelivery ? "default" : "outline"}
                className={`${wantsDelivery ? "btn-grad-primary " : ""}h-auto whitespace-normal py-2`}
                aria-pressed={wantsDelivery} onClick={() => choose("shop")}>
                {`Delivery, ${offer.data && offer.data.fee_cents > 0 ? formatCents(offer.data.fee_cents) : "free"}`}
              </Button>
            ) : null}
            {helprOffered ? (
              <Button type="button" variant={wantsHelpr ? "default" : "outline"}
                className={`${wantsHelpr ? "btn-grad-primary " : ""}h-auto whitespace-normal py-2`}
                aria-pressed={wantsHelpr} onClick={() => choose("helpr")}>
                Helpr delivery
              </Button>
            ) : null}
          </div>
          {delivering || helpring ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {helpring
                  ? "A Helpr picks it up at the shop and brings it to you: $6 plus $1.50 a mile, within 50 miles. The shop and the Helpr see your address only after the shop accepts."
                  : `The shop delivers within ${offer.data?.radius_miles} miles. It sees your address only after it accepts the order.`}
              </p>
              <div className="space-y-1">
                <Label htmlFor="shop-order-addr1">Street address</Label>
                <Input id="shop-order-addr1" autoComplete="address-line1" value={addr.line1} onChange={(e) => setAddr((a) => ({ ...a, line1: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="shop-order-addr2">Apt, suite (optional)</Label>
                <Input id="shop-order-addr2" autoComplete="address-line2" value={addr.line2} onChange={(e) => setAddr((a) => ({ ...a, line2: e.target.value }))} />
              </div>
              <div className="grid grid-cols-[1fr_8rem] gap-2">
                <div className="space-y-1">
                  <Label htmlFor="shop-order-city">City</Label>
                  <Input id="shop-order-city" autoComplete="address-level2" value={addr.city} onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="shop-order-zip">ZIP</Label>
                  <Input id="shop-order-zip" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={addr.postal_code}
                    onChange={(e) => setAddr((a) => ({ ...a, postal_code: e.target.value }))} />
                </div>
              </div>
              {addrProblem && (addr.line1 || addr.city || addr.postal_code) ? (
                <p className="text-xs text-muted-foreground">{addrProblem}</p>
              ) : null}
              {helpring ? (
                <div className="flex items-center justify-between gap-2" data-testid="shop-order-helpr-price">
                  <p className="text-sm" aria-live="polite">
                    {helprCents !== null && quote
                      ? `Helpr delivery: ${formatCents(helprCents)} for ${quote.q.delivery_miles} ${quote.q.delivery_miles === 1 ? "mile" : "miles"}`
                      : "See the price for this address before you send the order."}
                  </p>
                  <Button type="button" variant="outline" size="sm" disabled={addrProblem !== null || quoting || helprCents !== null}
                    onClick={() => void lookUpHelprPrice()}>
                    {quoting ? "Looking…" : "See the price"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {delivering || helpring ? null : <HandoverModeNote shopId={shopId} />}
      {preorder ? <PreorderChargeBox preorder={preorder} /> : (
        <div className="space-y-1 rounded-xl bg-muted/60 p-3" data-testid="shop-order-cancel-policy">
          <p className="text-sm font-semibold">{policy.label}</p>
          <p className="text-xs text-muted-foreground">{policy.detail}</p>
        </div>
      )}

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between"><dt>Items</dt><dd>{formatCents(itemsCents)}</dd></div>
        {delivering ? <div className="flex justify-between"><dt>Shop delivery</dt><dd>{deliveryCents > 0 ? formatCents(deliveryCents) : "Free"}</dd></div> : null}
        {helpring && helprCents !== null ? <div className="flex justify-between"><dt>Helpr delivery</dt><dd>{formatCents(helprCents)}</dd></div> : null}
        {/* Shops audit 11-08 #8: shop-checkout adds the first-time setup fee as its own line (Declutter's BuyerTotal rule). */}
        {setupFeeCents > 0 ? <div className="flex justify-between"><dt>One-time account setup fee</dt><dd data-testid="shop-order-setup-fee">{formatCents(setupFeeCents)}</dd></div> : null}
        <div className="flex justify-between font-semibold"><dt>Total before tax</dt><dd data-testid="shop-order-total">{formatCents(itemsCents + feeCents + deliveryCents + (helprCents ?? 0) + setupFeeCents)}</dd></div>
        {/* S010 (Shops audit 11-12): no fee row or formula (10-25 rule); the total says in words a service fee is in it. */}
        <p className="text-xs text-muted-foreground" data-testid="shop-order-fee-words">{`${SHOP_SERVICE_FEE_INCLUDED} ${setupFeeKnown ? "Sales tax is added at checkout." : "Sales tax and any one-time setup fee are added at checkout."}`}</p>
      </dl>

      <Button type="button" className="btn-grad-primary w-full" disabled={!canSend} onClick={() => void send()}>
        {opening ? "Opening…" : preorder ? "Pay now and preorder" : "Hold my card and send the order"}
      </Button>
    </section>
  );
}
