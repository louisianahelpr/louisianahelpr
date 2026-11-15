/**
 * Q2792 (check:changed a11y-prod sweep, 2026-11-10 and again 2026-11-14 on Builder 2's push): screen 010 job-detail-completed
 * failed axe-core 4.14's label-content-name-mismatch (WCAG 2.5.3, "Label in Name"), target `.grid-cols-2`. That is
 * JobProofPhotos' page-variant button: it draws the "Before" and "After" tiles and was named by an aria-label, "See
 * the before and after photos", which does not hold the drawn words in order. The button now has no aria-label: its
 * drawn words are its name, after an sr-only lead-in (DeclutterSellerCard's pattern, labelContainsVisibleText).
 *
 * axe-core cannot decide this rule in jsdom (no layout, so every node comes back "incomplete"; measured 11-14), so
 * this renders the real component (both variants, one and two tiles, with photo counts) and holds the accessible
 * name to the drawn words the way threadControlsNameTheirText does. The real rule was re-run in Chromium by the
 * a11y-prod sweep of /jobs/:id (check:changed) on the push that carries this.
 *
 * @mutate src/components/jobs/JobProofPhotos.tsx |       data-job-proof-open=""\n      onClick | data-job-proof-open=""\n      aria-label="See the before and after photos"\n      onClick
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: (paths: string[]) => paths.map(() => "data:image/gif;base64,R0lGODlhAQABAAAAACw=") }));

import { JobProofPhotos } from "@/components/jobs/JobProofPhotos";

/** axe's comparison, near enough: lower case, letters and digits only, the drawn words inside the name. */
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function drawnText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(".sr-only").forEach((n) => n.remove());
  return copy.textContent ?? "";
}

describe("Q2792: the job's before/after photo button is named by the words it draws (WCAG 2.5.3)", () => {
  const cases: Array<[string, Parameters<typeof JobProofPhotos>[0]]> = [
    ["page, before and after", { beforeUrls: ["b1"], afterUrls: ["a1"] }],
    ["page, counts", { beforeUrls: ["b1", "b2"], afterUrls: ["a1", "a2", "a3"] }],
    ["page, before only", { beforeUrls: ["b1"], afterUrls: [] }],
    ["card, before and after", { beforeUrls: ["b1"], afterUrls: ["a1"], variant: "card" }],
    ["card, after only", { beforeUrls: null, afterUrls: ["a1"], variant: "card" }],
  ];
  for (const [label, props] of cases) {
    it(label, () => {
      const { container, unmount } = render(<JobProofPhotos {...props} />);
      const button = container.querySelector("button[data-job-proof-open]");
      expect(button).not.toBeNull();
      const drawn = words(drawnText(button!));
      // Inventory: the button draws words of its own.
      expect(drawn).toMatch(/before|after/);
      const name = words(button!.getAttribute("aria-label") ?? button!.textContent ?? "");
      expect(name, `"${drawn}" is not in the name "${name}"`).toContain(drawn);
      // And the name still says what pressing it does.
      expect(name).toMatch(/^see the photos/);
      unmount();
    });
  }
});
