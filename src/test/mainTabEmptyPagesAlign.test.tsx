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
 * @mutate src/components/job-card/ActivityEmptyState.tsx |     ? (isPosted ? "Browse jobs" : "Post a job") |     ? (isPosted ? "Browse Jobs" : "Post a Job")
 * @mutate src/components/job-card/ActivityEmptyState.tsx |         bodyLines={MAIN_TAB_EMPTY_BODY_LINES}\n |
 * @mutate src/components/messages/ConversationList.tsx |                 bodyLines={MAIN_TAB_EMPTY_BODY_LINES}\n |
 * @mutate src/components/ui/EmptyState.tsx |               bodyLines && EMPTY_BODY_RESERVE_CLASS, |
 * @mutate src/components/ui/EmptyState.tsx | max-[359px]:min-h-[calc((var(--body-lines)_+_1)*1.625em)] | max-[359px]:min-h-[calc(var(--body-lines)*1.625em)]
 * @mutate src/components/messages/ConversationList.tsx | ${isWebDesktop && !embedded ? "[&>div:first-child]:!py-0" : ""} |
 * @mutate src/components/messages/ConversationList.tsx | minHeight: embedded ? "52px" : isWebDesktop ? COMPACT_HEADER_ROW_MIN_HEIGHT : undefined, | minHeight: embedded ? "52px" : undefined,
 * @mutate src/components/messages/ConversationList.tsx |       aria-label={t("chat.search")}\n      className={isWebDesktop ? HEADER_ICON_BUTTON_DESKTOP_CLASS : HEADER_ICON_BUTTON_CLASS} |       aria-label={t("chat.search")}\n      className={HEADER_ICON_BUTTON_CLASS}
 * @mutate src/components/messages/ConversationList.tsx |               triggerWidth: isWebDesktop ? "28px" : "44px", |               triggerWidth: "44px",
 *
 * Home (2026-10-13, prod, eli, Filters > Only Saved Jobs with nothing saved):
 * its "Nothing saved yet" sat at circle 310 / title 418 at 375 against 272 / 380
 * on the other three: its wrapper added pt-4 and it has no button, so the
 * centred block was a button row shorter. Main-tab empty pages now keep a fixed
 * action row (EMPTY_ACTION_SLOT_CLASS) whether or not they show a button.
 *
 * @mutate src/components/ui/EmptyState.tsx |         {bodyLines ? (\n          <div className={EMPTY_ACTION_SLOT_CLASS} data-action-slot>\n            {action}\n          </div>\n        ) : (\n          action\n        )} |         {action}
 * @mutate src/components/ui/EmptyState.tsx | "h-12 w-full min-w-0 flex flex-col items-center" | "w-full min-w-0 flex flex-col items-center"
 * @mutate src/components/dashboard/SavedOnlyState.tsx |           bodyLines={MAIN_TAB_EMPTY_BODY_LINES}\n |
 * @mutate src/components/dashboard/SavedOnlyState.tsx |       <div className="flex-1 min-h-0 flex">\n        <EmptyState | <div className="px-3 pt-4 flex-1 min-h-0 flex">\n        <EmptyState
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { EMPTY_ACTION_SLOT_CLASS, EMPTY_BODY_RESERVE_CLASS, EmptyState, MAIN_TAB_EMPTY_BODY_LINES } from "@/components/ui/EmptyState";
import { SavedOnlyState } from "@/components/dashboard/SavedOnlyState";

const code = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

/** The main-tab empty pages: My Posts + My Jobs (ActivityEmptyState), Messages, and Home's saved-only empty. */
const MAIN_TAB_EMPTY_CALLERS = [
  "src/components/job-card/ActivityEmptyState.tsx",
  "src/components/messages/ConversationList.tsx",
  "src/components/dashboard/SavedOnlyState.tsx",
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

  it("a main-tab empty page keeps one fixed 48px action row, with a button or without one", () => {
    expect(EMPTY_ACTION_SLOT_CLASS.split(" ")).toContain("h-12");
    const withButton = render(<EmptyState icon={Inbox} title="t" body="b" bodyLines={MAIN_TAB_EMPTY_BODY_LINES} action={<button>Go</button>} />);
    const slotA = withButton.container.querySelector("[data-action-slot]") as HTMLElement;
    expect(slotA?.querySelector("button")?.textContent).toBe("Go");
    const without = render(<EmptyState icon={Inbox} title="t" body="b" bodyLines={MAIN_TAB_EMPTY_BODY_LINES} />);
    const slotB = without.container.querySelector("[data-action-slot]") as HTMLElement;
    expect(slotB, "the row is kept with no button").not.toBeNull();
    for (const s of [slotA, slotB]) for (const c of EMPTY_ACTION_SLOT_CLASS.split(" ")) expect(s.classList.contains(c), c).toBe(true);
    // Not a main-tab page: no slot, the action renders as before.
    const plain = render(<EmptyState icon={Inbox} title="t" body="b" action={<button>Go</button>} />);
    expect(plain.container.querySelector("[data-action-slot]")).toBeNull();
  });

  it("Home's saved-only empty is a main-tab empty page: no wrapper padding, the shared rows", () => {
    const { container } = render(<SavedOnlyState />);
    const wrapper = container.firstElementChild as HTMLElement;
    // My Posts / My Jobs / Messages put the EmptyState in a wrapper with no padding.
    expect(wrapper.className.split(" ").filter((c) => /^(p|pt|px|py)-/.test(c))).toEqual([]);
    expect(container.querySelector("p[data-body-lines]")).not.toBeNull();
    expect(container.querySelector("[data-action-slot]")).not.toBeNull();
    expect(container.textContent).toContain("Nothing saved yet");
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

  // Re-pointed 2026-10-19 (Q2205): My Posts' header (PostsHeader), the box this was matched TO, left with the old
  // screen; Messages keeps the same compact 28px geometry on its own, pinned as literal values.
  it("Messages' desktop header buttons are the inline 28px box, and its search slot reserves 28px", () => {
    const msgs = code("src/components/messages/ConversationList.tsx");
    const desktopClass = /const HEADER_ICON_BUTTON_DESKTOP_CLASS =([\s\S]*?);/.exec(msgs)?.[1] ?? "";
    expect(desktopClass).toContain("h-7 w-7 !min-h-0 !min-w-0");
    // The BUTTON carrying the label (the search field's input shares it).
    expect(msgs, "Search conversations").toMatch(
      /aria-label=\{t\("chat\.search"\)\}\s*className=\{isWebDesktop \? HEADER_ICON_BUTTON_DESKTOP_CLASS : HEADER_ICON_BUTTON_CLASS\}/,
    );
    // The hamburger lives in InboxMenus.tsx; ConversationList hands it the same class pair.
    expect(msgs, "Conversation list options").toMatch(
      /<InboxOptionsMenu[^>]*triggerClassName=\{isWebDesktop \? HEADER_ICON_BUTTON_DESKTOP_CLASS : HEADER_ICON_BUTTON_CLASS\}/,
    );
    expect(code("src/components/messages/InboxMenus.tsx")).toContain('aria-label={t("chat.listOptions")} className={triggerClassName}');
    expect(msgs).toMatch(/triggerWidth: isWebDesktop \? "28px" : "44px"/);
    // The row itself: the compact geometry on the desktop website.
    expect(msgs).toContain('${isWebDesktop && !embedded ? "[&>div:first-child]:!py-0" : ""}');
    expect(msgs).toContain('minHeight: embedded ? "52px" : isWebDesktop ? COMPACT_HEADER_ROW_MIN_HEIGHT : undefined,');
  });
});

describe("Jobs › Posted / Working empty page buttons are sentence case (audit #16/#61)", () => {
  it("'Post a job' and 'Browse jobs', never Title Case", () => {
    const c = code("src/components/job-card/ActivityEmptyState.tsx");
    expect(c).toContain('(isPosted ? "Browse jobs" : "Post a job")');
    expect(c).not.toMatch(/"Post a Job"|"Browse Jobs"/);
  });
});
