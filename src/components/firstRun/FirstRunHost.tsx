import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useFirstRunGate } from "./firstRunGate";

/**
 * HOME'S FIRST RUN, WITHOUT ITS SCREENS ON HOME'S FIRST LOAD (B65, Home speed).
 *
 * Every member's Home ran this, but only a new member (or a "Take the tour
 * again" replay) ever sees the picker and the coach marks. So Home keeps only
 * the gate here (the seen-state read, the ?tour=1 replay, `onActiveChange` for
 * what waits behind it) and fetches ./FirstRun (the picker, the coach marks and
 * the section hooks they use) the first time the gate opens. The gate already
 * waits 600 ms before it opens, so the screens' chunk loads inside that wait.
 */
const FirstRunScreens = lazy(() => import("./FirstRun"));

export function FirstRun({ userId, onActiveChange }: { userId?: string; onActiveChange?: (active: boolean) => void }) {
  const [params, setParams] = useSearchParams();
  const replayAsked = params.get("tour") === "1";
  const gate = useFirstRunGate(userId, true);
  // Each replay remounts the screens straight into the tour (the old in-place setPhase("tour")).
  const [replays, setReplays] = useState(0);

  useEffect(() => {
    if (!replayAsked) return;
    setReplays((n) => n + 1);
    gate.replay();
    const next = new URLSearchParams(params);
    next.delete("tour");
    setParams(next, { replace: true });
  }, [replayAsked]); // once per ?tour=1 arrival

  useEffect(() => { onActiveChange?.(gate.pending); }, [gate.pending, onActiveChange]);

  if (!gate.open) return null;
  return (
    <Suspense fallback={null}>
      <FirstRunScreens key={replays} startInTour={replays > 0} onDone={gate.finish} />
    </Suspense>
  );
}
