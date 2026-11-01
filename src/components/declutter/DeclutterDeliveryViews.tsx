/**
 * Declutter slice 5 screens, Helpr delivery (docs/specs/declutter-auctions.md
 * rows 24, 29-30, 40-43; B59-B72):
 *   - OrderDeliveryPanel: the buyer's and the seller's view of a paid delivery
 *     order (waiting for a Helpr, the pickup time, on its way, at the door), the
 *     buyer's "I got it" (no drop-off code: owner 2026-10-18), the photos from both ends;
 *   - DeliverView (/declutter?view=deliver): a Helpr's vehicle (row 41), the
 *     deliveries near them they can take with a pickup time, and their own
 *     deliveries: the exact addresses, "Picked up" photo at the pickup, the
 *     drop-off with a door photo, backing out, "The seller
 *     wasn't there", and their pay.
 * Built on the shared Helpr task module (src/lib/helprTasks/api.ts); every rule
 * is enforced in SQL (20261017055505), these screens only explain it.
 */
import { NextStep } from "@/components/ui/NextStep";
import { stillInHandLine } from "@/lib/declutter/stillInHand";
import { DELIVERY_ADDRESSES_SHOW } from "@/lib/declutter/deliveryAddressWords";
import { useEffect, useState } from "react";
import { DeliveryTalkButton } from "./DeliveryTalk";
import { BuyerCantFinishPanel, buyerMayConfirm, cantFinishLine, HelprCantFinish, SellerReturnPanel } from "./DeliveryCantFinish";
import { invalidateTasks, useTaskSteps } from "./useTaskSteps";
import { DeliveryRoute } from "./DeliveryRoute";
import { SellerHandedOver } from "./SellerHandedOver";
import { HelprNoShowAnswer, HelprNoShowReportButton } from "./DeclutterNoHelpr";
import { RouteSuggestions } from "./RouteSuggestions";
import { GoOnlineCard } from "./GoOnlineCard";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import { DeclutterNotice } from "./declutterUi";
import { useHiredPayoutPrompt } from "@/components/payouts/useHiredPayoutPrompt";
import { HiredPayoutSetupDialog } from "@/components/payouts/HiredPayoutSetupDialog";
import { payoutAccountReady } from "@/lib/payoutAfterHire";
import { StepTracker } from "@/components/tracker/StepTracker";
import { DeliveryRaisePanel } from "./DeliveryRaisePanel";
import { deliveryRaiseQuery } from "@/lib/declutter/deliveryRaiseQuery";
import { DeliveryTipPanel } from "./DeliveryTipPanel";
import { ProblemForm } from "./DeclutterProblemForm";
import { fetchTipsOnMyDeliveries } from "@/lib/declutter/deliveryTip";
import { TaskPickupTime } from "./DeclutterPickupWindows";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { currentPosition } from "@/lib/declutter/position";
import { BusyAreasCard } from "@/components/busyAreas/BusyAreasCard";
import { DeliverExplainer } from "./DeclutterDeliverExplainer";
import { VehicleForm } from "./DeliverVehicleForm";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { markReviewPrompt } from "@/lib/declutter/reviewPrompt";
import { sellerPayoutRule } from "@/lib/declutter/sellerPayoutRule";
import {
  acceptTask,
  confirmReceived,
  fetchMyTasks,
  fetchMyVehicle,
  fetchOpenCount,
  fetchOpenTasks,
  fetchTaskView,
  releaseTask,
  taskPhotoUrl,
  type MyTask,
  type OpenTask,
  type TaskSize,
  type TaskView,
} from "@/lib/helprTasks/api";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";
const primary = "btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold";

const SIZE_WORDS: Record<TaskSize, string> = {
  small: "Small (fits in a car)",
  large: "Large (needs a truck)",
  xl: "Extra large (truck and two people)",
};

const DELIVERY_STEPS = ["Booked", "Picked up", "Delivered"] as const;
const DELIVERY_STEP: Partial<Record<TaskView["status"], number>> = { accepted: 0, picked_up: 1, delivered: 2, confirmed: 2 };
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** AUD31-27: the Louisiana day a finished delivery ended, "Thu, Oct 29". */
const ENDED_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A private task photo through a short-lived signed URL. */
function TaskPhoto({ path, label }: { path: string; label: string }) {
  const url = useQuery({ queryKey: ["helpr-tasks", "photo", path], queryFn: () => taskPhotoUrl(path), staleTime: 5 * 60_000 });
  if (url.isError) {
    return (
      <p className="text-xs" role="alert">
        {label}: the photo couldn't load.{" "}
        <button type="button" className="underline" onClick={() => void url.refetch()}>Try again</button>
      </p>
    );
  }
  if (!url.data) return null;
  return (
    <figure className="space-y-1">
      <img src={url.data} alt={label} className="h-32 w-32 rounded-lg bg-photo-empty object-cover" loading="lazy" />
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

function TaskPhotos({ view }: { view: TaskView }) {
  if (!view.pickup_photo_path && !view.dropoff_photo_path) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {view.pickup_photo_path && <TaskPhoto path={view.pickup_photo_path} label="At the pickup" />}
      {view.dropoff_photo_path && <TaskPhoto path={view.dropoff_photo_path} label="At the drop-off" />}
    </div>
  );
}

/**
 * BUY-22 (buying audit 10-30), the D2-9 rule for a Helpr delivery: pickups hold "Report a problem" back until the
 * booked pickup is over (pickupTimeOver, 15 minutes past it), and a Helpr delivery offered it while nobody had even
 * taken the job. Now the button shows once the Helpr has the item (picked up, delivered or confirmed), or 15 minutes
 * after the Helpr's booked pickup time (a Helpr who never came). Still finding a Helpr, unfilled or closed: none (no
 * Helpr is what DeclutterNoHelpr answers). The sheet itself can still be opened from the order's other buttons.
 */
export function deliveryProblemTimeCame(v: Pick<TaskView, "status" | "pickup_slot_start">, now = Date.now()): boolean {
  if (v.status === "picked_up" || v.status === "delivered" || v.status === "confirmed") return true;
  return v.status === "accepted" && !!v.pickup_slot_start && now >= new Date(v.pickup_slot_start).getTime() + 15 * 60_000;
}

/**
 * What the buyer or the seller reads about a paid delivery order. `tipOnly`: the handed-over
 * order card (after "I got it" the order is handed_over and the card no longer shows this
 * panel) shows just the buyer's tip, so the Helpr can still be tipped (audit 2026-10-28 A3-1).
 */
/** `askGot` (D3-7): opened from the card's "I got it", so the confirm sheet opens once the task says it can. */
/** `problemForm`: the order card's "Report a problem" lives here, so it can wait for the task (deliveryProblemTimeCame). */
export function OrderDeliveryPanel({ taskId, side, orderId, tipOnly = false, askGot: askOnOpen = false, problemForm = false }: { taskId: string; side: "buyer" | "seller"; orderId: string; tipOnly?: boolean; askGot?: boolean; problemForm?: boolean }) {
  const qc = useQueryClient();
  const task = useQuery({ queryKey: ["helpr-tasks", "view", taskId], queryFn: () => fetchTaskView(taskId), meta: { persist: false } });
  // A2-7: the buyer's raise read starts NOW, beside the task read, not once the task has loaded and the panel mounts.
  useQuery({ ...deliveryRaiseQuery(orderId), enabled: side === "buyer" });
  // "I got it" asks in the app, never window.confirm (lead 2026-10-28; DeclutterConfirmSheet).
  const [askGot, setAskGot] = useState(false);
  const gotIt = useMutation({
    mutationFn: () => confirmReceived(taskId),
    onSettled: () => setAskGot(false),
    onSuccess: () => {
      markReviewPrompt(orderId);
      toast("Delivery done. Enjoy your item.");
      invalidateTasks(qc);
      void qc.invalidateQueries({ queryKey: ["declutter", "handover", orderId] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const mayAsk = askOnOpen && !tipOnly && side === "buyer" && (task.data?.status === "picked_up" || task.data?.status === "delivered");
  useEffect(() => { if (mayAsk) setAskGot(true); }, [mayAsk]);
  if (task.isError) {
    return <ErrorState variant="inline" title="We couldn't load this delivery." body={declutterErrorMessage(task.error)} onRetry={() => void task.refetch()} />;
  }
  if (task.isLoading || !task.data) return tipOnly ? null : <p className="text-sm text-muted-foreground" role="status">Loading the delivery…</p>;
  const v = task.data;
  if (tipOnly) return side === "buyer" && v.status === "confirmed" ? <DeliveryTipPanel taskId={taskId} helprFirstName={v.helpr_first_name} /> : null;
  const who = v.helpr_first_name ?? "Your Helpr";
  let line: string;
  if (v.status === "open") {
    line = side === "buyer"
      ? `Finding a Helpr. If nobody takes it by ${when(v.open_until)}, what you paid for delivery comes back and you pick it up at the seller's home instead.`
      : "Finding a Helpr. You'll be told the pickup time.";
  } else if (v.status === "accepted" && v.pickup_slot_start) {
    line = side === "buyer"
      ? `${who} picks it up from the seller ${when(v.pickup_slot_start)}.`
      : `${who} picks it up ${when(v.pickup_slot_start)}. Have it ready.`;
  } else if (v.status === "picked_up") {
    // Audit 1c #1: without the seller's "Handed over" the seller reads it as the Helpr's word.
    line = side === "buyer"
      ? stillInHandLine(who, v.picked_up_at) ?? `${who} has your item and is on the way.`
      : v.handed_over_at
        ? `${who} picked it up. You're paid when the buyer has it.`
        : `${who} says it was picked up. You're paid when the buyer has it. If you didn't hand it over, report a problem.`;
  } else if (v.status === "delivered" && v.delivered_at) {
    line = side === "buyer"
      ? `${who} left it at your drop-off address ${when(v.delivered_at)}. Tap "I got it". If something is wrong, report a problem before it confirms itself ${when(new Date(new Date(v.delivered_at).getTime() + 24 * 3_600_000).toISOString())}.`
      // LEAD-DOOR-PAYLINE: the seller's rule for a Helpr delivery (sellerPayoutRule): "after 24 hours" was a day early.
      : `${who} left it at the buyer's address. ${sellerPayoutRule("delivery")}`;
  } else if (v.status === "confirmed") {
    line = "Delivered.";
  } else if (v.status === "unfilled") {
    line = "No Helpr took this delivery. What you paid for delivery was refunded.";
  } else if (v.status === "failed") {
    // BUY-45: the buyer read only "This delivery was closed" (declutter_admin_decide_delivery_damage: decided as damaged).
    line = side === "buyer" ? "Louisiana Helpr decided this delivery as damaged on the way. What happens to your money shows on this order." : "Louisiana Helpr decided this delivery as damaged on the way.";
  } else if (v.status === "cancelled") {
    line = side === "buyer" ? "This delivery was cancelled. What happens to your money shows on this order." : "This delivery was cancelled.";
  } else {
    line = "This delivery was closed.";
  }
  // BUY-36: where a delivery the Helpr can't finish stands replaces the line above.
  const cantFinish = v.status === "picked_up" ? cantFinishLine(v, side, who) : null;
  if (cantFinish) line = cantFinish;
  const collecting = v.stuck_stage === "collecting";
  // BUY-39: never while it is on the road (it finished the sale with the item in the Helpr's car); from the drop-off,
  // or once the Helpr has held it 24 hours without marking it delivered (BUY-37's "If you have it, tap I got it").
  // BUY-36: a buyer collecting it from a Helpr at fault confirms when they have it (the server skips BUY-39 then).
  const canConfirm = side === "buyer" && buyerMayConfirm(v)
    && (v.status === "delivered" || (v.status === "picked_up" && (collecting || stillInHandLine(who, v.picked_up_at) !== null)));
  // Board 76: the one tracker, Booked -> Picked up -> Delivered, once a Helpr has it.
  const at = DELIVERY_STEP[v.status];
  // Each real step, with its own time, as a centred progress note (spec §3 status bubbles).
  const events = [
    v.accepted_at && { key: "a", text: `${who} took the delivery`, at: v.accepted_at },
    v.picked_up_at && { key: "p", text: side === "seller" && !v.handed_over_at ? `${who} says it was picked up` : `${who} picked it up from the seller`, at: v.picked_up_at },
    v.delivered_at && { key: "d", text: `${who} left it at the drop-off`, at: v.delivered_at },
  ].filter(Boolean) as { key: string; text: string; at: string }[];
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="text-ds-15 font-semibold line-clamp-2" title={v.title}>{v.title}</p>
        <p className="text-ds-13 text-muted-foreground">{v.pickup_area} to {v.dropoff_area} · {SIZE_WORDS[v.size]}</p>
      </div>
      {at !== undefined && <StepTracker steps={DELIVERY_STEPS} at={at} />}
      <p className="text-sm">{line}</p>
      {events.length > 0 && (
        <ul className="flex flex-col items-center gap-1.5" aria-label="What happened">
          {events.map((e) => (
            <li key={e.key} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-ds-12 text-foreground">
              <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
              {e.text} · {clock(e.at)}
            </li>
          ))}
        </ul>
      )}
      <TaskPhotos view={v} />
      {/* Q1929 (row 40): the buyer may raise the pay while no Helpr has it; it also lists their raises. */}
      {side === "buyer" && <DeliveryRaisePanel orderId={orderId} />}
      {/* Q2453: once it is done, the buyer may tip the Helpr (the job tip's money, 100% to the Helpr). */}
      {side === "buyer" && v.status === "confirmed" && <DeliveryTipPanel taskId={taskId} helprFirstName={v.helpr_first_name} />}
      {canConfirm && (
        <button type="button" className={primary} disabled={gotIt.isPending} onClick={() => setAskGot(true)}>
          I got it
        </button>
      )}
      {["accepted", "picked_up", "delivered"].includes(v.status) && <DeliveryTalkButton taskId={taskId} />}
      {side === "buyer" && v.status === "picked_up" && <BuyerCantFinishPanel taskId={taskId} view={v} who={who} />}
      {side === "seller" && v.status === "picked_up" && <SellerReturnPanel taskId={taskId} view={v} who={who} />}
      {/* Audit 1c #1: the seller confirms the handover; it changes no status and moves no money. */}
      {/* soldstates-5 (owner 10-31): the seller's "The Helpr didn't come"; the Helpr has 24 hours to answer. */}
      {side === "seller" && v.status === "accepted" && v.pickup_slot_start && !v.problem_open && !v.handed_over_at && <HelprNoShowReportButton orderId={orderId} taskId={taskId} slotStart={v.pickup_slot_start} who={who} />}
      {side === "seller" && v.status === "accepted" && !v.problem_open && <SellerHandedOver taskId={taskId} orderId={orderId} who={who} handedOverAt={v.handed_over_at} pickupAt={v.pickup_slot_start} />}
      {problemForm && <ProblemForm orderId={orderId} side={side} stage="delivery" trigger={deliveryProblemTimeCame(v)} />}
      <ConfirmSheet open={askGot} title="Do you have it?" confirmLabel="I got it" pending={gotIt.isPending}
        onConfirm={() => gotIt.mutate()} onClose={() => setAskGot(false)} testId="delivery-got-it">
        {collecting ? "Tapping I got it pays the seller. The Helpr isn't paid, and you get back what you paid for the delivery." : "Tapping I got it finishes the sale: the Helpr and the seller are paid. You can still ask the seller for a refund within 24 hours."}
      </ConfirmSheet>
    </div>
  );
}

/**
 * One open delivery a Helpr can take (board 50, spec §9.14): what it is, the
 * pickup -> drop-off route as AREAS only, what is being carried, the take-home
 * after the Helpr fee, then a pickup time inside the seller's times and
 * "Accept delivery". Every figure is the task row's (helpr_tasks_open_near).
 */
function OpenTaskRow({ t }: { t: OpenTask }) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  // Q2416 (owner 2026-10-27): taking a delivery needs no payout account; right after it, a Helpr
  // without one is asked to set it up, the same prompt as a hired Helpr (pay held until then).
  const hiredPayout = useHiredPayoutPrompt();
  // The seller's pickup times as day + time chips (TaskPickupTime, 20261028232930).
  const [chosen, setChosen] = useState<string | null>(null);
  const [showWay, setShowWay] = useState(false);
  const [taken, setTaken] = useState(false);
  const take = useMutation({
    mutationFn: (iso: string) => acceptTask(t.task_id, iso),
    onSuccess: () => {
      // Audit 1c D3-8: the task is no longer open, so its pickup-times read would answer task_not_found (a 500).
      setTaken(true);
      qc.removeQueries({ queryKey: ["helpr-tasks", "task-pickup-windows", t.task_id] });
      toast.success("Delivery accepted. The seller and the buyer are told your pickup time.", {
        action: { label: "See it", onClick: () => document.querySelector('[aria-label="Your deliveries"]')?.scrollIntoView({ block: "start" }) },
      });
      setChosen(null);
      invalidateTasks(qc);
      if (user?.id) void hiredPayout.offer(user.id);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const miles = (n: number) => `about ${n} ${n === 1 ? "mile" : "miles"}`;
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-4">
      <div className="space-y-1">
        <p className="text-ds-12 font-semibold text-primary">Helpr delivery</p>
        <p className="text-ds-17 font-bold leading-snug line-clamp-2" title={t.title}>{t.title}</p>
        <p className="text-ds-13 text-muted-foreground">Pick up by {when(t.latest_pickup_at)}</p>
      </div>
      <ol className="space-y-3" aria-label="Route">
        <li className="relative flex gap-3">
          <span aria-hidden className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-primary" />
          <span aria-hidden className="absolute left-[5px] top-5 h-[calc(100%+0.25rem)] w-0.5 bg-border" />
          <div className="min-w-0">
            <p className="text-ds-15 font-semibold">Pick up in {t.pickup_area}</p>
            <p className="text-ds-13 text-muted-foreground">
              From the seller{t.miles_to_pickup !== null ? ` · ${miles(t.miles_to_pickup)} from you` : ""}
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="mt-1 h-3 w-3 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <p className="text-ds-15 font-semibold">Drop off near {t.dropoff_area}</p>
            <p className="text-ds-13 text-muted-foreground">To the buyer · {miles(t.trip_miles)}</p>
          </div>
        </li>
      </ol>
      <div className="space-y-0.5">
        <p className="text-ds-13 font-semibold">What you're carrying</p>
        <p className="text-ds-13 text-muted-foreground">{SIZE_WORDS[t.size]}</p>
      </div>
      <div className="rounded-xl bg-[hsl(var(--burnt-sienna)/0.08)] p-3 space-y-1">
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-ds-15 font-semibold">You take home</span>
          <span className="text-ds-22 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(t.take_home_cents)}</span>
        </p>
        <p className="text-ds-12 text-muted-foreground">
          Paid when the buyer confirms it arrived, or 24 hours after you leave it. Take a photo at the pickup and at the drop-off.
        </p>
      </div>
      <p className="text-ds-12 text-muted-foreground">{DELIVERY_ADDRESSES_SHOW}</p>
      <div className="space-y-2">
        <p className="block text-ds-13 font-semibold">Pickup time</p>
        <TaskPickupTime taskId={t.task_id} by={when(t.latest_pickup_at)} value={chosen} onPick={setChosen} enabled={!taken} />
        <button type="button" className={`${primary} w-full min-h-12 text-ds-16 disabled:opacity-50`} disabled={take.isPending || !chosen}
          onClick={() => { if (chosen) take.mutate(chosen); }}>
          Accept delivery
        </button>
      </div>
      {/* "On your way" (owner 2026-10-27): other open deliveries that add little to this one. */}
      <button type="button" className="text-ds-13 font-semibold underline min-h-11" aria-expanded={showWay} onClick={() => setShowWay((v) => !v)}>
        {showWay ? "Hide deliveries on the way" : "Deliveries on the way"}
      </button>
      {showWay && <RouteSuggestions withTaskId={t.task_id} />}
      {hiredPayout.open && <HiredPayoutSetupDialog open onOpenChange={(o) => { if (!o) hiredPayout.close(); }} />}
    </li>
  );
}

/**
 * Q2416: a Helpr who took deliveries without a payout account is told, on their own list, that the pay
 * waits for the account, with the way to set it up (or the paused / needs-hire notice). A test account
 * that is fixture-shaped (is_seed, no account) is never asked (payoutAccountReady's caller rule).
 */
function DeliveryPayoutHeld({ tasks }: { tasks: MyTask[] }) {
  const { profile } = useCurrentUser();
  const setupPaused = usePayoutSetupPaused();
  // Pay still to come: a delivery in hand, or a confirmed one whose payout has not gone out.
  const owed = tasks.some((t) => ["accepted", "picked_up", "delivered"].includes(t.status)
    || (t.status === "confirmed" && t.payout_status !== "succeeded" && t.payout_status !== "nothing_due"));
  if (!profile || !owed || payoutAccountReady(profile)) return null;
  if (profile.is_seed === true && !profile.stripe_account_id) return null;
  if (setupPaused) {
    return <PayoutSetupPausedNotice />;
  }
  return (
    <DeclutterNotice title="Set up payouts to get paid for your deliveries.">
      Your delivery pay is held until your payout account is ready.{" "}
      <Link to="/profile?tab=payment" className="underline font-semibold">Set up payouts</Link>
    </DeclutterNotice>
  );
}

/**
 * One delivery the Helpr took: the addresses, its state and Back out. Audit 1c D3-9: the photo steps live on Your route's
 * stop cards only (every delivery in hand is a stop there, except one held by a problem, which has no step anyway).
 */
function MyTaskCard({ t, userId, tipCents = 0 }: { t: MyTask; userId: string; tipCents?: number }) {
  const active = t.status === "accepted" || t.status === "picked_up" || t.status === "delivered";
  // Exact addresses: never written to the on-device query cache (lh-authz-rls review #6).
  const view = useQuery({ queryKey: ["helpr-tasks", "view", t.task_id], queryFn: () => fetchTaskView(t.task_id), enabled: active, meta: { persist: false } });
  const { done } = useTaskSteps(t.task_id, userId);
  // Back out asks in the app, never window.confirm (lead 2026-10-28); "the seller wasn't there" is SellerAwayStep's.
  const [ask, setAsk] = useState<{ kind: "backOut" } | null>(null);
  const backOut = useMutation({
    mutationFn: () => releaseTask(t.task_id),
    onSettled: () => setAsk(null),
    onSuccess: (r) => done(r.strike ? "You backed out less than 2 hours before the pickup, so you got a delivery strike." : "You backed out. Another Helpr can take it."),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const v = view.data;
  const toRoute = (
    <button type="button" className="min-h-11 text-left text-ds-13 font-semibold underline" data-task-steps-on-route=""
      onClick={() => document.querySelector('[aria-label="Your route"]')?.scrollIntoView({ block: "start" })}>
      Take the photo at this stop on your route
    </button>
  );
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-2">
      <p className="font-semibold truncate" title={t.title}>{t.title}</p>
      {/* AUD31-27: a delivery that ended unpaid (closed, unfilled, damaged) promises no pay; the line under says why. */}
      <p className="text-sm text-muted-foreground">{SIZE_WORDS[t.size]}{active || t.status === "confirmed" ? <> · {formatPrice(t.take_home_cents)} for you</> : null}</p>
      {!active && (
        <p className="text-sm">
          {t.status === "confirmed"
            ? t.payout_status === "succeeded" ? "Delivered and paid."
              : t.payout_status === "failed" ? "Delivered. Your pay didn't go through yet. Check that your payout account is set up."
                : "Delivered. Your pay is on its way."
            : t.status === "failed" ? "Decided as damaged in delivery. Not paid." : "Closed."}
          {/* AUD31-27: every finished row says the day it ended (when the server sends it). */}
          {t.ended_at && <span className="text-muted-foreground" data-task-ended=""> {ENDED_DAY.format(new Date(t.ended_at))}</span>}
        </p>
      )}
      {/* Deep audit #40: after the drop-off photo the card said nothing until the buyer confirmed. */}
      {t.status === "delivered" && (
        <div role="status" data-task-delivered="">
          <NextStep className="!text-sm" value={{ who: "them", text: "Delivered. Waiting for the buyer to confirm it arrived." }} />
        </div>
      )}
      {/* Q2453: the buyer's tip, all of it the Helpr's (Stripe sends it straight to their account). */}
      {tipCents > 0 && <p className="text-sm">The buyer tipped you {formatPrice(tipCents)}.</p>}
      {active && view.isError && <p className="text-sm" role="alert">{declutterErrorMessage(view.error)}</p>}
      {active && v && (
        <>
          {/* The shared next-step line (owner 11-01 12:02 PM): the Helpr's move on this delivery, with the pickup time.
              The steps themselves are on the route (toRoute). */}
          {!v.problem_open && v.status === "accepted" && (
            <NextStep className="!text-sm" value={{ who: "you", text: "Pick it up from the seller", by: v.pickup_slot_start ? when(v.pickup_slot_start) : null }} />
          )}
          {v.status === "picked_up" && !v.stuck_stage && (
            <NextStep className="!text-sm" value={{ who: "you", text: "Take it to the buyer and tap Left at the door" }} />
          )}
          {v.pickup_slot_start && <p className="text-sm">Pickup: <span className="font-medium">{when(v.pickup_slot_start)}</span></p>}
          {v.pickup_address && <p className="text-sm">Pick up at: <span className="font-medium">{v.pickup_address}</span></p>}
          {v.dropoff_address && <p className="text-sm">Deliver to: <span className="font-medium">{v.dropoff_address}</span></p>}
          {/* Audit 1c #4: after "The seller wasn't there" (or any problem on the sale) the steps wait for the decision. */}
          {v.status === "accepted" && v.problem_open && (
            <p className="text-sm font-semibold" role="status" data-task-held="">Reported. Louisiana Helpr is deciding.</p>
          )}
          {v.status === "accepted" && !v.problem_open && (
            <>
              {v.handed_over_at && <p className="text-sm" data-task-handed-over="">The seller says they handed it over.</p>}
              {toRoute}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn} disabled={backOut.isPending}
                  onClick={() => setAsk({ kind: "backOut" })}>
                  Back out
                </button>
              </div>
            </>
          )}
          {(v.status === "accepted" || v.status === "picked_up") && <HelprNoShowAnswer taskId={t.task_id} />}
          {v.status === "picked_up" && !v.stuck_stage && toRoute}
          {["accepted", "picked_up", "delivered"].includes(v.status) && <DeliveryTalkButton taskId={t.task_id} />}
          {v.status === "picked_up" && <HelprCantFinish taskId={t.task_id} userId={userId} />}
          <TaskPhotos view={v} />
        </>
      )}
      <ConfirmSheet open={ask?.kind === "backOut"} title="Back out of this delivery?" confirmLabel="Back out" pending={backOut.isPending}
        onConfirm={() => backOut.mutate()} onClose={() => setAsk(null)} testId="delivery-back-out">
        {/* AUD31-26: say whether THIS back-out costs a strike (helpr_task_release: late = under 2 hours before the
            pickup, and free whenever the seller moved the time, which this view cannot see). */}
        Another Helpr can take it. {backOutCostsStrike(v?.pickup_slot_start)
          ? "It's less than 2 hours before the pickup, so backing out now costs a delivery strike, unless the seller moved the time."
          : "It's more than 2 hours before the pickup, so backing out now costs no strike."}
      </ConfirmSheet>
    </li>
  );
}

/** helpr_task_release's late rule: under 2 hours before the booked pickup (or no time read yet: say the worst). */
export function backOutCostsStrike(pickupSlotStart: string | null | undefined, now: number = Date.now()): boolean {
  if (!pickupSlotStart) return true;
  const t = new Date(pickupSlotStart).getTime();
  return !Number.isFinite(t) || now > t - 2 * 3_600_000;
}

/**
 * The answers helpr_task_assert_helpr gives a member who may not deliver YET (Q2351, measured
 * 2026-10-27: 233 of 234 members on prod had no payout account, so every one of them who opened
 * this page saw "We couldn't load deliveries." and filed an error_logs row). They are who-may-deliver
 * rules, not failures: a plain notice with the next step, never ErrorState.
 */
const DELIVER_NOT_YET = ["payout_setup_incomplete", "under_18", "declutter_strikes_blocked", "account_restricted"] as const;
type DeliverNotYet = (typeof DELIVER_NOT_YET)[number];

export function deliverNotYet(err: unknown): DeliverNotYet | null {
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === "string" && (DELIVER_NOT_YET as readonly string[]).includes(m.trim()) ? (m.trim() as DeliverNotYet) : null;
}

function DeliverNotYetNotice({ code }: { code: DeliverNotYet }) {
  const setupPaused = usePayoutSetupPaused();
  if (code === "payout_setup_incomplete") {
    if (setupPaused) return <PayoutSetupPausedNotice />;
    return (
      <DeclutterNotice title="Set up payouts to deliver.">
        We pay you for each delivery through your payout account.{" "}
        <Link to="/profile?tab=payment" className="underline font-semibold">Set up payouts</Link>
      </DeclutterNotice>
    );
  }
  if (code === "under_18") return <DeclutterNotice title="You must be 18 or older to deliver." />;
  return <DeclutterNotice title="Deliveries aren't open to you right now.">{declutterErrorMessage({ message: code })}</DeclutterNotice>;
}

/** /declutter?view=deliver: a Helpr's vehicle, deliveries to take, and their own deliveries. */
export function DeliverView() {
  const { user } = useCurrentUser();
  const userId = user?.id ?? "";
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const mine = useQuery({ queryKey: ["helpr-tasks", "mine"], queryFn: fetchMyTasks, enabled: !!userId });
  // Q2452: no car, no deliveries (the server lists, offers and lets take none); the same query VehicleForm reads.
  const vehicle = useQuery({ queryKey: ["helpr-tasks", "vehicle", userId], queryFn: () => fetchMyVehicle(userId), enabled: !!userId });
  const noCar = vehicle.isSuccess && !vehicle.data?.has_car;
  // Where "Your vehicle" sits is decided once, from the first read, so saving the first car never moves (remounts) it.
  const [vehicleFirst, setVehicleFirst] = useState<boolean | null>(null);
  if (vehicleFirst === null && vehicle.isSuccess) setVehicleFirst(!vehicle.data?.has_car);
  // Q2453: tips on the Helpr's deliveries (a failed read only hides the tip line).
  const tips = useQuery({ queryKey: ["helpr-tasks", "tips", userId], queryFn: () => fetchTipsOnMyDeliveries(userId), enabled: !!userId });
  const open = useQuery({ queryKey: ["helpr-tasks", "open", where?.lat ?? null, where?.lng ?? null], queryFn: () => fetchOpenTasks(where), enabled: !!userId });
  // Audit 1c D3-6: every open delivery, whatever the vehicle, by area (a failed read only hides the count and the map).
  const counts = useQuery({ queryKey: ["helpr-tasks", "open-count"], queryFn: fetchOpenCount, enabled: !!userId });
  const locate = useMutation({
    mutationFn: currentPosition,
    onSuccess: (p) => setWhere(p),
    // Audit 3 (A3-2): the shared location_required words talk about a pickup address; sorting the list is not that.
    onError: (err) =>
      toast.error(err instanceof Error && err.message === "location_required" ? "Turn on location to see the nearest deliveries first." : declutterErrorMessage(err)),
  });
  if (!userId) return null;
  const myList = mine.data ?? [];
  // What Deliver is and what a driver earns, from the real pay rule (owner 2026-10-28: "just explain it better").
  const intro = <DeliverExplainer />;
  // Q2351: who may deliver is a designed answer (helpr_task_assert_helpr), never an error screen.
  const notYet = deliverNotYet(open.error) ?? deliverNotYet(mine.error);
  if (notYet) {
    return (
      <div className="space-y-6">
        {intro}
        <DeliverNotYetNotice code={notYet} />
      </div>
    );
  }
  // Audit DD D1 (lead 2026-10-30): a Helpr with no car starts at "Your vehicle" (step 1) under the full explainer; once a
  // car is saved, the deliveries to take come first, Go online appears, and the explainer folds to its title.
  const setUp = vehicle.isSuccess && !!vehicle.data?.has_car;
  const openList = open.data ?? [];
  const busyRows = counts.data ?? openList;
  const waiting = (counts.data ?? []).reduce((n, r) => n + r.open_count, 0);
  return (
    <div className="space-y-6">
      {setUp ? <DeliverExplainer collapsed /> : intro}
      {vehicleFirst === true && <VehicleForm userId={userId} />}
      {myList.some((t) => t.status === "accepted" || t.status === "picked_up") && <DeliveryRoute userId={userId} where={where} />}
      <section className="space-y-3" aria-label="Deliveries near you">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Deliveries you can take</h2>
          {setUp && (
            <button type="button" className={btn} disabled={locate.isPending} onClick={() => locate.mutate()}>
              {where ? "Update my location" : "Nearest first"}
            </button>
          )}
        </div>
        {noCar && waiting > 0 && (
          <p className="text-sm font-semibold" data-open-count="">{waiting === 1 ? "1 delivery is waiting." : `${waiting} deliveries are waiting.`}</p>
        )}
        {noCar ? (
          <p className="text-sm text-muted-foreground" role="status">Add your car under Your vehicle to take deliveries.</p>
        ) : open.isError ? (
          <ErrorState variant="inline" title="We couldn't load deliveries." body={declutterErrorMessage(open.error)} onRetry={() => void open.refetch()} />
        ) : open.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading deliveries…</p>
        ) : openList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliveries to take right now.{vehicle.data?.has_truck ? "" : " Large items only show once you add a truck."}</p>
        ) : (
          <ul className="space-y-3">{openList.map((t) => <OpenTaskRow key={t.task_id} t={t} />)}</ul>
        )}
      </section>
      <section className="space-y-3" aria-label="Your deliveries">
        <h2 className="text-base font-semibold">Your deliveries</h2>
        {mine.isError ? (
          <ErrorState variant="inline" title="We couldn't load your deliveries." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />
        ) : mine.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading your deliveries…</p>
        ) : myList.length === 0 ? (
          <p className="text-sm text-muted-foreground">You haven't taken a delivery yet.</p>
        ) : (
          <>
            <DeliveryPayoutHeld tasks={myList} />
            <ul className="space-y-3">{myList.map((t) => <MyTaskCard key={t.task_id} t={t} userId={userId} tipCents={tips.data?.get(t.task_id) ?? 0} />)}</ul>
          </>
        )}
      </section>
      {setUp && <GoOnlineCard userId={userId} where={where} />}
      {/* Q2435, narrowed by audit DD D2: where open deliveries wait, by parish (counts only); shown only when one does. */}
      {busyRows.length > 0 && <BusyAreasCard deliveries={busyRows} />}
      {vehicleFirst === false && <VehicleForm userId={userId} />}
    </div>
  );
}
