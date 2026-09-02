import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, UserCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import UserAvatar from "@/components/UserAvatar";
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

// `initialsOf` used to live here. It is now `avatarInitials` inside
// `<UserAvatar>` (`src/lib/avatarImage.ts`) — one derivation shared by every
// avatar in the app, hardened against the whitespace-only name that turns
// `split(" ").map(w => w[0]).join("")` into an empty string and paints a
// coloured circle with nothing in it.

export function OfferToSavedHelpr({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const navigate = useNavigate();
  // Preserve whatever is already on /post-job — above all `pif_credit` and
  // its `budget`. This card sits on the entry screen a gift recipient lands
  // on, so rebuilding the query string from scratch meant "offer it to a
  // saved Helpr" quietly threw the gift away and billed them in full.
  const [searchParams] = useSearchParams();
  const { user } = useCurrentUser();

  const { data: helpers, isError, error } = useQuery({
    queryKey: queryKeys.savedHelpers.byUser(user?.id),
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc("get_my_saved_helpers");
      if (rpcError) throw rpcError;
      return (data ?? []) as SavedHelperLite[];
    },
    // Fetched on MOUNT, not on open. Deferring it until the card was opened
    // meant the self-hiding below could only fire AFTER a tap, so a poster
    // with no saved helprs saw the card, tapped it, and watched it vanish
    // under their finger — no empty state, nothing in its place (measured
    // 2026-09-02: present before the tap, gone by +300ms, still gone at +3s).
    // That is the opposite of the "sees nothing" this component documents, and
    // worse than the empty picker it was written to avoid.
    //
    // The round trip this used to save is one RPC on a screen that already
    // fetches the poster's recent jobs on mount for the Repost card — and
    // Repost is the sibling that gets this right.
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  if (isError) report(error, { tags: { source: "OfferToSavedHelpr.get_my_saved_helpers" } });

  // Hidden once we know there is nobody to offer to. `undefined` means the
  // query is still in flight, which must NOT hide the card — see the skeleton
  // note on Repost for why a row that appears late is its own defect.
  if (helpers && helpers.length === 0) return null;

  const toggle = () => onOpenChange(!open);

  const pick = (helperId: string) => {
    track("post_job_entry_choice", { choice: "direct_offer" });
    const next = new URLSearchParams(searchParams);
    next.set("offerTo", helperId);
    navigate(`/post-job?${next.toString()}`);
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
              // `.trim()` before the fallback: a whitespace-only `full_name`
              // is truthy, so `h.full_name || "Helpr"` rendered a button with
              // a blank label next to the avatar. Same defect class as the
              // empty monogram this file was opened for — measured in the
              // probe harness, 2026-08-31.
              const name = h.full_name?.trim() || "Helpr";
              return (
                <button
                  key={h.helper_id}
                  type="button"
                  onClick={() => pick(h.helper_id)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-ds-md squircle border border-border/60 bg-white/70 dark:bg-card/60 backdrop-blur text-left btn-press transition-all duration-200 hover:border-primary/50 min-h-11"
                >
                  {/* Migrated onto the shared `<UserAvatar>` (2026-08-31).
                      The `<img>` this replaces had no error path at ALL — not
                      even the `onError` fallback the rest of the app carried —
                      so a deleted storage object rendered an empty box, and a
                      blank-but-200 upload (a flat block, a DiceBear frame)
                      rendered a flat circle. This is the picker that starts a
                      direct offer, so the poster is identifying one saved
                      Helpr among several; identical blank circles make that
                      choice guesswork. See `src/lib/avatarImage.ts`. */}
                  <UserAvatar
                    userId={h.helper_id}
                    src={h.avatar_url}
                    name={name}
                    pixelSize={32}
                    aria-hidden
                    className="w-8 h-8 shrink-0"
                    fallbackClassName="text-ds-11 ring-0"
                  />
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
