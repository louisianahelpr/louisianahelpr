import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { report } from "@/lib/errorLogger";
import { isSpentOrExpired, type ConfirmLinkType } from "../../../../supabase/functions/_shared/confirmLink";

/**
 * The "Confirm my email" step of a scanner-safe link, and the way back from a
 * link that ran out (lead, 2026-10-25; supabase/functions/_shared/confirmLink.ts
 * says why). Opening the page spends nothing: only the tap below POSTs the
 * token (supabase.auth.verifyOtp). On success the page's own poll takes the
 * now-confirmed session into the app; `onConfirmed` drops the token from the URL.
 *
 * An expired or already-used link shows what happened and one way forward each:
 * already confirmed, Log in; otherwise a new link to the address (the page's
 * own Resend, with its security check and cooldown). Guard:
 * src/test/scannerSafeConfirmLinks.test.ts.
 */
interface Props {
  /** The token to spend, or null when the page opened on an expired link. */
  token: { tokenHash: string; type: ConfirmLinkType } | null;
  email: string;
  setEmail: (v: string) => void;
  onConfirmed: () => void;
  onResend: () => void;
  resending: boolean;
  resendCooldown: number;
}

export function ConfirmLinkPanel({ token, email, setEmail, onConfirmed, onResend, resending, resendCooldown }: Props) {
  const [state, setState] = useState<"ready" | "confirming" | "expired" | "failed">(token ? "ready" : "expired");

  const confirm = async () => {
    if (!token || state === "confirming") return;
    setState("confirming");
    try {
      const { error } = await supabase.auth.verifyOtp({ token_hash: token.tokenHash, type: token.type });
      if (!error) {
        onConfirmed();
        return;
      }
      if (isSpentOrExpired(error)) {
        setState("expired");
        return;
      }
      report(error, { severity: "warning", tags: { source: "ConfirmLinkPanel.verifyOtp" } });
      setState("failed");
    } catch (err) {
      // A network fault: the token is not spent, so the same tap can retry.
      report(err, { severity: "warning", tags: { source: "ConfirmLinkPanel.verifyOtp" } });
      setState("failed");
    }
  };

  if (state === "ready" || state === "confirming" || state === "failed") {
    return (
      <div className="space-y-4 text-center" data-testid="confirm-link-panel">
        <p className="text-ds-14 font-sans text-balance" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          One tap and your account is ready.
        </p>
        <Button type="button" variant="primary" size="lg" className="w-full rounded-full" onClick={() => void confirm()} disabled={state === "confirming"}>
          {state === "confirming" ? "Confirming…" : "Confirm my email"}
        </Button>
        {state === "failed" && (
          <p role="alert" className="text-ds-13 font-sans" style={{ color: "hsl(var(--destructive-ink))" }}>
            That didn't go through. Check your connection and tap again.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 text-left" data-testid="confirm-link-expired" role="status">
      <p className="text-ds-14 font-sans font-semibold text-center" style={{ color: "hsl(var(--ink-deep))" }}>
        This link has expired or was already used.
      </p>
      <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Already confirmed? Log in. If not, we'll send you a new link. Only the newest link works.
      </p>
      <div className="space-y-2">
        <Label htmlFor="confirm-link-email" className="text-ds-13">Email</Label>
        <Input id="confirm-link-email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <Button type="button" variant="primary" className="w-full rounded-full" onClick={onResend} disabled={!email.trim() || resending || resendCooldown > 0}>
        {resending ? "Sending…" : resendCooldown > 0 ? `Send a new link (${resendCooldown}s)` : "Send a new link"}
      </Button>
      <Button asChild variant="outline" className="w-full rounded-full">
        <Link to="/login">Log in</Link>
      </Button>
    </div>
  );
}
