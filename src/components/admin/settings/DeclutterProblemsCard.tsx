import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFeature } from "@/hooks/useFeature";
import { adminDecideDeliveryDamage, adminDecideProblem, fetchOpenProblemsWithDetail, handoverPhotoUrl, type AdminProblem, type AdminProblemDetail } from "@/lib/declutter/handover";
import { photoPublicUrl } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { taskPhotoUrl } from "@/lib/helprTasks/photoUrl";
import { AdminCard } from "../AdminViewShell";

/**
 * Declutter problems waiting for an admin (spec rows 15, 67, 96; B54):
 * a buyer or seller reported a problem on a paid sale, which holds the money.
 * The admin decides: refund the buyer or pay the seller, says whose fault it
 * was (that fixes who bears the card fee: seller fault = full refund paid by
 * the seller, buyer fault = item price back, no fault = card fee kept, owner
 * 2026-10-15), and may give a strike. No split (B54). The server refuses a
 * non-admin and a problem already decided (declutter_admin_decide_problem,
 * audit-logged). Shown while the 'declutter' switch is on for this admin, and
 * always while a problem is open (row 62: paid sales go on with the switch off).
 *
 * Slice 5 (Helpr delivery): an item reported damaged or not received that the
 * Helpr already has is decided with "Damaged in delivery" (row 43: the buyer
 * gets everything back, the seller is paid, the Helpr is not paid and gets a
 * strike); the server refuses "Refund the buyer" there, because that path
 * pays the Helpr for the trip (B69). A Helpr's "the seller wasn't there"
 * report arrives here too, reported by the Helpr.
 */
type ProblemRow = AdminProblem;

/** The Helpr's photo at the pickup (private helpr-tasks bucket, signed URL; admins may read it). */
function HelprPhoto({ path }: { path: string }) {
  const url = useQuery({ queryKey: ["helpr-tasks", "photo", path], queryFn: () => taskPhotoUrl(path), staleTime: 5 * 60_000 });
  if (url.isError) return <p className="text-xs" role="alert">The Helpr's photo couldn't load.</p>;
  if (!url.data) return null;
  return <img src={url.data} alt="The Helpr's photo at the pickup address" className="h-32 w-32 rounded-lg object-cover" loading="lazy" />;
}

/** A handover photo (private declutter-handover bucket, signed URL; admins may read it). */
function HandoverPhoto({ path, alt }: { path: string; alt: string }) {
  const url = useQuery({ queryKey: ["declutter", "handover-photo", path], queryFn: () => handoverPhotoUrl(path), staleTime: 5 * 60_000 });
  if (url.isError || url.data === null) return <p className="text-xs" role="alert">This photo couldn't load.</p>;
  if (!url.data) return <div className="aspect-square w-full rounded-lg bg-muted" aria-hidden />;
  return <img src={url.data} alt={alt} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

/**
 * A2-13 (audit2 SH2-4): the item, the money, both people and the handover
 * photos, so the admin decides from the card. Absent until
 * declutter_admin_open_problems is on prod (detail is null then).
 */
function ProblemDetail({ d }: { d: AdminProblemDetail }) {
  const title = d.item_titles[0] ?? "Item";
  const more = d.item_titles.length - 1;
  const money = [
    d.items_cents != null && `items ${formatPrice(d.items_cents)}`,
    d.bundle_discount_cents ? `bundle discount -${formatPrice(d.bundle_discount_cents)}` : null,
    d.delivery_cents ? `delivery ${formatPrice(d.delivery_cents)}` : null,
    d.premium_cents != null && `buyer fee ${formatPrice(d.premium_cents)}`,
    d.tax_cents ? `tax ${formatPrice(d.tax_cents)}` : null,
  ].filter(Boolean).join(", ");
  const photos = [
    d.set_out_photo_path && { path: d.set_out_photo_path, label: "Seller set it out", at: when(d.set_out_at), extra: null },
    d.picked_up_photo_path && {
      path: d.picked_up_photo_path,
      label: "Buyer picked it up",
      at: when(d.picked_up_at),
      extra: d.picked_up_distance_m != null ? `${d.picked_up_distance_m} m from the pickup address` : null,
    },
  ].filter(Boolean) as { path: string; label: string; at: string | null; extra: string | null }[];
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {d.item_photo_paths[0] ? (
          <img src={photoPublicUrl(d.item_photo_paths[0])} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover bg-muted" />
        ) : null}
        <div className="min-w-0 space-y-0.5">
          <p className="font-semibold [overflow-wrap:anywhere]">{title}{more > 0 ? ` and ${more} more` : ""}</p>
          {d.total_cents != null && (
            <p className="text-sm">Paid {formatPrice(d.total_cents)}{money ? <span className="text-muted-foreground"> ({money})</span> : null}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Buyer: {d.buyer_name ?? "Deleted account"}. Seller: {d.seller_name ?? "Deleted account"}.
          </p>
        </div>
      </div>
      {photos.length > 0 ? (
        <div className="grid max-w-md grid-cols-2 gap-3">
          {photos.map((ph) => (
            <figure key={ph.path} className="space-y-1">
              <HandoverPhoto path={ph.path} alt={ph.label} />
              <figcaption className="text-xs">
                <span className="font-medium">{ph.label}</span>
                {ph.at ? <span className="block text-muted-foreground">{ph.at}</span> : null}
                {ph.extra ? <span className="block text-muted-foreground">{ph.extra}</span> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No handover photos.</p>
      )}
      {d.confirmed_at ? (
        <p className="text-xs text-muted-foreground">Handover confirmed {when(d.confirmed_at)}{d.confirmed_by ? ` (${CONFIRMED_BY_WORDS[d.confirmed_by] ?? d.confirmed_by})` : ""}.</p>
      ) : null}
    </div>
  );
}

const CONFIRMED_BY_WORDS: Record<string, string> = {
  scan: "the seller scanned the buyer's code",
  code: "the seller typed the buyer's code",
  buyer: "the buyer said they got it",
  porch: "porch photos",
  auto: "automatically, nobody objected in time",
  admin: "by an admin",
};

const REASON_WORDS: Record<string, string> = {
  not_as_described: "Not as described",
  damaged: "Damaged",
  not_received: "Not received",
  no_show: "Someone didn't show",
  safety: "Safety",
  other: "Something else",
};

function ProblemItem({ row }: { row: ProblemRow }) {
  const qc = useQueryClient();
  const [fault, setFault] = useState<"seller" | "buyer" | "none">("none");
  const [strike, setStrike] = useState(false);
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (decision: "refund_buyer" | "pay_seller") => adminDecideProblem(row.id, decision, fault, strike, note.trim() || null),
    onSuccess: (_r, decision) => {
      toast.success(decision === "refund_buyer" ? "Decided: the buyer is refunded." : "Decided: the seller is paid.");
      void qc.invalidateQueries({ queryKey: ["declutter", "admin-problems"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const damage = useMutation({
    mutationFn: () => adminDecideDeliveryDamage(row.id, note.trim() || null),
    onSuccess: () => {
      toast.success("Decided: damaged in delivery. The buyer is refunded, the seller paid, the Helpr not paid.");
      void qc.invalidateQueries({ queryKey: ["declutter", "admin-problems"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // "Damaged in delivery" is for an order a Helpr carries; audit2 SH2-4 saw it offered on a seller delivery.
  // Without the detail (server not updated) it stays offered, as before.
  const deliveryReason = (row.reason === "damaged" || row.reason === "not_received") && row.detail?.helpr_delivery !== false;
  const id = (k: string) => `dcl-prob-${k}-${row.id}`;
  return (
    <li className="rounded-xl border border-border p-3 space-y-2">
      <p className="font-semibold">{REASON_WORDS[row.reason] ?? row.reason} · reported by the {row.reporter_side === "helpr" ? "Helpr" : row.reporter_side}</p>
      <p className="text-xs text-muted-foreground">Order {row.order_id.slice(0, 8)} · {new Date(row.created_at).toLocaleString()}</p>
      <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{row.note}</p>
      {row.detail ? <ProblemDetail d={row.detail} /> : null}
      {row.reporter_side === "helpr" && (row.photo_paths ?? []).map((p) => <HelprPhoto key={p} path={p} />)}
      <label htmlFor={id("fault")} className="block text-xs font-medium">Whose fault?</label>
      <select id={id("fault")} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" value={fault}
        onChange={(e) => { const f = e.target.value as "seller" | "buyer" | "none"; setFault(f); if (f === "none") setStrike(false); }}>
        <option value="none">Nobody's</option>
        <option value="seller">The seller's</option>
        <option value="buyer">The buyer's</option>
      </select>
      <p className="text-xs text-muted-foreground">
        If you refund: the seller's fault = the whole payment back (the seller owes the card fee); the buyer's fault = the
        item price back (the buyer's fee is kept); nobody's = the payment back minus the card fee.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={strike} disabled={fault === "none"} onChange={(e) => setStrike(e.target.checked)} />
        Give the at-fault side a strike
      </label>
      <label htmlFor={id("note")} className="block text-xs font-medium">Note (both sides see it)</label>
      <input id={id("note")} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" maxLength={1000}
        value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <Button onClick={() => decide.mutate("refund_buyer")} disabled={decide.isPending}>Refund the buyer</Button>
        <Button variant="outline" onClick={() => decide.mutate("pay_seller")} disabled={decide.isPending}>Pay the seller</Button>
      </div>
      {deliveryReason && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            On a Helpr delivery the Helpr already has, decide damage here: the buyer gets everything back, the seller is
            still paid, the Helpr is not paid and gets a strike.
          </p>
          <Button variant="outline" onClick={() => damage.mutate()} disabled={damage.isPending || decide.isPending}>
            Damaged in delivery
          </Button>
        </div>
      )}
    </li>
  );
}

export function DeclutterProblemsCard() {
  const on = useFeature("declutter");
  const open = useQuery({
    queryKey: ["declutter", "admin-problems"],
    queryFn: fetchOpenProblemsWithDetail,
  });
  // Row 62: paid sales (and their problems) carry on with the switch off, so an open problem always shows
  // (lh-authz-rls review 4.1); with the switch off and nothing open, the card stays hidden.
  if (!on && !(open.data?.length)) return null;
  return (
    <AdminCard title="Declutter problems" subtitle="Reported problems on paid sales. The money waits for your decision.">
      {open.isError ? (
        <p className="text-sm" role="alert">{declutterErrorMessage(open.error)}</p>
      ) : open.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
      ) : (open.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No open problems.</p>
      ) : (
        <ul className="space-y-3">
          {(open.data ?? []).map((row) => <ProblemItem key={row.id} row={row} />)}
        </ul>
      )}
    </AdminCard>
  );
}
