// Board 157 (report or block): the reasons are ONE radio group on the same
// screen as the details box, and "Also block <name>" never blocks on its own:
// it hands over to the caller's Block dialog only after the report went in.
// @mutate src/components/ReportDialog.tsx | if (step === "confirmation" && blockAfter && alsoBlock) alsoBlock.onBlock(); | if (blockAfter && alsoBlock) alsoBlock.onBlock();
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.single = () => self;
    self.then = (resolve: (v: unknown) => void) => resolve({ data: { id: "0a1b2c3d-0000-0000-0000-000000000000" }, error: null });
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
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
    expect(onBlock).toHaveBeenCalledTimes(1);
  });

  it("closing before sending never blocks", () => {
    const onBlock = vi.fn();
    render(<ReportDialog open onClose={vi.fn()} reportedType="user" reportedId="u1" alsoBlock={{ name: "Tommy H.", onBlock }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Also block Tommy H." }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onBlock).not.toHaveBeenCalled();
  });
});
