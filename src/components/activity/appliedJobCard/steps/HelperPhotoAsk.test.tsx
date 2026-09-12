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
 * PhotoProofStep is replaced with a stand-in that exposes its `onUploaded`, so
 * this pins exactly the wiring HelperPhotoAsk owns: an upload invalidates the
 * activity cache that renders the card.
 */
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofStep: ({ title, onUploaded }: { title: string; onUploaded?: () => void }) => (
    <div>
      <span>{title}</span>
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
    expect(screen.getByText("Add an after photo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "simulate upload finished" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["activity"] });
  });

  it("re-reads the activity cache when the Before photo upload finishes", () => {
    const spy = setup(
      <HelperPhotoAsk jobId="job-1" job={job({ proof_after_urls: ["a.png"] })} step="working" />,
    );
    expect(screen.getByText("Add a before photo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "simulate upload finished" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["activity"] });
  });

  it("asks for nothing when the poster did not require photo proof", () => {
    setup(<HelperPhotoAsk jobId="job-1" job={job({ require_photo_proof: false })} step="working" />);
    expect(screen.queryByText(/Add an? (after|before) photo/)).toBeNull();
  });
});
