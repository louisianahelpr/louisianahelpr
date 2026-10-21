// Board 157 (report or block): the reasons are ONE radio group on the same
// screen as the details box, and "Also block <name>" never blocks on its own:
// it hands over to the caller's Block dialog only after the report went in.
// @mutate src/components/ReportDialog.tsx |     const block = step === "confirmation" && blockAfter && alsoBlock; |     const block = blockAfter && alsoBlock;
// @mutate src/components/ReportDialog.tsx |     if (submitting) return;\n    onClose(); |     if (submitting) return;\n    if (blockAfter && alsoBlock) alsoBlock.onBlock();\n    onClose();
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const insertResult = vi.hoisted(() => ({ refuse: false }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.single = () => self;
    self.then = (resolve: (v: unknown) => void) =>
      resolve(insertResult.refuse
        ? { data: null, error: { message: "rate limited", code: "P0001" } }
        : { data: { id: "0a1b2c3d-0000-0000-0000-000000000000" }, error: null });
    return self;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
      from: () => ({ insert: () => chain() }),
    },
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import ReportDialog from "./ReportDialog";
import { REASONS } from "./reportDialog/reportReasons";

describe("ReportDialog, board 157", () => {
  it("offers every reason as one radio group, with the details box on the same screen", () => {
    render(<ReportDialog open onClose={vi.fn()} reportedType="user" reportedId="u1" />);
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBe(REASONS.user.length);
    expect(radios.length).toBeGreaterThan(3);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
    fireEvent.click(radios[1]);
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(radios[0].getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText(/Also block/)).toBeNull();
  });

  it("'Also block' opens the Block dialog only once the report is sent", async () => {
    const onBlock = vi.fn();
    const onClose = vi.fn();
    render(<ReportDialog open onClose={onClose} reportedType="user" reportedId="u1" alsoBlock={{ name: "Tommy H.", onBlock }} />);
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Asked me to pay in cash." } });
    fireEvent.click(screen.getByRole("switch", { name: "Also block Tommy H." }));
    expect(onBlock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(screen.getByText("Report sent")).toBeTruthy());
    expect(onBlock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Block Tommy H." }));
    expect(onClose).toHaveBeenCalled();
    expect(onBlock).toHaveBeenCalledTimes(1);
  });

  it("closing the receipt any other way (Escape) never blocks", async () => {
    const onBlock = vi.fn();
    const onClose = vi.fn();
    render(<ReportDialog open onClose={onClose} reportedType="user" reportedId="u1" alsoBlock={{ name: "Tommy H.", onBlock }} />);
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Asked me to pay in cash." } });
    fireEvent.click(screen.getByRole("switch", { name: "Also block Tommy H." }));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(screen.getByText("Report sent")).toBeTruthy());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("closing before sending never blocks", () => {
    const onBlock = vi.fn();
    render(<ReportDialog open onClose={vi.fn()} reportedType="user" reportedId="u1" alsoBlock={{ name: "Tommy H.", onBlock }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Also block Tommy H." }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("a refused insert keeps the form and never hands over to Block", async () => {
    insertResult.refuse = true;
    try {
      const onBlock = vi.fn();
      render(<ReportDialog open onClose={vi.fn()} reportedType="user" reportedId="u1" alsoBlock={{ name: "Tommy H.", onBlock }} />);
      fireEvent.click(screen.getAllByRole("radio")[0]);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Asked me to pay in cash." } });
      fireEvent.click(screen.getByRole("switch", { name: "Also block Tommy H." }));
      fireEvent.click(screen.getByRole("button", { name: "Send report" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Send report" })).toHaveProperty("disabled", false));
      expect(screen.queryByText("Report sent")).toBeNull();
      expect(onBlock).not.toHaveBeenCalled();
    } finally {
      insertResult.refuse = false;
    }
  });
});
