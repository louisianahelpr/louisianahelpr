import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Crown, Star, TrendingUp, Sparkles, ExternalLink } from "lucide-react";
import { formatName } from "@/lib/utils";
import { Link } from "react-router-dom";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { unwrap } from "@/lib/supabaseResult";

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
  tier: "Elite" | "Verified" | "Rising Star" | "Active" | "New";
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

const AdminHelperTiers = () => {
  const [tierFilter, setTierFilter] = useState<string>("all");

  const { data: helpers, isInitialLoading } = useInstantQuery<HelperTier[]>({
    key: ["admin-helper-tiers"],
    fallback: [],
    fetcher: async () => {
      // RPC row shape differs from the local HelperTier type (column
      // naming / nullability) — cast at the boundary. unwrap() surfaces a
      // failed RPC as the query's error state instead of a silent empty list.
      const data = unwrap(await supabase.rpc("get_helper_tiers", { p_limit: 50 }));
      return (data as HelperTier[]) || [];
    },
  });

  const tiers = ["Elite", "Verified", "Rising Star", "Active", "New"];
  const visible = tierFilter === "all" ? helpers : helpers.filter((h) => h.tier === tierFilter);
  const counts = tiers.reduce<Record<string, number>>((acc, t) => {
    acc[t] = helpers.filter((h) => h.tier === t).length;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <p className="text-ds-11 text-muted-foreground">
        Performance-tiered view of approved Helprs. "Rising Stars" = recent review momentum (last 30 days). Reach out to feature them.
      </p>

      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant={tierFilter === "all" ? "default" : "outline"}
          onClick={() => setTierFilter("all")}
        >
          All ({helpers.length})
        </Button>
        {tiers.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tierFilter === t ? "default" : "outline"}
            onClick={() => setTierFilter(t)}
          >
            {t} ({counts[t] || 0})
          </Button>
        ))}
      </div>

      {isInitialLoading ? (
        <p className="text-ds-11 text-muted-foreground">Loading tiers…</p>
      ) : visible.length === 0 ? (
        <p className="text-ds-11 text-muted-foreground text-center py-8">No Helprs in this tier yet.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((helper) => {
            const Icon = TIER_ICON[helper.tier];
            return (
              <div key={helper.user_id} className="rounded-ds-md liquid-glass p-4 flex items-center gap-3">
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
                    <Badge className={`${TIER_COLOR[helper.tier]} text-ds-10 gap-0.5`}>
                      <Icon className="w-3 h-3" /> {helper.tier}
                    </Badge>
                    {helper.parish && (
                      <span className="text-ds-11 text-muted-foreground">{helper.parish} Parish</span>
                    )}
                  </div>
                  <div className="flex gap-3 text-ds-11 text-muted-foreground">
                    <span className="flex items-center gap-0.5">
                      {/* intentional: gold star (rating icon), not a status tone */}
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      {Number(helper.avg_rating).toFixed(2)} avg ({helper.total_reviews} reviews)
                    </span>
                    {helper.recent_reviews > 0 && (
                      <span className="flex items-center gap-0.5 text-primary">
                        <TrendingUp className="w-3 h-3" />
                        +{helper.recent_reviews} in 30d
                      </span>
                    )}
                    <span>{helper.completed_jobs} jobs</span>
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
    </div>
  );
};

export default AdminHelperTiers;
