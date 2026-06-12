import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ShieldCheck, Star, Briefcase, AlertTriangle } from "lucide-react";
import HelprMark from "@/components/HelprMark";

interface HelperProfile {
  full_name: string | null;
  avatar_url: string | null;
  approval_status: string | null;
  completed_jobs: number;
  avg_rating: number | null;
}

const VerifyHelper = () => {
  usePageTitle("Verify Helper — Helpr");
  const { helperId } = useParams<{ helperId: string }>();
  const [profile, setProfile] = useState<HelperProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!helperId) { setNotFound(true); setLoading(false); return; }
    (async () => {
      const { data: profileData, error: profileErr } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, approval_status")
        .eq("user_id", helperId)
        .single();

      if (profileErr || !profileData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // Get completed job count
      const { count: completedCount } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("helper_id", helperId)
        .eq("status", "completed");

      // Get average rating from reviews
      const { data: reviewData } = await supabase
        .from("reviews")
        .select("rating")
        .eq("reviewee_id", helperId);

      let avgRating: number | null = null;
      if (reviewData && reviewData.length > 0) {
        const total = reviewData.reduce((sum, r) => sum + (r.rating ?? 0), 0);
        avgRating = total / reviewData.length;
      }

      setProfile({
        full_name: profileData.full_name,
        avatar_url: profileData.avatar_url,
        approval_status: profileData.approval_status,
        completed_jobs: completedCount ?? 0,
        avg_rating: avgRating,
      });
      setLoading(false);
    })();
  }, [helperId]);

  const isApproved = profile?.approval_status === "approved";
  const initials = profile?.full_name
    ? profile.full_name
        .split(" ")
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  if (loading) {
    return (
      <div className="min-h-screen bg-premium-page flex items-center justify-center">
        <div className="w-12 h-12 rounded-full animate-pulse" style={{ background: "hsl(var(--parchment))" }} />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-premium-page flex flex-col items-center justify-center px-6 text-center gap-4">
        <AlertTriangle className="w-10 h-10" style={{ color: "hsl(var(--burnt-sienna))" }} />
        <h1 className="font-display font-bold text-2xl" style={{ color: "hsl(var(--ink-deep))" }}>
          Helper not found
        </h1>
        <p className="text-sm" style={{ color: "hsl(var(--olivewood))" }}>
          This QR code may be expired or invalid. Ask the helper to regenerate it from their profile.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav flex flex-col">
      {/* Brand bar */}
      <div className="flex items-center justify-center py-5">
        <HelprMark to="/" size="md" />
      </div>

      {/* Verification card */}
      <div className="flex-1 flex items-start justify-center px-5 pt-4">
        <div
          className="w-full max-w-sm rounded-ds-lg overflow-hidden"
          style={{
            background: "hsl(var(--parchment) / 0.95)",
            boxShadow:
              "0 1px 2px hsl(var(--olivewood) / 0.06), 0 8px 24px -4px hsl(var(--olivewood) / 0.14), 0 20px 40px -10px hsl(var(--olivewood) / 0.12)",
          }}
        >
          {/* Status banner */}
          <div
            className="px-5 py-3 flex items-center gap-2"
            style={{
              background: isApproved
                ? "hsl(143 60% 38% / 0.1)"
                : "hsl(var(--burnt-sienna) / 0.08)",
            }}
          >
            {isApproved ? (
              <ShieldCheck
                className="w-5 h-5 shrink-0"
                style={{ color: "hsl(143 60% 38%)" }}
              />
            ) : (
              <AlertTriangle
                className="w-5 h-5 shrink-0"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              />
            )}
            <span
              className="text-xs font-semibold uppercase tracking-widest"
              style={{
                color: isApproved
                  ? "hsl(143 60% 30%)"
                  : "hsl(var(--burnt-sienna))",
                letterSpacing: "0.14em",
              }}
            >
              {isApproved ? "ID Verified — Active on Helpr" : "Not currently active on Helpr"}
            </span>
          </div>

          {/* Avatar + identity */}
          <div className="flex flex-col items-center px-6 pt-8 pb-6 gap-4">
            {/* Avatar */}
            <div className="relative">
              {profile?.avatar_url && !avatarBroken ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.full_name ?? "Helper"}
                  className="w-28 h-28 rounded-ds-lg object-cover"
                  style={{
                    boxShadow: "0 4px 16px hsl(var(--olivewood) / 0.18)",
                  }}
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <div
                  className="w-28 h-28 rounded-ds-lg flex items-center justify-center text-3xl font-bold font-serif"
                  style={{
                    background: "hsl(var(--bark) / 0.12)",
                    color: "hsl(var(--bark))",
                  }}
                >
                  {initials}
                </div>
              )}
              {isApproved && (
                <div
                  className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{
                    background: "hsl(143 60% 38%)",
                    boxShadow: "0 2px 6px hsl(var(--olivewood) / 0.22)",
                  }}
                >
                  <ShieldCheck className="w-4 h-4 text-white" />
                </div>
              )}
            </div>

            {/* Name */}
            <div className="text-center space-y-1">
              <h1
                className="font-display font-bold text-2xl leading-tight"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                {profile?.full_name ?? "Unknown"}
              </h1>

              {/* Stats strip */}
              <div className="flex items-center justify-center gap-4 pt-1">
                {profile?.avg_rating !== null && (
                  <div className="flex items-center gap-1">
                    <Star
                      className="w-3.5 h-3.5"
                      style={{
                        color: "hsl(var(--gold-warm))",
                        fill: "hsl(var(--gold-warm))",
                      }}
                    />
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: "hsl(var(--ink-deep))" }}
                    >
                      {profile.avg_rating.toFixed(1)}
                    </span>
                  </div>
                )}
                {(profile.completed_jobs ?? 0) > 0 && (
                  <div className="flex items-center gap-1">
                    <Briefcase
                      className="w-3.5 h-3.5"
                      style={{ color: "hsl(var(--bark))" }}
                    />
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: "hsl(var(--ink-deep))" }}
                    >
                      {profile.completed_jobs}{" "}
                      <span className="font-normal" style={{ color: "hsl(var(--olivewood))" }}>
                        {profile.completed_jobs === 1 ? "job" : "jobs"}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Trust copy */}
            <p
              className="text-center text-xs leading-relaxed max-w-xs"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              {isApproved
                ? "This person has been Stripe Identity-verified by Helpr."
                : "This helper is not currently active. Do not proceed with this job."}
            </p>
          </div>

          {/* Footer */}
          <div
            className="px-5 py-4 text-center text-[10px] border-t"
            style={{
              borderColor: "hsl(var(--olivewood) / 0.1)",
              color: "hsl(var(--olivewood) / 0.6)",
            }}
          >
            Verified by louisianahelpr.com · For security questions,{" "}
            <a
              href="mailto:admin@louisianahelpr.com"
              className="underline underline-offset-2"
              style={{ color: "hsl(var(--bark))" }}
            >
              contact us
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyHelper;
