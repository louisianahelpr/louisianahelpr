import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyNote } from "@/components/money/MoneyNote";
import { useAuthReady } from "@/hooks/useAuthReady";
import { usePayPalPayee, paypalPayeeQueryKey } from "@/hooks/usePayPalPayee";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { requireBiometric } from "@/lib/biometricGate";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import { queryKeys } from "@/lib/queryKeys";
import { normalizePayPalEmail, parsePayPalPayeeSaved, payPalEmailProblem } from "@/lib/paypalPayee";

const SAVE_FAILED = "We couldn't save your PayPal email. Try again.";

/**
 * "Get paid with PayPal" (PayPal Plan A, phase 2): the payout setup screen's
 * body while `paypal_payments` is on for the member (PaymentTab renders it in
 * place of the Stripe form). One email, typed twice. Saving it is the member's
 * payout setup for jobs: the server (set_paypal_payee_email) makes it payable,
 * completes any accept that was waiting on setup, and holds money already
 * queued to an older email until our team checks it.
 */
export function PayPalPayeeCard({ onSettled }: { onSettled?: () => void } = {}) {
  const { user } = useAuthReady();
  const qc = useQueryClient();
  const state = usePayPalPayee();
  const emailId = useId();
  const confirmId = useId();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const settled = !state.loading;
  useEffect(() => {
    if (settled) onSettled?.();
  }, [settled, onSettled]);

  if (state.loading) {
    return <div className="h-40 rounded-xl animate-pulse" style={{ background: "hsl(var(--ink-deep) / 0.05)" }} role="status" aria-label="Loading your payout details" />;
  }
  if (state.error) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep) / 0.75)" }}>
          {state.errorMessage}
        </p>
        <Button variant="outline" size="sm" onClick={state.refetch}>Try again</Button>
      </div>
    );
  }

  const payee = state.payee;
  const showForm = editing || !payee?.hasEmail;
  const problem = payPalEmailProblem(email, confirm);

  const save = async () => {
    setTouched(true);
    if (problem || !user) return;
    // Where the money lands: the same Face ID / passcode gate as Stripe payout setup.
    const ok = await requireBiometric("Confirm changes to your payout account");
    if (!ok) return;
    setSaving(true);
    try {
      const res = await supabase.rpc("set_paypal_payee_email", { p_email: normalizePayPalEmail(email), p_email_confirm: normalizePayPalEmail(confirm) });
      if (res.error) {
        hapticError();
        const words = rpcErrorMessage("set_paypal_payee_email", res.error);
        if (!words) report(res.error, { severity: "error", tags: { source: "PayPalPayeeCard.save" } });
        toast.error(words ?? SAVE_FAILED);
        return;
      }
      // The RPC returns the stored state; anything else is not a write.
      const saved = parsePayPalPayeeSaved(res.data);
      if (!saved) {
        hapticError();
        report(new Error("set_paypal_payee_email returned no stored state"), { severity: "error", tags: { source: "PayPalPayeeCard.save" } });
        toast.error(SAVE_FAILED);
        return;
      }
      qc.setQueryData(paypalPayeeQueryKey(user.id), {
        hasEmail: true, emailMasked: saved.emailMasked, payable: saved.payable, verified: saved.verified,
      });
      // The accept gate and every "set up payouts" prompt read these.
      void qc.invalidateQueries({ queryKey: paypalPayeeQueryKey(user.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.payoutSetup.all });
      setEditing(false);
      setEmail("");
      setConfirm("");
      setTouched(false);
      const done = saved.acceptsCompleted + saved.crewConfirmsCompleted;
      toast.success(
        !saved.payable
          ? "Saved. Your payouts are still on hold. Write to us from Help and we'll sort it out."
          : saved.heldPayouts > 0
          ? "Saved. Money already on its way to your old email waits until our team checks the change."
          : done > 0
            ? `Saved. ${done === 1 ? "The job you accepted is" : `The ${done} jobs you accepted are`} now confirmed.`
            : "Saved. We'll pay you at this PayPal email.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-paypal-payee-card="">
      <div className="flex items-start gap-3">
        <span
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: "hsl(var(--bark) / 0.10)", color: "hsl(var(--bark))" }}
        >
          <Wallet className="w-4 h-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-display font-bold leading-tight text-ds-16" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
            Get paid with PayPal
          </h2>
          <p className="font-sans mt-1 text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            We pay you through PayPal for the jobs you do. It's free to receive.
          </p>
        </div>
      </div>

      {payee?.hasEmail && !editing && (
        <div className="space-y-3">
          <div data-paypal-payee-saved="" className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--bark))" }} aria-hidden />
            <p className="min-w-0 font-sans text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
              We'll pay <span className="font-semibold break-all">{payee.emailMasked}</span> (PayPal).
            </p>
          </div>
          {!payee.payable && (
            <MoneyNote>
              <p role="status">Your payouts are on hold. Write to us from Help and we'll sort it out.</p>
            </MoneyNote>
          )}
          <Button variant="outline" className="w-full" onClick={() => setEditing(true)}>
            Change PayPal email
          </Button>
        </div>
      )}

      {showForm && (
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={emailId} className="text-ds-13 font-semibold">PayPal email</Label>
            <Input
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={confirmId} className="text-ds-13 font-semibold">Type it again</Label>
            <Input
              id={confirmId}
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={touched && !!problem}
              aria-describedby={`${confirmId}-hint`}
            />
          </div>
          <p id={`${confirmId}-hint`} className="text-ds-12" style={{ color: touched && problem ? "hsl(var(--destructive-ink))" : "hsl(var(--olivewood) / 0.8)" }} role={touched && problem ? "alert" : undefined}>
            {touched && problem ? problem : "Use the email on your PayPal account. A typo would send your money to someone else."}
          </p>
          <Button type="submit" variant="primary" className="w-full" disabled={saving}>
            {saving ? "Saving…" : "Save PayPal email"}
          </Button>
          {payee?.hasEmail && (
            <Button type="button" variant="ghost" className="w-full" disabled={saving} onClick={() => { setEditing(false); setEmail(""); setConfirm(""); setTouched(false); }}>
              Cancel
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
