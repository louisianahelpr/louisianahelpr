// VN-10 — tapping a map pin's preview card was a dead tap whenever the pin's
// job wasn't in the feed's loaded/filtered page. `fetchJobForPin` is the last
// resort in that lookup, so what matters here is that it hands back a REAL row
// (with the `customer_id` the detail dialog decides Apply on), that a job that
// has since closed is reported as gone rather than as a success, and that a
// failing query surfaces instead of being swallowed.
import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingleResult = {
  value: { data: null as unknown, error: null as unknown },
};
const rpcResult = { value: { data: null as unknown, error: null as unknown } };
const selectSpy = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: (cols: string) => {
        selectSpy(cols);
        return {
          eq: () => ({ maybeSingle: () => Promise.resolve(maybeSingleResult.value) }),
        };
      },
    })),
    rpc: vi.fn(() => Promise.resolve(rpcResult.value)),
  },
}));

import { fetchJobForPin } from "./fetchJobForPin";

const makeRow = () => ({
  id: "job-1",
  title: "Move-out clean for a one-bedroom",
  description: "",
  category: "cleaning",
  budget: 145,
  date_needed: "2099-01-01",
  location: "Baton Rouge, LA",
  customer_id: "poster-1",
  status: "open",
  created_at: new Date().toISOString(),
});

beforeEach(() => {
  maybeSingleResult.value = { data: null, error: null };
  rpcResult.value = { data: null, error: null };
  selectSpy.mockClear();
});

describe("fetchJobForPin", () => {
  it("returns the authoritative row, including the customer_id the dialog needs", async () => {
    maybeSingleResult.value = { data: makeRow(), error: null };
    rpcResult.value = {
      data: [{ user_id: "poster-1", full_name: "Marie Boudreaux", avatar_url: null }],
      error: null,
    };

    const job = await fetchJobForPin("job-1");

    expect(job?.id).toBe("job-1");
    // This is the whole reason the map's own privacy-reduced MapJob can't be
    // used: it carries no customer_id, and Dashboard gates the Apply footer on
    // `detailJob.customer_id !== user.id`.
    expect(job?.customer_id).toBe("poster-1");
    expect(job?.posterName).toBe("Marie B.");
    // The dialog reads far more of the row than the card does — the select must
    // stay the feed's full column list, not a card-shaped subset.
    expect(selectSpy.mock.calls[0][0]).toContain("credential_tier");
    expect(selectSpy.mock.calls[0][0]).toContain("payment_status");
  });

  it("returns null when the job is gone, so the caller can say so", async () => {
    maybeSingleResult.value = { data: null, error: null };

    expect(await fetchJobForPin("job-gone")).toBeNull();
  });

  it("throws the query error instead of swallowing it", async () => {
    maybeSingleResult.value = { data: null, error: { message: "permission denied" } };

    await expect(fetchJobForPin("job-1")).rejects.toBeTruthy();
  });

  it("still returns the job when the poster has deleted their account", async () => {
    // A job can outlive its poster: deletion nulls `customer_id`.
    maybeSingleResult.value = { data: { ...makeRow(), customer_id: null }, error: null };

    const job = await fetchJobForPin("job-1");
    expect(job?.id).toBe("job-1");
    expect(job?.posterName).toBeUndefined();
  });

  it("does not query for an empty id", async () => {
    expect(await fetchJobForPin("")).toBeNull();
    expect(selectSpy).not.toHaveBeenCalled();
  });
});

// Swallowing the query error turns a refused row into "job not found", which
// is the dead tap VN-10 closed.
// @mutate src/components/browseMap/fetchJobForPin.ts | if (error) throw error; |
// The dialog reads far more of the row than the card does; a card-shaped
// select renders a detail sheet that silently disagrees with the one the list
// opens for the very same job.
// @mutate src/components/browseMap/fetchJobForPin.ts | applicant_count, credential_tier, parish | applicant_count, parish
