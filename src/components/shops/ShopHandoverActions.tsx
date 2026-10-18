/**
 * The handover part of one Shops order card (Shops M2, migration
 * 20261018211820; owner pop-up 2026-10-18: the shop picks "left out" or "in
 * person", NO codes anywhere).
 *
 *   Shop: "Mark ready" (left out: a photo is required; in person: optional),
 *         and once handed over the payout line. The shop can NEVER finish its
 *         own order (owner 2026-10-18 ~21:00Z): only the buyer's "I got it" or
 *         the automatic finish 24 hours after the ready date does.
 *   Buyer: "I got it" (the shop is paid), "I didn't get it" (the money waits
 *         for Louisiana Helpr), and the shop's ready photo.
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
  markReady,
  payoutText,
  readyPhotoUrl,
  reportNotReceived,
  uploadReadyPhoto,
} from "@/lib/shops/handover";
import { shopsErrorMessage } from "@/lib/shops/errors";

const NOTE_MAX = 500;

/** Today in Louisiana (ready dates are local dates; the server uses shop_local_today()). */
function louisianaToday(now: number = Date.now()): string {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export function ShopHandoverActions({ order, side, userId }: { order: ShopOrder; side: "buyer" | "shop"; userId: string }) {
  const qc = useQueryClient();
  const fileId = useId();
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const open = order.status === "accepted" && !!order.captured_at;
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
    mutationFn: () => reportNotReceived(order.id, note),
    onSuccess: () => {
      toast.success("Reported. Louisiana Helpr looks at it before anyone is paid.");
      setReporting(false);
      setNote("");
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
      title="Didn't get your order?"
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
        <Textarea id={`${fileId}-note`} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="Nobody was there at pickup" />
      </div>
    </BrandConfirmDialog>
  );
  const h = handover.data ?? null;
  const busy = ready.isPending || finish.isPending || report.isPending;
  const porch = order.handover_mode === "porch";
  const today = louisianaToday();
  const due = today >= order.ready_date;

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
        {porch ? "Left out for pickup." : "Pick up in person."}{" "}
        {h?.ready_at ? (side === "buyer" ? "The shop marked it ready." : "You marked it ready.") : ""}
      </p>
      {side === "shop" ? (
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
          <p className="w-full text-xs text-muted-foreground" data-testid="shop-handover-wait">
            {porch
              ? "The buyer taps \"I got it\". If they don't, it finishes on its own 24 hours after the ready date, once your photo is in."
              : "The buyer taps \"I got it\" when they have it. If they don't, it finishes on its own 24 hours after the ready date."}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {h?.ready_photo_path && !photoUrl && (
            <Button type="button" size="sm" variant="outline" disabled={photo.isPending} onClick={() => photo.mutate(h.ready_photo_path!)}>
              See the shop's photo
            </Button>
          )}
          <Button type="button" size="sm" className="btn-grad-primary" disabled={busy} onClick={() => setConfirming(true)}>
            I got it
          </Button>
          {(due || !!h?.ready_at) && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setNote(""); setReporting(true); }}>
              I didn't get it
            </Button>
          )}
        </div>
      )}
      <BrandConfirmDialog
        open={confirming}
        onOpenChange={(o) => { if (!o) setConfirming(false); }}
        title="Got your order?"
        description="The shop is paid now and the order is final. Only tap this once you have it."
        primaryLabel={finish.isPending ? "Saving…" : "I got it"}
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
