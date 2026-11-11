import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { EntryPanel, Step } from "./postJobFormTypes";

/** The tag this flow writes on the history entries it pushes: how many screens deep the form was. */
const TAG = "postStep";

/** The screen depth a history entry was pushed for, or null when this flow did not push it. */
export function postStepFromHistory(state: unknown): number | null {
  const v = (state as Record<string, unknown> | null | undefined)?.[TAG];
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * How deep in the post flow a screen is. Back (handlePostJobBack) always lands on a shallower screen, and every
 * forward move lands on a deeper one: the groups (0), a way to start or a group's kinds, Details, Price, When and
 * where, Review (6). A deep link opens the form with no entry screen behind it, so its first screen is 0.
 */
export function postScreenDepth(s: { step: Step; formPage: number; entryPanel: EntryPanel | null; categoryGroup: string | null; skipEntry: boolean }): number {
  if (s.step === "checkout") return 6;
  if (s.step === "entry") return s.entryPanel ? 1 : 0;
  if (s.formPage > 1) return s.formPage + 1;
  if (s.categoryGroup) return 2;
  return s.skipEntry ? 0 : 1;
}

/**
 * F303 (audit 11-10): the post flow's screens live in React state, so the browser's (or Android's) Back left
 * /post-job from any step. Now each forward move pushes a same-URL entry tagged with its depth, and a POP onto a
 * shallower entry steps the form back one screen in place (the fields stay). The page's own back arrow pops only an
 * entry this flow pushed (its tag equals the screen's depth), else steps back in place, as before.
 *
 * Landing on a tagged entry at mount (a reload, or Back from the page a posted job went to) means the form started
 * over, so it goes back past the entries it pushed to the flow's first one: Back never walks a finished form again.
 */
export function usePostStepHistory(depth: number, stepBack: () => void) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const back = useRef(stepBack);
  useEffect(() => {
    back.current = stepBack;
  });
  const prev = useRef<{ depth: number; key: string } | null>(null);
  // The depth an entry this flow did not push stands for: where the form was when it arrived on that entry.
  const base = useRef(depth);
  useEffect(() => {
    const tag = postStepFromHistory(location.state);
    const last = prev.current;
    prev.current = { depth, key: location.key };
    if (!last) {
      base.current = depth;
      // Each of the `tag` entries below this one was pushed by this flow on the same page: all in-app.
      if (tag !== null) navigate(-tag);
      return;
    }
    const moved = last.key !== location.key;
    if (moved && navigationType === "POP") {
      const t = tag ?? base.current;
      if (t < depth) back.current();
      // Forward onto an entry this flow pushed: the form cannot jump ahead, so return to the entry it came from
      // (this one was pushed from it, so it is in-app).
      else if (t > depth) navigate(-1);
      return;
    }
    if (moved) {
      // Someone else navigated (a Repost tile's ?rebook link, a replace that dropped the state): a new first entry.
      if (tag === null) base.current = depth;
      return;
    }
    if (depth > (tag ?? base.current)) {
      navigate({ pathname: location.pathname, search: location.search }, { state: { ...((location.state as object | null) ?? {}), [TAG]: depth } });
    }
    // Runs on a screen change or a navigation; the router state and navigate it reads belong to that same key.
  }, [depth, location.key]);
  // The page's back arrow: pop the entry this flow pushed for this screen (the POP above steps the form back), or
  // step back in place when this screen has no entry of its own.
  const goBack = () => {
    const tag = postStepFromHistory(location.state);
    if (tag !== null && tag === depth) navigate(-1);
    else back.current();
  };
  return goBack;
}
