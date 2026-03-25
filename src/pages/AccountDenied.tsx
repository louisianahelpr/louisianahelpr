import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { XCircle, RefreshCw, Mail, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const AccountDenied = () => {
  const navigate = useNavigate();
  const [denyReason, setDenyReason] = useState("");

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/login"); return; }
      const { data: profile } = await supabase
        .from("profiles")
        .select("approval_status, denial_reason")
        .eq("user_id", session.user.id)
        .single();
      if (!profile) return;
      if (profile.approval_status === "approved") navigate("/dashboard");
      if (profile.approval_status === "pending") navigate("/account-pending");
      if (profile.denial_reason) setDenyReason(profile.denial_reason);
    };
    check();
  }, [navigate]);


  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center space-y-8">
        <Link to="/" className="text-3xl font-display font-bold text-primary inline-block">
          Helpr
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <XCircle className="w-8 h-8 text-destructive" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Account Not Approved</h1>
            <p className="text-muted-foreground">
              Unfortunately, your account was not approved at this time.
            </p>
          </div>

          {denyReason && (
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4 text-left">
              <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-1">Reason</p>
              <p className="text-sm text-foreground">{denyReason}</p>
            </div>
          )}

          <div className="border-t border-border pt-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">What can you do?</h2>

            <div className="flex items-start gap-3 text-left">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <RefreshCw className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Re-apply with updated info</p>
                <p className="text-xs text-muted-foreground">Sign up again with the same email to resubmit your profile with a new photo, ID, and details.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 text-left">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Mail className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Contact support</p>
                <p className="text-xs text-muted-foreground">If you think this was a mistake, reach out to our support team.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Button className="w-full" size="lg" onClick={async () => { await supabase.auth.signOut(); navigate("/signup"); }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Re-apply Now
            </Button>
            <a href="mailto:support@louisianahelpr.com">
              <Button variant="ghost" className="w-full" size="sm">
                <Mail className="w-4 h-4 mr-2" />
                Email Support
              </Button>
            </a>
          </div>

          <p className="text-xs text-muted-foreground text-center pt-2">
            Need help? Email us at{" "}
            <a href="mailto:support@louisianahelpr.com" className="text-primary font-medium hover:underline">
              support@louisianahelpr.com
            </a>
          </p>
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

export default AccountDenied;
