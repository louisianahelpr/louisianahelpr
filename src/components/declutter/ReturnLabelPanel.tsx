/**
 * The buyer's return label on a shipped order (20261103212046). An admin asks for the item back after a refund for
 * damaged or not as described (declutter_admin_request_return_label); the worker buys the label and the buyer's
 * notice says "Print it from your order". This is that place: on the buyer's card of a shipped order, while
 * declutter_shipping is on for them. No return asked (the server's order_not_found) shows nothing at all.
 * Guard: src/components/declutter/returnLabelPanel.test.tsx.
 */
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useFeature } from "@/hooks/useFeature";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchMyReturnLabel, returnLabelKey } from "@/lib/declutter/returnLabel";

export function ReturnLabelPanel({ orderId }: { orderId: string }) {
  const on = useFeature("declutter_shipping");
  const q = useQuery({ queryKey: returnLabelKey(orderId), queryFn: () => fetchMyReturnLabel(orderId), enabled: on });
  if (!on || q.isPending) return null;
  if (q.isError) {
    return <ErrorState variant="inline" title="We couldn't load your return label." body={declutterErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  }
  const r = q.data;
  if (!r) return null;
  if (r.state === "requested") {
    return <p className="text-ds-13 text-muted-foreground" data-return-label="requested">Your return label is being made. It shows here when it's ready.</p>;
  }
  if (r.state === "failed" || !r.label_url) {
    return <p className="text-ds-13 text-muted-foreground" data-return-label="failed">We couldn't make your return label. Louisiana Helpr will message you about sending the item back.</p>;
  }
  const url = r.label_url;
  return (
    <div className="space-y-2 rounded-ds-sm border border-border p-3" data-return-label="ready">
      <p className="text-ds-14 font-semibold">Send the item back</p>
      <p className="text-ds-13 text-muted-foreground">
        Print the label, tape it to the package and drop it at the post office. You don't pay for it.
      </p>
      {r.tracking_code && <p className="text-ds-13 text-muted-foreground">Return tracking <span className="font-mono">{r.tracking_code}</span></p>}
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => void openExternalUrl(url)} data-print-return-label="">
          Print return label
        </Button>
      </div>
    </div>
  );
}
