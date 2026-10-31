/**
 * A3-L9 (app audit 2026-10-28, fail-delete-375.png): the "Your account is
 * deleted." panel mixed alignment (a left-aligned title with its check mark on
 * a line of its own, then a centred body) and its only action, "Done", was the
 * grey secondary button. The only way forward on a panel is its commit, so
 * "Done" wears the primary treatment (DialogPrimaryAction), the check sits on
 * the title's line, and the body reads left-aligned like the title.
 * ("Deleting…" while the request runs is already on the I5 base.)
 *
 * @mutate src/components/profile/DeleteAccountDialog.tsx | <DialogPrimaryAction onClick={onAcknowledgeDeleted}>{t("deleteAccount.done")}</DialogPrimaryAction> | <DialogSecondaryAction onClick={onAcknowledgeDeleted}>{t("deleteAccount.done")}</DialogSecondaryAction>
 * @mutate src/components/profile/DeleteAccountDialog.tsx | <div className="space-y-4 py-2" role="status" aria-live="polite"> | <div className="text-center space-y-4 py-2" role="status" aria-live="polite">
 * @mutate src/components/profile/DeleteAccountDialog.tsx | title={<span className="inline-flex items-center gap-2"><Check | title={<span><Check
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: {}, functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u1", email: "member@example.com", identities: [{ provider: "email" }] } }),
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";

beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

function renderDeleted() {
  const noop = () => {};
  render(
    <MemoryRouter>
      <DeleteAccountDialog
        open
        onOpenChange={noop}
        deleteStep={2}
        setDeleteStep={noop}
        deleteConfirmText=""
        setDeleteConfirmText={noop}
        deletingAccount={false}
        onDelete={noop}
        accountDeleted
        onAcknowledgeDeleted={noop}
      />
    </MemoryRouter>,
  );
}

describe("A3-L9: the account-deleted panel", () => {
  it("its only action, Done, is the primary (olive) commit, not the grey secondary", () => {
    renderDeleted();
    const buttons = screen.getAllByRole("button").filter((b) => b.textContent?.trim());
    // Vacuity floor: the panel has exactly one labelled action.
    expect(buttons.length).toBeGreaterThan(0);
    const done = screen.getByRole("button", { name: /^done$/i });
    expect(done.className.split(/\s+/)).toContain("btn-grad-primary");
    expect(done.className).not.toMatch(/\bghost\b/);
  });

  it("the body reads left-aligned like the title", () => {
    renderDeleted();
    const status = screen.getByRole("status");
    expect(status.className.split(/\s+/)).not.toContain("text-center");
  });

  it("the check mark sits on the title's line", () => {
    renderDeleted();
    const title = screen.getByText(/Your account is deleted\./);
    const row = title.closest("span.inline-flex");
    expect(row).toBeTruthy();
    expect(row?.querySelector("svg")).toBeTruthy();
  });
});
