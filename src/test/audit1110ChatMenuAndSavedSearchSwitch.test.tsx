/**
 * Whole-app audit 11-10, Builder 2:
 *   F429 chat "..." menu: Report user and Block user looked the same (two grey rows, two icons). Report now says in one
 *         line what it does, and Block user is the red (destructive-ink) row so a thumb does not take it for Report.
 *   F468 Saved searches: a row that read "Alerts off" gave no way to turn that one search back on from the list; each
 *         row carries its own Alerts switch (disabled while "Pause all" is on; the settings sheet keeps Email and Delete).
 *
 * @mutate src/components/messages/ChatHeader.tsx | <DropdownMenuItem onClick={onBlockUser} data-chat-block-user="" className="text-[hsl(var(--destructive-ink))] focus:text-[hsl(var(--destructive-ink))]"> | <DropdownMenuItem onClick={onBlockUser} data-chat-block-user="">
 * @mutate src/components/messages/ChatHeader.tsx | <span className="text-ds-12 text-muted-foreground">{t("msg.reportUserBody")}</span> | <span className="text-ds-12 text-muted-foreground"></span>
 * @mutate src/pages/profile/SavedSearchesTab.tsx | <RowAlertSwitch search={s} userId={userId} paused={!!paused.data} /> | {null}
 * @mutate src/pages/profile/SavedSearchesTab.tsx | disabled={paused \|\| change.isPending} | disabled={change.isPending}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { en } from "@/lib/i18n/en";

const code = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("F429: the chat menu tells Report and Block apart", () => {
  it("Block user is the red row and Report user carries a one-line hint", () => {
    const src = code("src/components/messages/ChatHeader.tsx");
    const block = src.match(/<DropdownMenuItem onClick=\{onBlockUser\} data-chat-block-user="" className="([^"]*)">/);
    expect(block).not.toBeNull();
    expect(block![1]).toContain("text-[hsl(var(--destructive-ink))]");
    expect(block![1]).toContain("focus:text-[hsl(var(--destructive-ink))]");
    expect(src).toMatch(/<span data-menu-label="">\{t\("msg\.reportUser"\)\}<\/span>\s*<span className="text-ds-12 text-muted-foreground">\{t\("msg\.reportUserBody"\)\}<\/span>/);
    expect(en["msg.reportUser"]).toBe("Report user");
    expect(en["msg.reportUserBody"]).toBe("Tell our team about a problem.");
    // Report stays the plain colour: no destructive ink on the Report row.
    const report = src.match(/<DropdownMenuItem onClick=\{onReportUser\}([^>]*)>/);
    expect(report).not.toBeNull();
    expect(report![1]).not.toContain("destructive");
  });
});

describe("F468: every saved-search row has its own Alerts switch", () => {
  it("renders RowAlertSwitch in each row, disabled while Pause all is on, flipping notify_enabled for that one search", () => {
    const src = code("src/pages/profile/SavedSearchesTab.tsx");
    expect(src).toContain("<RowAlertSwitch search={s} userId={userId} paused={!!paused.data} />");
    const fn = src.slice(src.indexOf("function RowAlertSwitch("), src.indexOf("function SearchSheet("));
    expect(fn).toContain("updateSavedSearch(userId, search.id, { notify_enabled })");
    expect(fn).toContain("checked={search.notify_enabled}");
    expect(fn).toContain("disabled={paused || change.isPending}");
    expect(fn).toContain('aria-label={`Alerts for ${search.name}`}');
    expect(fn).toContain('data-saved-search-alerts=""');
  });
});
