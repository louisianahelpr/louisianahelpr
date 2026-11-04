import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { UserAvatar } from "@/components/UserAvatar";
import { isMissingRpcNamed } from "@/lib/missingRpc";

/**
 * Q2008 "Helprs near you" (owner order 2026-10-17, D5): a row of faces at the top of Home, members in YOUR
 * parish who turned on "Show me in Helprs near you" (You > Availability; off by default), with an "active now"
 * dot while their Available now is on. Privacy: the server (get_helprs_near_me, 20261104062747) matches the
 * parish and returns only id, the masked "First L." name, photo and active_now; no location ever reaches the
 * client. Renders nothing until at least one neighbour has opted in (and before the RPC is deployed).
 */
export interface NearbyHelpr {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  active_now: boolean;
}

const HELPRS_NEAR_ME_KEY = "helprs-near-me";

export async function fetchHelprsNearMe(): Promise<NearbyHelpr[]> {
  const { data, error } = await supabase.rpc("get_helprs_near_me");
  if (error) {
    if (isMissingRpcNamed(error, "get_helprs_near_me")) return []; // not deployed yet: no row
    throw error;
  }
  return data ?? [];
}

export function HelprsNearYou({ userId }: { userId: string | undefined }) {
  const { data } = useQuery({
    queryKey: [HELPRS_NEAR_ME_KEY, userId],
    queryFn: fetchHelprsNearMe,
    enabled: !!userId,
    staleTime: 60_000,
  });
  if (!data || data.length === 0) return null;
  return (
    <section data-testid="helprs-near-you" aria-labelledby="helprs-near-you-title" className="min-w-0">
      <h2 id="helprs-near-you-title" className="px-1 mb-2 text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">
        Helprs near you
      </h2>
      <ul className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x" role="list">
        {data.map((h) => {
          const name = h.full_name ?? "A neighbor";
          const first = name.split(" ")[0];
          return (
            <li key={h.user_id} className="snap-start shrink-0">
              <Link
                to={`/user/${h.user_id}`}
                aria-label={h.active_now ? `${name}, active now` : name}
                className="flex w-16 flex-col items-center gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="relative">
                  <UserAvatar userId={h.user_id} src={h.avatar_url} name={name} pixelSize={56} className="h-14 w-14" />
                  {h.active_now && (
                    <span
                      data-active-now=""
                      aria-hidden="true"
                      className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-background bg-success"
                    />
                  )}
                </span>
                <span className="w-full truncate text-center text-ds-13 text-foreground">{first}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
