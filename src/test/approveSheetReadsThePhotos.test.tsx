/**
 * THE POSTER SEES THE HELPR'S PHOTOS BEFORE APPROVING (owner, 2026-10-23; report "ben also did not receive any before
 * or after pictures", Mow two lawns 7c6deb77: at 17:50Z the job held 1 before and 2 after photos).
 *
 * The one place a poster approves is the card's CompletionChoiceSheet (InProgressStep; the job page's button is
 * Manage job, which opens that card; chat has no approve). It showed the photos only from the list the card had
 * loaded, which can predate the Helpr's photos. It now reads the job's own columns when it opens and leads with
 * them. Measured with WebKit on prod data: ~/.lh-shots/ui5-photos/approve-sheet-*.
 *
 * @mutate src/pages/posts/CompletionChoiceSheet.tsx |         if (data) setFresh({ before: data.proof_before_urls ?? [], after: data.proof_after_urls ?? [] }); |
 * @mutate src/pages/posts/CompletionChoiceSheet.tsx |   const afterUrls = fresh?.after ?? proofAfterUrls; |   const afterUrls = proofAfterUrls;
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

const row = vi.hoisted(() => ({ before: ["j/before-1.jpg"], after: ["j/after-1.jpg", "j/after-2.jpg"] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { proof_before_urls: row.before, proof_after_urls: row.after }, error: null }) }) }),
    }),
  },
}));
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofGroup: ({ beforeUrls, afterUrls }: { beforeUrls: string[]; afterUrls: string[] }) => (
    <div data-testid="photos">{`before ${beforeUrls.length} after ${afterUrls.length}`}</div>
  ),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyJobParty: vi.fn() }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn() }));

import { CompletionChoiceSheet } from "@/pages/posts/CompletionChoiceSheet";

afterEach(cleanup);

describe("the approve sheet leads with the Helpr's photos as they are now", () => {
  it("a card whose list predates the photos still shows them: 1 before, 2 after", async () => {
    render(
      <CompletionChoiceSheet open jobId="j" jobTitle="Mow two lawns" helperId="h" helperName="Yusef" userId="p"
        proofBeforeUrls={[]} proofAfterUrls={[]} onClose={() => {}} onConfirm={() => {}} onRevisionSubmitted={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId("photos").textContent).toBe("before 1 after 2"));
    expect(screen.getByText("Yusef's photos of the work.")).toBeTruthy();
  });
});
