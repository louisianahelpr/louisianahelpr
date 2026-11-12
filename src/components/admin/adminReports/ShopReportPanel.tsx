/**
 * A shop or shop-item report in the admin reports queue (Shops H2, 20261105182210): the copy the report kept, a link
 * to the shop, and the one action that fits. "Hide Shop" hides the whole shop (shops_admin_set_hidden; the owner
 * reads the reason) and "Take It Down" takes the item off the shop (shops_admin_take_down_item: rejected with the
 * reason, the owner told, the 30-day re-check starts). Either resolves the report.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogDestructiveAction,
  DialogFooter,
  DialogHero,
  DialogSecondaryAction,
} from "@/components/ui/dialog";
import type { ReportedShop } from "@/lib/shops/reports";
import { shopCanComeDown } from "./reportedShops";

const errorWords = (err: unknown) =>
  (err as { userMessage?: string } | null)?.userMessage ?? "That didn't work. Refresh the reports list and try again.";

export function ShopReportPanel({ shop, reportId, content, open: reportOpen, onDone }: {
  shop: ReportedShop | undefined;
  reportId: string;
  content: string | null | undefined;
  /** The report is still pending or being looked at. */
  open: boolean;
  onDone: () => void;
}) {
  const [dialog, setDialog] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const isItem = shop?.kind === "shop_item";
  const isMessage = shop?.kind === "shop_talk_message";
  const submit = async () => {
    if (!shop) return;
    setBusy(true);
    try {
      const api = await import("@/lib/shops/reports");
      if (isItem) await api.takeDownShopItem(shop.reported_id, note.trim(), reportId);
      else await api.hideReportedShop(shop.shop_id, note.trim(), reportId);
      toast(isItem ? "Item taken down. Its owner was told why." : "Shop hidden. Its owner sees your reason.");
      setDialog(false);
      onDone();
    } catch (err) {
      toast.error(errorWords(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-ds-sm bg-muted/50 p-3 text-ds-11" data-shop-report={shop?.kind ?? "gone"}>
      {content && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><span className="font-semibold">Reported {isMessage ? "message" : isItem ? "item" : "shop"}: </span>{content}</p>}
      {shop && !isMessage && !shopCanComeDown(shop) && (
        <p className="font-semibold">{isItem ? "This item is already off the shop." : "This shop is already hidden."}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {shop && (
          <Button size="sm" variant="outline" asChild>
            <Link to={`/shops/${shop.shop_id}`}>View Shop</Link>
          </Button>
        )}
        {shop && reportOpen && shopCanComeDown(shop) && (
          <Button size="sm" variant="outline" className="text-destructive-ink hover:text-destructive-ink" onClick={() => { setNote(""); setDialog(true); }}>
            {isItem ? "Take It Down" : "Hide Shop"}
          </Button>
        )}
      </div>
      <Dialog open={dialog} onOpenChange={(o) => { if (!busy) setDialog(o); }}>
        <DialogContent role="alertdialog">
          <DialogHero title={isItem ? "Take this item down?" : "Hide this shop?"} />
          <DialogDescription>
            {isItem
              ? `"${shop?.label ?? "This item"}" comes off the shop now, and the owner's next items are checked for 30 days. Orders already placed carry on. The owner reads your reason.`
              : `"${shop?.label ?? "This shop"}" leaves Shops now: members can no longer find it or open its page. Open orders are refunded in full, and orders still waiting are cancelled with no charge. The owner reads your reason.`}
          </DialogDescription>
          <Textarea aria-label="Reason the owner reads" value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <DialogSecondaryAction disabled={busy}>Cancel</DialogSecondaryAction>
            <DialogDestructiveAction onClick={submit} disabled={busy || note.trim().length < 3}>
              {busy ? "Working…" : isItem ? "Take It Down" : "Hide Shop"}
            </DialogDestructiveAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
