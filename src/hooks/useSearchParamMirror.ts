import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Keep a screen's view state (tabs, filters, search) in the URL, so a history
 * entry is a complete description of what the user was looking at.
 *
 * Why this exists: browse-style screens held their filters in plain `useState`.
 * Every history entry for the feed was therefore identical, and going back —
 * from a job, a message thread, a settings page — rebuilt the screen from
 * defaults. The user's report was "when I click the back button anywhere it
 * needs to take me back to where I left off … everything is all over the
 * place". Scroll offset is restored separately (ScrollToTop), but scroll alone
 * cannot help when the LIST underneath it has been rebuilt unfiltered.
 *
 * Contract:
 *  - `state` maps param name → current value. An EMPTY string means "default",
 *    and the param is removed rather than written, so a pristine view has a
 *    clean URL.
 *  - `adopt` is called with a reader when the params change from outside this
 *    hook (browser/gesture back, deep link, notification tap) and disagree
 *    with `state`. Push the values into your local state there.
 *
 * Writes use `replace: true`: refining a filter amends the entry you are on
 * instead of minting a new one, so Back leaves the screen rather than stepping
 * backwards through every chip tap.
 *
 * ⚠️ `setSearchParams` NAVIGATES UNCONDITIONALLY, and it is not referentially
 * stable. Both halves of that matter, and this hook originally got both wrong:
 *
 *   let setSearchParams = useCallback((nextInit, opts) => {
 *     ...
 *     navigate("?" + newSearchParams, opts);   // no equality check, ever
 *   }, [navigate, searchParams]);              // identity churns
 *
 * The first version guarded INSIDE the updater — returning `prev` when nothing
 * differed — and carried a comment claiming that "can never loop". It looped:
 * react-router runs the updater, then navigates with whatever comes back,
 * `prev` included. That re-created `navigate`, which re-created
 * `setSearchParams`, which was in this effect's dep array, which re-ran the
 * effect, which navigated again. A guest sitting on /browse with no filters
 * set — the case where there is nothing to write at all — spun ~200
 * `replaceState` calls per mount in Chrome and never stopped under test.
 *
 * WebKit throttles `replaceState` to ~100 calls per 30s and throws
 * SecurityError past that, so on iOS this was a route-navigation hazard, not
 * just wasted CPU.
 *
 * So: decide OUTSIDE the updater and return early, so the navigator is never
 * called on a no-op; and reach `setSearchParams` through a ref so its identity
 * can never feed back into the deps.
 */
export function useSearchParamMirror(
  state: Record<string, string>,
  adopt: (read: (key: string) => string) => void,
) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Serialised so the write effect depends on the VALUES, not on a fresh
  // object identity every render.
  const stateKey = JSON.stringify(state);

  // The query string as a STRING, for the same reason: `searchParams` is a
  // fresh object whenever the location changes, and a dep on it would make
  // every write re-arm the effect that performed it.
  const search = searchParams.toString();

  // Held in a ref, never a dep — see the warning in the doc comment above.
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;

  useEffect(() => {
    const desired: Record<string, string> = JSON.parse(stateKey);
    const next = new URLSearchParams(search);
    let changed = false;
    for (const [key, value] of Object.entries(desired)) {
      const current = next.get(key);
      if (value) {
        if (current !== value) {
          next.set(key, value);
          changed = true;
        }
      } else if (current !== null) {
        next.delete(key);
        changed = true;
      }
    }
    // The load-bearing line. `setSearchParams` navigates whatever we hand it,
    // so "no change" has to mean "do not call it" — not "call it with the
    // value it already has".
    if (!changed) return;
    setSearchParamsRef.current(next, { replace: true });
    // Both deps are strings: once the write lands, `search` matches `desired`,
    // this re-runs once more, finds nothing changed, and stops.
  }, [stateKey, search]);

  // Local values are read through a ref rather than listed as deps. As deps,
  // this effect would also run on our own write — at which point
  // `searchParams` is still the pre-write value, so it would read "unset" and
  // clobber the just-made selection back to the default.
  const localRef = useRef(state);
  localRef.current = state;

  useEffect(() => {
    const params = new URLSearchParams(search);
    const read = (key: string) => params.get(key) ?? "";
    const local = localRef.current;
    const differs = Object.keys(local).some((key) => read(key) !== local[key]);
    if (differs) adopt(read);
    // `adopt` is intentionally not a dep: callers pass an inline closure, and
    // depending on it would re-run this on every render. (No eslint-disable is
    // needed now that the dep is the `search` STRING rather than the
    // `searchParams` object — the rule only tracked the latter.)
  }, [search]);
}
