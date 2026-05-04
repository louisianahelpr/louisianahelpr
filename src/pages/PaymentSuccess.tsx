import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle, ShieldCheck } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticSuccess } from "@/lib/haptics";
import AuthShell from "@/components/auth/AuthShell";

const PaymentSuccess = () => {
  usePageTitle("Payment Authorized — Helpr");
  const navigate = useNavigate();

  useEffect(() => {
    hapticSuccess();
  }, []);

  return (
    <AuthShell hideBack eyebrow="Payment authorized" maxWidth="md">
      <div className="liquid-glass p-7 sm:p-8 space-y-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "hsl(var(--bark) / 0.1)" }}
        >
          <CheckCircle className="w-8 h-8" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
        </div>

        <div className="space-y-2">
          <span className="text-display-eyebrow">All set</span>
          <h1
            className="font-display italic font-bold leading-tight mt-1"
            style={{
              fontSize: "clamp(1.75rem, 3vw + 0.5rem, 2.25rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            Payment authorized.
          </h1>
        </div>

        <div
          className="flex items-start justify-center gap-3 rounded-2xl p-4 text-left"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "1px solid hsl(var(--bark) / 0.18)",
          }}
        >
          <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
          <p className="text-xs font-sans leading-relaxed" style={{ color: "hsl(var(--olivewood))" }}>
            Your payment has been securely processed. The helpr will be paid once both you and the helpr confirm the job is complete.
          </p>
        </div>

        <p className="font-serif italic text-sm leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
          Your task is now live and visible to nearby helprs. Once a helpr applies and you accept them, the job begins. When the work is done, both parties mark it complete to release payment. If one side confirms and the other doesn't respond within 72 hours, payment is released automatically.
        </p>

        <Button
          size="lg"
          onClick={() => navigate("/dashboard")}
          className="w-full rounded-xl"
          style={{
            background: "hsl(var(--bark))",
            backgroundImage: "none",
            border: "1px solid hsl(var(--bark))",
            color: "hsl(var(--parchment))",
            fontFamily: "Montserrat, system-ui, sans-serif",
            fontWeight: 600,
            letterSpacing: "0.01em",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px -8px rgba(0,0,0,0.1)",
          }}
        >
          Back to dashboard
        </Button>
      </div>
    </AuthShell>
  );
};

export default PaymentSuccess;
