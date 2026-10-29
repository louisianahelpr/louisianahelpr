import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { TurnstileField } from "@/components/auth/TurnstileField";
import { useCaptcha } from "@/hooks/useCaptcha";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { hasPasswordSignIn, reauthWithPassword, sendDeleteCode, verifyDeleteCode } from "@/lib/deleteAccountReauth";

/**
 * Step 2 of account deletion asks "is it really you?" before the delete runs
 * (A3-I5, owner 2026-10-29). Password for members who have one; a 6-digit
 * emailed code for members who signed up with Google or Apple, or forgot it.
 * The server refuses the delete without a sign-in from the last ten minutes
 * (supabase/functions/_shared/recentSignIn.ts), so this is not only a screen.
 */
export interface DeleteReauth {
  /** True once the person has typed enough to try (a password, or a code that was sent). */
  ready: boolean;
  /** Run the check. Shows its own message and resolves false when it fails. */
  confirm: () => Promise<boolean>;
  fields: ReactNode;
}

const linkClass = "text-ds-13 font-medium underline underline-offset-2 self-start disabled:opacity-60";

export function useDeleteReauth(disabled: boolean): DeleteReauth {
  const { user } = useCurrentUser();
  const email = user?.email ?? "";
  const [mode, setMode] = useState<"password" | "code">(() => (hasPasswordSignIn(user) ? "password" : "code"));
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const captcha = useCaptcha();

  const sendCode = async () => {
    if (!email) { setMessage("Your account has no email address on file. Contact support to delete it."); return; }
    setSending(true);
    setMessage(null);
    const res = await captcha.run((captchaToken) => sendDeleteCode(email, captchaToken));
    setSending(false);
    if (res.ok) setCodeSent(true);
    else setMessage(res.message);
  };

  const switchTo = (next: "password" | "code") => { setMode(next); setMessage(null); };

  const ready = mode === "password" ? password.length > 0 : codeSent && /^\d{6,10}$/.test(code.trim());

  const confirm = async (): Promise<boolean> => {
    if (!email) { setMessage("Your account has no email address on file. Contact support to delete it."); return false; }
    setMessage(null);
    const res = mode === "password"
      ? await captcha.run((captchaToken) => reauthWithPassword(email, password, captchaToken))
      : await verifyDeleteCode(email, code);
    if (!res.ok) setMessage(res.message);
    return res.ok;
  };

  const busy = disabled || sending;
  const fields = (
    <div className="flex flex-col gap-2 my-1">
      {mode === "password" ? (
        <>
          <label htmlFor="delete-reauth-password" className="text-ds-13 font-medium text-foreground">Your password</label>
          <Input
            id="delete-reauth-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-ds-md"
            disabled={busy}
          />
          <button type="button" className={linkClass} disabled={busy} onClick={() => switchTo("code")}>
            No password? Email me a code
          </button>
        </>
      ) : (
        <>
          <p className="text-ds-13 text-foreground">
            {codeSent ? <>We sent a 6-digit code to <span className="font-semibold break-all">{email}</span>.</> : <>We&rsquo;ll email a 6-digit code to <span className="font-semibold break-all">{email}</span>.</>}
          </p>
          {codeSent ? (
            <>
              <label htmlFor="delete-reauth-code" className="text-ds-13 font-medium text-foreground">Code from the email</label>
              <Input
                id="delete-reauth-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="h-11 text-center font-mono tracking-widest rounded-ds-md"
                disabled={busy}
              />
              <button type="button" className={linkClass} disabled={busy} onClick={() => { void sendCode(); }}>
                {sending ? "Sending…" : "Send a new code"}
              </button>
            </>
          ) : (
            <button type="button" className={linkClass} disabled={busy} onClick={() => { void sendCode(); }}>
              {sending ? "Sending…" : "Email me a code"}
            </button>
          )}
          <button type="button" className={linkClass} disabled={busy} onClick={() => switchTo("password")}>
            Use my password instead
          </button>
        </>
      )}
      {message ? <p role="alert" className="text-ds-13" style={{ color: "hsl(var(--alert-ink))" }}>{message}</p> : null}
      <TurnstileField ref={captcha.ref} action="delete_account" />
    </div>
  );

  return { ready, confirm, fields };
}
