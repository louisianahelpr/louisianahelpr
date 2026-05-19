import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatName } from "@/lib/utils";

/**
 * Your Helprs — a horizontal quick-rebook strip on the Dashboard.
 *
 * Surfaces the customer's saved helprs (the same get_my_saved_helpers RPC
 * that backs Profile → Saved Helprs) so a repeat booking is one tap away
 * instead of buried in a profile sub-tab. Tapping a helpr opens PostJob
 * with ?offerTo so the new job goes straight to them as a direct offer
 * — the established "hire again" fast-path.
 *
 * Renders nothing when the user has no saved helprs, so it never clutters
 * the feed for newcomers.
 */
interface SavedHelperLite {
  helper_id: string;
  full_name: string | null;
  avatar_url: string | null;
}

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";

export function YourHelpersRow() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();

  const { data: helpers } = useQuery({
    queryKey: ["savedHelpers", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_saved_helpers");
      if (error) throw error;
      return (data ?? []) as SavedHelperLite[];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  if (!helpers || helpers.length === 0) return null;

  return (
    <div className="shrink-0 px-4 pt-1 pb-1.5">
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="font-serif italic uppercase tracking-[0.18em]"
          style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)" }}
        >
          Your helprs
        </span>
        <button
          type="button"
          onClick={() => navigate("/profile?tab=saved_helpers")}
          className="text-[0.65rem] font-sans font-semibold active:opacity-60 transition-opacity"
          style={{ color: "hsl(var(--olivewood) / 0.6)" }}
        >
          See all
        </button>
      </div>
      <div className="flex gap-3.5 overflow-x-auto no-scrollbar -mx-4 px-4">
        {helpers.map((h) => {
          const name = formatName(h.full_name, "Helpr");
          return (
            <button
              key={h.helper_id}
              type="button"
              onClick={() => navigate(`/post-job?offerTo=${h.helper_id}`)}
              className="shrink-0 w-[3.75rem] flex flex-col items-center gap-1 active:scale-95 transition-transform"
              aria-label={`Offer a job to ${name}`}
            >
              <span
                className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center"
                style={{
                  background: "hsl(var(--bark) / 0.12)",
                  boxShadow: "0 0 0 1px hsl(var(--olivewood) / 0.18)",
                }}
              >
                {h.avatar_url ? (
                  <img
                    loading="lazy"
                    decoding="async"
                    src={h.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span
                    className="font-display italic font-bold text-[0.85rem]"
                    style={{ color: "hsl(var(--bark))" }}
                  >
                    {initialsOf(name)}
                  </span>
                )}
              </span>
              <span
                className="text-[0.65rem] font-sans font-medium leading-tight truncate w-full text-center"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {name.split(" ")[0]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default YourHelpersRow;
