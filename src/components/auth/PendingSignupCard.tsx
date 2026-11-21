import { MailCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enVerify";

/**
 * Owner 2026-11-20 (ease batch, item 6): the final step for someone whose sign-up email is not verified yet. Every
 * action that needs an account (posting live, messaging, paying) sends a signed-out visitor to /signup; with a sign-up
 * waiting on this device (src/lib/pendingSignup.ts) /signup shows this instead of a second form: a friendly "Check your
 * email to finish", a resend (on /signup-pending, which holds the captcha-checked resend and the session poll), and a
 * way to use another address. What they started stays where it was (the job post draft, the redirect back to it).
 */
export function PendingSignupCard({ email, onUseDifferent }: { email: string; onUseDifferent: () => void }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  return (
    <section aria-labelledby="pending-signup-title" className="space-y-4 text-center" data-testid="pending-signup-card">
      <span aria-hidden className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <MailCheck className="h-6 w-6 text-primary" />
      </span>
      <h2 id="pending-signup-title" className="font-moment text-ds-22 leading-tight text-foreground">{t("verify.checkTitle")}</h2>
      <p className="text-ds-14 text-muted-foreground text-balance [overflow-wrap:anywhere]">{t("verify.checkBody", { email })}</p>
      <Button type="button" variant="primary" className="w-full" onClick={() => navigate("/signup-pending", { state: { email, resend: true } })}>
        {t("verify.resend")}
      </Button>
      <p className="text-ds-13">
        <InlineTextButton onClick={onUseDifferent} className="font-semibold" style={{ color: "hsl(var(--bark))" }}>
          {t("verify.different")}
        </InlineTextButton>
      </p>
    </section>
  );
}
