// @mutate src/components/mobileNav/DockPill.tsx |   if (!motion) return <span className={className} style={style} aria-hidden />; |   if (!motion) return <span className={className} aria-hidden />;
import { describe, it, expect, vi } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { DockPill } from "./DockPill";
import { useDockMotionLoader } from "./useDockMotion";

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

    // A long press (menuOpen) starts the fetch at once.
    renderHook(() => useDockMotionLoader(false, true));
    // The framer pill replaces the plain one once the chunk is in.
    // 10 s: framer-motion is a dynamic import, and under a loaded local run it
    // took over waitFor's 1 s default (land run 2026-10-06; passes alone).
    await waitFor(() => expect(container.firstElementChild).not.toBe(before), { timeout: 10_000 });
    const after = container.firstElementChild as HTMLElement;
    expect(after.tagName).toBe("SPAN");
    expect(after.className).toBe(props.className);
    expect(after.getAttribute("aria-hidden")).toBe("true");
    // framer adds `opacity: 1`, the default; the drawn background is the same.
    expect(after.style.background).toBe(backgroundBefore);
  });
});
