import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Award, Crown, ExternalLink, Sparkles, Star, TrendingUp } from "lucide-react";
import { formatName } from "@/lib/utils";
import { Link } from "react-router-dom";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { unwrap } from "@/lib/supabaseResult";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminViewShell, AdminCard, AdminFilterStrip } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { report } from "@/lib/errorLogger";

interface HelperTier {
  user_id: string;
  full_name: string | null;
  parish: string | null;
  avatar_url: string | null;
  total_reviews: number;
  recent_reviews: number;
  avg_rating: number;
  recent_avg_rating: number;
  completed_jobs: number;
  growth_score: number;
  /** One of the five TIER_ICON names today, but the RPC decides: see tierLook. */
  tier: string;
}

// Tier chips are a decorative BRAND palette, not a severity signal — the
// 4 non-"New" tiers need 4 distinct hues to visually differentiate a
// helper's standing at a glance, and the semantic tone map (danger /
// warning / notice / success / info / neutral) only has 6 buckets that
// would collapse Elite + Verified onto the same "info" hue. Kept as
// intentional palette utilities; see AdminHelperTiers header comment.
const TIER_COLOR: Record<string, string> = {
  Elite: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200",
  Verified: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200",
  "Rising Star": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200",
  Active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200",
  New: "bg-muted text-muted-foreground border-border",
};

const TIER_ICON: Record<string, any> = {
  Elite: Crown,
  Verified: Sparkles,
  "Rising Star": TrendingUp,
  Active: Star,
  New: Star,
};

/**
 * The look for a tier name, with a neutral fallback. The RPC decides the tier
 * names, so a renamed, new or lowercase tier (the last is what crashed the
 * route in the mocked sweep, 25767c27e) made `<Icon/>` undefined and took the
 * whole route down. An unknown name now renders as a plain muted badge.
 */
const has = (map: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(map, key);
const tierLook = (tier: string) => ({
  known: has(TIER_ICON, tier),
  Icon: has(TIER_ICON, tier) ? TIER_ICON[tier] : Award,
  color: has(TIER_COLOR, tier) ? TIER_COLOR[tier] : "bg-muted text-muted-foreground border-border",
});

/** Each unknown tier name is reported once per page load, not per row or render. */
const reportedUnknownTiers = new Set<string>();

const AdminHelperTiers = () => {
  const [tierFilter, setTierFilter] = useState<string>("all");

  // isError/refetch are read below: unwrap() flips isError on a failed RPC, but
  // this component previously destructured only `data` — so a failure collapsed
  // into `helpers = []` and rendered as a misleading "No Helprs" empty state.
  // (This is exactly how the get_helper_tiers 42501 grant bug hid: 7 real
  // helpers, shown as zero. See migration 20260724194356.)
  const { data: helpers, isInitialLoading, isError, refetch } = useInstantQuery<HelperTier[]>({
    key: ["admin-helper-tiers"],
    fallback: [],
    fetcher: async () => {
      // RPC row shape differs from the local HelperTier type (column
      // naming / nullability) — cast at the boundary. unwrap() surfaces a
      // failed RPC as the query's error state (isError), handled in render.
      const data = unwrap(await supabase.rpc("get_helper_tiers", { p_limit: 50 }));
      return (data as HelperTier[]) || [];
    },
  });

  const tiers = ["Elite", "Verified", "Rising Star", "Active", "New"];

  const unknownTiers = [...new Set(helpers.map((h) => String(h.tier)).filter((t) => !tierLook(t).known))].sort().join("\n");
  useEffect(() => {
    for (const tier of unknownTiers ? unknownTiers.split("\n") : []) {
      if (reportedUnknownTiers.has(tier)) continue;
      reportedUnknownTiers.add(tier);
      report(new Error("AdminHelperTiers: unknown tier from get_helper_tiers"), {
        severity: "warning",
        tags: { source: "AdminHelperTiers.unknownTier" },
        context: { tier },
      });
    }
  }, [unknownTiers]);
  const visible = tierFilter === "all" ? helpers : helpers.filter((h) => h.tier === tierFilter);
  const counts = tiers.reduce<Record<string, number>>((acc, t) => {
    acc[t] = helpers.filter((h) => h.tier === t).length;
    return acc;
  }, {});

  return (
    <AdminViewShell>
      {/* The lead sentence used to sit naked on the page background above a
          chip row that wrapped to two ragged lines. It is a description OF
          this queue, so it becomes the card's subtitle, and the six chips
          become one scrollable strip. */}
      <AdminCard
        title="Approved Helprs by Tier"
        subtitle="Rising Star = recent review momentum (last 30 days). Reach out to feature them."
        contentClassName="space-y-4"
      >
      <AdminFilterStrip label="Filter Helprs by tier">
        <Button
          size="sm"
          variant={tierFilter === "all" ? "default" : "outline"}
          onClick={() => setTierFilter("all")}
          aria-pressed={tierFilter === "all"}
          className="shrink-0"
        >
          All ({helpers.length})
        </Button>
        {tiers.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tierFilter === t ? "default" : "outline"}
            onClick={() => setTierFilter(t)}
            aria-pressed={tierFilter === t}
            className="shrink-0"
          >
            {t} ({counts[t] || 0})
          </Button>
        ))}
      </AdminFilterStrip>

      {isInitialLoading ? (
        <p className="text-ds-11 text-muted-foreground">Loading tiers…</p>
      ) : isError ? (
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="We couldn't load Helpr tiers."
          body="Tap Try again — this is read-only, nothing was changed."
          onRetry={() => refetch()}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={Award}
          title="Nobody in this tier"
          body="Helprs move up as they complete jobs and earn reviews."
        />
      ) : (
        <div className="space-y-2">
          {visible.map((helper) => {
            const { Icon, color } = tierLook(String(helper.tier));
            return (
              <div key={helper.user_id} className="rounded-ds-md border border-border/60 bg-background/40 p-4 flex items-center gap-3">
                <UserAvatar
                  userId={helper.user_id}
                  src={helper.avatar_url}
                  name={helper.full_name}
                  pixelSize={40}
                  className="w-10 h-10 shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-ds-13 text-foreground truncate">
                      {formatName(helper.full_name, "—")}
                    </p>
                    <Badge className={`${color} text-ds-10 gap-0.5`}>
                      <Icon className="w-3 h-3" /> {helper.tier}
                    </Badge>
                    {/* An unset parish rendered as an empty gap, which reads as
                        a broken row next to three that have one. Say what is
                        actually true instead. */}
                    <span className="text-ds-11 text-muted-foreground">
                      {helper.parish ? `${helper.parish} Parish` : "No parish set"}
                    </span>
                  </div>
                  {/* `flex-wrap` + `whitespace-nowrap`: at 375 the three stats
                      used to share one line with the View button and broke
                      mid-phrase ("5.00 avg / (10 / reviews)"). Each stat now
                      wraps as a unit. */}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-ds-11 text-muted-foreground [&>span]:whitespace-nowrap">
                    <span className="flex items-center gap-0.5">
                      {/* intentional: gold star (rating icon), not a status tone */}
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      {Number(helper.avg_rating).toFixed(2)} avg ({helper.total_reviews}{" "}
                      {helper.total_reviews === 1 ? "review" : "reviews"})
                    </span>
                    {helper.recent_reviews > 0 && (
                      <span className="flex items-center gap-0.5 text-primary">
                        <TrendingUp className="w-3 h-3" />
                        +{helper.recent_reviews} in 30d
                      </span>
                    )}
                    <span>
                      {helper.completed_jobs} {helper.completed_jobs === 1 ? "job" : "jobs"}
                    </span>
                  </div>
                </div>
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <Link to={`/user/${helper.user_id}`}>
                    View <ExternalLink className="w-3 h-3 ml-1" />
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
      )}
      </AdminCard>
    </AdminViewShell>
  );
};

export default AdminHelperTiers;
