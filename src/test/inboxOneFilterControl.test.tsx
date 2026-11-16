/**
 * M6 (iOS design audit 11-16): the Inbox's two tabs filtered two ways. Messages had chips (All, Unread, Jobs,
 * Declutter); Notifications had a segmented control in the reverse order (Unread, All). The Messages | Notifications
 * row was two centred halves with its own underline, unlike the left-aligned word tabs on Jobs and Declutter.
 *
 * Now: ONE filter control, the shared FilterChips, on both tabs, All first; the bell's panel keeps its segmented
 * control but in the same order; the Inbox's tabs wear the SectionTabs look (.section-tab / .section-tab-selected).
 *
 * @mutate src/components/NotificationPanelView.tsx |             <div className="min-w-0 flex-1">{inboxChips}</div> |             <div className="min-w-0 flex-1">{segmented}</div>
 * @mutate src/pages/messages/useMessageSections.tsx |     <FilterChips chips={chips} value={section} | <OldChips chips={chips} value={section}
 * @mutate src/components/inbox/InboxTabs.tsx |               on ? "section-tab-selected text-foreground" : "text-muted-foreground", |               on ? "text-foreground" : "text-muted-foreground",
 * @mutate src/components/NotificationPanelView.tsx |         { key: "all", label: t("notif.all") },\n        { key: "unread", label: t("notif.unread"), count: unreadCount }, |         { key: "unread", label: t("notif.unread"), count: unreadCount },\n        { key: "all", label: t("notif.all") },
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { FilterChips } from "@/components/ui/FilterChips";

const code = (f: string) => blankComments(readFileSync(f, "utf8"));
const view = code("src/components/NotificationPanelView.tsx");
const sections = code("src/pages/messages/useMessageSections.tsx");
const tabs = code("src/components/inbox/InboxTabs.tsx");

describe("the Inbox has one filter control, All first (M6)", () => {
  it("the Notifications tab's row draws the shared FilterChips, not the segmented control", () => {
    const inline = view.slice(view.indexOf("{inline ? ("), view.indexOf("<AnchoredPanelHeader", view.indexOf("{inline ? (")));
    expect(inline.length).toBeGreaterThan(50); // vacuity floor: the inline branch was found
    expect(inline).toContain("{inboxChips}");
    expect(inline).not.toContain("{segmented}");
    expect(view).toMatch(/const inboxChips = \(\s*<FilterChips<Filter>/);
  });

  it("both of the notifications' controls list All before Unread", () => {
    const allAt = [...view.matchAll(/(?:key|value): "all"/g)].map((m) => m.index!);
    const unreadAt = [...view.matchAll(/(?:key|value): "unread"/g)].map((m) => m.index!);
    expect(allAt).toHaveLength(2);
    expect(unreadAt).toHaveLength(2);
    allAt.forEach((a, i) => expect(a).toBeLessThan(unreadAt[i]));
  });

  it("the Messages tab's chips are the same FilterChips, All first", () => {
    expect(sections).toMatch(/<FilterChips chips=\{chips\} value=\{section\}/);
    expect(sections.indexOf('value: "all"')).toBeLessThan(sections.indexOf('value: "unread"'));
  });

  it("FilterChips: a group of pressed / unpressed chips in the order given", () => {
    const onChange = vi.fn();
    render(<FilterChips chips={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]} value="all" onChange={onChange} label="Filter" chipAttr="data-x-chip" />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["All", "Unread"]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[0].getAttribute("data-x-chip")).toBe("all");
    fireEvent.click(buttons[1]);
    expect(onChange).toHaveBeenCalledWith("unread");
  });

  it("the Inbox's tabs wear the SectionTabs look, not two centred halves", () => {
    expect(tabs).toContain('"section-tab relative');
    expect(tabs).toContain('on ? "section-tab-selected text-foreground"');
    expect(tabs).not.toMatch(/className="relative flex-1/);
  });
});
