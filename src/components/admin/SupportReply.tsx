import { useId, useState } from "react";
import { MessageSquareReply, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { functionInvokeError } from "@/lib/supabaseResult";
import { userFacingError } from "@/lib/userFacingError";
import { report } from "@/lib/errorLogger";
import { formatName } from "@/lib/utils";
import { formatShortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Admin replies to a support ticket (owner 2026-10-23, via the lead): Admin
 * Support had only Resolve / Dismiss, so the owner could not answer a member.
 *
 * The reply goes through the `admin-support-reply` edge function, which checks
 * the admin role server-side, records the reply (support_replies), sends the
 * member an in-app notice and an email to their account address, and reports
 * each of those outcomes separately. This file is the thread on the card and
 * the composer.
 */

/** Same bound as the support_replies_body_length CHECK and the edge function. */
export const SUPPORT_REPLY_MAX_CHARS = 4000;

export type SupportReplyRow = {
  id: string;
  report_id: string;
  body: string;
  created_at: string;
  admin_name: string | null;
  /** NULL while the delivery is not recorded (never read as "not delivered"). */
  notified: boolean | null;
  /** Newest email_send_log status, or not_queued / no_address / unconfirmed / unknown. */
  email_status: string;
  resolved_on_send: boolean;
  /** False until the edge function finished recording what reached the member. */
  outcome_recorded: boolean;
};

/** What the edge function answers on success. */
type ReplyResult = {
  success?: boolean;
  /** A guest's ticket: there is no account, so email is the whole reply. */
  guest?: boolean;
  notified?: boolean;
  email_queued?: boolean;
  has_email?: boolean;
  /** The member has an address, but it was never confirmed: not mailed. */
  email_unconfirmed?: boolean;
  resolved?: boolean;
  /** What happened to "Mark resolved when sent". */
  resolve?: "not_requested" | "not_attempted" | "resolved" | "already_closed" | "error" | "skipped_undelivered";
  /** False when the reply's delivery record did not save (the thread can't show it). */
  outcome_recorded?: boolean;
  error?: string;
};

/** The email half of a reply, in words. */
export function emailStatusLabel(status: string): string {
  switch (status) {
    case "sent": return "Emailed";
    case "pending": return "Email queued";
    // The queue worker retries a failed send (up to 5 times, every 5 minutes)
    // and a later success flips the same row to sent; only dlq is final
    // (lh-silent-failure review r1 #2).
    case "failed": return "Email retrying";
    case "dlq": return "Email failed";
    case "not_queued": return "Email not queued";
    case "suppressed": return "Email not sent (test account)";
    case "no_address": return "Not emailed (no address on file)";
    case "unconfirmed": return "Not emailed (address not confirmed)";
    default: return "Email status unknown";
  }
}

/** What reached the member, as one sentence for the toast. Exported for tests. */
export function replyOutcomeMessage(name: string, r: ReplyResult): { ok: boolean; text: string } {
  const reached: string[] = [];
  const missed: string[] = [];
  if (!r.guest) (r.notified ? reached : missed).push("in the app");
  if (r.has_email === false) missed.push("by email (no address on file)");
  else if (r.email_unconfirmed) missed.push("by email (their address isn't confirmed)");
  else (r.email_queued ? reached : missed).push("by email");
  // A requested resolve that did not happen is said, never left out
  // (lh-silent-failure review r1 #3).
  const resolveNote: Record<string, { text: string; ok: boolean }> = {
    resolved: { text: " Ticket marked resolved.", ok: true },
    already_closed: { text: " The ticket was already closed.", ok: true },
    error: { text: " The ticket is still open: marking it resolved failed.", ok: false },
    skipped_undelivered: { text: " The ticket stays open because the reply reached no one.", ok: false },
  };
  const res = resolveNote[r.resolve ?? (r.resolved ? "resolved" : "")] ?? { text: "", ok: true };
  const record = r.outcome_recorded === false
    ? " Its delivery record didn't save, so check the ticket before sending again."
    : "";
  const tail = `${res.text}${record}`;
  const extrasOk = res.ok && r.outcome_recorded !== false;
  if (missed.length === 0) return { ok: extrasOk, text: `Reply sent to ${name} ${r.guest ? "by email" : "in the app and by email"}.${tail}` };
  if (reached.length === 0) {
    return { ok: false, text: `Reply saved, but it did not reach ${name} ${missed.join(" or ")}.${tail}` };
  }
  return { ok: false, text: `Reply sent to ${name} ${reached.join(" and ")}, but not ${missed.join(" or ")}.${tail}` };
}

/** "Oct 21, 10:00 AM": the day and the time the admin sent it. */
function replyWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatShortDate(d)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** The replies already sent on one ticket, oldest first. */
export function SupportThread({ replies, byEmailOnly = false }: { replies: SupportReplyRow[]; byEmailOnly?: boolean }) {
  if (replies.length === 0) return null;
  return (
    <ol className="space-y-2" aria-label="Replies sent">
      {replies.map((r) => (
        <li key={r.id} className="rounded-ds-sm border border-border/60 bg-primary/5 p-3 space-y-1">
          <p className="text-ds-11 font-semibold text-foreground break-words">
            {formatName(r.admin_name, "An admin")} replied
            <span className="font-normal text-muted-foreground">
              {" · "}
              <time dateTime={r.created_at}>{replyWhen(r.created_at)}</time>
            </span>
          </p>
          <p className="text-ds-11 text-foreground whitespace-pre-wrap break-words">{r.body}</p>
          <p className="text-ds-10 text-muted-foreground">
            {!r.outcome_recorded && <span className="text-destructive-ink">Delivery not fully recorded: check before resending · </span>}
            {!byEmailOnly && (r.notified === null ? "In-app notice not recorded · " : r.notified ? "In-app notice delivered · " : "In-app notice not delivered · ")}
            {emailStatusLabel(r.email_status)}
            {r.resolved_on_send && " · Resolved on send"}
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * The Reply button and, once pressed, the composer. `canResolve` shows the
 * "Mark resolved when sent" box (pending tickets only); `onSent` refetches.
 */
export function SupportReplyComposer({
  ticketId,
  memberName,
  canResolve,
  disabledReason,
  byEmailOnly = false,
  onSent,
}: {
  ticketId: string;
  memberName: string;
  canResolve: boolean;
  /** Set when there is no member to reach (deleted account): the button explains instead of opening. */
  disabledReason?: string;
  /** A guest's ticket: no account to tell in the app. */
  byEmailOnly?: boolean;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [resolve, setResolve] = useState(canResolve);
  const [sending, setSending] = useState(false);
  const fieldId = useId();
  const resolveId = useId();
  const countId = useId();

  if (disabledReason) {
    return <p className="text-ds-11 text-muted-foreground">{disabledReason}</p>;
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => { setResolve(canResolve); setOpen(true); }}>
        <MessageSquareReply className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Reply
      </Button>
    );
  }

  const trimmed = text.trim();
  const tooLong = trimmed.length > SUPPORT_REPLY_MAX_CHARS;

  const send = async () => {
    if (!trimmed || tooLong || sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-support-reply", {
        body: { reportId: ticketId, message: trimmed, resolve: canResolve && resolve },
      });
      if (error) throw await functionInvokeError(error);
      const result = (data ?? {}) as ReplyResult;
      if (!result.success) throw new Error(result.error || "The reply was not sent.");
      const outcome = replyOutcomeMessage(memberName, result);
      if (outcome.ok) toast.success(outcome.text);
      else toast.warning(outcome.text);
      setText("");
      setOpen(false);
      onSent();
    } catch (err) {
      // No "nothing was sent" here: a dropped connection can lose the answer to
      // a reply that DID go out, and sending again would mail the member twice
      // (lh-authz-rls review r1 #3). The thread is re-read so the admin can see.
      toast.error(userFacingError(err, "Couldn't confirm the reply went out. Check the replies on this ticket before sending again."));
      report(err, { tags: { source: "AdminSupport.reply" } });
      onSent();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2 rounded-ds-sm border border-border/60 p-3">
      <label htmlFor={fieldId} className="text-ds-11 font-semibold text-foreground">
        Reply to {memberName}
      </label>
      <Textarea
        id={fieldId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={byEmailOnly ? "They get this by email." : "They get this in the app and by email."}
        aria-describedby={countId}
        aria-invalid={tooLong || undefined}
        disabled={sending}
      />
      <p id={countId} className={tooLong ? "text-ds-10 text-destructive-ink" : "text-ds-10 text-muted-foreground"}>
        {trimmed.length}/{SUPPORT_REPLY_MAX_CHARS}
        {tooLong && " · too long to send"}
      </p>
      {canResolve && (
        <div className="flex items-center gap-2">
          <Checkbox
            id={resolveId}
            checked={resolve}
            onCheckedChange={(v) => setResolve(v === true)}
            disabled={sending}
          />
          <label htmlFor={resolveId} className="text-ds-11 text-foreground">Mark resolved when sent</label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={sending}>
          Cancel
        </Button>
        <Button size="sm" onClick={send} disabled={!trimmed || tooLong || sending}>
          {sending
            ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" aria-hidden="true" />
            : <Send className="w-3.5 h-3.5 mr-1" aria-hidden="true" />}
          Send reply
        </Button>
      </div>
    </div>
  );
}
