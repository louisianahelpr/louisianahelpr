import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Award, Crown } from "lucide-react";

type ParishBadgeData = {
  home_parish: string | null;
  is_verified_local: boolean;
  is_top_helper_in_parish: boolean;
  parish_completed_jobs: number;
};

interface ParishBadgesProps {
  userId: string;
  /** When true, render compact pill row (for cards). When false, render fuller layout (for profile). */
  compact?: boolean;
}

/**
 * Trust badges tied to a helper's home parish:
 * - Home parish pill (always shown if parish is set)
 * - "Verified Local" — home parish matches a preferred parish AND ≥3 completed jobs there
 * - "Top Helper in {Parish}" — appears in get_top_helpers_by_parish top 10
 */
export const ParishBadges = ({ userId, compact = false }: ParishBadgesProps) => {
  const [data, setData] = useState<ParishBadgeData | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("get_helper_parish_badges", { _user_id: userId })
      .then(({ data }) => {
        if (cancelled || !data || data.length === 0) return;
        setData(data[0] as ParishBadgeData);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!data?.home_parish) return null;

  const sizeText = compact ? "text-[10px]" : "text-xs";
  const sizeIcon = compact ? "w-3 h-3" : "w-3.5 h-3.5";
  const padding = compact ? "px-2 py-0.5" : "px-2.5 py-1";

  return (
    <div className="flex flex-wrap gap-1.5 justify-center">
      <span
        className={`inline-flex items-center gap-1 ${padding} rounded-full bg-secondary text-secondary-foreground font-medium ${sizeText}`}
        title={`Based in ${data.home_parish} Parish`}
      >
        <MapPin className={sizeIcon} />
        {data.home_parish}
      </span>

      {data.is_verified_local && (
        <span
          className={`inline-flex items-center gap-1 ${padding} rounded-full bg-primary/10 text-primary font-semibold border border-primary/20 ${sizeText}`}
          title={`Completed ${data.parish_completed_jobs}+ jobs in ${data.home_parish} Parish`}
        >
          <Award className={sizeIcon} />
          Verified Local
        </span>
      )}

      {data.is_top_helper_in_parish && (
        <span
          className={`inline-flex items-center gap-1 ${padding} rounded-full bg-accent/15 text-accent-foreground font-semibold border border-accent/30 ${sizeText}`}
          title={`Top 10 helpr in ${data.home_parish} Parish`}
        >
          <Crown className={sizeIcon} />
          Top in {data.home_parish}
        </span>
      )}
    </div>
  );
};
