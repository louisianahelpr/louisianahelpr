import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Camera } from "lucide-react";
import { formatShortDate } from "@/lib/format";

type PortfolioItem = {
  jobTitle: string;
  beforeUrls: string[];
  afterUrls: string[];
  completedAt: string;
};

export function HelperPortfolio({ helperId }: { helperId: string }) {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPortfolio();
  }, [helperId]);

  const loadPortfolio = async () => {
    const { data, error } = await supabase
      .from("jobs")
      .select("title, proof_before_urls, proof_after_urls, updated_at")
      .eq("helper_id", helperId)
      .eq("status", "completed")
      .not("proof_after_urls", "eq", "{}")
      .order("updated_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("[HelperPortfolio] failed to load portfolio:", error);
    } else if (data) {
      setItems(
        data
          .filter((j) => j.proof_after_urls && j.proof_after_urls.length > 0)
          .map((j) => ({
            jobTitle: j.title,
            beforeUrls: j.proof_before_urls || [],
            afterUrls: j.proof_after_urls || [],
            completedAt: j.updated_at,
          }))
      );
    }
    setLoading(false);
  };

  if (loading || items.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-ds-17 font-display font-semibold text-foreground flex items-center gap-2">
        <Camera className="w-5 h-5 text-primary" /> Work Portfolio
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item, idx) => (
          <div key={idx} className="rounded-ds-md liquid-glass overflow-hidden group">
            {/* Show the first after photo as the main image */}
            <div className="relative aspect-[4/3]">
              <img
                src={item.afterUrls[0]}
                alt={`${item.jobTitle} - completed`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {item.beforeUrls.length > 0 && (
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-background/80 text-ds-10 font-medium text-foreground backdrop-blur-sm">
                  Before & After
                </div>
              )}
            </div>
            <div className="p-2.5">
              <p className="text-ds-11 font-medium text-foreground truncate">{item.jobTitle}</p>
              <p className="text-muted-foreground text-ds-11">
                {formatShortDate(item.completedAt)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
