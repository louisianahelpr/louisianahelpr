import { useNavigate } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { helpOrderSubject } from "@/lib/supportSubject";
import { SUPPORT_REPLY_PROMISE } from "@/lib/supportTopics";

/* The job page's "Get help now" came off (owner 2026-10-31, LEAD-JOBPAGE-LAYOUT: help is the top-right icon, PageHeader's
   HelpEntry on every back-arrow screen). Declutter orders keep their button below. */
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
