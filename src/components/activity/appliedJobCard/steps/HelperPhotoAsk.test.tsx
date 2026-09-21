import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * AN UPLOAD MUST MOVE THE CARD FORWARD WITHOUT REALTIME.
 *
 * The photo ask advances on data: After first on the Working step, then the
 * Before once the After exists. Until 2026-09-12 the only thing that re-read
 * the job after an upload was the realtime `jobs` subscription, which this
 * codebase itself describes as best-effort (it drops on a cold native socket).
 * With it down the dialog closed and the card still asked for the After photo.
 *
 * PhotoProofCaptureChip is replaced with a stand-in that exposes its
 * `onUploaded`, so this pins exactly the wiring HelperPhotoAsk owns: an upload
 * invalidates the activity cache that renders the card.
 *
 * It was `PhotoProofStep` until 2026-09-19, when the owner moved the capture
 * control off its panel and onto the card's action row — same uploader, same
 * `onUploaded`, one control instead of a titled block.
 */
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofCaptureChip: ({ label, onUploaded }: { label: string; onUploaded?: () => void }) => (
    <div>
      <span>{label}</span>
      <button type="button" onClick={() => onUploaded?.()}>
        simulate upload finished
      </button>
    </div>
  ),
}));

import { HelperPhotoAsk } from "./HelperPhotoAsk";

const job = (over: Record<string, unknown> = {}) =>
  ({ id: "job-1", proof_before_urls: [], proof_after_urls: [], require_photo_proof: true, ...over }) as never;

const setup = (ui: ReactNode) => {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return spy;
};

describe("HelperPhotoAsk", () => {
  it("re-reads the activity cache when the After photo upload finishes", () => {
    const spy = setup(<HelperPhotoAsk jobId="job-1" job={job()} step="working" />);
    expect(screen.getByText("After Photo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "simulate upload finished" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["activity"] });
  });

  it("re-reads the activity cache when the Before photo upload finishes", () => {
    const spy = setup(
      <HelperPhotoAsk jobId="job-1" job={job({ proof_after_urls: ["a.png"] })} step="working" />,
    );
    expect(screen.getByText("Before Photo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "simulate upload finished" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["activity"] });
  });

  it("asks for nothing when the poster did not require photo proof", () => {
    // Was `queryByText(/Add an? (after|before) photo/)` — copy that belonged to
    // the DELETED PhotoProofStep panel and that this component has never
    // rendered, so the assertion passed with `proofRequired` removed entirely.
    // Assert against what the chip actually paints, and that nothing at all is
    // mounted.
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <HelperPhotoAsk jobId="job-1" job={job({ require_photo_proof: false })} step="working" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("After Photo")).toBeNull();
    expect(screen.queryByText("Before Photo")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("still asks when the column is missing entirely (old database, `?? true`)", () => {
    setup(<HelperPhotoAsk jobId="job-1" job={{ id: "job-1", proof_before_urls: [], proof_after_urls: [] } as never} step="working" />);
    expect(screen.getByText("After Photo")).toBeTruthy();
  });
});

// The whole point of this component's wiring: an upload re-reads the activity
// cache itself instead of hoping the best-effort realtime `jobs` channel is up.
// @mutate src/components/activity/appliedJobCard/steps/HelperPhotoAsk.tsx | void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all }); | void 0;
// A poster who turned photo proof off must not be asked.
// @mutate src/components/activity/appliedJobCard/steps/HelperPhotoAsk.tsx | if (!proofRequired) return null; | if (false) return null;
