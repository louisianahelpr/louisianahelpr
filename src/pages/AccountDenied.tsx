import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { XCircle, RefreshCw, Mail, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const AccountDenied = () => {
  usePageTitle("Account Denied — Helpr");
  const navigate = useNavigate();
  const { user, profile, isLoading } = useCurrentUser();

  // Redirect away once the account is no longer denied. Reads the shared
  // useCurrentUser profile so this gate can't drift from the rest of the
  // app's view of approval state.
  // `replace` — otherwise the browser Back button returns here and re-bounces
  // forever (a history trap on all three account-gate screens).
  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate("/login", { replace: true }); return; }
    if (profile?.approval_status === "approved") navigate("/dashboard", { replace: true });
    else if (profile?.approval_status === "pending") navigate("/account-pending", { replace: true });
  }, [user, profile, isLoading, navigate]);

  const denyReason = profile?.denial_reason ?? "";

  // Don't paint the denial card for a visitor we're about to bounce — a
  // signed-out guest hitting this URL used to see a flash of "We couldn't
  // approve your account." before the redirect effect ran.
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
          <XCircle className="w-8 h-8" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />
        </div>

        <div className="space-y-2">
          <span className="text-display-eyebrow">Not approved</span>
          <h1 className="text-page-title leading-tight mt-1 truncate">
            We couldn't approve your account.
          </h1>
          <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Unfortunately, your account was not approved at this time.
          </p>
        </div>

        {denyReason && (
          <div
            className="rounded-2xl p-4 text-left"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "1px solid hsl(var(--burnt-sienna) / 0.2)",
            }}
          >
            <p
              className="text-ds-11 font-serif italic uppercase tracking-[0.18em] mb-1"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              Reason
            </p>
            <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>{denyReason}</p>
          </div>
        )}

        <div className="border-t pt-6 space-y-4 text-left" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-ds-md flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "hsl(var(--bark) / 0.1)" }}>
              <RefreshCw className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Re-apply with updated info</p>
              <p className="text-ds-11 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Sign up again with the same email to resubmit your profile with a new photo, ID, and details.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-ds-md flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "hsl(var(--bark) / 0.1)" }}>
              <Mail className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Contact support</p>
              <p className="text-ds-11 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                If you think this was a mistake, reach out to our team.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            variant="primary"
            className="w-full rounded-ds-md"
            size="lg"
            onClick={async () => { await signOutWithPushCleanup(); navigate("/signup"); }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Re-Apply Now
          </Button>
          {/* Appeal CTA → /support, never a raw `mailto:`. Inside the native
              app a mailto has no handler, so the appeal button did nothing at
              all on the one screen where a denied user has no other route to a
              human — the same reason AccountBanned links to /support. /support
              is public (not behind ProtectedRoute), so a denied account can
              still reach it, and the form identifies them from their session,
              so the admin gets the account without the user typing an ID.

              The denial reason is deliberately NOT carried in the URL: it can
              contain internal admin notes, and a query string is the wrong
              place for them. It is already shown on this card above, so the
              user can quote whatever they want to contest. */}
          <Button asChild variant="ghost" className="w-full rounded-ds-md" size="sm">
            <Link to="/support?topic=message&subject=Account%20decision%20appeal">
              <Mail className="w-4 h-4 mr-2" />
              Appeal This Decision
            </Link>
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

export default AccountDenied;
