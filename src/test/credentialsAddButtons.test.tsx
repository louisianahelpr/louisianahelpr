import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * CREDENTIALS: "Add License" / "Add Insurance" BUTTONS, NOT SWITCHES (Q142),
 * AND THE WAY BACK IN AFTER A WITHDRAWAL (Q111).
 *
 * Owner decision 2026-09-23 (docs/OPEN.md MORNING QUESTIONS 6, option b): the
 * "I Am Licensed" / "I Am Insured" switches become buttons that go straight to
 * upload-for-review. The switches looked like they set the badge; they never
 * could (is_licensed / is_insured are server-owned, Q99 — pinned separately by
 * src/test/profileProtectedColumnWrites.test.ts, the class check that no
 * member-facing write carries those columns).
 *
 * Q111: on /profile?tab=credentials, confirming the X on a sent document says
 * "you can attach a new copy any time", but removeSentDoc turns the card's
 * intent off and the row comes back is_licensed=false — with the switch gone
 * the card must land on the Add button, never on a card with no way to add.
 *
 * What is pinned, against the real component (supabase mocked at the client):
 *   1. there is no switch on the tab, and one Add button per credential;
 *   2. pressing "Add License" opens the file picker (the hidden input's
 *      click), and a picked file lands in the existing attach -> "Send License
 *      for Review" flow, with nothing written to the server;
 *   3. after withdrawing a sent license, the Add License button is back and
 *      still opens the picker.
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity):
// the button stops opening the picker (1 + 2 fail);
// @mutate src/components/profile/CredentialsTab.tsx | onClick={() => addInputRefs.current[kind]?.click()} | onClick={() => undefined}
// a withdrawal that leaves the card "on" with no row behind it and no way to add (3 fails);
// @mutate src/components/profile/CredentialsTab.tsx | {!on && ( | {!on && !removing && Object.keys(intent).length === 0 && (
// the switch comes back in place of the button (1 fails).
// @mutate src/components/profile/CredentialsTab.tsx | {kind === "license" ? "Add License" : "Add Insurance"} | {kind === "license" ? "I Am Licensed" : "I Am Insured"}

type Row = Record<string, unknown>;
const EMPTY_ROW: Row = {
  is_licensed: false,
  is_insured: false,
  license_url: null,
  insurance_url: null,
  license_status: "none",
  insurance_status: "none",
  license_rejection_reason: null,
  insurance_rejection_reason: null,
  business_name: null,
};

const db = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { ...db.row }, error: null }),
      }),
    }),
    update: (payload: Record<string, unknown>) => {
      db.updates.push(payload);
      return {
        eq: () => ({
          select: async () => {
            // What trg_auto_pending_credentials does when a path is cleared.
            if ("license_url" in payload && payload.license_url === null) {
              db.row = { ...db.row, license_url: null, is_licensed: false, license_status: "none" };
            }
            return { data: [{ ...db.row }], error: null };
          },
        }),
      };
    },
  });
  return {
    supabase: {
      from,
      storage: { from: () => ({ upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() }) },
    },
  };
});

import { CredentialsTab } from "@/components/profile/CredentialsTab";

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CredentialsTab userId="u-1" onBack={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pickerFor(kind: "license" | "insurance"): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[type="file"][data-credential-add="${kind}"]`);
  if (!el) throw new Error(`no Add-${kind} file input on the card`);
  return el;
}

beforeEach(() => {
  db.row = { ...EMPTY_ROW };
  db.updates = [];
});

describe("Q142: credentials are added with buttons, not switches", () => {
  it("renders no switch and one Add button per credential", async () => {
    renderTab();
    expect(await screen.findByRole("button", { name: "Add License" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Insurance" })).toBeTruthy();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("Add License opens the picker, and the picked file goes to Send for Review", async () => {
    renderTab();
    const button = await screen.findByRole("button", { name: "Add License" });
    const input = pickerFor("license");
    const clicked = vi.spyOn(input, "click");
    fireEvent.click(button);
    expect(clicked).toHaveBeenCalledTimes(1);

    const file = new File(["%PDF-1.4"], "license.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("license.pdf")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send License for Review" })).toBeTruthy();
    // Picking is local only: nothing reached profiles.
    expect(db.updates).toEqual([]);
  });
});

describe("Q111: withdrawing a sent document leaves the way to add a new one", () => {
  it("after Take It Back, the Add License button is back and opens the picker", async () => {
    db.row = { ...EMPTY_ROW, license_url: "u-1/credentials/license-1727000000000.pdf", is_licensed: true, license_status: "pending" };
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Take your license out of the review queue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Take It Back" }));

    const add = await screen.findByRole("button", { name: "Add License" });
    await waitFor(() => expect(db.updates).toEqual([{ license_url: null }]));
    const input = pickerFor("license");
    const clicked = vi.spyOn(input, "click");
    fireEvent.click(add);
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
