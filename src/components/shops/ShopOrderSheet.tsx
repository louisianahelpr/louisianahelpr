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
 * The server re-checks every rule (shops_request_order): nothing here is the
 * protection. Styling is today's shared components only (no visual pass yet).
 */
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { DatePickerField } from "@/components/DatePickerField";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { fetchShopItems, formatItemPrice, type ShopItem } from "@/lib/shops/items";
import { fetchItemOptions } from "@/lib/shops/variants";
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
} from "@/lib/shops/orders";
import { isLouisianaZip } from "@/lib/shipping/policy";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopsNotice } from "./shopsUi";
import { HandoverModeNote } from "./ShopHandoverModePicker";
import ShopOrderOptions, { lineKey, QuantityStepper } from "./ShopOrderOptions";

const MAX_PER_LINE = 20;
const NOTE_MAX = 500;

function maxFor(item: ShopItem): number {
  return item.stock_count == null ? MAX_PER_LINE : Math.min(MAX_PER_LINE, item.stock_count);
}

export default function ShopOrderSheet({ shopId }: { shopId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // One heading id per instance (A0-L1), for whichever state is showing.
  const headId = useId();
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId), enabled: !!shopId });
  const terms = useQuery({ queryKey: ["shops", "order-terms", shopId], queryFn: () => fetchOrderTerms(shopId), enabled: !!shopId });
  // Items with option lists (variants): their combinations, prices and stock.
  const options = useQuery({ queryKey: ["shops", "item-options", shopId], queryFn: () => fetchItemOptions(shopId), enabled: !!shopId });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [readyDate, setReadyDate] = useState("");
  const [note, setNote] = useState("");
  const [opening, setOpening] = useState(false);
  // H8 (b): where an at-home carpet or furniture cleaning is done (taxed there).
  const [svc, setSvc] = useState({ line1: "", city: "", postal_code: "" });

  const orderable = useMemo(
    () => (items.data ?? []).filter((i) => i.status === "live" && (i.stock_count == null || i.stock_count > 0)),
    [items.data],
  );
  // Each chosen line: a plain item, or one combination of an item with option lists (keyed item:variant).
  const chosen = orderable.flatMap((i) => {
    const opts = options.data?.get(i.id);
    if (!opts) return (qty[i.id] ?? 0) > 0 ? [{ item: i, variantId: null as string | null, unit: i.price_cents, n: qty[i.id] }] : [];
    return opts.variants
      .filter((v) => v.active && (qty[lineKey(i.id, v.id)] ?? 0) > 0)
      .map((v) => ({ item: i, variantId: v.id as string | null, unit: v.price_cents, n: qty[lineKey(i.id, v.id)] }));
  });
  const leadDays = chosen.reduce((m, l) => Math.max(m, l.item.lead_time_days), 0);
  const itemsCents = chosen.reduce((sum, l) => sum + l.unit * l.n, 0);
  const t = terms.data;
  const dateProblem = t && readyDate ? readyDateProblem(readyDate, t, leadDays) : null;
  const firstDate = t ? firstOpenReadyDate(t, leadDays) : null;

  if (items.isLoading || terms.isLoading || options.isLoading) {
    return (
      <section className="space-y-2" aria-labelledby={headId} role="status" aria-label="Loading ordering">
        <h2 id={headId} className="text-sm font-semibold">Order</h2>
        <Skeleton className="h-32 w-full rounded-2xl" />
      </section>
    );
  }
  if (terms.isError || !t || options.isError) {
    return (
      <section className="space-y-2" aria-labelledby={headId}>
        <h2 id={headId} className="text-sm font-semibold">Order</h2>
        <div role="alert" className="space-y-2">
          <p className="text-sm">{shopsErrorMessage(terms.error ?? options.error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { void terms.refetch(); void options.refetch(); }} disabled={terms.isFetching || options.isFetching}>
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
  const atHome = chosen.some((l) => l.item.at_buyer === true);
  // One address per calculation: an at-home cleaning is ordered on its own (the server refuses a mix too).
  const atHomeMixed = atHome && chosen.length > 1;
  const svcOk = svc.line1.trim().length >= 3 && svc.city.trim().length >= 2 && /^[0-9]{5}$/.test(svc.postal_code.trim()) && isLouisianaZip(svc.postal_code);
  const canSend = chosen.length > 0 && !!readyDate && dateProblem === null && note.length <= NOTE_MAX && !opening
    && (!atHome || (svcOk && !atHomeMixed));

  const send = async () => {
    setOpening(true);
    try {
      const url = await requestOrder({
        shopId,
        lines: chosen.map((l) => (l.variantId ? { item_id: l.item.id, variant_id: l.variantId, quantity: l.n } : { item_id: l.item.id, quantity: l.n })),
        readyDate,
        note,
        // The cancel terms shown above: shop-checkout refuses (terms_changed) if the shop changed them since.
        terms: { cancel_policy: t.cancel_policy, ready_tap_cancel: t.ready_tap_cancel },
        ...(atHome ? { serviceAddress: { line1: svc.line1.trim(), city: svc.city.trim(), postal_code: svc.postal_code.trim() } } : {}),
      });
      await openExternalUrl(url, () => {
        setOpening(false);
        void qc.invalidateQueries({ queryKey: ["shops", "my-orders"] });
        navigate("/shops/orders");
      });
    } catch (err) {
      // terms_changed included: the toast says so and the terms above reload before the buyer pays.
      toast.error(shopsErrorMessage(err));
      setOpening(false);
      void qc.invalidateQueries({ queryKey: ["shops", "order-terms", shopId] });
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4" aria-labelledby={headId}>
      <div className="space-y-1">
        <h2 id={headId} className="text-sm font-semibold">Order</h2>
        <p className="text-xs text-muted-foreground">{ORDER_HOLD_TEXT}</p>
      </div>

      <ul className="space-y-3">
        {orderable.map((i) => {
          const opts = options.data?.get(i.id);
          if (opts) {
            return (
              <ShopOrderOptions key={i.id} item={i} options={opts} qty={qty} maxPerLine={MAX_PER_LINE}
                onQty={(key, n) => setQty((q) => ({ ...q, [key]: n }))} />
            );
          }
          return (
            <li key={i.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold [overflow-wrap:anywhere]">{i.title}</p>
                <p className="text-xs text-muted-foreground">{formatItemPrice(i.price_cents)} each</p>
              </div>
              <QuantityStepper label={i.title} max={maxFor(i)} value={qty[i.id] ?? 0} onChange={(n) => setQty((q) => ({ ...q, [i.id]: n }))} />
            </li>
          );
        })}
      </ul>

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

      {atHome && (
        <fieldset className="space-y-2" data-testid="shop-order-service-address">
          <legend className="text-sm font-semibold">Where the work will be done</legend>
          {atHomeMixed && (
            <p className="text-xs text-destructive">Work done at your place is ordered on its own. Order the other items separately.</p>
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

      <HandoverModeNote shopId={shopId} />
      <div className="space-y-1 rounded-xl bg-muted/60 p-3" data-testid="shop-order-cancel-policy">
        <p className="text-sm font-semibold">{policy.label}</p>
        <p className="text-xs text-muted-foreground">{policy.detail}</p>
      </div>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between"><dt>Items</dt><dd>{formatCents(itemsCents)}</dd></div>
        <div className="flex justify-between"><dt>Service fee (5% + $0.70)</dt><dd>{formatCents(feeCents)}</dd></div>
        <div className="flex justify-between font-semibold"><dt>Total</dt><dd data-testid="shop-order-total">{formatCents(itemsCents + feeCents)}</dd></div>
        <p className="text-xs text-muted-foreground">Sales tax is added at checkout.</p>
      </dl>

      <Button type="button" className="btn-grad-primary w-full" disabled={!canSend} onClick={() => void send()}>
        {opening ? "Opening…" : "Hold my card and send the order"}
      </Button>
    </section>
  );
}
