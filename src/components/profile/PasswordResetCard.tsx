import { useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getPublicResetPasswordUrl } from "@/lib/authRedirects";
import { confirmConsequential } from "@/lib/toastPolicy";
import { captchaRefusal } from "@/lib/turnstile";
import { useCaptcha } from "@/hooks/useCaptcha";
import { TurnstileField } from "@/components/auth/TurnstileField";

/**
 * Profile > Security's Password card: mails a reset link to the account's
 * address. Split out of SecurityTab when the reset call gained its Turnstile
 * token (Q1314).
 */
export function PasswordResetCard({ email }: { email: string | null | undefined }) {
  const [resettingPassword, setResettingPassword] = useState(false);
  const captcha = useCaptcha();
  return (
    <div className="rounded-2xl liquid-glass p-3.5">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Lock className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
            Password
          </h2>
          {/* Sits INSIDE the title block, exactly where the email address
              sits on the card above — not in a detached band under the whole
              title+button row. The old layout put it there, so the 44px
              button set the row height, the one-line title floated in the
              middle of it, and the prose landed below with a dead strip
              above AND below: three cards, three silhouettes. */}
          <p className="text-ds-11 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Reset via secure email link.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          // Reset needs an address to mail the link to. It used to be
          // enabled-but-inert without one (the handler early-returned in
          // silence), which reads as a broken button.
          disabled={!email || resettingPassword}
          aria-label="Email me a password reset link"
          onClick={async () => {
            if (!email || resettingPassword) return;
            setResettingPassword(true);
            const { error } = await captcha.run((captchaToken) =>
              supabase.auth.resetPasswordForEmail(email, { redirectTo: getPublicResetPasswordUrl(), captchaToken }),
            );
            setResettingPassword(false);
            if (error) toast.error(captchaRefusal(error.message) ?? "Couldn't send the reset link — try again?");
            // Say it worked — the only visible change was the button label
            // flicking back from "Sending…", which reads as nothing happened.
            else confirmConsequential(`Reset link sent to ${email}.`);
          }}
        >
          {resettingPassword ? "Sending…" : "Reset"}
        </Button>
      </div>
      <TurnstileField ref={captcha.ref} action="password_reset" className="mt-2" />
    </div>
  );
}
