/**
 * A saved pitch belongs to ONE account (owner, 2026-10-09: her default pitch
 * "plz", saved as Lexi, pre-filled her father's application on the same
 * browser). The template and per-job drafts were keyed with no user in them.
 */
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let currentUserId = "user-a";
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: currentUserId }, isReady: true }) }));
vi.mock("@/hooks/useAwardBlockReason", () => ({ useAwardBlockReason: () => null }));
vi.mock("@/lib/useOnlineStatus", () => ({ useOnlineStatus: () => ({ online: true }) }));

import { ApplyBody } from "./ApplyBody";
import { pitchDraftKey, pitchTemplateKey } from "./applyConfirmDialogHelpers";
import { safeStorage } from "@/lib/safeStorage";

function Harness() {
  const [msg, setMsg] = useState("");
  return (
    <MemoryRouter>
      <ApplyBody
        open
        confirmApplyJob={{ id: "job-1", budget: 35 } as never}
        platformFee={12}
        applyMessage={msg}
        setApplyMessage={setMsg}
        applyLoading={false}
        handleApplyConfirm={() => {}}
        hideEarnings
        onClose={() => {}}
        applyFiles={[]}
        setApplyFiles={() => {}}
      />
      <output data-testid="msg">{msg}</output>
    </MemoryRouter>
  );
}

describe("pitch storage is per account", () => {
  beforeEach(() => { localStorage.clear(); currentUserId = "user-a"; });

  it("one account's saved pitch never pre-fills another's form", () => {
    safeStorage.setItem(pitchTemplateKey("user-a")!, "plz");
    currentUserId = "user-b";
    render(<Harness />);
    expect(screen.getByTestId("msg").textContent).toBe("");
  });

  it("the account that saved it still gets it", () => {
    safeStorage.setItem(pitchTemplateKey("user-a")!, "plz");
    render(<Harness />);
    expect(screen.getByTestId("msg").textContent).toBe("plz");
  });

  it("the old browser-wide template is dropped, not adopted", () => {
    localStorage.setItem("helpr_pitch_template", "plz");
    currentUserId = "user-b";
    render(<Harness />);
    expect(screen.getByTestId("msg").textContent).toBe("");
    expect(localStorage.getItem("helpr_pitch_template")).toBeNull();
  });

  it("keys carry the user id, and none exist signed out", () => {
    expect(pitchDraftKey("a", "j")).not.toBe(pitchDraftKey("b", "j"));
    expect(pitchTemplateKey(null)).toBeNull();
    expect(pitchDraftKey(null, "j")).toBeNull();
  });
});
