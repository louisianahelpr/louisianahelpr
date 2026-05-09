import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Ban, Mail, LogOut, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";

const BAN_STATUSES = ["banned", "temp_banned", "permanently_banned"] as const;

const AccountBanned = () => {
  usePageTitle("Account Banned — Helpr");
  const navigate = useNavigate();
  const [banStatus, setBanStatus] = useState<string | null>(null);
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/login"); return; }
      const { data: profile } = await supabase
        .from("profiles")
        .select("ban_status, auto_suspended_until")
        .eq("user_id", session.user.id)
        .single();
      if (!profile) return;
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
    ? "Account permanently banned"
    : isTemp
      ? "Account temporarily suspended"
      : "Account suspended";

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
    <AuthShell hideBack eyebrow="Account status" maxWidth="md">
      <div className="liquid-glass p-7 sm:p-8 space-y-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
        >
          <Ban className="w-8 h-8" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />
        </div>

        <div className="space-y-2">
          <span className="text-display-eyebrow">Suspended</span>
          <h1
            className="font-display italic font-bold leading-tight mt-1"
            style={{
              fontSize: "clamp(1.6rem, 2.5vw + 0.5rem, 2rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            {headline}.
          </h1>
          <p className="font-serif italic text-sm" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
            {subline}
          </p>
        </div>

        {isTemp && formattedUntil && (
          <div
            className="rounded-2xl p-4 text-left flex items-start gap-3"
            style={{
              background: "hsl(var(--olivewood) / 0.05)",
              border: "1px solid hsl(var(--olivewood) / 0.12)",
            }}
          >
            <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--burnt-sienna))" }} />
            <div>
              <p
                className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em] mb-1"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                Suspended until
              </p>
              <p className="text-sm font-sans font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                {formattedUntil}
              </p>
            </div>
          </div>
        )}

        <div className="border-t pt-6 space-y-3" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          <h2
            className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em]"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Think this is a mistake?
          </h2>
          <p className="text-xs font-sans" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
            If you believe your account was suspended in error, contact our support team with your account email and we'll review your case.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <a href="mailto:admin@louisianahelpr.com?subject=Account%20Suspension%20Appeal">
            <Button
              className="w-full rounded-xl"
              size="lg"
              style={{
                background: "hsl(var(--bark))",
                backgroundImage: "none",
                border: "1px solid hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
              }}
            >
              <Mail className="w-4 h-4 mr-2" />
              Contact support
            </Button>
          </a>
          <Link to="/rules">
            <Button variant="ghost" className="w-full rounded-xl" size="sm">
              Review Platform Rules
            </Button>
          </Link>
        </div>

        <p className="text-xs font-sans" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>
          Need help? Email us at{" "}
          <a
            href="mailto:admin@louisianahelpr.com"
            className="font-semibold hover:underline"
            style={{ color: "hsl(var(--bark))" }}
          >
            admin@louisianahelpr.com
          </a>
        </p>
      </div>

      <div className="text-center mt-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => { await supabase.auth.signOut(); navigate("/"); }}
          className="text-muted-foreground"
        >
          <LogOut className="w-4 h-4 mr-1" /> Sign out
        </Button>
      </div>
    </AuthShell>
  );
};

export default AccountBanned;
