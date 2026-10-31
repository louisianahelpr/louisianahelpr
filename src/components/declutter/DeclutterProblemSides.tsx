/**
 * D2-3 (audit 1b #3): both sides of a reported problem on the order card. The side that did not report sees the
 * reason, the words and the photos, and adds their own side (declutter_problem_add_side, 20261029225634); the
 * reporter sees the other side's answer. Louisiana Helpr reads both before it decides.
 *
 * Reads the order's newest problem through declutter_order_problem (audit 1030 DB-1: the two sides and admins, only
 * the columns below; the old direct select("*") was refused for every member on prod); shows nothing once it is decided
 * (DeclutterProblemDecided below then says what Louisiana Helpr decided, DB-12). Photos are signed links (the bucket is private).
 *
 * B100 (owner 2026-10-30, 20261030134109): the member who reported it can "Take back my report" (with a confirm)
 * while it is open, as the buyer or the seller. The money hold lifts and the 24-hour clocks run on; a withdrawn
 * problem shows nothing here, like a decided one.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addProblemSide, fetchOrderProblem, handoverPhotoUrl, withdrawProblem, type OrderProblem } from "@/lib/declutter/handover";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { FallbackImg } from "./FallbackImg";
import { ProblemPhotoPicker, uploadProblemPhotos } from "./DeclutterProblemPhotos";
import { ConfirmSheet } from "./DeclutterConfirmSheet";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

export function ProblemPhotos({ paths }: { paths: string[] }) {
  const urls = useQuery({
    queryKey: ["declutter", "problem-photos", paths],
    queryFn: async () => Promise.all(paths.map((p) => handoverPhotoUrl(p))),
    enabled: paths.length > 0,
    staleTime: 5 * 60_000,
  });
  if (paths.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" data-problem-photos="">
      {(urls.data ?? []).map((u, i) => u
        ? <a key={paths[i]} href={u} target="_blank" rel="noreferrer"><FallbackImg src={u} alt={`Problem photo ${i + 1}`} className="h-16 w-16 rounded-lg object-cover bg-photo-empty" /></a>
        : null)}
    </div>
  );
}

/**
 * Audit 1030 DB-12: what Louisiana Helpr decided, on the card itself (it said only "Handed over."). The same words as
 * the "Louisiana Helpr decided" notices (declutter_admin_decide_problem); a refund's amount stays in its own notice.
 */
const DECIDED_WORDS: Record<NonNullable<OrderProblem["decision"]>, Record<"buyer" | "seller", string>> = {
  pay_seller: { buyer: "The seller keeps the payment, and the sale is final.", seller: "You keep the payment." },
  refund_buyer: { buyer: "We are refunding you. A separate notice says how much.", seller: "We are refunding the buyer." },
  refund_part: { buyer: "We are refunding you part of the payment. A separate notice says how much.", seller: "We are refunding the buyer part of the payment." },
  delivery_damage: { buyer: "It was damaged in delivery. A separate notice says what comes back to you.", seller: "It was damaged in delivery." },
};

export function DeclutterProblemDecided({ orderId, side }: { orderId: string; side: "buyer" | "seller" }) {
  const problem = useQuery({ queryKey: ["declutter", "problem", orderId], queryFn: () => fetchOrderProblem(orderId) });
  const p = problem.data;
  const words = p?.status === "decided" && p.decision ? DECIDED_WORDS[p.decision]?.[side] : undefined;
  if (!words) return null;
  return <p className="text-sm" data-problem-decided=""><span className="font-semibold">Louisiana Helpr decided:</span> {words}</p>;
}

export function DeclutterProblemSides({ orderId, side }: { orderId: string; side: "buyer" | "seller" }) {
  const qc = useQueryClient();
  const problem = useQuery({ queryKey: ["declutter", "problem", orderId], queryFn: () => fetchOrderProblem(orderId) });
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const send = useMutation({
    // Sent again, the server replaces the earlier words and photos: with no new photo the ones already sent stay.
    mutationFn: async (p: OrderProblem) => addProblemSide(p.id, note.trim(), photos.length ? await uploadProblemPhotos(orderId, photos) : (p.other_side_photo_paths ?? [])),
    onSuccess: () => {
      toast("Sent. Louisiana Helpr reads both sides before it decides.");
      setOpen(false);
      setPhotos([]);
      void qc.invalidateQueries({ queryKey: ["declutter", "problem", orderId] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const [takingBack, setTakingBack] = useState(false);
  const takeBack = useMutation({
    mutationFn: (q: OrderProblem) => withdrawProblem(q.id),
    onSettled: () => setTakingBack(false),
    onSuccess: () => {
      toast("Report taken back. Nothing is held for it now.");
      // The order card's hold, refund panel and steps all read from the order, so refresh every Declutter read.
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const p = problem.data;
  if (!p || p.status !== "open") return null;
  const mine = p.reporter_side === side;
  // NIGHT-BUYINGopenpr-8: this box said "You reported a problem: It's damaged." under the note's "Damaged, reported by
  // you." The note (ProblemOpenNote) says what and who once; this box shows each side's own words and photos.
  const whose = mine ? "Your" : p.reporter_side === "buyer" ? "The buyer's" : p.reporter_side === "seller" ? "The seller's" : p.reporter_side === "system" ? "Louisiana Helpr's" : "The Helpr's";
  const other = side === "buyer" ? "The seller" : "The buyer";
  // A buyer's no-show report: the seller's words are an answer to it.
  const noShow = p.reason === "no_show" && p.reporter_side === "buyer";
  return (
    <section className="space-y-2 rounded-xl border border-border p-3" data-problem-sides="">
      <p className="text-sm">
        <span className="font-semibold">{whose} report:</span> "{p.note}"
      </p>
      <ProblemPhotos paths={p.photo_paths ?? []} />
      {p.other_side_note && (
        <div className="space-y-1" data-problem-other-side="">
          <p className="text-sm"><span className="font-semibold">{noShow ? (mine ? `${other} answered:` : "You answered:") : mine ? `${other}'s side:` : "Your side:"}</span> "{p.other_side_note}"</p>
          <ProblemPhotos paths={p.other_side_photo_paths ?? []} />
        </div>
      )}
      {mine && (p.reporter_side === "buyer" || p.reporter_side === "seller") && (
        <button type="button" className={btn} disabled={takeBack.isPending} onClick={() => setTakingBack(true)}>
          Take back my report
        </button>
      )}
      <ConfirmSheet open={takingBack} title="Take back your report?" confirmLabel="Take it back" cancelLabel="Keep my report"
        pending={takeBack.isPending} onConfirm={() => takeBack.mutate(p)} onClose={() => setTakingBack(false)} testId="take-back-report">
        Louisiana Helpr stops looking at it and the money is no longer held for it. You can&apos;t report this sale again after taking it back.
      </ConfirmSheet>
      {!mine && !open && (
        <button type="button" className={btn} onClick={() => { setNote(p.other_side_note ?? ""); setOpen(true); }}>
          {p.other_side_note ? "Change your side" : "Add your side"}
        </button>
      )}
      {!mine && open && (
        <div className="space-y-2">
          <label htmlFor={`dcl-side-${orderId}`} className="block text-xs font-medium">Your side, for Louisiana Helpr</label>
          <textarea id={`dcl-side-${orderId}`} className={input} maxLength={1000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <ProblemPhotoPicker files={photos} onChange={setPhotos} disabled={send.isPending} />
          {(p.other_side_photo_paths ?? []).length > 0 && <p className="text-ds-12 text-muted-foreground">New photos replace the ones you sent.</p>}
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={send.isPending || !note.trim()} onClick={() => send.mutate(p)}>Send</button>
            <button type="button" className={btn} onClick={() => setOpen(false)}>Not now</button>
          </div>
        </div>
      )}
    </section>
  );
}
