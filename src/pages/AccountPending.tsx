import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clock, ShieldCheck, Bell, LogOut, MailCheck, RefreshCw, CreditCard, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getPublicSiteUrl } from "@/lib/authRedirects";
import { toast } from "sonner";

const AccountPending = () => {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [stripeStatus, setStripeStatus] = useState<{
    connected: boolean;
    details_submitted: boolean;
    charges_enabled: boolean;
    payouts_enabled: boolean;
  } | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [connectingStripe, setConnectingStripe] = useState(false);

  const checkStripeStatus = async () => {
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "status" },
      });
      if (!error && data) {
        setStripeStatus({
          connected: !!data.connected,
          details_submitted: !!data.details_submitted,
          charges_enabled: !!data.charges_enabled,
          payouts_enabled: !!data.payouts_enabled,
        });
      }
    } catch (e) {
      console.error("Stripe status check failed:", e);
    } finally {
      setStripeLoading(false);
    }
  };

  const handleConnectStripe = async () => {
    setConnectingStripe(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: {
          action: "onboard",
          return_url: `${getPublicSiteUrl()}/account-pending`,
        },
      });
      if (error || !data?.url) throw new Error(data?.error || "Could not start payout setup");
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to start payout setup");
      setConnectingStripe(false);
    }
  };

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

      // Check Stripe status only after email is verified
      if (isVerified) {
        await checkStripeStatus();
      }
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

    // Polling fallback
    const interval = setInterval(check, 15000);
    return () => {
      clearInterval(interval);
      if (channel) supabase.removeChannel(channel);
    };
  }, [navigate]);

  const handleResendVerification = async () => {
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

  const stripeFullyVerified =
    stripeStatus?.connected &&
    stripeStatus?.charges_enabled &&
    stripeStatus?.payouts_enabled;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md text-center space-y-6">
        <Link to="/" className="text-3xl font-display font-bold text-primary inline-block">
          Helpr
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
          {/* Hero icon — changes based on verification state */}
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${emailVerified ? "bg-primary/10" : "bg-amber-500/10"}`}>
            {emailVerified
              ? <CheckCircle2 className="w-8 h-8 text-primary" />
              : <MailCheck className="w-8 h-8 text-amber-500" />}
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">
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
                "Your email is verified. You can now browse the app, post jobs, and message helpers."
              )}
            </p>
          </div>

          {/* Email verification action — only shown when NOT verified */}
          {!emailVerified && (
            <div className="space-y-3">
              <Button
                onClick={handleResendVerification}
                disabled={resending}
                size="lg"
                className="w-full gap-2"
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

          {/* Verified — let them continue to dashboard immediately */}
          {emailVerified && (
            <Button
              onClick={() => navigate("/dashboard")}
              size="lg"
              className="w-full gap-2"
            >
              <CheckCircle2 className="w-4 h-4" /> Continue to dashboard
            </Button>
          )}

          {/* Heads-up about Stripe — only relevant when they apply to jobs */}
          {emailVerified && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-left">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Want to earn as a helper?
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When you apply to your first job, we'll walk you through connecting a Stripe payout account so you can get paid. No setup needed until then.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Trust copy */}
          <div className="border-t border-border pt-5 space-y-3 text-left">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Why verify your email?</p>
                <p className="text-xs text-muted-foreground">
                  It keeps your account secure and lets us send job updates, payment receipts, and password resets.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bell className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Auto-unlock</p>
                <p className="text-xs text-muted-foreground">
                  Once you click the verification link, this page redirects you to your dashboard automatically.
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
