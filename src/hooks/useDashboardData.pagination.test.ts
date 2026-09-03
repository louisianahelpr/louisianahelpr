// V-006 — one blocked poster permanently capped the dashboard feed.
//
// The open-jobs query asks for PAGE_SIZE + 1 rows so a full response means
// "at least one more row exists". `hasMore` used to be computed AFTER the
// blocked-poster filter had removed rows from that response, so a single
// blocked poster made the count PAGE_SIZE, `25 > 25` false, `nextOffset` null
// — and React Query's `getNextPageParam` then treated the feed as finished for
// the rest of the session. No error, no tell: the feed just ended early and
// looked like the end of the list.
//
// The assertion that matters is the FIRST one: full server page minus one
// blocked row still reports hasMore. Asserting "blocked jobs are filtered out"
// would have passed against the bug — the filtering was never broken.

import { describe, it, expect } from "vitest";
import { splitFeedPage } from "./useDashboardData";

const PAGE_SIZE = 25;

type Row = { id: string; customer_id: string };

/** One raw `open_jobs_browse` response: `count` rows, ids r0…r{count-1}. */
function serverRows(count: number, blockedAt: number[] = []): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    customer_id: blockedAt.includes(i) ? "blocked-poster" : `poster-${i}`,
  }));
}

const isBlocked = (r: Row) => r.customer_id === "blocked-poster";

describe("splitFeedPage — pagination survives client-side filtering", () => {
  it("still reports hasMore when a blocked poster shrinks a full page (V-006)", () => {
    // The exact shape of the bug: the server returned PAGE_SIZE + 1, so there
    // IS another page — one of those rows just happens to be from someone the
    // viewer blocked.
    const { rows, hasMore } = splitFeedPage(serverRows(PAGE_SIZE + 1, [3]), isBlocked);

    expect(hasMore).toBe(true); // was `false` — infinite scroll died here
    expect(rows).toHaveLength(PAGE_SIZE - 1);
    expect(rows.some(isBlocked)).toBe(false);
  });

  it("still reports hasMore when EVERY row on the page is blocked", () => {
    const allIdx = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => i);
    const { rows, hasMore } = splitFeedPage(serverRows(PAGE_SIZE + 1, allIdx), isBlocked);

    // An empty page is not the end of the feed — the caller must keep paging.
    expect(rows).toHaveLength(0);
    expect(hasMore).toBe(true);
  });

  it("reports the end of the feed only when the SERVER ran out of rows", () => {
    expect(splitFeedPage(serverRows(PAGE_SIZE), isBlocked).hasMore).toBe(false);
    expect(splitFeedPage(serverRows(7), isBlocked).hasMore).toBe(false);
    expect(splitFeedPage(serverRows(0), isBlocked).hasMore).toBe(false);
  });

  it("drops the probe row before filtering, so no row is served on two pages", () => {
    // `offset` advances by PAGE_SIZE regardless of what the client removed, so
    // the row at index PAGE_SIZE is the FIRST row of the next page. Filtering
    // before slicing would let it slide into this page and then appear again.
    const { rows } = splitFeedPage(serverRows(PAGE_SIZE + 1, [0]), isBlocked);

    expect(rows.map((r) => r.id)).not.toContain(`r${PAGE_SIZE}`);
    expect(rows).toHaveLength(PAGE_SIZE - 1);
  });

  it("returns a full page untouched when nothing is blocked", () => {
    const { rows, hasMore } = splitFeedPage(serverRows(PAGE_SIZE + 1), isBlocked);

    expect(hasMore).toBe(true);
    expect(rows).toHaveLength(PAGE_SIZE);
    expect(rows[0].id).toBe("r0");
    expect(rows[PAGE_SIZE - 1].id).toBe(`r${PAGE_SIZE - 1}`);
  });
});
