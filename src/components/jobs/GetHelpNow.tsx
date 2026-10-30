import { useNavigate } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { helpOrderSubject, helpSupportSubject } from "@/lib/supportSubject";
import { SUPPORT_REPLY_PROMISE } from "@/lib/supportTopics";

/** Active jobs: hired and not yet done (a disputed job too: the dispute is still open). */
export const GET_HELP_NOW_STATUSES: ReadonlySet<string> = new Set(["accepted", "in_progress", "revision_requested", "disputed"]);

/**
 * "Get help now" (owner decided 2026-10-29, Q2478 part 3; audit page CMP-3): one tap from an active job to
 * Louisiana Helpr. It opens /support with "Talk to a real person" chosen and the job named in the subject
 * (its title and short id, the way the dispute chips do it: helpSupportSubject), so the message lands in the
 * admin support queue, the support inbox and Slack (contact-support) with the job attached. It promises the
 * shared SUPPORT_REPLY_PROMISE, "We usually answer within a few hours."
 *
 * Shown to both sides of the job (never role-based); nothing on an open, done or cancelled job.
 * Guard: src/test/getHelpNow.test.tsx.
 */
export function GetHelpNow({ job }: { job: { id: string; title?: string | null; status?: string | null } }) {
  if (!GET_HELP_NOW_STATUSES.has(job.status ?? "")) return null;
  return <GetHelpButton subject={helpSupportSubject(job)} />;
}

/**
 * The same one tap on a Declutter order (CMP-3; both sides of the order, never role-based). Only while the order
 * needs help: paid and not yet handed over, or handed over with a problem still open. Named as a list of what shows,
 * so every other status stays off: a refunded, expired or superseded order is over, and a handed-over order with no
 * problem has its own "Something's not right" and refund window on the card.
 */
export function OrderGetHelpNow({ order, problemOpen }: { order: { orderId: string; title: string; status: string | null }; problemOpen: boolean }) {
  const active = order.status === "paid" || (order.status === "handed_over" && problemOpen);
  if (!active) return null;
  return <GetHelpButton subject={helpOrderSubject({ id: order.orderId, title: order.title })} />;
}

function GetHelpButton({ subject }: { subject: string }) {
  const navigate = useNavigate();
  const go = () => navigate(`/support?topic=message&subject=${encodeURIComponent(subject)}`);
  return (
    <div data-get-help-now="" className="flex flex-col items-start gap-1.5">
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={go}>
        <LifeBuoy className="w-4 h-4" aria-hidden="true" />
        Get help now
      </Button>
      <p className="text-ds-13 text-muted-foreground">{SUPPORT_REPLY_PROMISE}</p>
    </div>
  );
}
