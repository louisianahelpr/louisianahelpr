import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronDown, UserCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
import { report } from "@/lib/errorLogger";
import { track } from "@/lib/analytics";

/**
 * "Offer it to a saved Helpr" — the missing START of the direct-offer flow.
 *
 * The flow's END already existed: arrive at `/post-job?offerTo=<id>` and the
 * form shows a "Direct offer to …" banner and routes the finished job straight
 * to that helpr. But nothing anywhere STARTED it (owner: "they need a way to
 * select their saved Helpr — how are they going to send a direct offer if
 * there's no one there to click"). The only route in was the "Hire again" chip
 * on a completed job, which meant a poster who wanted to hand work to someone
 * they had saved could not, unless that person happened to have finished a job
 * for them recently.
 *
 * It lives on the ENTRY screen beside the other ways to start a post (owner:
 * "put direct offer here instead of in each box") because that is what it is —
 * a fifth way to begin, not a setting inside the form.
 *
 * Self-hiding: a poster with no saved helprs sees nothing rather than an empty
 * picker inviting them to choose from nobody.
 */
interface SavedHelperLite {
  helper_id: string;
  full_name: string | null;
  avatar_url: string | null;
}

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";

export function OfferToSavedHelpr({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [expandedOnce, setExpandedOnce] = useState(false);

  const { data: helpers, isError, error } = useQuery({
    queryKey: queryKeys.savedHelpers.byUser(user?.id),
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc("get_my_saved_helpers");
      if (rpcError) throw rpcError;
      return (data ?? []) as SavedHelperLite[];
    },
    // Only fetched once the poster actually opens the card — the entry screen
    // should not pay for a round trip nobody asked for.
    enabled: !!user && expandedOnce,
    staleTime: 5 * 60 * 1000,
  });

  if (isError) report(error, { tags: { source: "OfferToSavedHelpr.get_my_saved_helpers" } });

  // Hidden until we know there is somebody to offer to. `undefined` means the
  // query has not run yet (card never opened), which must NOT hide the card —
  // that is the state every first render is in.
  if (expandedOnce && helpers && helpers.length === 0) return null;

  const toggle = () => {
    setExpandedOnce(true);
    onOpenChange(!open);
  };

  const pick = (helperId: string) => {
    track("post_job_entry_choice", { choice: "direct_offer" });
    navigate(`/post-job?offerTo=${helperId}`);
  };

  return (
    <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-center" style={{ minHeight: "104px" }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-4 text-left active:scale-[0.99] transition-transform"
      >
        <span
          className="inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0"
          style={{ background: "hsl(var(--boost-tint) / 0.16)" }}
          aria-hidden
        >
          <UserCheck className="w-5 h-5" style={{ color: "hsl(var(--boost-ink))" }} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block font-display italic font-bold text-ds-17"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
          >
            Offer It to a Saved Helpr
          </span>
          <span
            className="block font-serif italic mt-0.5 text-ds-11"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            They get first refusal for a window you set before it opens to everyone.
          </span>
        </span>
        <ChevronDown
          className="w-5 h-5 shrink-0 transition-transform"
          style={{
            color: "hsl(var(--olivewood) / 0.8)",
            transform: open ? "rotate(180deg)" : undefined,
          }}
          aria-hidden
        />
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {!helpers ? (
            <p
              className="font-serif italic text-ds-12 py-2"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Loading your saved Helprs…
            </p>
          ) : (
            helpers.map((h) => {
              const name = h.full_name || "Helpr";
              return (
                <button
                  key={h.helper_id}
                  type="button"
                  onClick={() => pick(h.helper_id)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-ds-md squircle border border-border/60 bg-white/70 dark:bg-card/60 backdrop-blur text-left btn-press transition-all duration-200 hover:border-primary/50 min-h-11"
                >
                  {h.avatar_url ? (
                    <img
                      src={h.avatar_url}
                      alt=""
                      aria-hidden
                      className="w-8 h-8 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <span
                      className="w-8 h-8 rounded-full shrink-0 inline-flex items-center justify-center text-ds-11 font-bold"
                      style={{
                        background: "hsl(var(--bark) / 0.12)",
                        color: "hsl(var(--bark))",
                      }}
                      aria-hidden
                    >
                      {initialsOf(name)}
                    </span>
                  )}
                  <span className="text-ds-13 font-semibold text-foreground truncate">
                    {name}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default OfferToSavedHelpr;
