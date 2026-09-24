import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * WHERE THE OTHER PARTY'S PROFILE TILE LIVES — and how it gets there.
 *
 * ── THE OWNER'S POSITION, THIRD AND CURRENT (2026-09-19) ───────────────────
 * "also the helpr or posted by should be right above the buttons."
 *
 * It has moved twice before, so the history matters more than usual:
 *
 *   VN-22 (2026-09-14) — out of the meta row, into the card body under the
 *     description. "the profile for who's working the job should be shown when
 *     the job is expanded under the job description, not in that little area".
 *   2026-09-16 (9a39abbea / 187f61c3f) — out of the body and INTO the tracker,
 *     between the step rail and the map ("the profile should be under the
 *     tracker and above the map"). That is the `personTile` slot on
 *     <JobTracking>, which this module retires.
 *   NOW — out of the tracker and straight above the ONE action row, which is
 *     the reading order the owner's three 2026-09-19 notes define together:
 *
 *       title/price → meta (location · date · time) → description →
 *       tracker + map → PERSON TILE → ACTION ROW → the row's one reason line
 *
 *     "what the job is → what's happening → who → what you can do → why you
 *     can't." The tile is the last thing before the controls because it is the
 *     answer to "who am I about to message / pay / confirm for".
 *
 * ── WHY A CONTEXT AND NOT A PROP ──────────────────────────────────────────
 * The row lives inside {@link JobStepCard}, and the shortest path from either
 * card to that shell runs through between one and three components that only
 * forward props (PostedJobActions → the five poster steps; ActiveJobSection /
 * ConfirmedSection / DisputedSection → the five helper steps). Threading one
 * ReactNode through twelve mount sites is twelve chances for a state to be
 * missed silently — which is exactly how the tile went missing from the
 * no-tracker states the last time it moved.
 *
 * It is also the pattern this card already reached for: `CardExpandedContext`
 * (HelperTrackerPanel) existed for this same tile, for this same reason, and
 * this replaces it.
 *
 * ── THE FALLBACK, AND WHY IT IS A CLAIM AND NOT A BOOLEAN ─────────────────
 * Not every state HAS an action row. A cancelled posted job, a pending or
 * not-selected application, a `pending_approval` job — PostedJobActions
 * returns `null` for some statuses outright (STATUS_RENDERS_ACTIONS) and the
 * helper card has whole states with no step card at all. In those the tile has
 * no row to sit above, and dropping it would delete the other party's profile
 * from the card entirely, which is the V6 defect in reverse.
 *
 * So the shell CLAIMS the tile the way it already claims the row's primary
 * slot (`claimPrimary`, jobStepRow.tsx): if a JobStepCard mounted, it renders
 * the tile and the card's own fallback stands down; if none did, the fallback
 * renders it. The count is the honest question ("did anything take it?"),
 * where a boolean would be a second transcription of twelve render conditions
 * — a copy that can disagree with the thing it copies.
 *
 * Exactly one JobStepCard is ever mounted per card (the poster's five steps
 * come off a `switch`, the helper's off `deriveHelperStep`), so the claim
 * count is 0 or 1 and the name prints exactly once either way. The guard for
 * that is `src/test/jobCardPersonTileOnce.test.tsx`, which counts profile
 * links rather than trusting this paragraph.
 *
 * COLLAPSED CARDS SHOW NOTHING (V6, reaffirmed by the owner 2026-09-19). That
 * is not enforced here: each card passes `null` while collapsed, because only
 * the card knows its own expand state. Both do, and both are pinned by tests.
 */
export interface JobCardPersonValue {
  /** The built <PersonTile>, or null when the card is collapsed / ownerless. */
  tile: ReactNode;
  /** Register that a step card has taken the tile; returns the release. */
  claim: () => () => void;
}

export const JobCardPersonContext = createContext<JobCardPersonValue | null>(null);

/**
 * CARD SIDE. Opens the slot and reports whether a step card took the tile.
 *
 * TAKES NO TILE, and that is not an accident: both cards have an early return
 * (an application whose job row has gone invisible; a job still loading) above
 * the point where they know who the other party is, so a hook that needed the
 * tile could not be called unconditionally. This one is called at the top,
 * before any branch, and the card pairs it with `personSlotValue(tile, claim)`
 * once it has one — the rules-of-hooks ordering is then structural rather than
 * something the next edit has to remember.
 *
 * `stepCarriesTile` is false on the very first render (no layout effect has
 * run yet), so a card renders its fallback for one commit and then drops it.
 * That is invisible: `useLayoutEffect` fires before paint and its `setState`
 * is flushed in the same commit, so no frame is ever painted with two tiles.
 */
export function useJobCardPersonSlot(): {
  claim: () => () => void;
  stepCarriesTile: boolean;
} {
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((c) => c + 1);
    return () => setClaims((c) => c - 1);
  }, []);
  return { claim, stepCarriesTile: claims > 0 };
}

/**
 * The context value, built fresh each render on purpose.
 *
 * Memoising it would buy nothing: `tile` is a new element every render anyway
 * (it is JSX built in the card body), so a `useMemo` keyed on it would miss
 * every time. Nothing downstream depends on this object's identity —
 * `useClaimedPersonTile`'s effect is keyed on `claim`, which IS stable, and on
 * whether a tile exists.
 */
export function personSlotValue(tile: ReactNode, claim: () => () => void): JobCardPersonValue {
  return { tile, claim };
}

/**
 * SHELL SIDE. The tile this step card should render directly above its row,
 * or null when there is none (collapsed card, ownerless job, no provider).
 *
 * Claiming is a layout effect rather than a render-time write because a render
 * that mutates another component's state is exactly the thing React refuses;
 * `claimPrimary` next door has the same shape for the same reason.
 */
export function useClaimedPersonTile(): ReactNode {
  const ctx = useContext(JobCardPersonContext);
  const tile = ctx?.tile ?? null;
  const present = tile !== null && tile !== undefined && tile !== false;
  const claim = ctx?.claim;
  useLayoutEffect(() => {
    if (!claim || !present) return;
    return claim();
  }, [claim, present]);
  return present ? tile : null;
}
