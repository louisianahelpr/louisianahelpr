import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { DockPill } from "./DockPill";
import { startDockMotion } from "./useDockMotion";

const props = {
  layoutId: "mobile-nav-pill",
  className: "absolute inset-x-0.5 inset-y-0.5 rounded-full pointer-events-none",
  style: { background: "hsl(var(--bark) / 0.07)" },
  transition: { duration: 0 },
};

describe("DockPill (Q1172)", () => {
  it("draws the same span before framer arrives and after, so the dock's first frame does not change", async () => {
    const { container } = render(<DockPill {...props} />);
    const before = container.firstElementChild as HTMLElement;
    expect(before.tagName).toBe("SPAN");
    expect(before.className).toBe(props.className);
    expect(before.getAttribute("aria-hidden")).toBe("true");
    const backgroundBefore = before.style.background;
    expect(backgroundBefore).toContain("--bark");

    startDockMotion();
    // The framer pill replaces the plain one once the chunk is in.
    await waitFor(() => expect(container.firstElementChild).not.toBe(before));
    const after = container.firstElementChild as HTMLElement;
    expect(after.tagName).toBe("SPAN");
    expect(after.className).toBe(props.className);
    expect(after.getAttribute("aria-hidden")).toBe("true");
    // framer adds `opacity: 1`, the default; the drawn background is the same.
    expect(after.style.background).toBe(backgroundBefore);
  });
});
