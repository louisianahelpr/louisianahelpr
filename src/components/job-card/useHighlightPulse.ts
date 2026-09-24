import { useEffect, useRef, type RefObject } from "react";

/**
 * Deep-link highlight — scroll the card into view and pulse its ring once,
 * when this card is the target of a `?job=` / `?highlight=` notification link.
 * The CSS class drives the animation; `prefers-reduced-motion` is handled
 * entirely in the stylesheet (the scroll still fires regardless).
 *
 * MOVED UP one directory from `appliedJobCard/`. It was only ever wired to the
 * helper's applied cards, so a poster following "someone applied to your job X"
 * landed on a list with the target card unmarked and off-screen — the exact
 * shape of link the poster gets most. It is one behaviour, so it is one hook;
 * PostedJobCard now uses the same one rather than a second copy.
 *
 * WHY IT DEPENDS ON `highlight` AND NOT `[]`.
 *
 * The old version ran once on mount with the comment "`highlight` is stable
 * (set from initial URL param)". That is true for `?highlight=`, which
 * Activity.tsx seeds into `useState`'s initial value — and false for `?job=`,
 * which is the shape `notificationDestination()` now mints for every Activity
 * notification. A `?job=` link is resolved in an effect that bails while
 * `loading`, so the id is only known AFTER the list has rendered: the card
 * mounts with `highlight={false}`, the effect finds the job and flips it true,
 * and a mount-only hook has already run and will never run again. So the
 * highlight silently did nothing on the one path that produces it.
 *
 * The ref keeps the "once" guarantee the empty dep array was reaching for —
 * a re-render that re-asserts `highlight` must not re-scroll a list the user
 * has since scrolled away from.
 */
export function useHighlightPulse(highlight: boolean, cardRef: RefObject<HTMLDivElement>) {
  const firedRef = useRef(false);
  useEffect(() => {
    if (!highlight || firedRef.current) return;
    const el = cardRef.current;
    if (!el) return;
    firedRef.current = true;
    // Small delay so the list has finished laying out before we scroll.
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("highlight-pulse");
      // Remove the class after the animation ends so a future re-render
      // doesn't re-apply it and so the outline doesn't persist.
      const onEnd = () => el.classList.remove("highlight-pulse");
      el.addEventListener("animationend", onEnd, { once: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [highlight, cardRef]);
}
