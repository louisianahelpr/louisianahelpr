import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Crown, Star, TrendingUp, Sparkles, ExternalLink } from "lucide-react";
import { formatName } from "@/lib/utils";

const getInitials = (name?: string | null) =>
  (name || "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
import { Link } from "react-router-dom";

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

const TIER_COLOR: Record<string, string> = {
  Elite: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200",
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
  const [helpers, setHelpers] = useState<HelperTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase.rpc as any)("get_helper_tiers", { p_limit: 50 });
    if (!error) setHelpers((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const tiers = ["Elite", "Verified", "Rising Star", "Active", "New"];
  const visible = tierFilter === "all" ? helpers : helpers.filter((h) => h.tier === tierFilter);
  const counts = tiers.reduce<Record<string, number>>((acc, t) => {
    acc[t] = helpers.filter((h) => h.tier === t).length;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
          <Crown className="w-5 h-5 text-primary" /> Helper Tiers
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Performance-tiered view of approved helpers. "Rising Stars" = recent review momentum (last 30 days). Reach out to feature them.
        </p>
      </div>

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

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading tiers…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No helpers in this tier yet.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((helper) => {
            const Icon = TIER_ICON[helper.tier];
            return (
              <div key={helper.user_id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                <Avatar className="w-10 h-10 shrink-0">
                  <AvatarImage src={helper.avatar_url || undefined} />
                  <AvatarFallback>{getInitials(helper.full_name)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-foreground truncate">
                      {formatName(helper.full_name, "—")}
                    </p>
                    <Badge className={`${TIER_COLOR[helper.tier]} text-[10px] gap-0.5`}>
                      <Icon className="w-3 h-3" /> {helper.tier}
                    </Badge>
                    {helper.parish && (
                      <span className="text-[11px] text-muted-foreground">{helper.parish} Parish</span>
                    )}
                  </div>
                  <div className="flex gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-0.5">
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
                  <Link to={`/u/${helper.user_id}`}>
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
