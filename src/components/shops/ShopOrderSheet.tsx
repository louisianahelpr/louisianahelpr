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
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DatePickerField } from "@/components/DatePickerField";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { fetchShopItems, formatItemPrice, type ShopItem } from "@/lib/shops/items";
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
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopsNotice } from "./shopsUi";
import { HandoverModeNote } from "./ShopHandoverModePicker";

const MAX_PER_LINE = 20;
const NOTE_MAX = 500;

function maxFor(item: ShopItem): number {
  return item.stock_count == null ? MAX_PER_LINE : Math.min(MAX_PER_LINE, item.stock_count);
}

function QuantityStepper({ item, value, onChange }: { item: ShopItem; value: number; onChange: (n: number) => void }) {
  const max = maxFor(item);
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`How many ${item.title}`}>
      <Button type="button" size="icon" variant="outline" aria-label={`One less ${item.title}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
        <Minus className="h-4 w-4" aria-hidden />
      </Button>
      <span className="w-6 text-center text-sm font-semibold" aria-live="polite">{value}</span>
      <Button type="button" size="icon" variant="outline" aria-label={`One more ${item.title}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

export default function ShopOrderSheet({ shopId }: { shopId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId), enabled: !!shopId });
  const terms = useQuery({ queryKey: ["shops", "order-terms", shopId], queryFn: () => fetchOrderTerms(shopId), enabled: !!shopId });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [readyDate, setReadyDate] = useState("");
  const [note, setNote] = useState("");
  const [opening, setOpening] = useState(false);

  const orderable = useMemo(
    () => (items.data ?? []).filter((i) => i.status === "live" && (i.stock_count == null || i.stock_count > 0)),
    [items.data],
  );
  const chosen = orderable.filter((i) => (qty[i.id] ?? 0) > 0);
  const leadDays = chosen.reduce((m, i) => Math.max(m, i.lead_time_days), 0);
  const itemsCents = chosen.reduce((sum, i) => sum + i.price_cents * (qty[i.id] ?? 0), 0);
  const t = terms.data;
  const dateProblem = t && readyDate ? readyDateProblem(readyDate, t, leadDays) : null;
  const firstDate = t ? firstOpenReadyDate(t, leadDays) : null;

  if (items.isLoading || terms.isLoading) {
    return (
      <section className="space-y-2" aria-labelledby="shop-order" role="status" aria-label="Loading ordering">
        <h2 id="shop-order" className="text-sm font-semibold">Order</h2>
        <Skeleton className="h-32 w-full rounded-2xl" />
      </section>
    );
  }
  if (terms.isError || !t) {
    return (
      <section className="space-y-2" aria-labelledby="shop-order">
        <h2 id="shop-order" className="text-sm font-semibold">Order</h2>
        <div role="alert" className="space-y-2">
          <p className="text-sm">{shopsErrorMessage(terms.error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void terms.refetch()} disabled={terms.isFetching}>
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
  const canSend = chosen.length > 0 && !!readyDate && dateProblem === null && note.length <= NOTE_MAX && !opening;

  const send = async () => {
    setOpening(true);
    try {
      const url = await requestOrder({
        shopId,
        lines: chosen.map((i) => ({ item_id: i.id, quantity: qty[i.id] ?? 0 })),
        readyDate,
        note,
      });
      await openExternalUrl(url, () => {
        setOpening(false);
        void qc.invalidateQueries({ queryKey: ["shops", "my-orders"] });
        navigate("/shops/orders");
      });
    } catch (err) {
      toast.error(shopsErrorMessage(err));
      setOpening(false);
      void qc.invalidateQueries({ queryKey: ["shops", "order-terms", shopId] });
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4" aria-labelledby="shop-order">
      <div className="space-y-1">
        <h2 id="shop-order" className="text-sm font-semibold">Order</h2>
        <p className="text-xs text-muted-foreground">{ORDER_HOLD_TEXT}</p>
      </div>

      <ul className="space-y-3">
        {orderable.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold [overflow-wrap:anywhere]">{i.title}</p>
              <p className="text-xs text-muted-foreground">{formatItemPrice(i.price_cents)} each</p>
            </div>
            <QuantityStepper item={i} value={qty[i.id] ?? 0} onChange={(n) => setQty((q) => ({ ...q, [i.id]: n }))} />
          </li>
        ))}
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
