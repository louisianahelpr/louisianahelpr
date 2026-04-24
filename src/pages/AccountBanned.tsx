import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Ban, Mail, LogOut, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const BAN_STATUSES = ["banned", "temp_banned", "permanently_banned"] as const;

const AccountBanned = () => {
  const navigate = useNavigate();
  const [banStatus, setBanStatus] = useState<string | null>(null);
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        navigate("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("ban_status, auto_suspended_until")
        .eq("user_id", session.user.id)
        .single();
      if (!profile) return;
      // Not banned anymore — get them out of here
      if (!profile.ban_status || !BAN_STATUSES.includes(profile.ban_status as any)) {
        navigate("/dashboard");
        return;
      }
      setBanStatus(profile.ban_status);
      setSuspendedUntil(profile.auto_suspended_until ?? null);
    };
    check();
  }, [navigate]);

  const isPermanent = banStatus === "permanently_banned";
  const isTemp = banStatus === "temp_banned";

  const headline = isPermanent
    ? "Account Permanently Banned"
    : isTemp
      ? "Account Temporarily Suspended"
      : "Account Suspended";

  const subline = isPermanent
    ? "Your access to Helpr has been permanently revoked due to a violation of our Platform Rules."
    : isTemp
      ? "Your account has been temporarily suspended. You'll regain access once the suspension period ends."
      : "Your account has been suspended pending review.";

  const formattedUntil = suspendedUntil
    ? new Date(suspendedUntil).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center space-y-8">
        <Link to="/" className="text-3xl font-display font-bold text-primary inline-block">
          Helpr
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <Ban className="w-8 h-8 text-destructive" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">{headline}</h1>
            <p className="text-muted-foreground text-sm">{subline}</p>
          </div>

          {isTemp && formattedUntil && (
            <div className="rounded-lg bg-muted/50 border border-border p-4 text-left flex items-start gap-3">
              <Clock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-1">
                  Suspended until
                </p>
                <p className="text-sm text-foreground">{formattedUntil}</p>
              </div>
            </div>
          )}

          <div className="border-t border-border pt-6 space-y-4 text-left">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide text-center">
              Think this is a mistake?
            </h2>
            <p className="text-xs text-muted-foreground text-center">
              If you believe your account was suspended in error, contact our support team with your account email and we'll review your case.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <a href="mailto:admin@louisianahelpr.com?subject=Account%20Suspension%20Appeal">
              <Button className="w-full" size="lg">
                <Mail className="w-4 h-4 mr-2" />
                Contact Support
              </Button>
            </a>
            <Link to="/rules">
              <Button variant="ghost" className="w-full" size="sm">
                Review Platform Rules
              </Button>
            </Link>
          </div>

          <p className="text-xs text-muted-foreground text-center pt-2">
            Need help? Email us at{" "}
            <a href="mailto:admin@louisianahelpr.com" className="text-primary font-medium hover:underline">
              admin@louisianahelpr.com
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

export default AccountBanned;
