import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, MailCheck, RefreshCw, ArrowRight, Clock, Check, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import HelprMark from "@/components/HelprMark";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";

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
      <span className="w-6 h-6 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
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
      : state === "in_progress"
        ? "text-amber-600"
        : "text-muted-foreground/80";

  return (
    <div className="flex items-center gap-3 py-1.5">
      {icon}
      <div className="flex-1 min-w-0">
        <p className={`text-ds-13 font-medium leading-tight ${tone}`}>{label}</p>
        <p className={`text-ds-11 leading-tight ${subTone}`}>{sub}</p>
      </div>
    </div>
  );
};

const SkeletonCard = () => (
  <div className="w-full max-w-md rounded-[24px] bg-white dark:bg-card border border-black/5 shadow-[0_24px_60px_-20px_hsl(0_0%_0%/0.18)] p-7 animate-pulse">
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
    if (!user) { navigate("/login"); return; }
    if (profile?.approval_status === "approved") {
      toast.success("You're approved! Welcome in.");
      navigate("/dashboard");
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
      else toast.success("Sent! Check your inbox.");
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

      const fresh = queryClient.getQueryData<{ profile: { approval_status?: string | null } | null }>(
        queryKeys.currentUser.byId(user?.id),
      );
      const status = fresh?.profile?.approval_status;
      if (status !== "approved" && status !== "denied") {
        toast.success("Still verifying — we'll notify you the moment you're cleared.");
      }
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

  // Helpr-branded top header. Not a `.glass-header`, so it owns its own
  // top safe-area inset — the `bg-white` background then fills the iOS
  // status-bar region and the row content clears the notch.
  const header = (
    <header
      className="flex items-center justify-between px-5 h-14 bg-white dark:bg-background border-b border-border/40"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <HelprMark to="/" size="md" />
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => { await supabase.auth.signOut(); navigate("/"); }}
        className="text-muted-foreground h-8 px-2"
      >
        <LogOut className="w-4 h-4 mr-1" /> Sign out
      </Button>
    </header>
  );

  return (
    <AppShell header={header} reserveBottomNav={true}>
      <div className="min-h-full w-full flex items-center justify-center px-5 py-4">
        {loading ? (
          <SkeletonCard />
        ) : !emailVerified ? (
          // ---------- Email-not-verified variant (kept compact) ----------
          <div className="w-full max-w-md bg-white dark:bg-card rounded-[24px] shadow-[0_24px_60px_-20px_hsl(0_0%_0%/0.18)] border border-black/5 p-7 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-5">
              <MailCheck className="w-8 h-8 text-amber-500" />
            </div>
            <span className="text-display-eyebrow mb-2">One more step</span>
            <h1
              className="font-display italic font-bold leading-tight mb-3 mt-1"
              style={{
                fontSize: "1.65rem",
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
              className="w-full gap-2 rounded-2xl"
            >
              {resending ? (<><RefreshCw className="w-4 h-4 animate-spin" /> Sending…</>) : "Resend email"}
            </Button>
            <p className="text-ds-11 text-muted-foreground mt-3">
              Didn&apos;t get it? Check your spam folder.
            </p>
          </div>
        ) : (
          // ---------- Verification Center ----------
          <div className="w-full max-w-md flex flex-col gap-4">
            {/* Status hero */}
            <div className="shrink-0 bg-white dark:bg-card rounded-[24px] shadow-[0_24px_60px_-20px_hsl(0_0%_0%/0.18),0_8px_24px_-12px_hsl(0_0%_0%/0.12)] border border-black/5 p-5 sm:p-6">
              <div className="flex flex-col items-center text-center">
                <div className="relative w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <Clock className="w-8 h-8 text-primary" />
                  <span className="absolute inset-0 rounded-2xl ring-2 ring-primary/20 animate-ping" />
                </div>
                <span className="text-display-eyebrow mb-1">Almost ready</span>
                <h1
                  className="font-display italic font-bold leading-tight mb-1.5 mt-1"
                  style={{
                    fontSize: "1.5rem",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.02em",
                  }}
                >
                  We&apos;re verifying your details
                </h1>
                <p className="text-[13px] text-muted-foreground leading-relaxed max-w-[28ch]">
                  {firstName ? `Hang tight, ${firstName}. ` : ""}
                  Our team is reviewing your credentials. This usually takes
                  {" "}<span className="font-medium text-foreground">24–48 hours</span>.
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

            {/* Action area */}
            <div className="shrink-0 flex flex-col gap-2.5">
              <Button
                variant="bark"
                onClick={() => navigate("/dashboard")}
                size="lg"
                className="w-full gap-2 rounded-2xl"
              >
                Explore jobs while you wait <ArrowRight className="w-4 h-4" />
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
                  <><RefreshCw className="w-3.5 h-3.5" /> Sync status</>
                )}
              </Button>
              <Link
                to="/support"
                className="text-center text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Need help? <span className="underline underline-offset-2">Contact support</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default AccountPending;
