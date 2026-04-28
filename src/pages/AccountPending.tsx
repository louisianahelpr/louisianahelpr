import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, MailCheck, RefreshCw, ShieldCheck, ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import helprIcon from "@/assets/helpr-icon-96.webp";

const AccountPending = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/login"); return; }

      const isVerified = !!session.user.email_confirmed_at;
      setEmailVerified(isVerified);
      setUserEmail(session.user.email || "");

      const { data: profile } = await supabase
        .from("profiles")
        .select("approval_status, full_name")
        .eq("user_id", session.user.id)
        .single();
      if (!profile) return;
      setFullName(profile.full_name || "");
      if (profile.approval_status === "approved") { navigate("/dashboard"); return; }
      if (profile.approval_status === "denied") { navigate("/account-denied"); return; }
    };

    check();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    const subscribeRealtime = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      channel = supabase
        .channel(`profile-status-${session.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `user_id=eq.${session.user.id}`,
          },
          (payload) => {
            const next = payload.new as { approval_status?: string };
            if (next.approval_status === "approved") navigate("/dashboard");
            else if (next.approval_status === "denied") navigate("/account-denied");
          }
        )
        .subscribe();
    };
    subscribeRealtime();

    const interval = setInterval(check, 10000);
    return () => {
      clearInterval(interval);
      if (channel) supabase.removeChannel(channel);
    };
  }, [navigate]);

  const handleResendVerification = async () => {
    if (resending) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: userEmail });
      if (error) toast.error("Couldn't send. Try again in a moment.");
      else toast.success("Sent! Check your inbox.");
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setResending(false);
    }
  };

  /**
   * Force Sync — clears every locally cached fragment of the "pending" state
   * and pulls a fresh approval_status from the backend. If the user is in fact
   * approved, drop them straight on the dashboard.
   */
  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      // 1. Clear local caches that may be holding the stale "pending" verdict.
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
      } catch {
        /* storage may be unavailable in private mode — ignore */
      }

      // 2. Fully reset react-query cache for the current user.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        navigate("/login", { replace: true });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      await queryClient.refetchQueries({ queryKey: ["currentUser"] });

      // 3. Re-read directly from the database (bypasses every layer of cache).
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("approval_status, full_name")
        .eq("user_id", session.user.id)
        .single();

      if (error || !profile) {
        toast.error("Couldn't reach the server. Try again in a moment.");
        return;
      }

      if (profile.approval_status === "approved") {
        toast.success("You're approved! Welcome in.");
        navigate("/dashboard", { replace: true });
        return;
      }
      if (profile.approval_status === "denied") {
        navigate("/account-denied", { replace: true });
        return;
      }

      toast.success("Verification in progress — sync complete.");
    } catch {
      toast.error("Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  // Fixed top header — matches the global app shell pattern.
  const header = (
    <header className="flex items-center justify-between px-5 h-14 bg-background/80 backdrop-blur-md border-b border-border/40">
      <Link to="/" className="flex items-center gap-2 group" aria-label="Helpr home">
        <span className="w-8 h-8 rounded-xl bg-white shadow-md flex items-center justify-center overflow-hidden">
          <img src={helprIcon} alt="Helpr" className="w-8 h-8 object-contain translate-y-[3px]" />
        </span>
        <span className="text-lg font-display font-bold text-primary">Helpr</span>
      </Link>
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
    <AppShell header={header} reserveBottomNav={false} scrollable={false}>
      <div className="h-full w-full flex items-center justify-center px-5 py-6 overflow-hidden">
        <div
          className="w-full max-w-md bg-white dark:bg-card rounded-[24px] shadow-[0_24px_60px_-20px_hsl(0_0%_0%/0.18),0_8px_24px_-12px_hsl(0_0%_0%/0.12)] border border-black/5 px-6 py-8 sm:px-8 sm:py-10 flex flex-col items-center text-center"
        >
          {/* Icon */}
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-5 ${
              emailVerified ? "bg-primary/10" : "bg-amber-500/10"
            }`}
          >
            {emailVerified ? (
              <ShieldCheck className="w-8 h-8 text-primary" />
            ) : (
              <MailCheck className="w-8 h-8 text-amber-500" />
            )}
          </div>

          {/* Headline — serif display */}
          <h1 className="font-display text-[26px] sm:text-[28px] leading-tight font-semibold tracking-tight text-foreground mb-3">
            {!emailVerified
              ? "Check your email"
              : "Profile Under Review"}
          </h1>

          {/* Body */}
          {!emailVerified ? (
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              We sent a verification link to{" "}
              <span className="font-medium text-foreground break-all">{userEmail}</span>
            </p>
          ) : (
            <div className="space-y-3 mb-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {fullName ? `Hey ${fullName.split(" ")[0]} — verification` : "Verification"} typically takes
                {" "}<span className="font-medium text-foreground">24–48 hours</span>. We&apos;re validating your
                licenses and background check.
              </p>
              <p className="text-xs text-muted-foreground/90 leading-relaxed">
                Already approved? Tap <span className="font-medium text-foreground">Sync Status</span> to
                refresh your credentials.
              </p>
            </div>
          )}

          {/* Primary action */}
          {!emailVerified ? (
            <div className="w-full space-y-3">
              <Button
                onClick={handleResendVerification}
                disabled={resending}
                size="lg"
                variant="outline"
                className="w-full gap-2 rounded-2xl"
              >
                {resending ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Sending…</>
                ) : (
                  <>Resend email</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Didn&apos;t get it? Check your spam folder.
              </p>
            </div>
          ) : (
            <div className="w-full space-y-3">
              <Button
                onClick={handleSync}
                disabled={syncing}
                size="lg"
                className="w-full gap-2 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.55)]"
              >
                {syncing ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Syncing…</>
                ) : (
                  <>Sync Status <ArrowRight className="w-4 h-4" /></>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => { await supabase.auth.signOut(); navigate("/"); }}
                className="w-full text-muted-foreground hover:text-foreground"
              >
                <LogOut className="w-4 h-4 mr-1" /> Sign out
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default AccountPending;
