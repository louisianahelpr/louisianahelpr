import { Suspense, lazy, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Ban, Mail, LogOut, Clock, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDeleteAccount } from "@/hooks/useDeleteAccount";

// The same lazy import Profile uses: the dialog chunk and its confirm-flow
// deps are fetched only if the user actually opens it.
const DeleteAccountDialog = lazy(() =>
  import("@/components/profile/DeleteAccountDialog").then((m) => ({ default: m.DeleteAccountDialog })),
);

const BAN_STATUSES = ["banned", "temp_banned", "permanently_banned"] as const;

const AccountBanned = () => {
  usePageTitle("Account Banned — Helpr");
  const navigate = useNavigate();
  const { user, profile, isLoading } = useCurrentUser();

  // ACCOUNT DELETION LIVES HERE TOO, AND IT HAS TO.
  //
  // Apple requires in-app account deletion (App Store Review Guideline
  // 5.1.1(v)) and App Review may exercise the path themselves. For a banned
  // user this was the one screen in the product where that was impossible:
  // `ProtectedRoute` runs its ban gate BEFORE the `allowUnapproved` branch, so
  // every protected route — /profile included, which is where the delete
  // control lives — redirects straight back here, and /data-rights redirects
  // into the same gate. The only exits this screen offered were Support,
  // Rules and Sign Out. So a suspended user's only route to deletion was to
  // email a human, which is exactly what the guideline forbids.
  //
  // Meanwhile `delete-own-account` never read `ban_status` at all, so the API
  // path worked fine for precisely the user the UI blocked. The two halves
  // were backwards from each other.
  //
  // Same hook, same dialog as Profile — see `useDeleteAccount` for why this is
  // shared rather than a second copy of the handler.
  const deleteAccount = useDeleteAccount();

  // The actual reason, read from the row the ban was written to.
  //
  // WHY THIS QUERY EXISTS (2026-08-31): this screen used to derive every word
  // it showed from `profiles.ban_status` alone — three hardcoded sublines
  // selected by a ternary — so a user banned for a fourth reliability strike
  // and a user banned for fraud both read the identical sentence "a violation
  // of our Platform Rules". Meanwhile `user_bans.reason` is `text NOT NULL`,
  // is populated by every writer (BanDialog's category+note composer and ~8
  // server-side consequence ladders), and carries a policy written for exactly
  // this read:
  //     CREATE POLICY "Users can view their own bans" ON public.user_bans
  //       FOR SELECT TO authenticated USING (auth.uid() = user_id);
  // Verified against prod as the banned user, not by reading the migration: a
  // real signed-in test account gets 200 + its own row, and only its own row.
  // Nothing in `src/` consumed that policy — the one screen it was obviously
  // written for did not query the table.
  //
  // This is load-bearing for appeals, not decoration. The ban notification
  // links to `/profile?tab=warnings`, but ProtectedRoute's ban gate runs before
  // its `allowUnapproved` branch and bounces the user straight back here — so
  // before this query there was no route in the product by which a banned user
  // could learn what they were banned for.
  //
  // `unwrap()` per the house rule: a dropped error here would degrade to the
  // old generic copy with no signal that the read failed.
  const { data: ban } = useQuery({
    queryKey: ["accountBan", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("user_bans")
          .select("ban_type, reason, expires_at")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
  });

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
  const banReason = ban?.reason?.trim() || null;
  // `auto_suspended_until` FIRST because it is the column that actually governs
  // the lift: `sweep_expired_auto_bans` selects
  // `ban_status='temp_banned' AND auto_suspended_until < NOW()` and never looks
  // at `user_bans.expires_at`. So it is the honest date to show a user asking
  // "when do I get back in?".
  //
  // The `user_bans.expires_at` fallback covers the one shape that used to
  // render a promise with no date at all: a `temp_banned` row whose
  // `auto_suspended_until` is null. BanDialog now writes both (it once wrote
  // only `expires_at`, which is how a "7 day" ban became permanent-in-practice
  // AND dateless), but any row predating that fix is still in this state.
  // Prod check 2026-08-31: zero such rows exist today — this is a guard against
  // a latent shape, not a live incident.
  const suspendedUntil = profile?.auto_suspended_until ?? ban?.expires_at ?? null;

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

  // When we have the real reason we show it verbatim in its own block below,
  // so the vague "due to a violation of our Platform Rules" tail is dropped —
  // otherwise the screen asserts a generic cause immediately above the specific
  // one, which reads as two different explanations for the same ban.
  const subline = isPermanent
    ? banReason
      ? "Your access to Helpr has been permanently revoked."
      : "Your access to Helpr has been permanently revoked due to a violation of our Platform Rules."
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
        // Labelled. This renders in the DEVICE's zone, and the product states
        // its hours in CT elsewhere ("8a–6p CT"), so an unlabelled "Thu, Sep 3,
        // 1:46 PM" left a suspended user unable to tell which clock governs the
        // one deadline they care about.
        timeZoneName: "short",
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
          {/* NOT `truncate`. Measured 2026-08-31: `text-overflow: ellipsis` +
              `white-space: nowrap` on this h1 clipped the single most important
              sentence on the screen at every phone width — "Account temporarily
              suspended." rendered as "Account temporarily susp…" (scrollWidth
              314 vs clientWidth 277 at 375px, 222 at 320px). A centred headline
              inside a narrow card has no reason to be single-line; `text-balance`
              wraps it evenly instead. `PageHeader`'s truncate is a different
              case — a one-line header row — and stays. */}
          <h1 className="text-page-title leading-tight mt-1 text-balance">
            {headline}.
          </h1>
          <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {subline}
          </p>
        </div>

        {/* Structure copied verbatim from AccountDenied's `denyReason` block —
            same archetype, same card, so the two must not look like different
            people built them. Rendered only when a reason actually exists: an
            empty block asserting nothing is better than inventing a cause. */}
        {banReason && (
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
            <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
              {banReason}
            </p>
          </div>
        )}

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

      {/* Sign Out and Delete Account, in that order and both subordinate to the
          appeal CTAs above. Deletion is a real exit and it must be offered —
          but a suspended user's FIRST move should be the appeal, not the
          irreversible thing, so neither of these wears a filled treatment.
          `text-destructive` distinguishes the permanent one from the
          reversible one without promoting it. */}
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
          <DeleteAccountDialog
            {...deleteAccount.dialogProps}
            // The standard dialog lists what deletion keeps. For a banned user
            // one more thing is kept, and staying quiet about it would let
            // somebody delete their account believing it clears the
            // suspension. It does not: `retain_ban_on_deletion` records the
            // ban against a hash of this email before the purge runs, and
            // `handle_new_user` re-applies it if that address signs up again
            // (20260903014600_ban_survives_self_deletion.sql). Saying so up
            // front is also the more useful answer — the appeal, not the
            // delete button, is the route back in.
            extraKeptItems={[
              isPermanent
                ? "This ban — it applies again if you sign up with this email"
                : "This suspension — it applies again if you sign up with this email before it ends",
            ]}
          />
        </Suspense>
      )}
    </AuthShell>
  );
};

export default AccountBanned;
