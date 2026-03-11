import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { XCircle, RefreshCw, Mail, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const AccountDenied = () => {
  const navigate = useNavigate();
  const [denyReason, setDenyReason] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/login"); return; }
      const { data: profile } = await supabase
        .from("profiles")
        .select("approval_status")
        .eq("user_id", session.user.id)
        .single();
      if (!profile) return;
      if (profile.approval_status === "approved") navigate("/dashboard");
      if (profile.approval_status === "pending") navigate("/account-pending");
    };
    check();

    // Check notifications for deny reason
    const loadReason = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data: notifs } = await supabase
        .from("notifications")
        .select("message")
        .eq("user_id", session.user.id)
        .eq("title", "Account not approved")
        .order("created_at", { ascending: false })
        .limit(1);
      if (notifs?.[0]?.message) {
        const reason = notifs[0].message.replace("Your account was not approved. Reason: ", "").replace("Your account was not approved. Please contact support for details.", "");
        setDenyReason(reason);
      }
    };
    loadReason();
  }, [navigate]);

  const handleResubmit = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { navigate("/login"); return; }

    const { error } = await supabase
      .from("profiles")
      .update({ approval_status: "pending" })
      .eq("user_id", session.user.id);

    if (error) {
      toast.error("Failed to resubmit. Please try again.");
    } else {
      toast.success("Your profile has been resubmitted for review!");
      navigate("/account-pending");
    }
    setLoading(false);
  };

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
                <p className="text-sm font-medium text-foreground">Update & resubmit</p>
                <p className="text-xs text-muted-foreground">Update your profile, upload a clearer ID, and resubmit for review.</p>
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
            <Link to="/profile">
              <Button className="w-full" size="lg">
                Update My Profile
              </Button>
            </Link>
            <Button variant="outline" className="w-full" onClick={handleResubmit} disabled={loading}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {loading ? "Resubmitting…" : "Resubmit for Review"}
            </Button>
            <Link to="/support">
              <Button variant="ghost" className="w-full" size="sm">
                Contact Support
              </Button>
            </Link>
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

export default AccountDenied;
