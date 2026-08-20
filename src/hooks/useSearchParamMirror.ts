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
 */
export function useSearchParamMirror(
  state: Record<string, string>,
  adopt: (read: (key: string) => string) => void,
) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Serialised so the write effect depends on the VALUES, not on a fresh
  // object identity every render.
  const stateKey = JSON.stringify(state);

  useEffect(() => {
    const desired: Record<string, string> = JSON.parse(stateKey);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
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
        // Returning `prev` untouched leaves the location alone — only a real
        // difference produces a navigation, so this can never loop.
        return changed ? next : prev;
      },
      { replace: true },
    );
  }, [stateKey, setSearchParams]);

  // Local values are read through a ref rather than listed as deps. As deps,
  // this effect would also run on our own write — at which point
  // `searchParams` is still the pre-write value, so it would read "unset" and
  // clobber the just-made selection back to the default.
  const localRef = useRef(state);
  localRef.current = state;

  useEffect(() => {
    const read = (key: string) => searchParams.get(key) ?? "";
    const local = localRef.current;
    const differs = Object.keys(local).some((key) => read(key) !== local[key]);
    if (differs) adopt(read);
    // `adopt` is intentionally not a dep: callers pass an inline closure, and
    // depending on it would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
}
