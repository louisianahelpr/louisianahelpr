import { useLayoutEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { TAB_TITLES, type Tab } from "@/pages/profile/types";

/**
 * ProfileTabFallback — what a Profile tab looks like before its chunk lands.
 *
 * OWNER, 2026-09-19: loading states "jump and are not consistent with their
 * info", and the ruling on how to fix it, decided in a pop-up: "SKELETON
 * FILLS THE SCREEN, GROWS BELOW." The placeholder reserves ONE SCREENFUL —
 * not the full height of the real content. Anything taller than the screen
 * grows downward, below the fold, where nothing is under the reader's eye or
 * thumb. Declined in the same pop-up: a true per-tab skeleton reserving (for
 * Home History) 3,477px of grey bones, and no skeleton at all.
 *
 * WHAT WAS MEASURED, at 375 on prod, with the tab's own module held back so
 * the loading frame exists:
 *
 *   - THE TITLE ARRIVED LATE. There was no `<h1>` at all in the loading frame
 *     and one at y=26 in the loaded frame, on every tab — so every pixel of
 *     every tab's content slid down by the height of a page header at the
 *     moment the chunk landed. That is the single biggest jump on the screen
 *     and it was on all twenty-four tabs.
 *   - THE PLACEHOLDER WAS THE WRONG SCREEN ENTIRELY. A cold deep link into
 *     ?tab=gift_card painted Profile's LANDING skeleton — an avatar hero and
 *     three stat tiles — because Profile.tsx's boot skeleton special-cased
 *     exactly one tab (earnings) and gave the other twenty-three the landing's
 *     shape. An avatar standing in for a gift-card form is "not consistent
 *     with their info" in its purest form, and it is also the third of the
 *     three loading screens a deep link used to paint (splash → landing bones
 *     → tab bones → tab).
 *   - THE BODY RESERVED 118px against real content of 447–3,477px.
 *
 * SO, THREE THINGS, ALL IN THIS ONE COMPONENT:
 *
 *  1. THE HEADER IS REAL, not a bone. The tab is known before its chunk is,
 *     and `TAB_TITLES` already carries every tab's on-screen title (it exists
 *     to keep `document.title` equal to the h1). Rendering the actual
 *     `<ProfileTabHeader>` means the h1 is in its final position from the
 *     first frame, the back chevron WORKS while the chunk loads — it did not
 *     before — and the lazy component's own identical header replaces it in
 *     place with nothing moving. One tab refines its title rather than
 *     keeping it: `wrapped` renders `Your ${SEASON.title}` ("Your 2026 so
 *     far"), which is computed inside the lazy chunk, so the placeholder
 *     shows the static "Helpr Wrapped". Same box, same y — the word changes,
 *     the layout does not.
 *
 *  2. THE RESERVE IS ONE SCREENFUL, measured rather than guessed: the
 *     element's own distance from the top of the viewport, subtracted from
 *     the viewport height, on mount. A hard `100dvh` would over-reserve by
 *     the header it sits under; `min-h-full` would resolve against an
 *     auto-height ancestor and reserve nothing.
 *
 *  3. THE RESERVE IS EMPTY BELOW THE BONES — and this is how the short tabs
 *     are handled, which the ruling calls out explicitly. Account Security's
 *     real content is 44px. If the screenful were FILLED with bones, that tab
 *     would paint 700px of grey and then visibly collapse to a single row.
 *     Because the reserve below the two bone cards is blank canvas, a short
 *     tab settles with nothing visible disappearing: the only thing that
 *     shrinks is unused space that was already empty, so there is no dead gap
 *     left behind and no flash of vanishing furniture. A tall tab, meanwhile,
 *     grows into the reserve and then past it, downward, off the fold.
 *
 * The bones themselves stay deliberately few — two cards, a handful of bars.
 * A placeholder holds the shape and gets out of the way; drawing a tab's real
 * furniture would be inventing content we do not have yet.
 */
export interface ProfileTabFallbackProps {
  /** Which tab is loading — decides the title, and nothing else. */
  tab: Exclude<Tab, "landing">;
  /** Back out of the tab. Live during loading, which it was not before. */
  onBack?: () => void;
}

/**
 * The placeholder WITHOUT the header — two bone cards over a one-screenful
 * reserve.
 *
 * Exported because a tab waits twice: once for its chunk (this file's default
 * export covers that, header included) and again for its data, inside a body
 * whose header is already painted. Home History and Work Record both spent
 * that second wait on a job-card-shaped skeleton — three rows with badge
 * chips, a price tile and an apply-button footer — while what arrived was, in
 * Work Record's case, ONE letterhead document, and in Home History's a single
 * record card measured at 309px against the bone's 76px. Nothing in the
 * placeholder corresponded to anything in the content: "not consistent with
 * their info", verbatim. Both now wait in the same clothes they waited in a
 * moment earlier, so the sequence is one placeholder, not two.
 */
export const ProfileTabBodyReserve = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [reserve, setReserve] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // One screenful from where the body actually starts. Read once: the
    // placeholder's whole life is a few hundred ms, and a resize observer
    // here would fight the content that is about to replace it.
    const top = el.getBoundingClientRect().top;
    setReserve(Math.max(0, Math.round(window.innerHeight - top)));
  }, []);

  return (
    <div
      ref={ref}
      style={{ minHeight: reserve }}
      aria-hidden
      data-testid="profile-tab-fallback"
      className="space-y-4"
    >
      <div className="rounded-2xl liquid-glass p-5 space-y-3">
        <Skeleton className="h-5 w-32 rounded" />
        <Skeleton className="h-4 w-2/3 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
      </div>
      <div className="rounded-2xl liquid-glass p-5 space-y-3">
        <Skeleton className="h-4 w-1/3 rounded" />
        <Skeleton className="h-4 w-3/4 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
      </div>
    </div>
  );
};

export const ProfileTabFallback = ({ tab, onBack }: ProfileTabFallbackProps) => (
  <ProfileTabBody>
    <ProfileTabHeader title={TAB_TITLES[tab]} onBack={onBack} />
    <ProfileTabBodyReserve />
  </ProfileTabBody>
);

export default ProfileTabFallback;
