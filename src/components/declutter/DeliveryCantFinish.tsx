/**
 * BUY-36: a delivery the Helpr has and can't finish ("Delivery Helpr can't finish after pickup", owner 10-30; migration
 * 20261031231150). The Helpr reports it with a reason; on nobody's fault the buyer fixes it once; then the item goes back
 * to the seller. On the Helpr's fault the buyer picks a full refund, re-posting or collecting it. The rules and the money
 * are the server's; this only asks and says where it stands. toast.success renders nothing, so the card itself says it.
 */
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AddressAutocomplete } from "@/components/postjob/AddressAutocomplete";
import { PhotoPickButton } from "@/components/ui/PhotoPickButton";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { currentPosition } from "@/lib/declutter/position";
import { geocodeAddress } from "@/lib/geocode";
import {
  buyerChooseAfterCantFinish,
  buyerFixDelivery,
  fetchTaskView,
  markReturned,
  reportCantFinish,
  sellerReturnAnswer,
  uploadTaskPhoto,
  type CantFinishReason,
  type TaskView,
} from "@/lib/helprTasks/api";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { invalidateTasks } from "./useTaskSteps";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";
const input = "w-full rounded-2xl border border-input glass-field px-3 py-2 text-ds-15";
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** What the buyer gets back when nobody is at fault (owner 10-30: the buyer bears the card fee, and the screen says so). */
export const NOBODYS_FAULT_REFUND =
  "You'd get back what you paid, less the delivery fee, which pays the Helpr for the trip, and less the small part the card network kept for the payment, which it doesn't give back.";

const REASONS: { value: CantFinishReason; label: string; then: string }[] = [
  { value: "wrong_address", label: "The address or pin is wrong", then: "The buyer gets 24 hours to fix it, then you try once more. No strike." },
  { value: "cant_get_in", label: "I can't get in", then: "The buyer gets 24 hours to fix it, then you try once more. No strike." },
  { value: "nobody_there", label: "Nobody's there and it can't be left", then: "The buyer gets 24 hours to fix it, then you try once more. No strike." },
  { value: "wont_fit", label: "It won't fit or isn't safe to leave", then: "The buyer gets 24 hours to fix it, then you try once more. No strike." },
  { value: "cant_finish", label: "My vehicle, or I can't finish", then: "You take it back to the seller within 48 hours. You aren't paid, and it's a delivery strike." },
  { value: "damaged", label: "It got damaged", then: "Louisiana Helpr looks at it and decides. The money stays held until then." },
  { value: "other", label: "Something else", then: "Louisiana Helpr looks at it and decides. The money stays held until then." },
];

/** The buyer's and the seller's line on the delivery card, while it is reported. */
export function cantFinishLine(v: TaskView, side: "buyer" | "seller", who: string): string | null {
  const by = (iso?: string | null) => (iso ? when(iso) : "soon");
  switch (v.stuck_stage) {
    case "waiting_fix":
      return side === "buyer"
        ? `${who} can't finish this delivery yet. Fix it by ${by(v.stuck_fix_by)} and they try once more. If it isn't fixed, it goes back to the seller and the sale is cancelled. ${NOBODYS_FAULT_REFUND}`
        : `${who} can't finish this delivery yet. The buyer has until ${by(v.stuck_fix_by)} to fix it.`;
    case "retrying":
      return `${who} is trying the delivery once more.`;
    case "returning":
      if (v.stuck_fault === "helpr") {
        return side === "buyer"
          ? `${who} can't finish this delivery and has to take it back to the seller by ${by(v.stuck_return_by)}.`
          : `${who} can't finish this delivery and has to bring it back to you by ${by(v.stuck_return_by)}.`;
      }
      return side === "buyer"
        ? `This delivery couldn't be finished, so it goes back to the seller and the sale is cancelled. ${NOBODYS_FAULT_REFUND}`
        : `${who} couldn't leave it, and brings it back to you by ${by(v.stuck_return_by)}.`;
    case "returned":
      return side === "buyer" ? `${who} says it's back with the seller. We're waiting for the seller to confirm.` : null;
    case "awaiting_choice":
      return side === "buyer" ? `It's back with the seller. Choose what happens by ${by(v.stuck_choice_by)}, or Louisiana Helpr decides.` : "It's back with you. We're waiting for the buyer to choose.";
    case "collecting":
      return side === "buyer" ? `You're collecting it from ${who}: "${v.stuck_collect_note ?? ""}". Tap "I got it" once you have it.` : "The buyer is collecting it from the Helpr.";
    default:
      return null;
  }
}

/** The buyer can only say "I got it" while the item can still reach them. */
export function buyerMayConfirm(v: TaskView): boolean {
  return v.stuck_stage !== "returning" && v.stuck_stage !== "returned" && v.stuck_stage !== "awaiting_choice";
}

function useDone() {
  const qc = useQueryClient();
  return () => invalidateTasks(qc);
}

/** The Helpr's side: "I can't deliver this", and what to do next. On the delivery card and at the route's drop-off stop. */
export function HelprCantFinish({ taskId, userId }: { taskId: string; userId: string }) {
  const id = useId();
  const view = useQuery({ queryKey: ["helpr-tasks", "view", taskId], queryFn: () => fetchTaskView(taskId), meta: { persist: false } });
  const done = useDone();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<CantFinishReason | null>(null);
  const [note, setNote] = useState("");
  const report = useMutation({
    mutationFn: () => reportCantFinish(taskId, reason as CantFinishReason, note.trim()),
    onSuccess: () => { setAsking(false); done(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const back = useMutation({
    mutationFn: async (f: File) => {
      // Location first (a refusal uploads nothing), then the photo once per file.
      const where = await currentPosition();
      if (uploaded.current?.file !== f) uploaded.current = { file: f, path: await uploadTaskPhoto(userId, taskId, f) };
      await markReturned(taskId, uploaded.current.path, where);
    },
    onSuccess: () => { setPhoto(null); done(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const v = view.data;
  if (!v || v.status !== "picked_up" || v.problem_open) return null;
  const stage = v.stuck_stage ?? null;
  const picked = REASONS.find((r) => r.value === reason);
  const needsWords = reason === "damaged" || reason === "other";
  if (stage === "waiting_fix") {
    return <p className="text-sm" role="status" data-cant-finish="waiting">We asked the buyer to fix it by {v.stuck_fix_by ? when(v.stuck_fix_by) : "tomorrow"}. Hold on to the item; we'll tell you what they say.</p>;
  }
  if (stage === "returned") {
    return <p className="text-sm" role="status" data-cant-finish="returned">You brought it back. We're waiting for the seller to confirm.</p>;
  }
  if (stage === "awaiting_choice") return null;
  if (stage === "returning" || stage === "collecting") {
    return (
      <div className="space-y-2" data-cant-finish="returning">
        {stage === "collecting" && <p className="text-sm">The buyer will collect it from you: <span className="font-medium">"{v.stuck_collect_note}"</span></p>}
        {stage === "returning" && (
          <>
            <p className="text-sm">
              Take it back to the seller{v.stuck_return_by ? ` by ${when(v.stuck_return_by)}` : ""}
              {v.pickup_address ? <>: <span className="font-medium">{v.pickup_address}</span></> : ""}.
              {" "}{v.stuck_fault === "helpr" ? "You aren't paid for this delivery." : "You're paid for the trip once it's back."}
            </p>
            <label htmlFor={`${id}-back`} className="block text-ds-13 font-semibold">A photo of the item, taken at the pickup address</label>
            <PhotoPickButton id={`${id}-back`} picked={photo} disabled={back.isPending} onPick={setPhoto} />
            <button type="button" className={`${primary} disabled:opacity-50`} disabled={back.isPending || !photo} onClick={() => { if (photo) back.mutate(photo); }}>
              It's back with the seller
            </button>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2" data-cant-finish="ask">
      {stage === "retrying" && (
        <p className="text-sm" role="status">The buyer fixed it. Try once more{v.stuck_fix_note ? <>: <span className="font-medium">"{v.stuck_fix_note}"</span></> : ""}.</p>
      )}
      <button type="button" className={btn} onClick={() => setAsking(true)}>I can't deliver this</button>
      <ConfirmSheet open={asking} title="What's stopping you?" confirmLabel="Send" pending={report.isPending} confirmDisabled={!reason || (needsWords && !note.trim())}
        onConfirm={() => report.mutate()} onClose={() => setAsking(false)} testId="delivery-cant-finish">
        <div className="space-y-2 text-left">
          <fieldset className="space-y-1">
            <legend className="sr-only">What's stopping you?</legend>
            {REASONS.map((r) => (
              <label key={r.value} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name={`${id}-reason`} checked={reason === r.value} onChange={() => setReason(r.value)} />
                {r.label}
              </label>
            ))}
          </fieldset>
          {picked && <p className="text-ds-13 text-muted-foreground" data-cant-finish-then="">{picked.then}{stage === "retrying" && picked.value !== "cant_finish" && !needsWords ? " This was your one more try, so it goes back to the seller and you're paid for the trip." : ""}</p>}
          <label htmlFor={`${id}-note`} className="block text-xs font-medium">{needsWords ? "What happened?" : "Anything to add? (optional)"}</label>
          <textarea id={`${id}-note`} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
        </div>
      </ConfirmSheet>
    </div>
  );
}

/** The buyer's side: the one fix, or what happens to an item the Helpr can't finish. */
export function BuyerCantFinishPanel({ taskId, view: v, who }: { taskId: string; view: TaskView; who: string }) {
  const id = useId();
  const done = useDone();
  const [note, setNote] = useState("");
  const [address, setAddress] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const fix = useMutation({
    mutationFn: async () => {
      const typed = address.trim();
      if (!typed) return buyerFixDelivery(taskId, note.trim(), null, null);
      const point = await geocodeAddress(typed);
      if (!point) throw new Error("fix_address_not_found");
      return buyerFixDelivery(taskId, note.trim(), typed, { lat: point.latitude, lng: point.longitude });
    },
    onSuccess: () => { setFailed(null); done(); },
    onError: (err) => setFailed(err instanceof Error && err.message === "fix_address_not_found"
      ? "We couldn't find that address. Pick it from the list, or tell the Helpr what changed."
      : declutterErrorMessage(err)),
  });
  const [choice, setChoice] = useState<"refund" | "repost" | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [where, setWhere] = useState("");
  const choose = useMutation({
    mutationFn: (c: { choice: "refund" | "repost" | "collect"; note: string }) => buyerChooseAfterCantFinish(taskId, c.choice, c.note),
    onSuccess: () => { setChoice(null); setCollecting(false); setFailed(null); done(); },
    onError: (err) => setFailed(declutterErrorMessage(err)),
  });
  if (v.problem_open) return null;
  if (v.stuck_stage === "waiting_fix") {
    return (
      <div className="space-y-2 rounded-xl border border-border p-3" data-cant-finish-fix="">
        <label htmlFor={`${id}-address`} className="block text-xs font-medium">The right address, if it changed</label>
        <AddressAutocomplete id={`${id}-address`} value={address} onChange={setAddress} onPick={(p) => setAddress([p.street, p.city, p.state, p.zipCode].filter(Boolean).join(", "))} className={input} ariaLabel="The right address" />
        <label htmlFor={`${id}-note`} className="block text-xs font-medium">What the Helpr needs to know</label>
        <textarea id={`${id}-note`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
        {failed && <p role="alert" className="text-sm text-destructive-ink">{failed}</p>}
        <button type="button" className={`${primary} disabled:opacity-50`} disabled={fix.isPending || (!note.trim() && !address.trim())} onClick={() => fix.mutate()}>Send it to {who}</button>
      </div>
    );
  }
  if (v.stuck_fault !== "helpr" || !v.stuck_stage || v.stuck_stage === "retrying") return null;
  const chosen = v.stuck_choice;
  const canCollect = v.stuck_stage === "returning" || v.stuck_stage === "collecting";
  return (
    <div className="space-y-2 rounded-xl border border-border p-3" data-cant-finish-choose="">
      {chosen === "refund" && <p className="text-sm" role="status">You chose a full refund. It's sent once the item is back with the seller.</p>}
      {chosen === "repost" && <p className="text-sm" role="status">You chose another Helpr. It's posted again once the item is back with the seller.</p>}
      <div className="flex flex-wrap gap-2">
        {chosen !== "refund" && <button type="button" className={btn} disabled={choose.isPending} onClick={() => setChoice("refund")}>Refund me in full</button>}
        {chosen !== "repost" && <button type="button" className={btn} disabled={choose.isPending} onClick={() => setChoice("repost")}>Find another Helpr</button>}
        {canCollect && chosen !== "collect" && <button type="button" className={btn} disabled={choose.isPending} onClick={() => setCollecting(true)}>I'll collect it from {who}</button>}
      </div>
      {collecting && (
        <div className="space-y-2">
          <label htmlFor={`${id}-where`} className="block text-xs font-medium">Where and when can you meet?</label>
          <textarea id={`${id}-where`} rows={2} maxLength={1000} value={where} onChange={(e) => setWhere(e.target.value)} className={input} />
          <p className="text-ds-13 text-muted-foreground">Once you tap "I got it" the seller is paid, {who} isn't, and your delivery fee comes back.</p>
          <button type="button" className={`${primary} disabled:opacity-50`} disabled={choose.isPending || !where.trim()} onClick={() => choose.mutate({ choice: "collect", note: where.trim() })}>Tell {who}</button>
        </div>
      )}
      {failed && <p role="alert" className="text-sm text-destructive-ink">{failed}</p>}
      <ConfirmSheet open={choice !== null} title={choice === "refund" ? "Get a full refund?" : "Find another Helpr?"} confirmLabel={choice === "refund" ? "Refund me" : "Find another"} pending={choose.isPending}
        onConfirm={() => { if (choice) choose.mutate({ choice, note: "" }); }} onClose={() => setChoice(null)} testId="delivery-cant-finish-choice">
        {choice === "refund"
          ? "All of your money comes back, delivery included, once the item is back with the seller. The sale is cancelled."
          : "Once the item is back with the seller, the delivery is posted again at the same price. You pay nothing more."}
      </ConfirmSheet>
    </div>
  );
}

/** The seller's side: the Helpr says it's back. */
export function SellerReturnPanel({ taskId, view: v, who }: { taskId: string; view: TaskView; who: string }) {
  const id = useId();
  const done = useDone();
  const [notBack, setNotBack] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const answer = useMutation({
    mutationFn: (back: boolean) => sellerReturnAnswer(taskId, back, note.trim()),
    onSuccess: () => { setAsking(false); setFailed(null); done(); },
    onError: (err) => { setAsking(false); setFailed(declutterErrorMessage(err)); },
  });
  if (v.stuck_stage !== "returned" || v.problem_open) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border p-3" data-cant-finish-return="">
      <p className="text-sm">{who} says it's back with you. Answer by {v.return_answer_by ? when(v.return_answer_by) : "tomorrow"}. If you don't, we count it as back.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={answer.isPending} onClick={() => setAsking(true)}>I have it back</button>
        <button type="button" className={btn} disabled={answer.isPending} onClick={() => setNotBack(true)}>It didn't come back</button>
      </div>
      {notBack && (
        <div className="space-y-2">
          <label htmlFor={`${id}-note`} className="block text-xs font-medium">What happened?</label>
          <textarea id={`${id}-note`} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
          <button type="button" className={`${btn} disabled:opacity-50`} disabled={answer.isPending || !note.trim()} onClick={() => answer.mutate(false)}>Send to Louisiana Helpr</button>
        </div>
      )}
      {failed && <p role="alert" className="text-sm text-destructive-ink">{failed}</p>}
      <ConfirmSheet open={asking} title="You have it back?" confirmLabel="I have it back" pending={answer.isPending} onConfirm={() => answer.mutate(true)} onClose={() => setAsking(false)} testId="delivery-return-back">
        The sale is cancelled and there's no payout for it.
      </ConfirmSheet>
    </div>
  );
}
