import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { report } from "@/lib/errorLogger";

/**
 * Rolling write-rate instrumentation.
 *
 * WebKit throws past ~100 replaceState calls in a short window, which unmounts
 * the route into the error boundary. Three separate fixes have been shipped for
 * that loop (dep-array, live-URL compare, and moving Activity onto this hook)
 * and error_logs shows /my-posts STILL crashing after all three — so the next
 * step is evidence, not a fourth guess.
 *
 * This records every write this hook performs and, once a caller crosses
 * WRITE_BURST inside WINDOW_MS, reports ONCE per mount with the actual loop
 * participants: which keys changed, the before/after query strings, and the
 * most recent adopt() decisions. That is precisely what has been missing —
 * every previous fix was reasoned from reading the code.
 *
 * It reports at a threshold well under WebKit's limit so the evidence lands
 * BEFORE the route dies, and it reports at most once per mount so a genuine
 * loop cannot itself become a logging flood.
 */
const WINDOW_MS = 10_000;
const WRITE_BURST = 25;

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
  /**
   * Short screen identifier ("activity", "browse", …). Only used to label the
   * runaway-write report, so a loop can be attributed to a screen without
   * guessing from a minified stack.
   */
  label = "unknown",
) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Instrumentation state. Refs, so none of it can trigger a render and become
  // part of the very loop it is measuring.
  const writeTimesRef = useRef<number[]>([]);
  const writeTrailRef = useRef<string[]>([]);
  const reportedRef = useRef(false);
  // What adopt() decided, most recent last. The write effect quotes this in its
  // report: if the two effects are fighting, the answer shows up in the
  // interleaving of adopt decisions against the write trail — exactly what
  // reading the code has failed three times to reveal.
  const adoptTrailRef = useRef<string[]>([]);

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

    // ── instrumentation ────────────────────────────────────────────────────
    // Record BEFORE writing, so a burst that ends in a crash is still counted.
    const now = Date.now();
    const times = writeTimesRef.current.filter((t) => now - t < WINDOW_MS);
    times.push(now);
    writeTimesRef.current = times;
    const trail = writeTrailRef.current;
    trail.push(`${search || "(empty)"} -> ${next.toString() || "(empty)"}`);
    if (trail.length > 6) trail.shift();

    if (times.length >= WRITE_BURST && !reportedRef.current) {
      reportedRef.current = true;
      report(new Error("useSearchParamMirror runaway writes"), {
        severity: "error",
        tags: {
          source: "useSearchParamMirror",
          mirror: label,
          writesInWindow: times.length,
          windowMs: WINDOW_MS,
          desired: JSON.stringify(desired).slice(0, 300),
          trail: trail.join(" | ").slice(0, 900),
          adoptTrail: adoptTrailRef.current.join(" | ").slice(0, 500),
          route: typeof window !== "undefined" ? window.location.pathname : "",
        },
      });
    }
    // ───────────────────────────────────────────────────────────────────────

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
    if (differs) {
      const t = adoptTrailRef.current;
      t.push(
        `adopt@${search || "(empty)"} local=${JSON.stringify(local)}`,
      );
      if (t.length > 6) t.shift();
      adopt(read);
    }
    // `adopt` is intentionally not a dep: callers pass an inline closure, and
    // depending on it would re-run this on every render. (No eslint-disable is
    // needed now that the dep is the `search` STRING rather than the
    // `searchParams` object — the rule only tracked the latter.)
  }, [search]);
}
