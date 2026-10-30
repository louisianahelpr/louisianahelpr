/**
 * Q2231 (owner, 2026-10-19): the Messages top bar follows the global rule on
 * the phone, title · notifications · profile at the far right, by wearing the
 * SAME AppTopBar every section does (no "+"). Search, the options menu and the
 * Active/All filter live in ONE slim search row under the section tabs, with
 * a single "more" menu, never as icons in the top bar.
 *
 * @mutate src/components/messages/ConversationList.tsx | <div className="shrink-0 -mt-1"><AppTopBar title="Messages" desktopGap={false} /></div> | <div className="shrink-0 -mt-1"><AppTopBar title="Messages" desktopGap={false} add={{ label: "New message", path: "/messages" }} /></div>
 * @mutate src/components/messages/ConversationList.tsx |   const headerEl = phoneTopBar && !selectMode ? ( |   const headerEl = false ? (
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const list = blankComments(readFileSync(resolve(__dirname, "../components/messages/ConversationList.tsx"), "utf8"));
// The menus themselves live in InboxMenus.tsx (out of ConversationList for its size baseline).
const menus = blankComments(readFileSync(resolve(__dirname, "../components/messages/InboxMenus.tsx"), "utf8"));

describe("Messages top bar = the global top bar (Q2231)", () => {
  it("on the phone the header is the shared AppTopBar titled Messages, with no +", () => {
    // Board 38 (owner, 2026-10-20): the desktop two-pane list (embedded) wears the same header.
    expect(list).toMatch(/const phoneTopBar = embedded \|\| !isWebDesktop;/);
    expect(list).toMatch(/const headerEl = phoneTopBar && !selectMode \? \(/);
    const bars = list.match(/<AppTopBar[^>]*\/>/g) ?? [];
    // desktopGap={false}: the list pane pads itself (one header row, 2026-10-21).
    expect(bars).toEqual(['<AppTopBar title="Messages" desktopGap={false} />']);
  });
  it("search, Active/All and the options live in the slim search row's one more menu", () => {
    const row = list.slice(list.indexOf("const phoneSearchRow"), list.indexOf("const headerEl ="));
    expect(row).toContain('aria-label={t("chat.search")}');
    expect(row).toContain("{moreMenu}");
    const menu = list.slice(list.indexOf("const moreMenu"), list.indexOf("const phoneSearchRow"));
    expect(menu).toContain("<MessagesMoreMenu");
    const more = menus.slice(menus.indexOf("export function MessagesMoreMenu"));
    expect(more).toContain("INBOX_TAB_ORDER.map");
    expect(more).toContain("<InboxViewItems {...items} />");
    const views = menus.slice(menus.indexOf("function InboxViewItems"), menus.indexOf("export function InboxOptionsMenu"));
    for (const item of ["Select messages", "Pinned", "Recently deleted"]) expect(views).toContain(item);
  });
});
