import { useNavigate } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { helpSupportSubject } from "@/lib/supportSubject";
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
  const navigate = useNavigate();
  if (!GET_HELP_NOW_STATUSES.has(job.status ?? "")) return null;
  const go = () => navigate(`/support?topic=message&subject=${encodeURIComponent(helpSupportSubject(job))}`);
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
