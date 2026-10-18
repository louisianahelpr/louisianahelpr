/**
 * The handover part of one Shops order card (Shops M2, migration
 * 20261018184113; owner pop-up 2026-10-18: the shop picks "left out" or "in
 * person", NO codes anywhere).
 *
 *   Shop: "Mark ready" (left out: a photo is required; in person: optional),
 *         "Picked up" (in person only), and once handed over the payout line.
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
  markPickedUp,
  markReady,
  payoutText,
  readyPhotoUrl,
  reportNotReceived,
  uploadReadyPhoto,
} from "@/lib/shops/handover";
import { shopsErrorMessage } from "@/lib/shops/errors";

const NOTE_MAX = 500;

export function ShopHandoverActions({ order, side, userId }: { order: ShopOrder; side: "buyer" | "shop"; userId: string }) {
  const qc = useQueryClient();
  const fileId = useId();
  const [confirming, setConfirming] = useState<"got_it" | "picked_up" | null>(null);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
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
    mutationFn: (which: "got_it" | "picked_up") => (which === "got_it" ? confirmPickup(order.id) : markPickedUp(order.id)),
    onSuccess: (_d, which) => {
      toast.success(which === "got_it" ? "Thanks! The order is done." : "Marked picked up. Your payout is on its way.");
      setConfirming(null);
      refresh();
    },
    onError: (err) => { setConfirming(null); onError(err); },
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
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  if (side === "shop" && order.status === "handed_over") {
    const p = (payouts.data ?? []).find((x) => x.order_id === order.id);
    return p ? <p className="text-xs font-semibold" data-testid="shop-payout-line">{payoutText(p)}</p> : null;
  }
  if (!open) return null;
  const h = handover.data ?? null;
  const busy = ready.isPending || finish.isPending || report.isPending;
  const porch = order.handover_mode === "porch";

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
          {!porch && (
            <Button type="button" size="sm" className="btn-grad-primary" disabled={busy} onClick={() => setConfirming("picked_up")}>
              Picked up
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {h?.ready_photo_path && (
            <Button type="button" size="sm" variant="outline" disabled={photo.isPending} onClick={() => photo.mutate(h.ready_photo_path!)}>
              See the shop's photo
            </Button>
          )}
          <Button type="button" size="sm" className="btn-grad-primary" disabled={busy} onClick={() => setConfirming("got_it")}>
            I got it
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setNote(""); setReporting(true); }}>
            I didn't get it
          </Button>
        </div>
      )}
      <BrandConfirmDialog
        open={!!confirming}
        onOpenChange={(o) => { if (!o) setConfirming(null); }}
        title={confirming === "got_it" ? "Got your order?" : "Did the buyer pick it up?"}
        description={confirming === "got_it"
          ? "The shop is paid now and the order is final. Only tap this once you have it."
          : "The order is final and your payout is sent. Only tap this once the buyer has it."}
        primaryLabel={finish.isPending ? "Saving…" : confirming === "got_it" ? "I got it" : "Picked up"}
        primaryDisabled={finish.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          if (confirming) finish.mutate(confirming);
        }}
        secondaryLabel="Not yet"
      />
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
    </div>
  );
}
