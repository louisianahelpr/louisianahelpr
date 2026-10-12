import { useEffect, useState } from "react";

/**
 * BELOW 360px, SEARCH OPENS ON ITS OWN LINE (owner, 2026-09-23, Q48 option D;
 * work item Q143).
 *
 * At 320 the header row cannot hold a typable field beside the cluster: with
 * the magnifier's slot held open (the three-click fix) the field was 90px,
 * under the 120px floor (MIN_TYPABLE_FIELD_PX); without the slot the ✕ sat
 * 28px over the returning magnifier. So below 360 the header row stays as it
 * is at rest (the visible name, the held slot, hamburger, chevron) and the
 * field takes the line UNDER it, where the Active/All strip sits, full width.
 * The strip is hidden while search is open at every width anyway ("one control
 * at a time"), so nothing moves down. 375 and up are unchanged.
 *
 * A media query read in JS, not a Tailwind breakpoint: the two arrangements
 * put the field in different PARENTS (the header row vs the line below), which
 * CSS alone cannot do without rendering the autofocused input twice. The value
 * is computed on the first render, like useIsWebDesktop, so there is no
 * wrong-arrangement frame.
 */
const SEARCH_OWN_LINE_QUERY = "(max-width: 359px)";

function matchesQuery(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
}

export function useSearchOnOwnLine(): boolean {
  const [on, setOn] = useState(() => matchesQuery(SEARCH_OWN_LINE_QUERY));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(SEARCH_OWN_LINE_QUERY);
    const apply = () => setOn(mql.matches);
    apply();
    mql.addEventListener?.("change", apply);
    return () => mql.removeEventListener?.("change", apply);
  }, []);
  return on;
}
