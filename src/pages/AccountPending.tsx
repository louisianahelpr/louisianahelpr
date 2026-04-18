import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clock, ShieldCheck, Bell, LogOut, MailCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const AccountPending = () => {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [idvStatus, setIdvStatus] = useState<string | null>(null);
  const [legacyManual, setLegacyManual] = useState(false);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/login"); return; }
      
      const isVerified = !!session.user.email_confirmed_at;
      setEmailVerified(isVerified);
      setUserEmail(session.user.email || "");
      
      const { data: profile } = await supabase
        .from("profiles")
        .select("approval_status, full_name, idv_status, legacy_manual_review")
        .eq("user_id", session.user.id)
        .single();
      if (!profile) return;
      setFullName(profile.full_name || "");
      setIdvStatus(profile.idv_status || null);
      setLegacyManual(!!profile.legacy_manual_review);
      if (profile.approval_status === "approved") navigate("/dashboard");
      if (profile.approval_status === "denied") navigate("/account-denied");
    };
    check();

    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
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
              {emailVerified 
                ? "Your email is verified ✓ Your account is now under review by our team."
                : "Your email has not been verified yet. Please check your inbox and click the verification link, then your account will be reviewed by our team."}
            </p>
          </div>

          {!emailVerified && userEmail && (
            <Button
              onClick={handleResendVerification}
              disabled={resending}
              variant="outline"
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

          <div className="border-t border-border pt-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">What's happening?</h2>

            {idvStatus && !legacyManual && (
              <div className="flex items-start gap-3 text-left">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {idvStatus === "verified" ? "Identity verified ✓" :
                     idvStatus === "processing" || idvStatus === "pending" ? "Identity verification processing" :
                     idvStatus === "manual_review" ? "Under manual review" :
                     idvStatus === "failed" ? "Verification needs review" :
                     "Identity verification"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {idvStatus === "verified" ? "Stripe Identity confirmed your ID instantly." :
                     idvStatus === "processing" || idvStatus === "pending" ? "Stripe is checking your ID — usually under 2 minutes." :
                     idvStatus === "manual_review" ? "Our team is reviewing your submission. Decision within 24–48 hours." :
                     idvStatus === "failed" ? "We couldn't auto-verify. An admin is reviewing manually." :
                     "Awaiting verification."}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3 text-left">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Profile review</p>
                <p className="text-xs text-muted-foreground">Our team is reviewing your profile details. This usually takes 24–48 hours.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 text-left">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bell className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">We'll notify you</p>
                <p className="text-xs text-muted-foreground">You'll receive an email and in-app notification once your account is approved.</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 border border-border p-3">
            <p className="text-xs text-muted-foreground">
              💡 This page will automatically update when your account is reviewed. You can close this tab and come back anytime.
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
