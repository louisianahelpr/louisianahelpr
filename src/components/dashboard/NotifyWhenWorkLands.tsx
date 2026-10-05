import { useState } from "react";
import { Bell, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * "Notify Me When Work Lands" (Q1313, owner 2026-10-05): the tap SAVES who to
 * tell. Before, the guest button only opened /signup and kept nothing.
 *
 * One door: the join_launch_notify RPC (migration 20261005070322). The list is
 * not readable by visitors; a repeat join answers like a first one. Nothing is
 * sent from here or on insert: the first launch message is a draft the owner
 * approves (docs/OPEN.md Q1313).
 *
 * The consent line below is what the person agrees to; its version is the one
 * the RPC records (launch-notify-v1). Changing the wording means a new version
 * in both places.
 */
export const LAUNCH_NOTIFY_CONSENT =
  "We'll email you when paid jobs open near you and when Helpr launches. Nothing else, and every email has a one-tap unsubscribe.";

export type LaunchNotifySource = "browse_empty" | "home_empty";

/** Join the list. `email` null = a signed-in member's own account address. */
export async function joinLaunchNotify(
  email: string | null,
  source: LaunchNotifySource,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("join_launch_notify", { p_email: email ?? "", p_source: source });
  if (error) {
    const code = (error as { code?: string }).code;
    // P0001 = a sentence the RPC wrote for the person (bad address, busy minute).
    if (code === "P0001" && error.message) return { ok: false, message: error.message };
    report(error, { severity: code === "PGRST202" ? "warning" : "error", tags: { source: "NotifyWhenWorkLands.join" } });
    return { ok: false, message: "We couldn't save that just now. Please try again." };
  }
  // A null error is not a write: the RPC answers {ok: true} only after its insert.
  if (!data || (data as { ok?: boolean }).ok !== true) {
    report(new Error("join_launch_notify answered without ok"), { severity: "error", tags: { source: "NotifyWhenWorkLands.join" } });
    return { ok: false, message: "We couldn't save that just now. Please try again." };
  }
  return { ok: true };
}

/** The guest's email form. */
export function NotifyWhenWorkLandsDialog({ open, onOpenChange, source }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: LaunchNotifySource;
}) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setError(null);
      setDone(false);
      setSaving(false);
    }
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const r = await joinLaunchNotify(email.trim(), source);
    setSaving(false);
    if (r.ok) setDone(true);
    else setError(r.message);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHero title={done ? "You're on the list." : "Notify Me When Work Lands"} />
        {done ? (
          <DialogBody>
            <p className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-primary" aria-hidden />
              <span>We'll email {email.trim()} when paid jobs open near you. You can unsubscribe from that email any time.</span>
            </p>
          </DialogBody>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-label="Your email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
            />
            {error && (
              <p role="alert" className="text-ds-12 text-[hsl(var(--destructive-ink))]">
                {error}
              </p>
            )}
            <DialogBody>
              <p className="flex items-start gap-2">
                <Bell className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                <span>{LAUNCH_NOTIFY_CONSENT}</span>
              </p>
            </DialogBody>
          </form>
        )}
        <DialogFooter>
          {done ? (
            <DialogPrimaryAction onClick={() => close(false)}>Done</DialogPrimaryAction>
          ) : (
            <>
              <DialogSecondaryAction onClick={() => close(false)} disabled={saving}>
                Not Now
              </DialogSecondaryAction>
              <DialogPrimaryAction onClick={() => void submit()} disabled={saving || email.trim().length < 3}>
                {saving ? "Saving…" : "Notify Me"}
              </DialogPrimaryAction>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
