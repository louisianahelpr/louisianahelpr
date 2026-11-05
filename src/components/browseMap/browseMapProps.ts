import type { ViewerFeedExclusions } from "@/pages/home/viewerFeedExclusions";
import type { MapJobFilterInput } from "./mapFilter";

/** BrowseMap's props, moved out of src/components/BrowseMap.tsx unchanged (Q806, the god-component ratchet). */
export interface BrowseMapProps {
  /**
   * Tap anywhere on a pin's preview card (same tap-anywhere-opens-the-job
   * behaviour as the feed's `JobCard`, which the preview literally
   * reuses — no separate "Apply" button on the map anymore).
   */
  onJobAction?: (jobId: string) => void;
  /**
   * Current user id. When set, the popup hides jobs the user posted
   * themselves (you can't apply to your own post — same rule as the
   * Dashboard apply path). When undefined (guest), every pin is shown.
   */
  currentUserId?: string;
  /**
   * Optional CTA rendered in the empty-state ("no jobs on the map
   * today"). Used by the guest dashboard to nudge sign-up so users
   * still convert when the marketplace happens to be quiet.
   */
  emptyStateCta?: { label: string; onClick: () => void };
  /**
   * The browse filters, applied to the map's own rows. The map runs its own
   * `get_open_jobs_for_map` fetch (the list is paginated; the map is not), so
   * it has to re-apply the predicate rather than reuse `filteredJobs`.
   * Omitted by surfaces with no filter UI (the guest dashboard) — then every
   * open pin shows.
   */
  filters?: MapJobFilterInput;
  /** Clears every filter — the CTA on the "no pins match" empty state. */
  onClearFilters?: () => void;
  /**
   * Fill the parent edge to edge — no rounded top corners, no border of its
   * own (owner: "map should fill this space").
   *
   * Set on the desktop website's side-by-side column, where the map IS the
   * column: its parent already draws the hairline that separates it from the
   * feed, so a second border inset the tiles by a pixel on every side and the
   * rounded top left two corner wedges of panel showing through. The phone's
   * list⇄map toggle keeps the rounded, bordered treatment — there the map is a
   * surface floating above the dock, not a column.
   */
  flush?: boolean;
  /**
   * The viewer's platform commission percent — the SAME value the surrounding
   * feed passes to `JobCard`. With it the pin popup prints the helper's net
   * take-home, so a job can't read $110 on the map and $96 in the list beside
   * it. Without it the popup falls back to the gross posted budget rather than
   * guessing a fee, because a payout figure must never read higher than the
   * payout.
   */
  effectiveFee?: number;
  /**
   * Desktop split-view hover sync: the id of the job whose FEED CARD the
   * pointer is currently over (BrowseTasksFeed/Dashboard's `hoveredJobId`).
   * When set, that job's pin scales up on the map so a poster scanning the
   * list can see at a glance which pin a card corresponds to. `undefined`
   * on surfaces with no feed alongside the map (the phone list⇄map toggle,
   * the guest dashboard) — then no pin is ever highlighted this way.
   */
  hoveredJobId?: string | null;
  /**
   * The viewer-local culls the list feed applies — applied-to, dismissed,
   * "Only saved" — as ONE object rather than a prop per rule.
   *
   * This started as a lone `appliedJobIds` prop (B1/B3): the list hid applied
   * jobs and the map kept their pins, so a pin opened a detail still offering
   * "Apply Now". Fixing that one rule did not fix the class — on 2026-09-19
   * the owner reported "map shows 7 jobs. list shows 4", which was
   * `dismissedJobIds`, a cull that at the time existed only inside
   * BrowseTasksFeed. Taking the whole `ViewerFeedExclusions` object means a
   * newly added rule arrives here automatically and the parity guard
   * (src/test/dashboardSurfaceExclusionParity.test.ts) names this file if it
   * is not honoured.
   *
   * `blockedUserIds` is the one field this surface CANNOT apply:
   * `get_open_jobs_for_map` deliberately omits `customer_id` (PII-safe row),
   * so there is nothing to match on. Documented, exempted by name in the
   * guard, and NOT to be fixed by widening the RPC.
   *
   * Omitted on the guest dashboard, which has none of these.
   */
  exclusions?: ViewerFeedExclusions;
  /**
   * Re-read the pin RPC whenever this changes. /home passes the list's own
   * last-read time, so the map re-reads exactly when the list does (after an
   * apply, a pull-to-refresh, a focus refetch). Before this the pins were
   * fetched once per mount and never again, so a job that left the board
   * (applied to, hired, cancelled) stayed pinned beside a list that had
   * dropped it.
   */
  refreshKey?: number;
}
