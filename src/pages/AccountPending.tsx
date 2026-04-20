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
      <div className="w-full max-w-md text-center space-y-8">
        <Link to="/" className="text-3xl font-display font-bold text-primary inline-block">
          Helpr
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">
              {fullName ? `Hey ${fullName.split(" ")[0]}!` : "Almost there!"}
            </h1>
            <p className="text-muted-foreground">
              {!emailVerified
                ? "First, verify your email — check your inbox for the link we just sent."
                : !stripeFullyVerified
                ? "Last step: connect a payout account so you can get paid for completed jobs. We use Stripe — bank-grade security."
                : "Your account is being finalized — this usually takes just a few seconds."}
            </p>
          </div>

          {/* Step 1: Email verification */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-left space-y-3">
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${emailVerified ? "bg-primary/15" : "bg-amber-500/15"}`}>
                {emailVerified
                  ? <CheckCircle2 className="w-4 h-4 text-primary" />
                  : <MailCheck className="w-4 h-4 text-amber-500" />}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {emailVerified ? "Email verified ✓" : "Verify your email"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {emailVerified
                    ? "Thanks for confirming your email address."
                    : "Click the link we sent to your inbox to verify."}
                </p>
              </div>
            </div>

            {!emailVerified && userEmail && (
              <Button
                onClick={handleResendVerification}
                disabled={resending}
                variant="outline"
                size="sm"
                className="w-full gap-2"
              >
                {resending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <MailCheck className="w-4 h-4" />
                )}
                Resend verification email
              </Button>
            )}
          </div>

          {/* Step 2: Connect payout account */}
          {emailVerified && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-left space-y-3">
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${stripeFullyVerified ? "bg-primary/15" : "bg-amber-500/15"}`}>
                  {stripeFullyVerified
                    ? <CheckCircle2 className="w-4 h-4 text-primary" />
                    : <CreditCard className="w-4 h-4 text-amber-500" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {stripeFullyVerified ? "Payout account verified ✓" : "Connect payout account"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {stripeFullyVerified
                      ? "Stripe verified your identity. You're ready to go!"
                      : stripeStatus?.connected && !stripeStatus.details_submitted
                      ? "You started Stripe setup — finish the remaining steps to get approved."
                      : "Stripe will verify your identity instantly via secure database matching (SSN, name, address)."}
                  </p>
                </div>
              </div>

              {!stripeFullyVerified && (
                <div className="rounded-lg bg-background/60 border border-border/60 p-3 space-y-2">
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide">What to expect</p>
                  <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
                    <li>Stripe asks for your legal name, DOB, address, and SSN.</li>
                    <li>They silently verify against government &amp; credit databases (takes seconds).</li>
                    <li>Only if that fails, they'll ask you to snap a photo of your ID.</li>
                    <li>Once approved, this page redirects you — you're cleared to accept jobs.</li>
                  </ol>
                </div>
              )}

              {!stripeFullyVerified && !stripeLoading && (
                <Button
                  onClick={handleConnectStripe}
                  disabled={connectingStripe}
                  size="sm"
                  className="w-full gap-2"
                >
                  {connectingStripe ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Opening Stripe…</>
                  ) : (
                    <><CreditCard className="w-4 h-4" />
                      {stripeStatus?.connected ? "Continue Stripe setup" : "Connect with Stripe"}
                    </>
                  )}
                </Button>
              )}

              {stripeFullyVerified && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Finalizing your approval…
                </div>
              )}
            </div>
          )}

          <div className="border-t border-border pt-5 space-y-3 text-left">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Why Stripe?</p>
                <p className="text-xs text-muted-foreground">
                  Stripe is the same payment platform used by Amazon, Lyft, and Shopify. They verify your identity instantly and securely — no manual ID review needed.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bell className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Auto-approval</p>
                <p className="text-xs text-muted-foreground">
                  Once Stripe verifies you, this page redirects you to your dashboard automatically.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 border border-border p-3">
            <p className="text-xs text-muted-foreground">
              💡 A one-time $2 platform fee is deducted from your first payout — never charged upfront.
            </p>
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
