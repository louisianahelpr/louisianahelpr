/**
 * The handover part of one Shops order card (Shops M2, migration
 * 20261018211820; owner pop-up 2026-10-18: the shop picks "left out" or "in
 * person", NO codes anywhere).
 *
 *   Shop: "Mark ready" (left out: a photo is required; in person: optional),
 *         in person "Handed over" from the ready date, and once handed over the
 *         payout line. The shop can NEVER finish its own order (owner
 *         2026-10-18 ~21:00Z): its "Handed over" (or left-out photo) only starts
 *         the buyer's 48 hours (H5, Declutter's 10-30 rule).
 *   Buyer: "I got it" (the shop is paid), "I didn't get it" (the money waits
 *         for Louisiana Helpr), and the shop's ready photo.
 *
 * Services and at-home work (shops audit 11-08 #3): always in person on the
 * server; the shop taps "Mark complete" (no ready photo), the buyer "It's done" or
 * "Something's wrong", and the 48-hour auto-confirm runs from the shop's tap.
 *
 * Loads its own handover row (one small query per card), so the screens keep
 * their one loading gate.
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import type { ShopOrder } from "@/lib/shops/orders";
import {
  confirmPickup,
  fetchHandovers,
  fetchMyShopPayouts,
  markHandedOver,
  markReady,
  payoutText,
  readyPhotoUrl,
  reportNotReceived,
  uploadReadyPhoto,
} from "@/lib/shops/handover";
import { addDays, preorderReadyFrom, shortDate } from "@/lib/shops/preorders";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { handoverIntro, handoverWords, isServiceOrder } from "@/lib/shops/handoverWords";

const NOTE_MAX = 500;

/** Today in Louisiana (ready dates are local dates; the server uses shop_local_today()). */
function louisianaToday(now: number = Date.now()): string {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export function ShopHandoverActions({ order, side, userId }: { order: ShopOrder; side: "buyer" | "shop"; userId: string }) {
  const qc = useQueryClient();
  const fileId = useId();
  const [confirming, setConfirming] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  // S018 (Shops audit 11-12): one optional photo with the problem report, kept on the device until "Report it".
  const [problemPhoto, setProblemPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const open = order.status === "accepted" && !!order.captured_at;
  // Services and at-home work: "Mark complete" (the jobs card owns the name "Mark done", AppliedJobCard.doneFloorFace guard), never a ready photo (shops audit 11-08 #3; the server keeps them in person).
  const service = isServiceOrder(order);
  const w = handoverWords(order);
  const handover = useQuery({
    queryKey: ["shops", "handover", order.id],
    queryFn: async () => (await fetchHandovers([order.id])).get(order.id) ?? null,
    enabled: open || order.status === "handed_over",
  });
  const payouts = useQuery({
    queryKey: ["shops", "payouts"],
    queryFn: fetchMyShopPayouts,
    enabled: side === "shop" && order.status === "handed_over",
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["shops", "handover", order.id] });
    void qc.invalidateQueries({ queryKey: ["shops", side === "shop" ? "shop-orders" : "my-orders"] });
    void qc.invalidateQueries({ queryKey: ["shops", "payouts"] });
  };
  const onError = (err: unknown) => {
    toast.error(shopsErrorMessage(err));
    refresh();
  };

  const ready = useMutation({
    mutationFn: async (file: File | null) => markReady(order.id, file ? await uploadReadyPhoto(userId, order.id, file) : null),
    onSuccess: () => { toast.success("Marked ready. The buyer is told."); refresh(); },
    onError,
  });
  const handedOver = useMutation({
    mutationFn: () => markHandedOver(order.id),
    onSuccess: () => {
      toast(w.shopDoneToast);
      setHandingOver(false);
      refresh();
    },
    onError: (err) => { setHandingOver(false); onError(err); },
  });
  const finish = useMutation({
    mutationFn: () => confirmPickup(order.id),
    onSuccess: () => {
      toast.success("Thanks. The order is done.");
      setConfirming(false);
      refresh();
    },
    onError: (err) => { setConfirming(false); onError(err); },
  });
  const report = useMutation({
    mutationFn: () => reportNotReceived(order.id, note, problemPhoto ? { userId, file: problemPhoto } : null),
    onSuccess: () => {
      toast.success("Reported. Louisiana Helpr looks at it before anyone is paid.");
      setReporting(false);
      setNote("");
      setProblemPhoto(null);
      refresh();
    },
    onError,
  });
  const photo = useMutation({
    mutationFn: async (path: string) => {
      const url = await readyPhotoUrl(path);
      if (!url) throw Object.assign(new Error("photo_unavailable"), { userMessage: "We couldn't open the photo. Try again." });
      return url;
    },
    onSuccess: (url) => setPhotoUrl(url),
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const reportDialog = (
    <BrandConfirmDialog
      open={reporting}
      onOpenChange={(o) => { if (!o) setReporting(false); }}
      title={service ? "Problem with the work?" : "Didn't get your order?"}
      description="Nobody is paid until Louisiana Helpr looks at it."
      primaryLabel={report.isPending ? "Sending…" : "Report it"}
      primaryDisabled={report.isPending || !note.trim()}
      onPrimary={(e) => {
        e.preventDefault();
        report.mutate();
      }}
      secondaryLabel="Cancel"
    >
      <div className="space-y-1">
        <Label htmlFor={`${fileId}-note`}>What happened?</Label>
        <Textarea id={`${fileId}-note`} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder={w.buyerProblemPlaceholder} />
      </div>
      <div className="space-y-1" data-testid="shop-problem-photo">
        <input
          id={`${fileId}-problem-photo`}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={report.isPending}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (f) setProblemPhoto(f);
          }}
        />
        {problemPhoto ? (
          <p className="flex items-center gap-2 text-xs">
            <span className="truncate" data-testid="shop-problem-photo-name">Photo added: {problemPhoto.name}</span>
            <Button type="button" size="sm" variant="ghost" disabled={report.isPending} onClick={() => setProblemPhoto(null)}>Remove</Button>
          </p>
        ) : (
          <Button type="button" size="sm" variant="outline" disabled={report.isPending} asChild>
            <label htmlFor={`${fileId}-problem-photo`}>Add a photo (optional)</label>
          </Button>
        )}
        <p className="text-xs text-muted-foreground">Only Louisiana Helpr sees the photo, not the shop.</p>
      </div>
    </BrandConfirmDialog>
  );
  const h = handover.data ?? null;
  const busy = ready.isPending || finish.isPending || report.isPending || handedOver.isPending;
  const porch = order.handover_mode === "porch";
  const today = louisianaToday();
  const due = today >= order.ready_date;
  // S015 (Shops audit 11-12): a Helpr-delivered order finishes on the Helpr's drop-off, so the shop has no
  // "Handed over" tap (the server refuses it: helpr_delivers_handover), unless it fell back to pickup.
  const byHelpr = order.fulfillment === "helpr_delivers" && !order.helpr_unfilled_at;
  // Preorders (money review 11-08): the ready tap counts only from 14 days before ready-by (the server refuses earlier).
  // S032 (Shops audit 11-12): any other goods order's ready tap counts from the day before its ready date (O2), so an
  // earlier tap is not offered. A service has no ready tap (its "Mark complete" waits for the ready date itself).
  const readyFrom = h?.ready_at ? null
    : order.preorder_item_id ? preorderReadyFrom(order.ready_date)
    : !service ? addDays(order.ready_date, -1) : null;
  const tooEarly = readyFrom !== null && today < readyFrom;

  if (side === "shop" && order.status === "handed_over") {
    const p = (payouts.data ?? []).find((x) => x.order_id === order.id);
    if (h?.problem_at) return <p className="text-xs font-semibold" data-testid="shop-handover-problem">The buyer reported a problem. Louisiana Helpr looks at it before anyone is paid.</p>;
    return p ? <p className="text-xs font-semibold" data-testid="shop-payout-line">{payoutText(p)}</p> : null;
  }
  if (!open) return null;

  if (h?.problem_at) {
    return (
      <p className="text-xs font-semibold" data-testid="shop-handover-problem">
        {side === "buyer"
          ? "You reported a problem. Louisiana Helpr looks at it before anyone is paid."
          : "The buyer reported a problem. Louisiana Helpr looks at it before anyone is paid."}
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="shop-handover-actions">
      <p className="text-xs text-muted-foreground">
        {handoverIntro(order)}{" "}
        {h?.ready_at ? (side === "buyer" ? "The shop marked it ready." : "You marked it ready.") : ""}
        {side === "buyer" && h?.shop_confirmed_at ? w.buyerShopSaysDone : ""}
      </p>
      {side === "shop" && tooEarly && readyFrom ? (
        <p className="text-xs text-muted-foreground" data-testid="shop-preorder-ready-from">
          {order.preorder_item_id
            ? `This is a preorder. You can mark it ready from ${shortDate(readyFrom)}.`
            : `You can mark it ready from ${shortDate(readyFrom)}, the day before it's due.`}
        </p>
      ) : side === "shop" && service ? (
        <div className="flex flex-wrap gap-2">
          {due && !h?.shop_confirmed_at && (
            <Button type="button" size="sm" className="btn-grad-primary" disabled={busy} onClick={() => setHandingOver(true)}>
              {service ? "Mark complete" : "Handed over"}
            </Button>
          )}
          <p className="w-full text-xs text-muted-foreground" data-testid="shop-handover-wait">
            {h?.shop_confirmed_at ? w.shopMarkedWait : w.shopOpenWait}
          </p>
        </div>
      ) : side === "shop" ? (
        <div className="flex flex-wrap gap-2">
          <Label htmlFor={fileId} className="sr-only">Photo of the order, ready</Label>
          <input
            id={fileId}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (f) ready.mutate(f);
            }}
          />
          <Button type="button" size="sm" variant={porch && !h?.ready_at ? "default" : "outline"}
            className={porch && !h?.ready_at ? "btn-grad-primary" : undefined}
            disabled={busy} onClick={() => document.getElementById(fileId)?.click()}>
            {ready.isPending ? "Saving…" : h?.ready_photo_path ? "Retake ready photo" : porch ? "Take photo and mark ready" : "Add a ready photo"}
          </Button>
          {!porch && !h?.ready_at && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => ready.mutate(null)}>Mark ready</Button>
          )}
          {!porch && !byHelpr && due && !h?.shop_confirmed_at && (
            <Button type="button" size="sm" className="btn-grad-primary" disabled={busy} onClick={() => setHandingOver(true)}>
              {service ? "Mark complete" : "Handed over"}
            </Button>
          )}
          <p className="w-full text-xs text-muted-foreground" data-testid="shop-handover-wait">
            {porch
              ? "The buyer taps \"I got it\". With your photo in, you're paid 48 hours after it (or after the ready day starts, if that is later) unless the buyer reports a problem."
              : h?.shop_confirmed_at
                ? w.shopMarkedWait
                : w.shopOpenWait}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {h?.ready_photo_path && !photoUrl && (
            <Button type="button" size="sm" variant="outline" disabled={photo.isPending} onClick={() => photo.mutate(h.ready_photo_path!)}>
              See the shop's photo
            </Button>
          )}
          {/* S002 (Shops audit 11-12): "I got it" pays the shop and ends the order, so it waits for the ready day, the
              shop's ready mark or its handover (the server refuses before: not_ready_yet). */}
          {(due || !!h?.ready_at || !!h?.shop_confirmed_at) && (
            <Button type="button" size="sm" className="btn-grad-primary" disabled={busy} onClick={() => setConfirming(true)}>
              {w.buyerGotIt}
            </Button>
          )}
          {(due || !!h?.ready_at || !!h?.shop_confirmed_at) && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setNote(""); setProblemPhoto(null); setReporting(true); }}>
              {w.buyerProblem}
            </Button>
          )}
        </div>
      )}
      <BrandConfirmDialog
        open={handingOver}
        onOpenChange={(o) => { if (!o) setHandingOver(false); }}
        title={service ? "Mark complete?" : "Handed over?"}
        description={w.shopDoneBody}
        primaryLabel={handedOver.isPending ? "Saving…" : service ? "Mark complete" : "Handed over"}
        primaryDisabled={handedOver.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          handedOver.mutate();
        }}
        secondaryLabel="Cancel"
      />
      <BrandConfirmDialog
        open={confirming}
        onOpenChange={(o) => { if (!o) setConfirming(false); }}
        title={service ? "Is the work done?" : "Got your order?"}
        description={w.buyerGotItBody}
        primaryLabel={finish.isPending ? "Saving…" : w.buyerGotIt}
        primaryDisabled={finish.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          finish.mutate();
        }}
        secondaryLabel="Cancel"
      />
      {photoUrl && <img src={photoUrl} alt="The shop's photo of your order, ready" className="max-h-64 w-full rounded-xl object-cover" />}
      {reportDialog}
    </div>
  );
}
