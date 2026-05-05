import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle, ShieldCheck, Megaphone, Handshake, Hammer, Wallet } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticSuccess } from "@/lib/haptics";
import AuthShell from "@/components/auth/AuthShell";

// Visual lifecycle preview — replaces the dense paragraph that used to
// sit in this same slot. Keeps the same content (4 stages from job-state
// machine: open → accepted → in_progress → completed) but presents it
// as scannable steps so customers know what to expect next.
const LIFECYCLE_STEPS = [
  { icon: Megaphone, label: "Posted", caption: "Your job is live for nearby helprs." },
  { icon: Handshake, label: "Accepted", caption: "You review applicants and pick one." },
  { icon: Hammer, label: "In progress", caption: "Helpr arrives and gets to work." },
  { icon: Wallet, label: "Released", caption: "Both confirm — payment goes out." },
];

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

        <div className="space-y-3 text-left">
          <p className="text-display-eyebrow">What happens next</p>
          <ol className="space-y-2.5">
            {LIFECYCLE_STEPS.map((step, i) => {
              const Icon = step.icon;
              const isFirst = i === 0;
              return (
                <li key={step.label} className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background: isFirst ? "hsl(var(--bark) / 0.12)" : "hsl(var(--olivewood) / 0.08)",
                      border: `1px solid ${isFirst ? "hsl(var(--bark) / 0.25)" : "hsl(var(--olivewood) / 0.15)"}`,
                    }}
                  >
                    <Icon
                      className="w-4 h-4"
                      strokeWidth={1.75}
                      style={{ color: isFirst ? "hsl(var(--bark))" : "hsl(var(--olivewood))" }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                      {step.label}
                      {isFirst && (
                        <span
                          className="ml-2 text-[10px] uppercase tracking-wider font-sans"
                          style={{ color: "hsl(var(--bark))" }}
                        >
                          you are here
                        </span>
                      )}
                    </p>
                    <p className="font-serif italic text-xs mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.78)" }}>
                      {step.caption}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="text-[11px] font-sans leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.65)" }}>
            If one side confirms and the other doesn't respond within 72 hours, payment is released automatically.
          </p>
        </div>

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
