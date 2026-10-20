/**
 * The landing's "How it works" steps are visible by default (lead, 2026-10-19:
 * a full-page capture of the live landing showed the section blank, because
 * its scroll reveal had never fired). Motion is an enhancement only: the
 * steps are never see-through (print, crawlers and full-page captures
 * read them); a section that starts below the fold only sits 16px low and any
 * pixel of it scrolling in slides it up (no ratio threshold).
 *
 * @mutate src/components/landing/HowItWorksSection.tsx | useState<Reveal>("shown") | useState<Reveal>("waiting")
 * @mutate src/components/landing/HowItWorksSection.tsx |                   opacity: 1, |                   opacity: lowered ? 0 : 1,
 * @mutate src/components/landing/HowItWorksSection.tsx |       { threshold: 0 }, |       { threshold: 0.2 },
 * @mutate src/components/landing/HowItWorksSection.tsx |     if (!el \|\| el.getBoundingClientRect().top < window.innerHeight) return; |     if (!el) return;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import HowItWorksSection from "@/components/landing/HowItWorksSection";

const SRC = readFileSync(join(process.cwd(), "src/components/landing/HowItWorksSection.tsx"), "utf8");
const card = () => screen.getByText("Post what you need").closest("div[style]") as HTMLElement;

type Cb = (entries: { isIntersecting: boolean }[]) => void;
let observed: { cb: Cb; opts?: IntersectionObserverInit }[] = [];
class FakeIO {
  constructor(public cb: Cb, public opts?: IntersectionObserverInit) { observed.push({ cb, opts }); }
  observe() {}
  disconnect() {}
}

function at(top: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top, bottom: top + 900, left: 0, right: 375, width: 375, height: 900, x: 0, y: top, toJSON: () => ({}) } as DOMRect);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  observed = [];
});

describe("How it works is visible by default; the reveal only enhances", () => {
  it("renders visible first (no hidden initial state in the source)", () => {
    expect(SRC).toContain('useState<Reveal>("shown")');
    expect(SRC).not.toMatch(/opacity:\s*inView \? 1 : 0/);
  });

  it("no IntersectionObserver: the steps stay visible", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    at(5000);
    render(<HowItWorksSection />);
    expect(card().style.transform).toBe("translateY(0)");
  });

  it("already on screen at load: visible, nothing observed", () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    at(100);
    render(<HowItWorksSection />);
    expect(card().style.transform).toBe("translateY(0)");
    expect(observed.length).toBe(0);
  });

  it("below the fold: still readable, sits low, and any pixel in view slides it up", () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    at(5000);
    render(<HowItWorksSection />);
    expect(card().style.opacity).toBe("1");
    expect(card().style.transform).toBe("translateY(16px)");
    expect(observed.length).toBeGreaterThan(0);
    expect(observed[0].opts?.threshold).toBe(0);
    act(() => observed[0].cb([{ isIntersecting: true }]));
    expect(card().style.transform).toBe("translateY(0)");
  });
});
