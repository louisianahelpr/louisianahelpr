/**
 * Owner bug, 2026-10-21: Post a job's "What Helprs will see" preview drew a big
 * grey placeholder (category icon) when the poster added NO photo, though no
 * surface a Helpr sees draws one. No photo means no photo area, on the preview
 * and on Browse (JobCardHeroBand), the quick view and the job page. The eyebrow
 * is sentence case, never uppercased.
 *
 * @mutate src/components/postjob/PostJobPreviewCard.tsx |         {photo && ( |         {true && (
 * @mutate src/components/dashboard/JobCardHeroBand.tsx |   if (!photo) return null; |   if (false) return null;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |         {hasPhoto && ( |         {true && (
 * @mutate src/components/dashboard/JobDetailDialog.tsx |         {photos.length > 0 && ( |         {true && (
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { PostJobPreviewCard } from "@/components/postjob/PostJobPreviewCard";
import { JobCardHeroBand } from "@/components/dashboard/JobCardHeroBand";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("no photo, no placeholder", () => {
  it("the preview draws no photo area and no icon without a photo", () => {
    const { container } = render(<PostJobPreviewCard title="Detail my truck" category="auto" budget={85} />);
    expect(container.querySelector("[data-preview-photo]")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("the preview shows the photo when there is one", () => {
    const { container } = render(<PostJobPreviewCard title="Detail my truck" category="auto" budget={85} photo="blob:x" />);
    expect(container.querySelector("[data-preview-photo] img")?.getAttribute("src")).toBe("blob:x");
  });

  it("the eyebrow is sentence case on screen (no uppercase transform)", () => {
    render(<PostJobPreviewCard title="" category="" budget={0} />);
    const h = screen.getByText("What Helprs will see");
    expect(h.className).not.toMatch(/\buppercase\b/);
  });

  it("Browse's hero band draws nothing without a photo", () => {
    const { container } = render(<JobCardHeroBand photo={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("the job page and the quick view render photos only when there are some", () => {
    expect(read("src/pages/jobs/jobPage/JobPage.tsx")).toContain("{hasPhoto && (");
    expect(read("src/components/dashboard/JobDetailDialog.tsx")).toContain("{photos.length > 0 && (");
  });
});
