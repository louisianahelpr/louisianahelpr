/**
 * Accept a family care invite — public page at /family/accept/:token.
 *
 * No auth required to VIEW the page (so someone can see who's inviting them
 * before logging in). Accepting the invite requires auth.
 *
 * Layout: document-scroll, PageHeader + centered card.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Users, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingInvite {
  id: string;
  caregiver_id: string;
  care_recipient_id: string;
  relationship: string;
  permissions: string[];
  status: string;
  // Caregiver name (joined)
  caregiverName: string | null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FamilyAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  usePageTitle("Care invite — Helpr");

  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Invalid invite link.");
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        // Fetch the pending relationship by token
        const relRes = await supabase
          .from("care_relationships")
          .select("*")
          .eq("invite_token", token)
          .maybeSingle();
        if (relRes.error) throw relRes.error;
        if (!relRes.data) {
          setError("This invite link is invalid or has already been used.");
          setLoading(false);
          return;
        }

        if (relRes.data.status !== "pending") {
          if (relRes.data.status === "active") {
            setError("This invite has already been accepted.");
          } else {
            setError("This invite is no longer valid.");
          }
          setLoading(false);
          return;
        }

        // Reject expired tokens up front so a leaked link (chat log, email
        // archive) can't be redeemed weeks after the fact. The 14-day
        // window is set by the DB default; if the column is NULL on a
        // pre-migration row we treat it as "unknown → expired" to fail
        // closed — the caregiver can re-issue a fresh invite either way.
        const expiresAtRaw = (relRes.data as { invite_token_expires_at?: string | null }).invite_token_expires_at;
        const expiresAtMs = expiresAtRaw ? new Date(expiresAtRaw).getTime() : null;
        if (expiresAtMs == null || Number.isNaN(expiresAtMs) || expiresAtMs < Date.now()) {
          setError("This invite link has expired. Ask them to send you a new one.");
          setLoading(false);
          return;
        }

        // Fetch caregiver's name
        const profRes = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", relRes.data.caregiver_id)
          .maybeSingle();

        setInvite({
          ...relRes.data,
          caregiverName: profRes.data?.full_name ?? null,
        } as PendingInvite);
      } catch (err) {
        report(err as Error, { severity: "warning", tags: { source: "FamilyAcceptPage.load" } });
        setError("Couldn't load this invite. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleAccept = async () => {
    if (!invite) return;
    if (!user) {
      // Redirect to login with return path
      navigate(`/login?redirect=/family/accept/${token}`);
      return;
    }

    setAccepting(true);
    try {
      const { error: updateErr } = await supabase
        .from("care_relationships")
        .update({ status: "active" })
        .eq("id", invite.id)
        .eq("care_recipient_id", user.id); // Security: only the recipient can accept
      if (updateErr) throw updateErr;

      hapticSuccess();
      setAccepted(true);
      toast.success("Access granted");
    } catch (err) {
      report(err as Error, { severity: "warning", tags: { source: "FamilyAcceptPage.accept" } });
      toast.error("Couldn't accept invite — please try again.");
    } finally {
      setAccepting(false);
    }
  };

  const caregiverName = invite?.caregiverName ?? "Someone";
  const permissions = invite?.permissions ?? [];

  const permissionLabels: Record<string, string> = {
    view_jobs: "View your posted jobs",
    post_jobs: "Post jobs on your behalf",
    message_helpers: "Message helpers for your jobs",
    manage_payments: "Manage payments",
  };

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      {/* Body is a lone centered `max-w-sm` invite card; without an explicit
          width the header fell through to `default` (max-w-5xl→90rem) and the
          title sat far left of the card at every breakpoint above sm. */}
      <PageHeader title="Care invite" width="lg" onBack={() => navigate("/")} />

      <div className="max-w-sm mx-auto px-4 pt-8 flex flex-col items-center">

        {/* Loading skeleton */}
        {loading && (
          <div className="w-full space-y-3">
            <div className="h-6 rounded motion-safe:animate-pulse w-2/3 mx-auto" style={{ background: "hsl(var(--sand) / 0.5)" }} />
            <div className="h-32 rounded-ds-md motion-safe:animate-pulse" style={{ background: "hsl(var(--sand) / 0.4)" }} />
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div
            className="w-full rounded-ds-md p-5 flex flex-col items-center gap-3 text-center"
            style={{
              background: "hsl(var(--ivory-sand))",
              border: "0.5px solid hsl(var(--sand) / 0.6)",
            }}
          >
            <AlertTriangle className="w-10 h-10" style={{ color: "hsl(var(--burnt-sienna))" }} />
            <p className="font-display italic font-semibold text-ds-16" style={{ color: "hsl(var(--ink-deep))" }}>
              Invite unavailable
            </p>
            <p className="text-ds-13 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {error}
            </p>
            <Button variant="outline" className="w-full mt-1" onClick={() => navigate("/")}>
              Go home
            </Button>
          </div>
        )}

        {/* Accepted state */}
        {!loading && !error && accepted && (
          <div
            className="w-full rounded-ds-md p-5 flex flex-col items-center gap-3 text-center"
            style={{
              background: "hsl(var(--ivory-sand))",
              border: "0.5px solid hsl(var(--sand) / 0.6)",
            }}
          >
            <CheckCircle2 className="w-10 h-10" style={{ color: "hsl(var(--sage))" }} />
            <p className="font-display italic font-semibold text-ds-16" style={{ color: "hsl(var(--ink-deep))" }}>
              Access granted!
            </p>
            <p className="text-ds-13 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {caregiverName} can now help manage your jobs on Louisiana Helpr.
            </p>
            <Button className="w-full mt-1" onClick={() => navigate("/family")}>
              View family dashboard
            </Button>
          </div>
        )}

        {/* Invite card */}
        {!loading && !error && !accepted && invite && (
          <div className="w-full space-y-4">
            {/* Header icon */}
            <div className="flex justify-center mb-2">
              <div
                className="w-16 h-16 rounded-[20px] flex items-center justify-center"
                style={{ background: "hsl(var(--bark) / 0.1)" }}
              >
                <Users className="w-8 h-8" style={{ color: "hsl(var(--bark))" }} />
              </div>
            </div>

            <div className="text-center">
              <p className="font-display italic font-semibold text-ds-18" style={{ color: "hsl(var(--ink-deep))" }}>
                {caregiverName} wants to help manage your jobs
              </p>
              <p className="text-ds-13 font-serif italic mt-1.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                They'll be able to help you with Louisiana Helpr on your behalf.
              </p>
            </div>

            {/* Permissions list */}
            <div
              className="rounded-ds-md p-4 space-y-2.5"
              style={{
                background: "hsl(var(--ivory-sand))",
                border: "0.5px solid hsl(var(--sand) / 0.6)",
              }}
            >
              <p className="text-ds-12 font-sans font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                What they can do
              </p>
              {permissions.map((p) => (
                <div key={p} className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--sage))" }} />
                  <span className="text-ds-13 font-serif italic" style={{ color: "hsl(var(--ink-deep))" }}>
                    {permissionLabels[p] ?? p}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-ds-11 font-serif italic text-center" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              You can remove their access at any time from your Family & care page.
            </p>

            {/* CTA */}
            {!user ? (
              <div className="space-y-2">
                <Button
                  className="w-full h-12"
                  onClick={() => navigate(`/login?redirect=/family/accept/${token}`)}
                >
                  Sign in to accept
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-12"
                  onClick={() => navigate(`/signup?redirect=/family/accept/${token}`)}
                >
                  Create an account
                </Button>
              </div>
            ) : (
              <Button
                className="w-full h-12"
                onClick={handleAccept}
                disabled={accepting}
              >
                {accepting ? "Accepting…" : `Accept — let ${caregiverName} help`}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
