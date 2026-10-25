/**
 * A signed-out tap on a job card warms nothing.
 *
 * Measured on prod (edge logs): 424 `HEAD /rest/v1/applications?select=id&
 * job_id=eq.<uuid>` -> 401 on 2026-10-22 and 11 in the 24 h to 2026-10-25,
 * every one with no JWT and referer https://www.louisianahelpr.com/ — Sentry's
 * "permission denied for table applications", mostly Facebook's in-app
 * browser. `applications` grants nothing to anon, and the dialog this
 * prefetch warms skips both reads for a guest (useJobDetailData `guest`).
 *
 * RED on origin/main 8ca225a0e3: the guest test fails (one applications
 * request fired with no session).
 */
// @mutate src/components/dashboard/prefetchJobDialog.ts | if (!viewerId) return; | void viewerId;
import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq"]) chain[k] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ count: 0, error: null });
  return {
    supabase: {
      auth: { getSession: () => getSessionMock() },
      from: (table: string) => {
        fromMock(table);
        return chain;
      },
    },
  };
});

import { prefetchJobDialog } from "./prefetchJobDialog";

beforeEach(() => {
  fromMock.mockReset();
  getSessionMock.mockReset();
});

describe("prefetchJobDialog", () => {
  it("makes no request at all for a signed-out visitor", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    await prefetchJobDialog("job-1", "poster-1");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("warms both reads for a signed-in viewer", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "viewer-1" } } } });
    await prefetchJobDialog("job-1", "poster-1");
    const tables = fromMock.mock.calls.map((c) => c[0]);
    // Inventory floor: both warm-ups, not a subset.
    expect(tables.length).toBeGreaterThan(1);
    expect(tables).toEqual(expect.arrayContaining(["applications", "jobs"]));
  });

  it("does nothing without a job or poster id", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "viewer-1" } } } });
    await prefetchJobDialog("", "poster-1");
    await prefetchJobDialog("job-1", "");
    expect(fromMock).not.toHaveBeenCalled();
  });
});
