import { Suspense, lazy, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { XCircle, RefreshCw, Mail, LogOut, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDeleteAccount } from "@/hooks/useDeleteAccount";

// The same lazy import Profile and AccountBanned use: the dialog chunk and its
// confirm-flow deps are fetched only if the user actually opens it.
const DeleteAccountDialog = lazy(() =>
  import("@/components/profile/DeleteAccountDialog").then((m) => ({ default: m.DeleteAccountDialog })),
);

const AccountDenied = () => {
  usePageTitle("Account Denied — Helpr");
  const navigate = useNavigate();
  const { user, profile, isLoading } = useCurrentUser();

  // ACCOUNT DELETION LIVES HERE TOO, FOR THE SAME REASON IT LIVES ON
  // /account-banned — and this screen was missed when that one was fixed.
  //
  // Apple requires in-app account deletion (App Store Review Guideline
  // 5.1.1(v)). A denied user can sign in, so they have an account, so they
  // must be able to delete it. Three things had to line up for them to be
  // unable to, and all three did:
  //   1. `/account-denied` is in `noNavPages` (mobileNavHelpers.ts), so
  //      MobileNav returns null — no bottom dock, hence no Profile tab, and
  //      /profile is where the delete control otherwise lives.
  //   2. AuthShell renders NO Navbar and NO Footer on native
  //      (`isNativePlatform || noWebChrome ? content : …`), and this screen
  //      passes `hideBack`, so there is no chevron either.
  //   3. The only exits the card offered were /support and two buttons that
  //      SIGN THE USER OUT first — after which the account still exists.
  // On iOS there is no address bar, so that combination left no path at all.
  //
  // The two sibling states were each already fine, by different mechanisms,
  // which is exactly why this one slipped: /account-pending IS in `authPages`
  // so it keeps the dock and reaches Profile; /account-banned was given its
  // own delete button. This screen got neither.
  //
  // Same hook, same dialog as Profile and AccountBanned — see
  // `useDeleteAccount` for why this is shared rather than a second copy of the
  // handler (a duplicated copy once broke deletion for every user for a day).
  //
  // No `extraKeptItems` here, deliberately: `retain_ban_on_deletion` fires
  // only for ban_status IN ('banned','temp_banned','permanently_banned'), so a
  // DENIED account carries nothing across deletion and it would be wrong to
  // warn that it does. Re-applying with the same email is already this card's
  // headline advice.
  const deleteAccount = useDeleteAccount();

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
          {/* NOT `truncate` — see AccountBanned.tsx for the measurement. This
              headline is longer still (33 chars) and clipped identically on a
              phone. `text-balance` wraps it evenly. */}
          <h1 className="text-page-title leading-tight mt-1 text-balance">
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

      {/* Sign Out and Delete Account, in that order and both subordinate to
          Re-Apply / Appeal above. Same treatment as AccountBanned: deletion is
          a real exit and must be offered, but a denied user's first move should
          be re-applying or appealing, not the irreversible thing — so neither
          wears a filled treatment, and `text-destructive` distinguishes the
          permanent one from the reversible one without promoting it. */}
      <div className="text-center mt-5 flex flex-col items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => { await signOutWithPushCleanup(); navigate("/"); }}
          className="text-muted-foreground"
        >
          <LogOut className="w-4 h-4 mr-1" /> Sign Out
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={deleteAccount.requestDelete}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="w-4 h-4 mr-1" /> Delete Account
        </Button>
      </div>

      {deleteAccount.isOpen && (
        <Suspense fallback={null}>
          <DeleteAccountDialog {...deleteAccount.dialogProps} />
        </Suspense>
      )}
    </AuthShell>
  );
};

export default AccountDenied;
