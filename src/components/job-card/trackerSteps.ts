// The open job card's tracker steps (JobTracking): what each step is called and what
// the button that reaches it says. Moved out of JobTracking.tsx whole (size ratchet).
import { MapPin, Clock, CheckCircle2, Truck, Wrench, PartyPopper, CalendarCheck, FileText, type LucideIcon } from "lucide-react";

/**
 * `label` names the STEP; `action` is what the button that reaches it SAYS.
 *
 * The next-step CTA used to render `label`, so it read "Accepted", "On the
 * Way", "Arrived", "Working", "Done" — the same five nouns the completed steps
 * directly above it already display. Nothing told the reader the button did
 * anything, and "Done" is the money-critical one: it requests the payout.
 *
 * The labels are kept SHORT on purpose. `button.tsx` sets `whitespace-nowrap`,
 * so a label that outgrows its box spills instead of wrapping. On a 320px
 * phone this button has roughly 170px of text room (card px-4, tracker p-3,
 * size="sm" px-4, an 18px icon and its gap), which is ~20 characters of the
 * 14px bold sans it renders in. The Done action reads "Mark it done"
 * (owner, 2026-09-14: name the event, not the money) — the same words as the
 * card's PayoutPrimary button, so the two controls for one action agree.
 *
 * Both step arrays are annotated with this ONE type so `displaySteps`
 * (`[...PRE_STATUSES, ...STATUSES]`) stays a single array type rather than a
 * union of two shapes the `.map` below would have to reconcile.
 */
export type TrackerStep = {
  key: string;
  label: string;
  /** Action phrasing for the next-step CTA; `null` where the step is never a
   *  button target. */
  action: string | null;
  icon: LucideIcon;
  color: string;
};

export const STATUSES: TrackerStep[] = [
  // Step 0 is never the TARGET of the next-step button (nextIdx is always
  // currentStatusIdx + 1 ≥ 1), so it has no action phrasing.
  { key: "assigned", label: "Offered", action: null, icon: Clock, color: "text-muted-foreground" },
  { key: "confirmed", label: "Accepted", action: "I've accepted", icon: CheckCircle2, color: "text-primary" },
  // CalendarCheck, not ShieldCheck: at the 16px the step row draws these at,
  // a shield-with-a-tick and the circle-with-a-tick above it were two dark
  // rings with a check in them and read as the same step twice. This one means
  // "both sides confirmed, the date is locked", which a calendar says plainly
  // and cannot be confused with "Accepted".
  { key: "job_confirmed", label: "Confirmed", action: "Confirm this job", icon: CalendarCheck, color: "text-primary" },
  { key: "on_the_way", label: "On the way", action: "I'm on my way", icon: Truck, color: "text-primary" },
  { key: "arrived", label: "Arrived", action: "I've arrived", icon: MapPin, color: "text-primary" },
  { key: "working", label: "Working", action: "Start working", icon: Wrench, color: "text-primary" },
  { key: "done", label: "Done", action: "Mark it done", icon: PartyPopper, color: "text-primary" },
];

/**
 * The two steps that happen BEFORE anyone is offered the job. A poster's own
 * card starts life at "Posted" with nobody assigned, so without these the
 * tracker had nothing to say until a helper had already been picked — which is
 * why an open job showed no tracker at all. They are PREPENDED (never
 * substituted) so a job that advances keeps one continuous timeline, and they
 * reuse the exact step shape/styling of `STATUSES` rather than introducing a
 * second tracker.
 */
/**
 * ONE pre-assignment step, not two (owner: "I think posted and applicants can
 * be merged").
 *
 * They were never two things that happen in sequence — a job is posted, and
 * applications arrive against that same posted job — so the tracker spent two
 * of its nine columns on one state, and the count they conveyed is already on
 * the card. The step's icon and caption carry the difference now: a file with
 * no caption while nobody has applied, and the people icon with "N applied"
 * underneath once they have.
 */
export const PRE_STATUSES: TrackerStep[] = [
  // Pre-assignment, so never a helper button target — hence `action: null`.
  { key: "posted", label: "Posted", action: null, icon: FileText, color: "text-primary" },
];
