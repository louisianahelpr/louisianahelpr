import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate("/login"); return; }
    if (profile?.approval_status === "approved") navigate("/dashboard");
    else if (profile?.approval_status === "pending") navigate("/account-pending");
  }, [user, profile, isLoading, navigate]);

  const denyReason = profile?.denial_reason ?? "";

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
          <h1 className="text-page-title leading-tight mt-1">
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
          {/* Appeal CTA — pre-fills the email with the user's ID + email
              + denial reason so the admin can pull the right case row up
              instantly. We don't share the bare denial_reason verbatim in
              the URL when it could contain sensitive admin notes — just
              flag that a reason exists so the user can quote it back. */}
          <a
            href={`mailto:admin@louisianahelpr.com?subject=${encodeURIComponent(
              "Account decision appeal",
            )}&body=${encodeURIComponent(
              [
                "Hi Helpr team,",
                "",
                "I'd like to appeal the decision on my account.",
                "",
                "[Tell us what changed or what you'd like reconsidered]",
                "",
                "—",
                `User ID: ${user?.id ?? "unknown"}`,
                `Email: ${user?.email ?? "unknown"}`,
                denyReason ? `Reason on file: ${denyReason}` : "Reason on file: (not provided)",
              ].join("\n"),
            )}`}
          >
            <Button variant="ghost" className="w-full rounded-ds-md" size="sm">
              <Mail className="w-4 h-4 mr-2" />
              Appeal This Decision
            </Button>
          </a>
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
