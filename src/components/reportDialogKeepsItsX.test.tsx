// F359j (audit 11-10): the Report dialog is a sheet on a phone, and a sheet keeps its corner X (owner 10-31) even
// though it also carries a labelled Cancel; the one-dismissal rule had dropped the X. Same opt-in as the Job done
// review (JA-54, src/test/reviewSheetKeepsItsX.test.tsx).
// @mutate src/components/ReportDialog.tsx | stepped keepClose onOpenAutoFocus | stepped onOpenAutoFocus
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: "r1" }, error: null }) }) }) }),
  },
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import ReportDialog from "./ReportDialog";

describe("ReportDialog keeps its X (F359j)", () => {
  it("shows the corner Close beside Cancel, for a user report and a listing report", () => {
    for (const reportedType of ["user", "declutter_item"] as const) {
      const { unmount } = render(<ReportDialog open onClose={vi.fn()} reportedType={reportedType} reportedId="x1" />);
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Close" }), reportedType).toBeTruthy();
      unmount();
    }
  });
});
