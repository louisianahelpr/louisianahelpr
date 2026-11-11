/**
 * Audit 11-10 F461: step 1 of Delete account offered no softer way out. A member who only wanted a break had to
 * delete everything. From Settings (/profile) it now ends with "Just need a break? Turn off notifications instead",
 * which closes the dialog and opens the Notifications tab. Elsewhere (the sign-up and banned screens) it is not shown.
 *
 * @mutate src/components/profile/DeleteAccountDialog.tsx |   return pathname.startsWith("/profile") ? <TakeABreakLine onGo={onGo} /> : null; |   return null;
 * @mutate src/components/profile/DeleteAccountDialog.tsx |         <TakeABreak onGo={() => handleOpenChange(false)} /> |         <TakeABreak onGo={() => {}} />
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useState } from "react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {}, functions: { invoke: vi.fn() } } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1", email: "m@example.com", identities: [{ provider: "email" }] } }) }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function Host() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Where />
      <DeleteAccountDialog open={open} onOpenChange={setOpen} deleteStep={1} setDeleteStep={() => {}} deleteConfirmText="" setDeleteConfirmText={() => {}} deletingAccount={false} onDelete={() => {}} />
    </>
  );
}

function at(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<Host />} /></Routes></MemoryRouter>);
}

beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

describe("F461: Delete account offers a break instead", () => {
  it("from Settings, step 1 links to Notifications and closes the dialog", async () => {
    at("/profile?tab=settings");
    const link = await screen.findByRole("link", { name: "Turn off notifications instead" });
    expect(link.getAttribute("href")).toBe("/profile?tab=notifications");
    expect(screen.getByText(/Just need a break\?/)).toBeInTheDocument();
    fireEvent.click(link);
    expect(screen.getByTestId("where").textContent).toBe("/profile?tab=notifications");
    await waitFor(() => expect(screen.queryByRole("link", { name: "Turn off notifications instead" })).toBeNull());
  });

  it("off Settings (sign-up, banned) it is not offered", async () => {
    at("/complete-profile");
    await screen.findByRole("button", { name: /^continue$/i });
    expect(screen.queryByRole("link", { name: "Turn off notifications instead" })).toBeNull();
  });
});
