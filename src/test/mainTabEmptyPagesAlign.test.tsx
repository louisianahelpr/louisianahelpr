/**
 * Q1558 (owner 2026-10-08, at My Jobs / Messages on an iPhone: "Should have all
 * the same positioning, box sizes. These should be nearly identical").
 * Looked at on prod 2026-10-12 (eli test helper, ~/.lh-shots/now-looks/eli-empty-*):
 *
 *   375:  the circle's top was 272px on My Posts and My Jobs, 283px on Messages,
 *         because the content is centred and Messages' sentence is 2 lines where
 *         theirs is 3.
 *   1440: the Messages tab row was 53px tall around 44px icon buttons; My Posts /
 *         My Jobs' row was 43px around 28px ones (PostsHeader's inlineFilters), so
 *         the Messages panel content sat 5px lower.
 *
 * The class: every main-tab empty page reserves the same body height
 * (MAIN_TAB_EMPTY_BODY_LINES), and Messages' desktop header buttons are the
 * same box as My Posts / My Jobs'.
 *
 * @mutate src/components/job-card/ActivityEmptyState.tsx |         bodyLines={MAIN_TAB_EMPTY_BODY_LINES}\n |
 * @mutate src/components/messages/ConversationList.tsx |                 bodyLines={MAIN_TAB_EMPTY_BODY_LINES}\n |
 * @mutate src/components/ui/EmptyState.tsx |               bodyLines && EMPTY_BODY_RESERVE_CLASS, |
 * @mutate src/components/ui/EmptyState.tsx | max-[359px]:min-h-[calc((var(--body-lines)_+_1)*1.625em)] | max-[359px]:min-h-[calc(var(--body-lines)*1.625em)]
 * @mutate src/components/messages/ConversationList.tsx | ${isWebDesktop && !embedded ? "[&>div:first-child]:!py-0" : ""} |
 * @mutate src/components/messages/ConversationList.tsx | minHeight: embedded ? "52px" : isWebDesktop ? COMPACT_HEADER_ROW_MIN_HEIGHT : undefined, | minHeight: embedded ? "52px" : undefined,
 * @mutate src/components/messages/ConversationList.tsx |       aria-label="Search conversations"\n      className={isWebDesktop ? HEADER_ICON_BUTTON_DESKTOP_CLASS : HEADER_ICON_BUTTON_CLASS} |       aria-label="Search conversations"\n      className={HEADER_ICON_BUTTON_CLASS}
 * @mutate src/components/messages/ConversationList.tsx |               triggerWidth: isWebDesktop ? "28px" : "44px", |               triggerWidth: "44px",
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { EMPTY_BODY_RESERVE_CLASS, EmptyState, MAIN_TAB_EMPTY_BODY_LINES } from "@/components/ui/EmptyState";

const code = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

/** The main-tab empty pages: My Posts + My Jobs (ActivityEmptyState) and Messages. */
const MAIN_TAB_EMPTY_CALLERS = [
  "src/components/job-card/ActivityEmptyState.tsx",
  "src/components/messages/ConversationList.tsx",
];

describe("main-tab empty pages put their circle, title and button in one place", () => {
  it("EmptyState reserves bodyLines lines for the sentence", () => {
    const { container } = render(<EmptyState icon={Inbox} title="t" body="short" bodyLines={MAIN_TAB_EMPTY_BODY_LINES} />);
    const p = container.querySelector("p[data-body-lines]") as HTMLElement;
    expect(p).not.toBeNull();
    expect(p.style.getPropertyValue("--body-lines")).toBe(String(MAIN_TAB_EMPTY_BODY_LINES));
    for (const c of EMPTY_BODY_RESERVE_CLASS.split(" ")) expect(p.classList.contains(c), c).toBe(true);
    // N lines everywhere, N+1 below 360px (My Posts' sentence is 4 lines at 320).
    expect(EMPTY_BODY_RESERVE_CLASS).toBe(
      "min-h-[calc(var(--body-lines)*1.625em)] max-[359px]:min-h-[calc((var(--body-lines)_+_1)*1.625em)]",
    );
  });

  it("without bodyLines nothing is reserved (every other EmptyState is unchanged)", () => {
    const { container } = render(<EmptyState icon={Inbox} title="t" body="short" />);
    const ps = [...container.querySelectorAll("p")] as HTMLElement[];
    expect(ps.length).toBeGreaterThan(1);
    expect(ps.every((p) => p.style.getPropertyValue("--body-lines") === "" && !p.className.includes("min-h-"))).toBe(true);
  });

  it("every main-tab empty page passes the shared line count", () => {
    for (const f of MAIN_TAB_EMPTY_CALLERS) {
      const src = code(f);
      const calls = src.split("<EmptyState").length - 1;
      expect(calls, f).toBeGreaterThan(0);
      expect(src.split("bodyLines={MAIN_TAB_EMPTY_BODY_LINES}").length - 1, f).toBe(calls);
    }
  });

  it("Messages' desktop header buttons are My Posts' inline 28px box, and its search slot reserves 28px", () => {
    const msgs = code("src/components/messages/ConversationList.tsx");
    const posts = code("src/pages/posts/PostsHeader.tsx");
    expect(posts).toContain('inlineFilters ? "h-7 w-7 !min-h-0 !min-w-0" : "h-11 w-11"');
    const desktopClass = /const HEADER_ICON_BUTTON_DESKTOP_CLASS =([\s\S]*?);/.exec(msgs)?.[1] ?? "";
    expect(desktopClass).toContain("h-7 w-7 !min-h-0 !min-w-0");
    for (const label of ["Search conversations", "Conversation list options"]) {
      // The BUTTON carrying the label (the search field's input shares it).
      expect(msgs, label).toMatch(
        new RegExp(`aria-label="${label}"\\s*className=\\{isWebDesktop \\? HEADER_ICON_BUTTON_DESKTOP_CLASS : HEADER_ICON_BUTTON_CLASS\\}`),
      );
    }
    expect(msgs).toMatch(/triggerWidth: isWebDesktop \? "28px" : "44px"/);
    // The row itself: My Posts' compact geometry on the desktop website.
    expect(posts).toContain('className={inlineFilters ? "[&>div:first-child]:!py-0" : undefined}');
    expect(msgs).toContain('${isWebDesktop && !embedded ? "[&>div:first-child]:!py-0" : ""}');
    expect(msgs).toContain('minHeight: embedded ? "52px" : isWebDesktop ? COMPACT_HEADER_ROW_MIN_HEIGHT : undefined,');
  });
});
