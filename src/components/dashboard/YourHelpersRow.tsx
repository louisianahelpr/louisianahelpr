import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatName } from "@/lib/utils";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { queryKeys } from "@/lib/queryKeys";
import { report } from "@/lib/errorLogger";

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
  available_until?: string | null;
}

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";

export function YourHelpersRow() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();

  const { data: helpers, error, isError } = useQuery({
    queryKey: queryKeys.savedHelpers.byUser(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_saved_helpers");
      if (error) throw error;
      return (data ?? []) as SavedHelperLite[];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // This strip renders nothing on failure (it's a decorative quick-rebook
  // shortcut, not critical data) — but a fetch failure must still be
  // findable, never silently indistinguishable from "no saved helprs."
  useEffect(() => {
    if (isError) report(error, { tags: { source: "YourHelpersRow.get_my_saved_helpers" } });
  }, [isError, error]);

  if (!helpers || helpers.length === 0) return null;

  return (
    <div className="shrink-0 px-4 pt-1 pb-1.5">
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="font-serif italic uppercase tracking-[0.18em] text-ds-10"
          style={{ color: "hsl(var(--burnt-sienna))" }}
        >
          Your Helprs
        </span>
        <button
          type="button"
          onClick={() => navigate("/profile?tab=saved_helpers")}
          className="text-ds-10 font-sans font-semibold active:opacity-60 transition-opacity"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          See all
        </button>
      </div>
      <div className="flex gap-3.5 overflow-x-auto no-scrollbar -mx-4 px-4">
        {helpers.map((h) => {
          const name = formatName(h.full_name, "Helpr");
          const isAvailable =
            !!h.available_until && new Date(h.available_until) > new Date();
          return (
            <button
              key={h.helper_id}
              type="button"
              onClick={() => navigate(`/post-job?offerTo=${h.helper_id}`)}
              className="shrink-0 w-[3.75rem] flex flex-col items-center gap-1 active:scale-95 transition-transform"
              aria-label={`Offer a job to ${name}`}
            >
              {/* Wrap avatar in a relative container so the availability dot
                  can be positioned absolute bottom-right without affecting
                  the button's flex layout. */}
              <span className="relative">
                <span
                  className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center"
                  style={{
                    background: "hsl(var(--bark) / 0.12)",
                    boxShadow: "0 0 0 1px hsl(var(--olivewood) / 0.18)",
                  }}
                >
                  {h.avatar_url ? (
                    <OptimizedImage
                      // 56px circle (w-14 h-14) — request a 56px thumbnail and
                      // let the Vercel edge serve AVIF/WebP.
                      src={h.avatar_url}
                      width={56}
                      height={56}
                      alt=""
                      // Above-the-fold on the Dashboard: this strip is among
                      // the first content the user sees, so request eager +
                      // high-priority fetches to improve LCP.
                      priority
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span
                      className="font-sans font-semibold text-ds-14"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      {initialsOf(name)}
                    </span>
                  )}
                </span>
                {isAvailable && (
                  /* Green pulse dot — shown when available_until is set and in
                     the future. border-card gives a white gap ring that separates
                     the dot from the avatar so it reads on any background. */
                  <span
                    className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card"
                    style={{ background: "hsl(var(--sage))" }}
                    title="Available now"
                  >
                    <span
                      className="absolute inset-0 rounded-full motion-safe:animate-ping opacity-75"
                      style={{ background: "hsl(var(--sage))" }}
                    />
                  </span>
                )}
              </span>
              <span
                className="text-ds-10 font-sans font-medium leading-tight truncate w-full text-center"
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
