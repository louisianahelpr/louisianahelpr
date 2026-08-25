import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Ban, Mail, LogOut, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const BAN_STATUSES = ["banned", "temp_banned", "permanently_banned"] as const;

const AccountBanned = () => {
  usePageTitle("Account Banned — Helpr");
  const navigate = useNavigate();
  const { user, profile, isLoading } = useCurrentUser();

  // Redirect away once the account is no longer banned. Reads the shared
  // useCurrentUser profile so this gate can't drift from the rest of the
  // app's view of ban state.
  // `replace` — otherwise the browser Back button returns here and re-bounces
  // forever (a history trap on all three account-gate screens).
  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate("/login", { replace: true }); return; }
    if (!profile?.ban_status || !(BAN_STATUSES as readonly string[]).includes(profile.ban_status)) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, profile, isLoading, navigate]);

  const banStatus = profile?.ban_status ?? null;
  const suspendedUntil = profile?.auto_suspended_until ?? null;

  const isPermanent = banStatus === "permanently_banned";
  const isTemp = banStatus === "temp_banned";

  // Eyebrow must track the actual ban state — a hardcoded "Suspended"
  // read wrong above a "permanently banned" headline.
  const eyebrowLabel = isPermanent ? "Banned" : isTemp ? "Suspended" : "Under review";

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
    ? new Date(suspendedUntil).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  // Don't paint the ban card for a visitor we're about to bounce — a
  // signed-out guest hitting this URL used to see a flash of "Account
  // suspended" before the redirect effect ran.
  if (isLoading || !user) {
    return (
      <AuthShell hideBack eyebrow="Account status" maxWidth="md">
        <div className="liquid-glass p-7 sm:p-8 min-h-[16rem] animate-pulse" aria-busy="true" />
      </AuthShell>
    );
  }

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
          <span className="text-display-eyebrow">{eyebrowLabel}</span>
          <h1 className="text-page-title leading-tight mt-1 truncate">
            {headline}.
          </h1>
          <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
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
                className="text-ds-11 font-serif italic uppercase tracking-[0.18em] mb-1"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                Suspended until
              </p>
              <p className="text-ds-13 font-sans font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                {formattedUntil}
              </p>
            </div>
          </div>
        )}

        <div className="border-t pt-6 space-y-3" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          <p className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            If you believe your account was suspended in error, contact our support team with your account email and we'll review your case.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {/* /support, not a `mailto:` — inside the native app a mailto has no
              handler, so on the ONE screen where the user has no other route
              to a human, the appeal button did nothing at all. /support is a
              public route (not behind ProtectedRoute), so a suspended account
              can still reach it, and the form identifies them from their
              session so support gets the account without them typing it. */}
          {/* `Button asChild` wrapping the Link — the canonical pattern. The
              inverse (<Link><Button>) renders a <button> INSIDE an <a>: invalid
              HTML, and a double tab stop on every one of these CTAs. */}
          <Button asChild variant="primary" className="w-full rounded-ds-md" size="lg">
            <Link to="/support?topic=message&subject=Account%20suspension%20appeal">
              <Mail className="w-4 h-4 mr-2" />
              Contact Support
            </Link>
          </Button>
          <Button asChild variant="ghost" className="w-full rounded-ds-md" size="sm">
            <Link to="/rules">Review Platform Rules</Link>
          </Button>
        </div>
      </div>

      <div className="text-center mt-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => { await signOutWithPushCleanup(); navigate("/"); }}
          className="text-muted-foreground"
        >
          <LogOut className="w-4 h-4 mr-1" /> Sign Out
        </Button>
      </div>
    </AuthShell>
  );
};

export default AccountBanned;
