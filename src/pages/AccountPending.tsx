import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, LogOut, MailCheck, RefreshCw, CheckCircle2, ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const AccountPending = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [continuing, setContinuing] = useState(false);

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

  const handleContinue = async () => {
    if (continuing) return;
    setContinuing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("approval_status, role")
          .eq("user_id", session.user.id)
          .single();
        if (profile?.role === "customer" && profile.approval_status === "pending") {
          await supabase
            .from("profiles")
            .update({ approval_status: "approved" })
            .eq("user_id", session.user.id);
        }
        if (profile?.approval_status === "denied") {
          navigate("/account-denied", { replace: true });
          return;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      navigate("/dashboard", { replace: true });
    } catch {
      navigate("/dashboard", { replace: true });
    } finally {
      setContinuing(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 pt-6 pb-4">
        <Link to="/" className="text-xl font-display font-bold text-primary">
          Helpr
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

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 pb-10">
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          {/* Icon */}
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ${
              emailVerified ? "bg-primary/10" : "bg-amber-500/10"
            }`}
          >
            {emailVerified ? (
              <CheckCircle2 className="w-8 h-8 text-primary" />
            ) : (
              <MailCheck className="w-8 h-8 text-amber-500" />
            )}
          </div>

          {/* Headline */}
          <h1 className="text-2xl font-bold text-foreground tracking-tight mb-2">
            {!emailVerified
              ? "Check your email"
              : fullName
              ? `Welcome, ${fullName.split(" ")[0]}!`
              : "You're all set!"}
          </h1>

          {/* Subhead */}
          <p className="text-sm text-muted-foreground leading-relaxed mb-8">
            {!emailVerified ? (
              <>
                We sent a verification link to{" "}
                <span className="font-medium text-foreground break-all">{userEmail}</span>
              </>
            ) : (
              "Your email is verified. Tap below to jump in."
            )}
          </p>

          {/* Primary action */}
          {!emailVerified ? (
            <div className="w-full space-y-3">
              <Button
                onClick={handleResendVerification}
                disabled={resending}
                size="lg"
                variant="outline"
                className="w-full gap-2"
              >
                {resending ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Sending…</>
                ) : (
                  <>Resend email</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Didn't get it? Check your spam folder.
              </p>
            </div>
          ) : (
            <Button
              onClick={handleContinue}
              disabled={continuing}
              size="lg"
              className="w-full gap-2"
            >
              {continuing ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Loading…</>
              ) : (
                <>Continue <ArrowRight className="w-4 h-4" /></>
              )}
            </Button>
          )}

          {/* Footnote */}
          <div className="mt-10 flex items-start gap-2 text-left">
            <Bell className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {emailVerified
                ? "We'll keep you posted on job activity in real time."
                : "This page unlocks automatically once you click the link."}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AccountPending;
