import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getPublicResetPasswordUrl } from "@/lib/authRedirects";
import { toast } from "sonner";
import { ArrowLeft, Mail, Loader2 } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";

const ForgotPassword = () => {
  usePageTitle("Reset Password — Helpr");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPublicResetPasswordUrl(),
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
      toast.success("Check your email for a reset link!");
    }
  };

  return (
    <AuthShell eyebrow="Reset your password" maxWidth="sm">
      <div className="liquid-glass p-6 sm:p-8 space-y-6">
        {sent ? (
          <div className="text-center space-y-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
              style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
            >
              <Mail className="w-7 h-7" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />
            </div>
            <h1
              className="font-display italic font-bold leading-tight"
              style={{
                fontSize: "clamp(1.5rem, 2.5vw + 0.5rem, 2rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.02em",
              }}
            >
              Check your inbox.
            </h1>
            <p className="font-serif italic text-sm" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              We sent a reset link to{" "}
              <span className="font-semibold not-italic" style={{ color: "hsl(var(--olivewood))" }}>
                {email}
              </span>
              . It expires in 1 hour.
            </p>
            <p className="text-xs font-sans" style={{ color: "hsl(var(--olivewood) / 0.55)" }}>
              Don't see it? Check your spam folder or wait a minute — emails can take a moment to arrive.
            </p>
            <Button
              variant="outline"
              className="w-full rounded-xl"
              onClick={() => setSent(false)}
            >
              Use a different email
            </Button>
          </div>
        ) : (
          <>
            <div className="text-center space-y-2">
              <span className="text-display-eyebrow">Forgot password</span>
              <h1
                className="font-display italic font-bold leading-tight mt-2"
                style={{
                  fontSize: "clamp(1.5rem, 2.5vw + 0.5rem, 2rem)",
                  color: "hsl(var(--ink-deep))",
                  letterSpacing: "-0.02em",
                }}
              >
                We'll send you a link.
              </h1>
              <p className="font-serif italic text-sm" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                Enter the email tied to your account and check your inbox.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-sans font-medium">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="rounded-xl bg-white/60 border-white/70"
                />
              </div>
              <Button
                type="submit"
                className="w-full rounded-xl"
                size="lg"
                disabled={loading}
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
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : "Send reset link"}
              </Button>
            </form>
          </>
        )}

        <p className="text-center text-xs pt-1" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          <Link
            to="/login"
            className="font-semibold hover:underline inline-flex items-center gap-1"
            style={{ color: "hsl(var(--bark))" }}
          >
            <ArrowLeft className="w-3 h-3" /> Back to sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
};

export default ForgotPassword;
