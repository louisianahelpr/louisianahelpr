import { useState } from "react";
import { Link } from "react-router-dom";
import { MailCheck, Clock, ShieldCheck, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AuthShell from "@/components/auth/AuthShell";

const SignupPending = () => {
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState("");
  const [showResend, setShowResend] = useState(false);

  const handleResend = async () => {
    if (!email.trim()) {
      toast.error("Please enter your email address");
      return;
    }
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
    });
    setResending(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Verification email resent! Check your inbox.");
    }
  };

  const stepIcon = (Icon: typeof MailCheck) => (
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
      style={{ background: "hsl(var(--bark) / 0.1)" }}
    >
      <Icon className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
    </div>
  );

  return (
    <AuthShell eyebrow="Almost there" maxWidth="md">
      <div className="liquid-glass p-7 sm:p-8 space-y-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "hsl(var(--bark) / 0.1)" }}
        >
          <MailCheck className="w-8 h-8" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
        </div>

        <div className="space-y-2">
          <span className="text-display-eyebrow">Verify your email</span>
          <h1
            className="font-display italic font-bold leading-tight mt-1"
            style={{
              fontSize: "clamp(1.6rem, 2.5vw + 0.5rem, 2rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            Check your inbox.
          </h1>
          <p className="font-serif italic text-sm" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
            We've sent a verification link to your email. Click it to confirm your account.
          </p>
        </div>

        <div className="border-t pt-6 space-y-4 text-left" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          <h2
            className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em] text-center"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            What happens next?
          </h2>

          <div className="flex items-start gap-3">
            {stepIcon(MailCheck)}
            <div>
              <p className="text-sm font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Verify your email</p>
              <p className="text-xs font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                Click the link in your inbox to confirm your email address.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            {stepIcon(Clock)}
            <div>
              <p className="text-sm font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Profile under review</p>
              <p className="text-xs font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                Our team will review your profile and ID. This usually takes 24–48 hours.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            {stepIcon(ShieldCheck)}
            <div>
              <p className="text-sm font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Get approved</p>
              <p className="text-xs font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                Once approved, you'll have full access to post and accept jobs.
              </p>
            </div>
          </div>
        </div>

        <div className="border-t pt-4" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          {!showResend ? (
            <button
              onClick={() => setShowResend(true)}
              className="text-sm font-medium hover:underline flex items-center gap-1.5 mx-auto"
              style={{ color: "hsl(var(--bark))" }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Didn't receive the email?
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-sans" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                Enter your email to resend the verification link:
              </p>
              <input
                type="email"
                autoComplete="email"
                aria-label="Your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl bg-white/60 border border-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ ['--tw-ring-color' as any]: "hsl(var(--bark) / 0.3)" }}
              />
              <Button
                onClick={handleResend}
                disabled={resending}
                size="sm"
                className="w-full rounded-xl"
                style={{
                  background: "hsl(var(--bark))",
                  backgroundImage: "none",
                  border: "1px solid hsl(var(--bark))",
                  color: "hsl(var(--parchment))",
                  fontFamily: "Montserrat, system-ui, sans-serif",
                  fontWeight: 600,
                }}
              >
                {resending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Resending…</> : "Resend verification email"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs font-sans pt-5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
        Already verified?{" "}
        <Link to="/login" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
};

export default SignupPending;
