/**
 * Holiday audit 1121 #54: the Small Business Saturday words and the sign-up's required box named "Small Business
 * Saturday, Nov 28" every day, so after the day the form still asked a business to say it was participating in it.
 * Small Business Saturday 2026 is Sat Nov 28 (Thanksgiving is Thu Nov 26). Through the day the words are unchanged;
 * from Nov 29 none of them name the day, and the box confirms a Louisiana small business instead (the server still
 * needs it ticked: sbs_featured_submissions.participating CHECK).
 *
 * @mutate src/content/sbsFeaturedLocal.ts |   const past = today > SBS_DAY; |   const past = false;
 * @mutate src/pages/info/giftGuides/SmallBizSubmitForm.tsx |           <span>{dayW.participating}</span> |           <span>{W.fields.participating}</span>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SBS_DAY, SBS_WORDS, sbsDayWords, sbsFieldError } from "@/content/sbsFeaturedLocal";
import { SmallBizSubmitForm } from "@/pages/info/giftGuides/SmallBizSubmitForm";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const KEYS = ["sectionIntro", "ctaLine", "dealLabel", "deal", "dealHint", "participating", "participatingError"] as const;

describe("Small Business Saturday words by day", () => {
  it("the day is Sat Nov 28, 2026", () => {
    expect(SBS_DAY).toBe("2026-11-28");
    expect(new Date(`${SBS_DAY}T12:00:00Z`).getUTCDay()).toBe(6);
  });

  it("through the day they name it; after it, none of them do", () => {
    for (const day of ["2026-11-24", "2026-11-28"]) {
      expect(sbsDayWords(day).participating).toBe(SBS_WORDS.fields.participating);
      expect(sbsDayWords(day).ctaLine).toBe(SBS_WORDS.ctaLine);
    }
    const after = sbsDayWords("2026-11-29");
    expect(KEYS.length).toBeGreaterThan(5);
    for (const k of KEYS) expect(after[k], k).not.toMatch(/Small Business Saturday|Nov 28|Saturday/);
    expect(sbsFieldError("participating", "participating", "2026-12-05")).toBe("Tick this box to confirm you're a Louisiana small business.");
    expect(sbsFieldError("participating", "participating", "2026-11-27")).toBe("Tick this box to confirm you're taking part in Small Business Saturday.");
  });

  it("the form's required box follows the Louisiana day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-30T15:00:00Z"));
    render(<SmallBizSubmitForm onClose={() => {}} />);
    expect(screen.getByText("We're a Louisiana small business.")).toBeTruthy();
    expect(screen.queryByText(/Small Business Saturday/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(screen.getByText("Tick this box to confirm you're a Louisiana small business.")).toBeTruthy();
  });
});
