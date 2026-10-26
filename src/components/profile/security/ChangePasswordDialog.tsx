import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHero, DialogPrimaryAction, DialogSecondaryAction } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { confirmConsequential } from "@/lib/toastPolicy";
import { signOutOtherDevices } from "@/lib/authSignOut";
import { describeWeakPassword, isWeakPasswordError } from "@/lib/authErrors";
import { PASSWORD_RULES, passwordProblem } from "@/pages/auth/signup/signupHelpers";

/** What the member reads for each refusal (server code or our own check). Pure; tested. */
export function changePasswordError(kind: "wrong_current" | "mismatch" | "same" | "too_many" | "reauth" | "other"): string {
  switch (kind) {
    case "wrong_current": return "That isn't your current password.";
    case "mismatch": return "The new passwords don't match.";
    case "same": return "Pick a password you haven't used here before.";
    case "too_many": return "Too many tries. Wait 15 minutes, or reset your password by email.";
    case "reauth": return "For your safety, change it with a reset link instead: tap Reset on the Password row.";
    default: return "Couldn't change your password. Try again.";
  }
}

/**
 * BOARD 175's "Change password" (behind 'account_security'): current password, then the new one
 * twice, with the SAME rules as Create account and Reset password (PASSWORD_RULES, shown while
 * typing). The current password is checked on the server first (verify_my_password, rate limited),
 * then auth.updateUser sets the new one, and every other device is signed out (the same as Reset).
 */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); setError(null); setShow(false); };
  const close = (o: boolean) => { if (!busy) { if (!o) reset(); onOpenChange(o); } };

  const submit = async () => {
    setError(null);
    if (next !== confirm) return setError(changePasswordError("mismatch"));
    const problem = passwordProblem(next);
    if (problem) return setError(problem);
    if (next === current) return setError(changePasswordError("same"));
    setBusy(true);
    try {
      const check = await supabase.rpc("verify_my_password", { p_password: current });
      if (check.error) {
        setError(changePasswordError(/too_many_attempts/.test(check.error.message) ? "too_many" : "other"));
        return;
      }
      if (check.data !== true) return setError(changePasswordError("wrong_current"));
      const { error: upd } = await supabase.auth.updateUser({ password: next, current_password: current });
      if (upd) {
        const code = (upd as { code?: string }).code ?? "";
        if (isWeakPasswordError(upd)) setError(passwordProblem(next) ?? describeWeakPassword(upd.message));
        else if (code === "same_password") setError(changePasswordError("same"));
        else if (code === "reauthentication_needed" || code === "reauthentication_not_valid") setError(changePasswordError("reauth"));
        else setError(changePasswordError("other"));
        return;
      }
      const others = await signOutOtherDevices();
      confirmConsequential(others ? "Password changed. Your other devices are signed out." : "Password changed. We couldn't sign out your other devices; use Sign out everywhere else.");
      reset();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-ds-13 font-semibold">{label}</Label>
      <Input id={id} type={show ? "text" : "password"} autoComplete={auto} value={value} onChange={(e) => set(e.target.value)} disabled={busy} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-change-password="">
        <DialogHero title="Change password" />
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {field("cp-current", "Current password", current, setCurrent, "current-password")}
          {field("cp-new", "New password", next, setNext, "new-password")}
          {next.length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-ds-12" aria-label="Password rules" data-password-rules="">
              {PASSWORD_RULES.map((r) => (
                <li key={r.label} className={r.test(next) ? "text-foreground" : "text-muted-foreground"}>
                  {r.test(next) ? "✓ " : ""}{r.label}
                </li>
              ))}
            </ul>
          )}
          {field("cp-confirm", "Confirm new password", confirm, setConfirm, "new-password")}
          <button type="button" className="inline-flex items-center gap-1.5 text-ds-13 font-semibold min-h-11" onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
            {show ? "Hide passwords" : "Show passwords"}
          </button>
          {error && <p role="alert" className="text-ds-13 text-destructive">{error}</p>}
          <DialogFooter>
            <DialogSecondaryAction type="button" onClick={() => close(false)} disabled={busy}>Cancel</DialogSecondaryAction>
            <DialogPrimaryAction type="submit" disabled={busy || !current || !next || !confirm}>
              {busy ? "Changing…" : "Change password"}
            </DialogPrimaryAction>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
