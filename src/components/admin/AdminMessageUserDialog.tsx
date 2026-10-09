// AdminMessageUserDialog — "Message" in the admin User Profile dialog's Admin
// Tools (owner, 2026-10-09: "add a option for admin to message directly from
// here"; two-way).
//
// The message lands in the user's Messages as a "Louisiana Helpr Team" thread
// and fires the normal new-message notification; they can reply there. Written
// by the admin-only RPC `admin_send_team_message` (migration
// 20261009223503_team_thread_direct_messages.sql), which also writes the
// admin_audit_log row, so this dialog does not log a second one. The whole
// conversation lives at /messages?teamThread=<user> for every admin.

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { classifySendRefusal } from "@/lib/messageSendRefusal";
import { MESSAGE_MAX_LENGTH } from "@/lib/messageLimits";
import { TEAM_THREAD_NAME, teamThreadLink } from "@/lib/teamThread";
import { formatName } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface AdminMessageUserDialogProps {
  /** Target profile. When null, the dialog is closed. */
  profile: Profile | null;
  onClose: () => void;
}

/** The RPC's own codes read the shared copy (RPC_ERROR_COPY); the two
 *  messages-table triggers that can also refuse it (block, send cap) say why. */
function sendErrorCopy(error: unknown): string {
  const copy = rpcErrorMessage("admin_send_team_message", error);
  if (copy) return copy;
  const refusal = classifySendRefusal(error as { code?: string; message?: string } | null);
  return refusal?.toast ?? "Couldn't send that message. Try again.";
}

export function AdminMessageUserDialog({ profile, onClose }: AdminMessageUserDialogProps) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  // `saving` is state: two clicks in one frame both read false. The ref sees the first.
  const inFlight = useRef(false);
  // One idempotency key per message, kept across a retry of the same text so a
  // send whose response was lost cannot land twice (messages_sender_client_id_key).
  const clientId = useRef<string>(crypto.randomUUID());

  const name = formatName(profile?.full_name, "this user");
  const trimmed = text.trim();
  const tooLong = trimmed.length > MESSAGE_MAX_LENGTH;

  const handleClose = () => {
    if (saving) return;
    setText("");
    clientId.current = crypto.randomUUID();
    onClose();
  };

  const send = async () => {
    if (!profile || !trimmed || tooLong || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("admin_send_team_message", {
        p_user_id: profile.user_id,
        p_content: trimmed,
        p_client_id: clientId.current,
      });
      // 23505 = this exact message (same key) already landed on an earlier try.
      const landed = !error ? !!data?.id : (error as { code?: string }).code === "23505";
      if (!landed) {
        if (error) report(error, { severity: "warning", tags: { source: "AdminMessageUserDialog.send" } });
        toast.error(sendErrorCopy(error));
        return;
      }
      const userId = profile.user_id;
      toast.success(`Sent to ${name}`, {
        description: `They'll see it in Messages from the ${TEAM_THREAD_NAME}.`,
        action: { label: "Open Conversation", onClick: () => navigate(teamThreadLink(userId)) },
      });
      setText("");
      clientId.current = crypto.randomUUID();
      onClose();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHero title={`Message ${name}`} />
        <div className="space-y-3">
          <p className="text-ds-12 text-muted-foreground">
            Goes to their Messages from the {TEAM_THREAD_NAME}, with the usual new-message
            notification. They can reply, and any admin can read the conversation.
          </p>
          <Textarea
            aria-label={`Message to ${name}`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              // New text is a new message: a retry may reuse the key only for
              // the SAME text, or an edit could be reported as sent (review #2).
              clientId.current = crypto.randomUUID();
            }}
            placeholder="Write your message…"
            rows={5}
            maxLength={MESSAGE_MAX_LENGTH}
            autoFocus
          />
          {trimmed.length > MESSAGE_MAX_LENGTH * 0.9 && (
            <p className={`text-ds-10 text-right ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
              {trimmed.length.toLocaleString()} / {MESSAGE_MAX_LENGTH.toLocaleString()}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={handleClose}>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction onClick={send} disabled={saving || !trimmed || tooLong}>
            {saving ? "Sending…" : "Send Message"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
