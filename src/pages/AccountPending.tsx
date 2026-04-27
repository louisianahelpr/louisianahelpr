import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, Bell, LogOut, MailCheck, RefreshCw, CreditCard, CheckCircle2, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const AccountPending = () => {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/login"); return; }

      const isVerified = !!session.user.email_confirmed_at;
      setEmailVerified(isVerified);
      setUserEmail(session.user.email || "");

      const { data: profile } = await supabase
        .from("profiles")
        .select("approval_status, full_name")
        .eq("user_id", session.user.id)
        .single();
      if (!profile) return;
      setFullName(profile.full_name || "");
      if (profile.approval_status === "approved") { navigate("/dashboard"); return; }
      if (profile.approval_status === "denied") { navigate("/account-denied"); return; }
    };

    check();

    // Real-time profile updates: redirect instantly when status flips
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const subscribeRealtime = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      channel = supabase
        .channel(`profile-status-${session.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `user_id=eq.${session.user.id}`,
          },
          (payload) => {
            const next = payload.new as { approval_status?: string };
            if (next.approval_status === "approved") navigate("/dashboard");
            else if (next.approval_status === "denied") navigate("/account-denied");
          }
        )
        .subscribe();
    };
    subscribeRealtime();

    // Polling fallback (also re-checks email verification)
    const interval = setInterval(check, 10000);
    return () => {
      clearInterval(interval);
      if (channel) supabase.removeChannel(channel);
    };
  }, [navigate]);

  const handleResendVerification = async () => {
    if (resending) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: userEmail,
      });
      if (error) {
        toast.error("Failed to resend verification email. Please try again.");
      } else {
        toast.success("Verification email sent! Check your inbox.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="relative min-h-dvh flex items-center justify-center bg-premium-page px-4 py-10 pb-24 sm:pb-10 overflow-hidden">
      {/* Ambient gradient halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, hsl(var(--primary) / 0.35), transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-md text-center space-y-6">
        <Link to="/" className="text-3xl font-display font-bold text-primary inline-block">
          Helpr
        </Link>

        <div className="rounded-3xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-xl shadow-primary/5 p-8 space-y-6">
          {/* Hero icon — changes based on verification state */}
          <div className="relative mx-auto w-20 h-20">
            <div
              className={`absolute inset-0 rounded-full blur-xl opacity-60 ${
                emailVerified ? "bg-primary/30" : "bg-amber-500/30"
              }`}
            />
            <div
              className={`relative w-20 h-20 rounded-full flex items-center justify-center ring-1 ring-inset ${
                emailVerified
                  ? "bg-primary/10 ring-primary/20"
                  : "bg-amber-500/10 ring-amber-500/20"
              }`}
            >
              {emailVerified ? (
                <CheckCircle2 className="w-9 h-9 text-primary" />
              ) : (
                <MailCheck className="w-9 h-9 text-amber-500" />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              {!emailVerified
                ? "Verify your email to continue"
                : fullName
                ? `You're in, ${fullName.split(" ")[0]}!`
                : "You're all set!"}
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {!emailVerified ? (
                <>
                  We sent a verification link to{" "}
                  <span className="font-medium text-foreground">{userEmail}</span>.
                  Click the link in your inbox to unlock your account.
                </>
              ) : (
                "Your email is verified. You can browse the app, post jobs, and message helprs."
              )}
            </p>
          </div>

          {/* Email verification action — only when NOT verified */}
          {!emailVerified && (
            <div className="space-y-3">
              <Button
                onClick={handleResendVerification}
                disabled={resending}
                size="lg"
                className="w-full gap-2 rounded-xl"
              >
                {resending ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Sending…</>
                ) : (
                  <><MailCheck className="w-4 h-4" /> Resend verification email</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Didn't get it? Check your spam folder, then tap above to resend.
              </p>
            </div>
          )}

          {/* Verified — let them continue immediately */}
          {emailVerified && (
            <Button
              onClick={() => navigate("/dashboard")}
              size="lg"
              className="w-full gap-2 rounded-xl shadow-lg shadow-primary/20"
            >
              <Sparkles className="w-4 h-4" /> Continue to dashboard
            </Button>
          )}

          {/* Heads-up about Stripe — only relevant when applying to jobs */}
          {emailVerified && (
            <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 text-left">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Want to earn as a helpr?
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    When you apply to your first job, we'll walk you through connecting a Stripe payout account so you can get paid. No setup needed until then.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Trust copy — varies by state */}
          <div className="border-t border-border/60 pt-5 space-y-3 text-left">
            {!emailVerified && (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Why verify your email?</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    It keeps your account secure and lets us send job updates, payment receipts, and password resets.
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                {emailVerified ? (
                  <Clock className="w-4 h-4 text-primary" />
                ) : (
                  <Bell className="w-4 h-4 text-primary" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {emailVerified ? "Real-time updates" : "Auto-unlock"}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {emailVerified
                    ? "We'll notify you the moment new helprs apply or your jobs get activity — no need to refresh."
                    : "Once you click the verification link, this page redirects you to your dashboard automatically."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={async () => { await supabase.auth.signOut(); navigate("/"); }}
          className="text-muted-foreground"
        >
          <LogOut className="w-4 h-4 mr-1" /> Sign out
        </Button>
      </div>
    </div>
  );
};

export default AccountPending;
