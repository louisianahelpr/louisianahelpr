import { useState } from "react";
import { ADMIN_DELETED_ACCOUNT_LABEL } from "@/lib/deletedPerson";
import { endSentence } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFeature } from "@/hooks/useFeature";
import { adminDecideDeliveryDamage, adminDecideStuckDelivery, adminDecideProblem, fetchOpenProblemsWithDetail, handoverPhotoUrl, type AdminProblem, type AdminProblemDetail } from "@/lib/declutter/handover";
import { offerCentsFromInput } from "@/lib/declutter/refundRequests";
import { photoPublicUrl } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { AdminCard } from "../AdminViewShell";
import { HelprPhoto, ProblemCaseView } from "./DeclutterProblemCase";
import { ProblemTalk } from "./DeclutterProblemTalk";

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
 *
 * AL-5 (anti-lying #5, 20261029000048): "Was the report true?" is its own explicit question. "No, it was false"
 * puts the fault on the reporter's side, leaves only the decision that goes against the reporter (a buyer's false
 * report: pay the seller; a seller's: refund the buyer), and gives the REPORTER a Declutter strike for a false
 * report (3 strikes = locked out of Declutter). Only for a buyer's or a seller's report; the server refuses
 * anything else (false_report_mismatch).
 */
type ProblemRow = AdminProblem;

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
            Buyer: {endSentence(d.buyer_name ?? ADMIN_DELETED_ACCOUNT_LABEL)} Seller: {endSentence(d.seller_name ?? ADMIN_DELETED_ACCOUNT_LABEL)}
          </p>
        </div>
      </div>
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

/** D2-3: a buyer's or seller's problem photo (the private declutter-handover bucket, a signed link). */
function SidePhoto({ path, alt }: { path: string; alt: string }) {
  const url = useQuery({ queryKey: ["declutter", "problem-photo", path], queryFn: () => handoverPhotoUrl(path), staleTime: 5 * 60_000 });
  if (!url.data) return null;
  return <img src={url.data} alt={alt} className="h-32 w-32 rounded-lg object-cover" loading="lazy" />;
}

function ProblemItem({ row }: { row: ProblemRow }) {
  const qc = useQueryClient();
  const [fault, setFault] = useState<"seller" | "buyer" | "none" | "helpr">("none");
  const [strike, setStrike] = useState(false);
  const [note, setNote] = useState("");
  const [falseReport, setFalseReport] = useState(false);
  // D2-14 (owner 2026-10-29: allow partial): pre-filled with the seller's last part offer, when there was one.
  const offer = row.detail?.refund_offer_cents ?? null;
  const [part, setPart] = useState(offer ? (offer / 100).toFixed(2) : "");
  const partCents = offerCentsFromInput(part);
  const itemsCents = row.detail?.items_cents ?? null;
  const partOk = partCents !== null && itemsCents !== null && partCents < itemsCents;
  const canPart = row.detail?.order_status === "handed_over";
  // A Helpr's report is a delivery matter: it is never marked false here.
  const reporter = row.reporter_side === "buyer" || row.reporter_side === "seller" ? row.reporter_side : null;
  // A false report goes against the reporter: the one decision left.
  const againstReporter = reporter === "buyer" ? "pay_seller" : "refund_buyer";
  const falseOn = falseReport && reporter !== null;
  // LEAD-ADMIN-HELPR-FAULT (owner rule 10-30 "Helpr's fault, Helpr bears it"): on a Helpr delivery the Helpr can be at
  // fault, which is a full refund only (the server refuses the rest: helpr_fault_not_possible).
  const helprFault = fault === "helpr" && !falseOn;
  const decide = useMutation({
    mutationFn: (decision: "refund_buyer" | "pay_seller" | "refund_part") => {
      const args = [row.id, decision, falseOn ? (reporter as "buyer" | "seller") : fault, falseOn ? false : strike, note.trim() || null, falseOn] as const;
      return decision === "refund_part" ? adminDecideProblem(...args, partCents) : adminDecideProblem(...args);
    },
    onSuccess: (_r, decision) => {
      const done = decision === "refund_buyer" ? "Decided: the buyer is refunded."
        : decision === "refund_part" ? `Decided: the buyer gets ${formatPrice(partCents ?? 0)} back and keeps the item.`
          : "Decided: the seller is paid.";
      toast.success(falseOn ? `${done} The ${reporter} gets a strike for a false report.` : done);
      void qc.invalidateQueries({ queryKey: ["declutter", "admin-problems"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const stuck = useMutation({
    mutationFn: (who: "none" | "helpr") => adminDecideStuckDelivery(row.id, who, note.trim() || null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["declutter", "admin-problems"] }),
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
  // declutter_answer_no_show: the buyer's report, with the seller's answer as the other side.
  const noShowAnswered = row.reason === "no_show" && row.reporter_side === "buyer" && !!row.detail?.other_side_note;
  return (
    <li className="rounded-xl border border-border p-3 space-y-2">
      <p className="font-semibold">{row.reporter_side === "system" ? "Held 60 days · nobody has said anything" : noShowAnswered ? "The seller didn't show · reported by the buyer · the seller answered" : <>{REASON_WORDS[row.reason] ?? row.reason} · reported by the {row.reporter_side === "helpr" ? "Helpr" : row.reporter_side}</>}</p>
      <p className="text-xs text-muted-foreground">Order {row.order_id.slice(0, 8)} · {new Date(row.created_at).toLocaleString()}</p>
      <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{row.note}</p>
      {row.detail ? <ProblemDetail d={row.detail} /> : null}
      {/* AL-4: the order's steps and both sides' handover photos, side by side with their times and places. */}
      {row.detail ? <ProblemCaseView problemId={row.id} d={row.detail} /> : null}
      {row.reporter_side === "helpr" && (row.photo_paths ?? []).map((p) => <HelprPhoto key={p} path={p} />)}
      {/* D2-3: the reporter's photos, and the other side's words and photos. */}
      {row.reporter_side !== "helpr" && row.reporter_side !== "system" && (row.photo_paths ?? []).map((p) => <SidePhoto key={p} path={p} alt={`The ${row.reporter_side}'s photo`} />)}
      {row.detail?.other_side_note ? (
        <div className="space-y-1" data-admin-other-side="">
          <p className="text-sm [overflow-wrap:anywhere]">
            <span className="font-semibold">{noShowAnswered ? "The seller's answer:" : `The ${row.reporter_side === "seller" ? "buyer" : "seller"}'s side:`}</span> {row.detail.other_side_note}
          </p>
          {(row.detail.other_side_photo_paths ?? []).map((p) => <SidePhoto key={p} path={p} alt="The other side's photo" />)}
        </div>
      ) : null}
      {/* AL-6: the buyer and seller's chat and the item questions, kept whole, as sides only. */}
      <ProblemTalk problemId={row.id} />
      {reporter ? (
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">Was the report true?</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={id("truth")} checked={!falseReport} onChange={() => setFalseReport(false)} />
            Yes, or I can't tell
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name={id("truth")} checked={falseReport} onChange={() => { setFalseReport(true); setStrike(false); }} />
            No, it was false: the {reporter} gets a strike for a false report
          </label>
          {falseReport ? (
            <p className="text-xs text-muted-foreground">
              The fault is the {reporter}'s, and only "{againstReporter === "pay_seller" ? "Pay the seller" : "Refund the buyer"}" is left.
              3 strikes lock them out of Declutter.
            </p>
          ) : null}
        </fieldset>
      ) : null}
      <label htmlFor={id("fault")} className="block text-xs font-medium">Whose fault?</label>
      <select id={id("fault")} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        value={falseOn ? (reporter as string) : fault} disabled={falseOn}
        onChange={(e) => { const f = e.target.value as "seller" | "buyer" | "none" | "helpr"; setFault(f); if (f === "none") setStrike(false); }}>
        <option value="none">Nobody's</option>
        <option value="seller">The seller's</option>
        <option value="buyer">The buyer's</option>
        {row.detail?.helpr_delivery ? <option value="helpr">The Helpr's</option> : null}
      </select>
      <p className="text-xs text-muted-foreground">
        If you refund: the seller's fault = the whole payment back (the seller owes the card fee); the buyer's fault = the
        item price back (the buyer's fee is kept); nobody's = the payment back minus the card fee.
        {row.detail?.helpr_delivery ? " The Helpr's fault (they took it and never picked it up) = the whole payment back, delivery included; the Helpr isn't paid and owes the card fee." : ""}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={strike && !falseOn} disabled={fault === "none" || falseOn} onChange={(e) => setStrike(e.target.checked)} />
        Give the at-fault side a strike
      </label>
      <label htmlFor={id("note")} className="block text-xs font-medium">Note (both sides see it)</label>
      <input id={id("note")} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" maxLength={1000}
        value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <Button onClick={() => decide.mutate("refund_buyer")} disabled={decide.isPending || (falseOn && againstReporter !== "refund_buyer")}>Refund the buyer</Button>
        <Button variant="outline" onClick={() => decide.mutate("pay_seller")} disabled={decide.isPending || helprFault || (falseOn && againstReporter !== "pay_seller")}>Pay the seller</Button>
      </div>
      {canPart && !falseOn && !helprFault && (
        <div className="space-y-1" data-admin-part-refund="">
          <label htmlFor={id("part")} className="block text-xs font-medium">Or refund part of the price (the buyer keeps the item)</label>
          {offer ? <p className="text-xs text-muted-foreground">The seller offered {formatPrice(offer)}.</p> : null}
          <div className="flex gap-2">
            <input id={id("part")} inputMode="decimal" className="w-32 rounded-lg border border-input bg-background px-3 py-2 text-sm"
              value={part} onChange={(e) => setPart(e.target.value)} placeholder="$" />
            <Button variant="outline" onClick={() => decide.mutate("refund_part")} disabled={decide.isPending || !partOk}>Refund part</Button>
          </div>
          {part.trim() && !partOk ? (
            <p className="text-xs text-destructive-ink" role="alert">Enter an amount above $0 and below the item price{itemsCents ? ` (${formatPrice(itemsCents)})` : ""}.</p>
          ) : null}
        </div>
      )}
      {/* BUY-36: a delivery the Helpr still has and can't finish is decided by fault. */}
      {row.detail?.helpr_delivery && !falseOn && (
        <div className="space-y-1" data-admin-stuck-delivery="">
          <p className="text-xs text-muted-foreground">
            If the Helpr has it and can't finish. Nobody's fault: the sale is cancelled, the buyer gets back all but the delivery fee and the card fee, the
            Helpr is paid for the trip. The Helpr's fault: the sale is cancelled, the buyer gets everything back, the Helpr isn't paid, owes the card fee and gets a strike. The seller isn't paid either way.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => stuck.mutate("none")} disabled={stuck.isPending || decide.isPending}>Nobody's fault</Button>
            <Button variant="outline" onClick={() => stuck.mutate("helpr")} disabled={stuck.isPending || decide.isPending}>The Helpr's fault</Button>
          </div>
        </div>
      )}
      {deliveryReason && !falseOn && (
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

/** `includeTest`: the "Show test listings" switch on the Declutter review card (FeatureSwitchesCard holds it, D2-4). */
export function DeclutterProblemsCard({ includeTest = false }: { includeTest?: boolean }) {
  const on = useFeature("declutter");
  const open = useQuery({
    // ["declutter", "admin-problems"] stays the prefix a decision invalidates.
    queryKey: ["declutter", "admin-problems", includeTest ? "with-test" : "real-only"],
    queryFn: () => fetchOpenProblemsWithDetail(includeTest),
  });
  // Row 62: paid sales (and their problems) carry on with the switch off, so an open problem always shows
  // (lh-authz-rls review 4.1); with the switch off and nothing open, the card stays hidden.
  if (!on && !(open.data?.length)) return null;
  return (
    <AdminCard title="Declutter problems" subtitle={includeTest
      ? "Reported problems on paid sales, test accounts' included. The money waits for your decision."
      : "Reported problems on paid sales. The money waits for your decision."}>
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
