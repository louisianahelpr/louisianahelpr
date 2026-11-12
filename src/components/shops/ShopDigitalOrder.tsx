/**
 * A digital download on an order card (owner 11-08; migrations 20261108182917 + 20261108185110).
 * Buyer: one Download button per file (a fresh 10-minute link per tap, from shop-digital), for as long as the account
 * exists; and, in the 72 hours after buying, "Report a problem with the file" (broken or not as described only).
 * Shop: what it gets and when (72 hours after the sale unless the buyer reports a problem).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeRadio } from "@/components/ui/NativeRadio";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { formatCents, setupFeeChargedCents, SHOP_SERVICE_FEE_INCLUDED, type ShopOrder } from "@/lib/shops/orders";
import {
  digitalDownloadUrl,
  digitalReportHoursLeft,
  fetchOrderDigitalFiles,
  fileSizeLabel,
  reportDigitalProblem,
} from "@/lib/shops/digitalFiles";
import { shopsErrorMessage } from "@/lib/shops/errors";

export default function ShopDigitalOrder({ order, side }: { order: ShopOrder; side: "buyer" | "shop" }) {
  const paid = !!order.captured_at && (order.status === "accepted" || order.status === "handed_over");
  if (side === "shop") {
    return (
      <p className="text-xs text-muted-foreground" data-testid="shop-digital-order-shop">
        Digital download. Your price: {formatCents(order.items_cents)}
        {order.status === "accepted" ? ", 72 hours after the sale unless the buyer reports a problem with the file." : "."}
      </p>
    );
  }
  return (
    <div className="space-y-2" data-testid="shop-digital-order">
      <p className="text-xs text-muted-foreground">
        Download {formatCents(order.items_cents)}
        {order.tax_cents > 0 ? ` + tax ${formatCents(order.tax_cents)}` : ""}
        {setupFeeChargedCents(order) > 0 ? ` + one-time account setup fee ${formatCents(setupFeeChargedCents(order))}` : ""}.
        {` ${SHOP_SERVICE_FEE_INCLUDED}`}
      </p>
      {paid ? <BuyerFiles order={order} /> : null}
    </div>
  );
}

function BuyerFiles({ order }: { order: ShopOrder }) {
  const qc = useQueryClient();
  const files = useQuery({ queryKey: ["shops", "order-digital-files", order.id], queryFn: () => fetchOrderDigitalFiles(order.id) });
  const open = useMutation({
    mutationFn: (fileId: string) => digitalDownloadUrl(fileId),
    // A fresh link each tap: it starts the download in the browser (or the share sheet in the app).
    onSuccess: (url) => window.open(url, "_blank", "noopener"),
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const hoursLeft = digitalReportHoursLeft(order.captured_at);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<"broken" | "not_as_described">("broken");
  const [note, setNote] = useState("");
  const report = useMutation({
    mutationFn: () => reportDigitalProblem(order.id, reason, note),
    onSuccess: () => {
      toast("Reported. Louisiana Helpr will look at it before the shop is paid.");
      setReporting(false);
      void qc.invalidateQueries({ queryKey: ["shops", "orders"] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  if (files.isError) {
    return (
      <div role="alert" className="space-y-1">
        <ReportErrorScreen source="ShopDigitalOrder.files" title="We couldn't load your download." />
        <p className="text-sm">We couldn't load your download.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void files.refetch()}>Try again</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {(files.data ?? []).map((f) => (
          <li key={f.file_id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2">
            <FileDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm">{f.file_name}</span>
            <span className="text-xs text-muted-foreground">{fileSizeLabel(f.byte_size)}</span>
            <Button type="button" size="sm" className="btn-grad-primary" disabled={open.isPending} onClick={() => open.mutate(f.file_id)}>
              Download
            </Button>
          </li>
        ))}
      </ul>
      {order.status === "accepted" && hoursLeft > 0 && !reporting && (
        <InlineTextButton onClick={() => setReporting(true)}>Report a problem with the file</InlineTextButton>
      )}
      {reporting && (
        <div className="space-y-2 rounded-xl border border-border p-3" data-testid="shop-digital-report">
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">What's wrong? ({hoursLeft} hours left to report)</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <NativeRadio name={`dl-reason-${order.id}`} checked={reason === "broken"} onChange={() => setReason("broken")} />
              The file is broken or won't open
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <NativeRadio name={`dl-reason-${order.id}`} checked={reason === "not_as_described"} onChange={() => setReason("not_as_described")} />
              It's not what the listing described
            </label>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor={`dl-note-${order.id}`}>Tell us what happened</Label>
            <Textarea id={`dl-note-${order.id}`} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setReporting(false)}>Cancel</Button>
            <Button type="button" size="sm" disabled={report.isPending || note.trim().length === 0} onClick={() => report.mutate()}>
              Send report
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
