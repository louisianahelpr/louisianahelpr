/**
 * Whole-app audit 11-10, Builder 2 copy and one-file rows:
 *   F471/F415/F234 /helpdesk, /settings and F455 /profile/security were 404s: each forwards to the real page.
 *   F419 a dead /messages/<id> link said "Page not found": it says it was a conversation and opens the inbox.
 *   F257 the 404's screen-reader heading was "Error 404": it is the page's title.
 *   F473 the chat's offline toast did not say the typed message is kept: it does.
 *   F454 Notifications' push row said "Turn on app notifications": the button says "Get alerts on this phone".
 *   F480 the inbox search placeholder said only "Search conversations": it names names, jobs and messages.
 *   F458 "I can help with" had nothing saying it is for Helprs: one line under it does.
 *
 * @mutate src/App.tsx |       <Route path="/helpdesk" element={<Navigate to="/help" replace />} />\n |
 * @mutate src/App.tsx |       <Route path="/settings" element={<Navigate to="/profile?tab=settings" replace />} />\n |
 * @mutate src/App.tsx |       <Route path="/profile/security" element={<Navigate to="/profile?tab=security" replace />} />\n |
 * @mutate src/pages/info/NotFound.tsx |   if (/^\/messages\/[^/]+/.test(pathname)) { |   if (false) {
 * @mutate src/pages/info/NotFound.tsx |       primaryTo: "/messages", |       primaryTo: "/",
 * @mutate src/pages/info/NotFound.tsx |           <h1 className="sr-only">{copy.title}</h1> |           <h1 className="sr-only">Error 404</h1>
 * @mutate src/lib/requireOnline.ts |   toast.error(offlineMessage); |   toast.error(OFFLINE_MESSAGE);
 * @mutate src/pages/messages/messagesData/sendHandlers.ts |     if (!requireOnline(OFFLINE_MESSAGE_KEPT)) return false; |     if (!requireOnline()) return false;
 * @mutate src/components/notificationPreferences/PushDeviceHint.tsx |           Get alerts on this phone\n |           Turn on app notifications\n
 * @mutate src/components/messages/ConversationList.tsx |         placeholder={`${t("chat.searchHint")}…`} |         placeholder={`${t("chat.search")}…`}
 * @mutate src/components/profile/ProfileEditForm.tsx |               <p className="text-ds-11 text-muted-foreground" data-skills-hint="">Only if you want to work jobs.</p>\n |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/connectivity", () => ({ isConfirmedOffline: () => true }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/nativePush", () => ({ useRequestPushPermissionOutcome: () => async () => "dismissed" }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

import NotFound, { notFoundCopy } from "@/pages/info/NotFound";
import { OFFLINE_MESSAGE, OFFLINE_MESSAGE_KEPT, requireOnline } from "@/lib/requireOnline";
import { PushDeviceHint } from "@/components/notificationPreferences/PushDeviceHint";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const read = (p: string) => blankComments(readFileSync(resolve(p), "utf8"));

afterEach(() => cleanup());

describe("audit 11-10: typed and old addresses forward (F471/F415/F234, F455)", () => {
  const app = read("src/App.tsx");
  it.each([
    ["/helpdesk", "/help"],
    ["/settings", "/profile?tab=settings"],
    ["/profile/security", "/profile?tab=security"],
  ])("%s forwards to %s", (from, to) => {
    expect(app).toContain(`<Route path="${from}" element={<Navigate to="${to}" replace />} />`);
  });
});

describe("audit 11-10: the 404 page (F419, F257)", () => {
  it("F419: a dead conversation link says so and opens the inbox", () => {
    render(<MemoryRouter initialEntries={["/messages/abc"]}><NotFound /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("We couldn't find that conversation");
    expect(screen.getByText("It may have been removed, or the link may be old.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to my messages" }).getAttribute("href")).toBe("/messages");
    expect(screen.queryByRole("link", { name: "Go home" })).toBeNull();
  });

  it("F419: only a conversation address gets the conversation words", () => {
    expect(notFoundCopy("/messages").title).toBe("Page not found");
    expect(notFoundCopy("/messagesx/abc").title).toBe("Page not found");
    expect(notFoundCopy("/declutter/item/abc").primaryTo).toBe("/");
  });

  it("F257: the screen-reader heading is the title, not 'Error 404'", () => {
    const { container } = render(<MemoryRouter initialEntries={["/nope"]}><NotFound /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Page not found");
    expect(container.textContent).not.toMatch(/404/);
    expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
  });
});

describe("audit 11-10: the chat's offline toast says the message is kept (F473)", () => {
  it("requireOnline shows the caller's words; the default is unchanged", () => {
    const toastError = vi.mocked(toast.error);
    toastError.mockClear();
    expect(requireOnline(OFFLINE_MESSAGE_KEPT)).toBe(false);
    expect(toastError).toHaveBeenLastCalledWith("You're offline. Your message is kept. Tap send when you're back.");
    expect(requireOnline()).toBe(false);
    expect(toastError).toHaveBeenLastCalledWith(OFFLINE_MESSAGE);
    expect(OFFLINE_MESSAGE).toBe("You're offline. Try again when you're back.");
  });

  it("the chat's send gate passes the kept-message words", () => {
    const src = read("src/pages/messages/messagesData/sendHandlers.ts");
    expect(src).toContain("if (!requireOnline(OFFLINE_MESSAGE_KEPT)) return false;");
  });
});

describe("audit 11-10: Notifications push row (F454)", () => {
  it("the button says what you get", () => {
    render(<PushDeviceHint />);
    expect(screen.getByRole("button", { name: "Get alerts on this phone" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Turn on app notifications" })).toBeNull();
  });
});

describe("audit 11-10: inbox search placeholder (F480) and the help-with hint (F458)", () => {
  it("F480: the placeholder names names, jobs and messages, in both languages; the field's name is unchanged", () => {
    const list = read("src/components/messages/ConversationList.tsx");
    expect(list).toContain('placeholder={`${t("chat.searchHint")}…`}');
    expect(list).toContain('aria-label={t("chat.search")}');
    expect(en["chat.searchHint"]).toBe("Search names, jobs and messages");
    expect(es["chat.searchHint"]).toBe("Buscar nombres, trabajos y mensajes");
  });

  it("F458: one line under 'I can help with' says it is for working jobs", () => {
    const form = read("src/components/profile/ProfileEditForm.tsx");
    expect(form).toContain('data-skills-hint="">Only if you want to work jobs.</p>');
  });
});
