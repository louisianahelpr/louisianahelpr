import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, MailCheck, RefreshCw, ArrowRight, Clock, Check, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { toast } from "sonner";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
import { postAuthDestination } from "@/lib/jobIntent";
import { REVIEW_SLA, REVIEW_SLA_HOURS } from "@/lib/reviewSla";

const StepRow = ({
  label,
  state,
}: {
  label: string;
  state: "done" | "in_progress" | "pending";
}) => {
  const icon =
    state === "done" ? (
      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
        <Check className="w-3.5 h-3.5" strokeWidth={3} />
      </span>
    ) : state === "in_progress" ? (
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "hsl(var(--amber-tint) / 0.15)", color: "hsl(var(--amber-ink))" }}
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      </span>
    ) : (
      <span className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0 text-ds-11">
        •
      </span>
    );

  const tone =
    state === "done"
      ? "text-foreground"
      : state === "in_progress"
        ? "text-foreground"
        : "text-muted-foreground";
  const sub =
    state === "done" ? "Complete" : state === "in_progress" ? "In progress" : "Waiting";
  const subTone =
    state === "done"
      ? "text-primary"
      : state === "pending"
        ? "text-muted-foreground/80"
        : "";
  const subStyle =
    state === "in_progress" ? { color: "hsl(var(--amber-ink))" } : undefined;

  return (
    <div className="flex items-center gap-3 py-1.5">
      {icon}
      <div className="flex-1 min-w-0">
        <p className={`text-ds-13 font-medium leading-tight ${tone}`}>{label}</p>
        <p className={`text-ds-11 leading-tight ${subTone}`} style={subStyle}>{sub}</p>
      </div>
    </div>
  );
};

const SkeletonCard = () => (
  <div className="w-full max-w-md rounded-ds-lg bg-card p-7 motion-safe:animate-pulse">
    <div className="w-16 h-16 rounded-2xl bg-muted mx-auto" />
    <div className="h-6 w-2/3 mx-auto mt-5 rounded bg-muted" />
    <div className="h-3 w-5/6 mx-auto mt-3 rounded bg-muted/70" />
    <div className="h-3 w-3/4 mx-auto mt-2 rounded bg-muted/70" />
    <div className="h-1.5 w-full mt-6 rounded-full bg-muted" />
    <div className="space-y-3 mt-5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-muted" />
          <div className="h-3 flex-1 rounded bg-muted/70" />
        </div>
      ))}
    </div>
  </div>
);

const AccountPending = () => {
  usePageTitle("Account Under Review — Helpr");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Single source of truth for auth + profile, shared with the rest of
  // the app. useCurrentUser carries its own realtime subscription on the
  // profile row, so an admin flipping approval_status advances this
  // screen without a bespoke fetch/subscribe/poll stack here.
  const { user, profile, isLoading: loading } = useCurrentUser();
  const emailVerified = !!user?.email_confirmed_at;
  const userEmail = user?.email ?? "";
  const [resending, setResending] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Leave the pending screen as soon as the account is decided. The
  // profile is kept fresh by useCurrentUser's realtime + focus/reconnect
  // refetch; the interval below is a belt-and-suspenders poll in case
  // realtime is unavailable while the user waits on this screen.
  useEffect(() => {
    if (loading) return;
    // `replace` — otherwise the browser Back button returns here and
    // re-bounces forever (a history trap on all three account-gate screens).
    if (!user) { navigate("/login", { replace: true }); return; }
    if (profile?.approval_status === "approved") {
      // THE hop where a new account is finally admitted to the app — and the
      // end of the journey that began with a logged-out tap on a job card.
      // `postAuthDestination` spends the stored `?redirect=` target here
      // (re-validating it as same-origin first) and clears the key, so the
      // visitor lands on the job they wanted instead of having to hunt for it
      // on a generic dashboard. With nothing stored it returns "/dashboard",
      // exactly as before. The read is destructive, so a later unrelated visit
      // to this screen can never re-fire it.
      navigate(postAuthDestination());
    } else if (profile?.approval_status === "denied") {
      navigate("/account-denied");
    }
  }, [user, profile, loading, navigate]);

  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.all });
    }, 15000);
    return () => clearInterval(interval);
  }, [queryClient]);

  const handleResendVerification = async () => {
    if (resending) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: userEmail });
      if (error) toast.error("Couldn't send. Try again in a moment.");
    } catch {
      toast.error("Hit a snag on our end — try that again in a moment?");
    } finally {
      setResending(false);
    }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      // Drop any stale cached approval state, then re-pull the shared
      // profile query. The redirect effect handles the outcome once the
      // fresh row lands.
      try {
        const keysToScrub = ["currentUser", "profile", "approval", "review", "pending"];
        for (const storage of [window.localStorage, window.sessionStorage]) {
          const toRemove: string[] = [];
          for (let i = 0; i < storage.length; i += 1) {
            const k = storage.key(i);
            if (k && keysToScrub.some((kk) => k.toLowerCase().includes(kk))) toRemove.push(k);
          }
          toRemove.forEach((k) => storage.removeItem(k));
        }
      } catch { /* ignore */ }

      await queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.all });
      await queryClient.refetchQueries({ queryKey: queryKeys.currentUser.all });

    } catch {
      toast.error("Couldn't sync your status just yet — try again in a sec?");
    } finally {
      setSyncing(false);
    }
  };

  // ----- derive checklist -----
  const idDone = !!profile?.id_document_url || profile?.idv_status === "verified";
  const idInProgress = !idDone && (!!profile?.idv_session_id || profile?.idv_status === "pending");
  const profDone =
    profile?.license_status === "verified" || profile?.insurance_status === "verified";
  const profInProgress =
    !profDone &&
    (profile?.license_status === "pending" || profile?.insurance_status === "pending");
  const reviewInProgress = emailVerified && idDone;

  const steps: { label: string; state: "done" | "in_progress" | "pending" }[] = [
    {
      label: "Email confirmed",
      state: emailVerified ? "done" : "in_progress",
    },
    {
      label: "ID uploaded",
      state: idDone ? "done" : idInProgress ? "in_progress" : "pending",
    },
    {
      label: "Professional check",
      state: profDone ? "done" : profInProgress ? "in_progress" : "pending",
    },
    {
      label: "Final admin review",
      state: reviewInProgress ? "in_progress" : "pending",
    },
  ];

  const completed = steps.filter((s) => s.state === "done").length;
  const progressPct = Math.round((completed / steps.length) * 100);
  const firstName = (profile?.full_name || "").split(" ")[0];

  return (
    // Unified onto AuthShell's centered-card treatment so all four
    // account-state screens (SignupPending, AccountPending, AccountDenied,
    // AccountBanned) read as one archetype: status + explanation + a single
    // next step. `align="center"` balances the short card in the viewport.
    <AuthShell hideBack eyebrow="Account status" maxWidth="md" align="center">
      <div className="w-full">
        {loading ? (
          <SkeletonCard />
        ) : !emailVerified ? (
          // ---------- Email-not-verified variant (kept compact) ----------
          <div className="w-full bg-card rounded-ds-lg p-7 flex flex-col items-center text-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
              style={{ background: "hsl(var(--amber-tint) / 0.10)" }}
            >
              <MailCheck className="w-8 h-8" style={{ color: "hsl(var(--amber-solid))" }} />
            </div>
            <span className="text-display-eyebrow mb-2">One more step</span>
            <h1
              className="font-display italic font-bold leading-tight mb-3 mt-1 text-ds-26"
              style={{
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.02em",
              }}
            >
              Check your email
            </h1>
            <p className="text-ds-11 text-muted-foreground leading-relaxed mb-6">
              We sent a verification link to{" "}
              <span className="font-medium text-foreground break-all">{userEmail}</span>
            </p>
            <Button
              onClick={handleResendVerification}
              disabled={resending}
              size="lg"
              variant="outline"
              className="w-full gap-2 rounded-ds-md"
            >
              {resending ? (<><RefreshCw className="w-4 h-4 animate-spin" /> Sending…</>) : "Resend Email"}
            </Button>
            <p className="text-ds-11 text-muted-foreground mt-3">
              Didn&apos;t get it? Check your spam folder.
            </p>
          </div>
        ) : (
          // ---------- Verification Center ----------
          <div className="w-full flex flex-col gap-4">
            {/* Status hero */}
            <div className="shrink-0 bg-card rounded-ds-lg p-5 sm:p-6">
              <div className="flex flex-col items-center text-center">
                <div className="relative w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <Clock className="w-8 h-8 text-primary" />
                  <span className="absolute inset-0 rounded-2xl ring-2 ring-primary/20 motion-safe:animate-ping" />
                </div>
                <span className="text-display-eyebrow mb-1">Almost ready</span>
                <h1
                  className="font-display italic font-bold leading-tight mb-1.5 mt-1 text-ds-24"
                  style={{
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.02em",
                  }}
                >
                  We&apos;re verifying your details
                </h1>
                {/* Deliberately carries no turnaround number: the banner below
                    owns the SLA. This line used to say "24–48 hours" while that
                    banner said "under 2 hours", and both always render — so the
                    screen contradicted itself in front of someone waiting on
                    approval. One statement, one number, one source. */}
                <p className="text-ds-13 text-muted-foreground leading-relaxed max-w-[90%] sm:max-w-[28ch]">
                  {firstName ? `Hang tight, ${firstName}. ` : ""}
                  Our team is reviewing your credentials.
                </p>
              </div>

              {/* Progress bar */}
              <div className="mt-5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-ds-11 font-medium uppercase tracking-wider text-muted-foreground">
                    Verification progress
                  </span>
                  <span className="text-ds-11 font-semibold text-primary">{progressPct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-700"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Checklist */}
              <div className="mt-3 divide-y divide-border/50">
                {steps.map((s) => (
                  <StepRow key={s.label} label={s.label} state={s.state} />
                ))}
              </div>
            </div>

            {/* Estimated review-time banner — the ONE place this screen
                states a turnaround, calibrated for business-hour reviewers.
                The number comes from REVIEW_SLA so the dashboard's
                pending-review banner can never drift away from it. Renders
                only when there's still review work in flight. */}
            {!reviewInProgress || progressPct < 100 ? (
              <div
                className="shrink-0 rounded-ds-md px-4 py-3 flex items-start gap-3"
                style={{
                  background: "hsl(var(--bark) / 0.06)",
                  border: "1px solid hsl(var(--bark) / 0.14)",
                }}
              >
                <Clock
                  className="w-4 h-4 shrink-0 mt-0.5"
                  strokeWidth={1.75}
                  style={{ color: "hsl(var(--bark))" }}
                  aria-hidden
                />
                <p className="text-ds-11 font-sans leading-relaxed" style={{ color: "hsl(var(--ink-deep))" }}>
                  Reviews usually finish in{" "}
                  <span className="font-semibold">{REVIEW_SLA}</span>{" "}
                  during business hours ({REVIEW_SLA_HOURS}). Overnight signups
                  clear next morning.
                </p>
              </div>
            ) : null}

            {/* Action area */}
            <div className="shrink-0 flex flex-col gap-2.5">
              <Button
                variant="primary"
                onClick={() => navigate("/dashboard")}
                size="lg"
                className="w-full gap-2 rounded-ds-md"
              >
                Explore Jobs While You Wait <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                onClick={handleSync}
                disabled={syncing}
                size="sm"
                variant="ghost"
                className="w-full gap-2 rounded-ds-md text-muted-foreground hover:text-foreground"
              >
                {syncing ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Syncing…</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5" /> Sync Status</>
                )}
              </Button>
              {/* Contact CTA — pre-fills the support email with the user's
                  ID + email so the admin can find the right row instantly
                  without asking a sleep-deprived applicant to dig out
                  their account info. Falls back to /support on web if
                  mailto: is blocked. */}
              <a
                href={`mailto:admin@louisianahelpr.com?subject=${encodeURIComponent(
                  "Account review question",
                )}&body=${encodeURIComponent(
                  [
                    "Hi Helpr team,",
                    "",
                    "I'm waiting on account approval and have a question:",
                    "",
                    "[Your question here]",
                    "",
                    "—",
                    `User ID: ${user?.id ?? "unknown"}`,
                    `Email: ${userEmail || "unknown"}`,
                  ].join("\n"),
                )}`}
                className="text-center text-ds-12 text-muted-foreground hover:text-foreground transition-colors"
              >
                Need help?{" "}
                <span className="underline underline-offset-2">Contact support</span>
              </a>
            </div>
          </div>
        )}

        {/* Sign-out — mirrors AccountDenied / AccountBanned so all four
            account-state screens carry the same quiet escape hatch at the
            card foot (replaces the old AppShell header's sign-out). */}
        {!loading && (
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
        )}
      </div>
    </AuthShell>
  );
};

export default AccountPending;
