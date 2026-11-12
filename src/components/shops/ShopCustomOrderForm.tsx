/**
 * Custom orders (20261106205852): the buyer orders the shop's price. They pick a ready date (from tomorrow to 90 days
 * out, on a day the shop fills orders and not a full day: the same rules shops_order_custom_quote applies), read the
 * shop's cancel rule BEFORE paying, and are sent to Stripe's page (shop-checkout 'order' with custom_request_id).
 * Pickup only for now. The server re-checks every rule; nothing here is the protection.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DatePickerField } from "@/components/DatePickerField";
import { openExternalUrl } from "@/lib/openExternalUrl";
import type { CustomRequest } from "@/lib/shops/customRequests";
import {
  buyerFeeCents,
  cancelPolicyText,
  CUSTOM_ORDER_LEAD_DAYS,
  earliestReadyDate,
  fetchOrderTerms,
  firstOpenReadyDate,
  formatCents,
  ORDER_HOLD_TEXT,
  readyDateProblem,
  requestCustomOrder,
  SHOP_SERVICE_FEE_INCLUDED,
} from "@/lib/shops/orders";
import { shopsErrorMessage } from "@/lib/shops/errors";

/** The payment line for the request's plan: today's card hold, or half now and the rest on the ready date. */
export const CUSTOM_ORDER_PAY_TEXT: Record<CustomRequest["payment_plan"], string> = {
  full_hold: ORDER_HOLD_TEXT,
  deposit_50: "Half is charged when the shop accepts, and the rest on the ready date to the same card.",
};

export default function ShopCustomOrderForm({ request, onDone }: { request: CustomRequest; onDone: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const shopId = request.shop_id;
  const terms = useQuery({ queryKey: ["shops", "order-terms", shopId], queryFn: () => fetchOrderTerms(shopId) });
  const [readyDate, setReadyDate] = useState("");
  const [opening, setOpening] = useState(false);
  const t = terms.data;
  const lead = CUSTOM_ORDER_LEAD_DAYS;
  const dateProblem = t && readyDate ? readyDateProblem(readyDate, t, lead) : null;
  const firstDate = t ? firstOpenReadyDate(t, lead) : null;
  const price = request.quote_cents ?? 0;
  const id = (s: string) => `custom-order-${request.id}-${s}`;

  if (terms.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading the shop's days…</p>;
  if (terms.isError || !t) {
    return (
      <div className="space-y-2" role="alert">
        <p className="text-sm">{shopsErrorMessage(terms.error)}</p>
        <Button type="button" size="sm" variant="outline" disabled={terms.isFetching} onClick={() => void terms.refetch()}>Try again</Button>
      </div>
    );
  }
  const policy = cancelPolicyText(t.cancel_policy, t.ready_tap_cancel);
  const canSend = !!readyDate && dateProblem === null && !opening && price > 0;

  const send = async () => {
    setOpening(true);
    try {
      const url = await requestCustomOrder({
        requestId: request.id, shopId, readyDate, note: "",
        // The cancel terms shown below: shop-checkout refuses (terms_changed) if the shop changed them since.
        terms: { cancel_policy: t.cancel_policy, ready_tap_cancel: t.ready_tap_cancel },
      });
      await openExternalUrl(url, () => {
        setOpening(false);
        void qc.invalidateQueries({ queryKey: ["shops", "my-orders"] });
        void qc.invalidateQueries({ queryKey: ["shops", "custom-requests"] });
        onDone();
        navigate("/shops/orders");
      });
    } catch (err) {
      toast.error(shopsErrorMessage(err));
      setOpening(false);
      void qc.invalidateQueries({ queryKey: ["shops", "order-terms", shopId] });
      void qc.invalidateQueries({ queryKey: ["shops", "custom-requests"] });
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-3" data-testid="shop-custom-order-form">
      <div className="space-y-1">
        <Label htmlFor={id("date")}>Ready date</Label>
        <DatePickerField
          id={id("date")}
          value={readyDate}
          onChange={setReadyDate}
          min={earliestReadyDate(t, lead)}
          isDateDisabled={(iso) => readyDateProblem(iso, t, lead) !== null}
          placeholder={firstDate ? "Pick the day you'll pick it up" : "No open days in the next 90 days"}
          aria-invalid={dateProblem !== null}
          aria-describedby={id("date-help")}
        />
        <p id={id("date-help")} className="text-xs text-muted-foreground">
          {dateProblem === "too_soon"
            ? "Pick a day from tomorrow on."
            : dateProblem === "closed"
              ? "The shop doesn't fill orders on that day."
              : dateProblem === "full"
                ? "That day is full. Pick another day."
                : dateProblem === "too_far"
                  ? "Pick a day in the next 90 days."
                  : "Greyed-out days are closed or full."}
        </p>
      </div>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-2"><dt>Price</dt><dd>{formatCents(price)}</dd></div>
        <div className="flex justify-between gap-2 font-semibold"><dt>You pay before tax</dt><dd data-testid="shop-custom-order-total">{formatCents(price + buyerFeeCents(price))}</dd></div>
        <p className="text-xs text-muted-foreground">{`${SHOP_SERVICE_FEE_INCLUDED} Any sales tax is added on the payment page.`}</p>
      </dl>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{`Cancel rule: ${policy.label}`}</p>
        <p className="text-xs text-muted-foreground">{policy.detail}</p>
      </div>
      <p className="text-xs text-muted-foreground">{CUSTOM_ORDER_PAY_TEXT[request.payment_plan]}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={opening} onClick={onDone}>Cancel</Button>
        <Button type="button" className="btn-grad-primary" disabled={!canSend} onClick={() => void send()}>
          {opening ? "Opening the payment page…" : "Go to payment"}
        </Button>
      </div>
    </div>
  );
}
