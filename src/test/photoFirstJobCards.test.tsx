/**
 * Photo-first job cards (owner 2026-10-17, Q2043 "Photo-first job cards,
 * Marketplace style" + Q2036 "one clean card: photo/category image, title,
 * price, one meta line, poster face"). Every Browse card leads with a picture
 * tile: the job's own first photo, else the category image. The poster's face
 * (photo or initials), first name and rating sit under the meta line. The row
 * keeps its height with no name, so every card is the same height.
 *
 * @mutate src/components/dashboard/JobCard.tsx |   const showMedia = !bare && !(hero && job.photos?.[0]); |   const showMedia = false;
 * @mutate src/components/dashboard/JobCardMedia.tsx |       {photo ? ( |       {false ? (
 * @mutate src/components/dashboard/JobCardMedia.tsx |   const rated = (reviewCount ?? 0) > 0 && (avgRating ?? 0) > 0; |   const rated = false;
 * @mutate src/components/dashboard/JobCardMedia.tsx |   if (!first \|\| name === "a neighbor") return <div data-testid="job-card-poster" aria-hidden className={JOB_CARD_FACE_ROW} />; |   if (!first \|\| name === "a neighbor") return null;
 * @mutate src/index.css |   .job-card-media-col .job-meta-row { flex-wrap: wrap; } |   .job-card-media-col .job-meta-row { flex-wrap: nowrap; }
 */
import fs from "node:fs";
import { blankCssComments } from "./helpers/blankNonCode";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import JobCard from "@/components/dashboard/JobCard";
import type { EnrichedJob } from "@/components/dashboard/types";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

const job = (o: Record<string, unknown> = {}) =>
  ({
    id: "j1", title: "Mow the front yard", description: "x", category: "yard_work", budget: 85,
    location: "Lafayette, LA", status: "open", expires_at: null, boost_expires_at: null, boosted_at: null,
    created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z", date_needed: null, is_urgent: false,
    urgent_fee: 0, is_group_job: false, helpers_needed: 1, customer_id: "22222222-2222-2222-2222-222222222222",
    photos: [], posterName: "Bea Thibodeaux", posterAvatarUrl: null, posterAvgRating: 4.8, posterReviewCount: 6,
    ...o,
  }) as unknown as EnrichedJob;

const draw = (j: EnrichedJob, extra: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <JobCard job={j} effectiveFee={15} currentUserId="someone-else" onApply={() => {}} onReport={() => {}} onSelect={() => {}} index={1} {...extra} />
    </MemoryRouter>,
  ).container;

describe("photo-first Browse job cards", () => {
  it("a job with a photo leads with that photo", () => {
    const c = draw(job({ photos: ["https://example.test/p.jpg"] }));
    const tile = c.querySelector("[data-testid=job-card-media]");
    expect(tile?.getAttribute("data-media")).toBe("photo");
    expect(tile?.querySelector("img")?.getAttribute("src")).toBe("https://example.test/p.jpg");
  });

  it("a job without a photo shows the category image, named for screen readers", () => {
    const c = draw(job());
    const tile = c.querySelector("[data-testid=job-card-media]");
    expect(tile?.getAttribute("data-media")).toBe("category");
    expect(tile?.querySelector("img")).toBeNull();
    expect(tile?.querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Yard work");
  });

  it("the poster's face, first name and rating are on the card", () => {
    const face = draw(job()).querySelector("[data-testid=job-card-poster]");
    expect(face?.textContent).toContain("Bea");
    expect(face?.textContent).not.toContain("Thibodeaux");
    expect(face?.textContent).toContain("4.8");
  });

  it("no rating without reviews; the row keeps its place with no name", () => {
    expect(draw(job({ posterReviewCount: 0 })).querySelector("[data-testid=job-card-poster]")?.textContent).not.toContain("4.8");
    const empty = draw(job({ posterName: "a neighbor" })).querySelector("[data-testid=job-card-poster]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toBe("");
    expect(empty?.className).toContain("h-5");
  });

  it("the hero card with its own photo band does not repeat the photo as a tile", () => {
    const c = draw(job({ photos: ["https://example.test/p.jpg"] }), { hero: true });
    expect(c.querySelector("[data-testid=job-card-hero]")).not.toBeNull();
    expect(c.querySelector("[data-testid=job-card-media]")).toBeNull();
    const count = c.querySelectorAll("[data-testid=job-card-media]").length + c.querySelectorAll("[data-feed-card]").length;
    expect(count).toBeGreaterThan(0);
  });

  it("on a phone the meta line takes two lines beside the tile instead of clipping the time", () => {
    const css = blankCssComments(fs.readFileSync("src/index.css", "utf8"));
    const block = css.slice(css.indexOf("@media (max-width: 767px) {\n  .job-card-media-col"));
    expect(block).toContain(".job-card-media-col .job-meta-row { flex-wrap: wrap; }");
    expect(block).toContain(".job-card-media-col .job-meta-row > [data-meta-break] { display: block; }");
    expect(draw(job()).querySelector(".job-card-media-col .job-meta-row [data-meta-break]")).not.toBeNull();
  });
});
