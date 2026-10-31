/**
 * A3-I3: unsaving a Helpr said nothing while saving did. Unsave now shows
 * "Removed from your Helprs" with Undo (an action, since applyToastPolicy
 * drops an actionless success toast), and Undo saves the Helpr again.
 */
// @mutate src/components/SaveHelperButton.tsx |       successToast("Removed from your Helprs", { |       void ("Removed from your Helprs", {
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const successToast = vi.fn();
const insert = vi.fn();
const del = vi.fn();
vi.mock("@/lib/toast", () => ({ successToast: (...a: unknown[]) => successToast(...a) }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticError: () => {} }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) c[m] = () => c;
    c.maybeSingle = async () => result;
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
    return c;
  };
  return {
    supabase: {
      from: () => ({
        select: () => chain({ data: { id: "f1" }, error: null }),
        delete: () => {
          const c: Record<string, unknown> = {};
          c.eq = () => c;
          c.select = async () => del();
          return c;
        },
        insert: async (row: unknown) => insert(row),
      }),
    },
  };
});

import SaveHelperButton from "@/components/SaveHelperButton";

beforeEach(() => {
  successToast.mockReset();
  insert.mockReset().mockResolvedValue({ data: null, error: null });
  del.mockReset().mockResolvedValue({ data: [{ id: "f1" }], error: null });
});

describe("A3-I3: unsaving a Helpr says so, with Undo", () => {
  it("shows 'Removed from your Helprs' with Undo, and Undo saves again", async () => {
    render(<MemoryRouter><SaveHelperButton helperId="h1" customerId="c1" variant="full" /></MemoryRouter>);
    const btn = await screen.findByRole("button", { name: /saved|unsave|remove/i });
    fireEvent.click(btn);
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Removed from your Helprs", expect.anything()));
    const opts = successToast.mock.calls[0][1] as { action: { label: string; onClick: () => unknown } };
    expect(opts.action.label).toBe("Undo");
    await opts.action.onClick();
    expect(insert).toHaveBeenCalledWith({ customer_id: "c1", helper_id: "h1" });
  });
});
