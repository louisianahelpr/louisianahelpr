/**
 * Posting audit 10-30 #8: what an admin sees and can do on a reported or held Wanted post.
 *
 * @mutate src/components/admin/adminReports/WantedReportPanel.tsx | {post.photos_held.includes(p) && <p className="font-semibold text-destructive-ink">Hidden from members</p>} | {null}
 * @mutate src/components/admin/adminReports/WantedReportPanel.tsx |       {open && !post.removed && ( |       {!post.removed && (
 * @mutate src/components/admin/adminReports/reportedWanted.ts |   if (post) return `Wanted post "${post.what}"`; |   if (post) return "Deleted user";
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WantedReportPanel } from "./WantedReportPanel";
import { wantedSubject } from "./reportedWanted";

const calls = vi.hoisted(() => ({ takeDown: [] as unknown[][], release: [] as unknown[][] }));
vi.mock("@/lib/declutter/api", () => ({
  photoPublicUrl: (p: string) => `https://photos.test/${p}`, photoCardUrl: (p: string) => `https://photos.test/${p}`, CARD_PHOTO_PX: 480,
  takeDownWanted: async (...a: unknown[]) => { calls.takeDown.push(a); return "removed"; },
  releaseWantedPhotos: async (...a: unknown[]) => { calls.release.push(a); return "released"; },
}));

const POST = { wanted_id: "w1", what: "Oak dresser", poster_id: "u1", status: "open", removed: false, is_seed: false, photo_paths: ["a.jpg", "b.jpg"], photos_held: ["b.jpg"] };

beforeEach(() => { calls.takeDown = []; calls.release = []; });

describe("WantedReportPanel", () => {
  it("reads the post and marks only the held photo", () => {
    render(<WantedReportPanel post={POST} reportId="r1" open onDone={() => {}} />);
    expect(screen.getByText("Oak dresser")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText("Hidden from members")).toHaveLength(1);
  });

  it("Show Photos releases with the report's id", async () => {
    const done = vi.fn();
    render(<WantedReportPanel post={POST} reportId="r1" open onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Show Photos" }));
    await waitFor(() => expect(calls.release).toEqual([["w1", "r1"]]));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  });

  it("Take It Down needs a reason and sends it", async () => {
    render(<WantedReportPanel post={POST} reportId="r1" open onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Take It Down" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Take It Down" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason the poster reads"), { target: { value: " Not allowed " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.takeDown).toEqual([["w1", "Not allowed", "r1"]]));
  });

  it("a closed report or a removed post offers no action", () => {
    const { rerender } = render(<WantedReportPanel post={POST} reportId="r1" open={false} onDone={() => {}} />);
    expect(screen.queryByRole("button", { name: "Take It Down" })).toBeNull();
    rerender(<WantedReportPanel post={{ ...POST, removed: true }} reportId="r1" open onDone={() => {}} />);
    expect(screen.queryByRole("button", { name: "Show Photos" })).toBeNull();
  });
});

describe("wantedSubject", () => {
  it("names the post, never a person", () => {
    expect(wantedSubject(POST, false)).toBe('Wanted post "Oak dresser"');
    expect(wantedSubject(undefined, false)).toBe("Deleted Wanted post");
    expect(wantedSubject(undefined, true)).toBe("Wanted post unavailable");
  });
});
