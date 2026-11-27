/**
 * CLASS GUARD (deep audit 1122 #3): an order, offer or chat link opened signed out asks the visitor to log in; it never
 * opens a sheet the server will refuse.
 *
 * WHAT WAS BROKEN: /declutter?order_talk=<id> opened signed out (a link from an email) opened the "Order chat" sheet,
 * the server refused the guest, and the sheet said "We couldn't load this chat. Check your connection and try again"
 * with Try again and no Log in (and logged an error each visit). On phone it covered the "Log in to see your order"
 * card; at 1440 that card never showed, so ?offer= was plain Browse with no word about the offer.
 *
 * WHAT THIS PINS
 *   1. Inventory from source: every link-opened Declutter chat (each exported `...FromLink` component under
 *      src/components/declutter) reads the signed-in member and draws nothing without one.
 *   2. Rendered: ?order_talk= signed out draws no sheet and asks the server nothing; the guest card with Log in (coming
 *      back to the link) shows at desktop width for an order / offer / chat link, and not for a plain Browse visit.
 */
// @mutate src/components/declutter/DeclutterOrderTalk.tsx |   if (!user \|\| !orderId \|\| !UUID.test(orderId)) return null; |   if (!orderId \|\| !UUID.test(orderId)) return null;
// @mutate src/components/declutter/DeclutterGuest.tsx |   if (!want) return null; |   if (!want && !barShown) return null;
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, isLoading: false }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));
const fetchOrderTalk = vi.hoisted(() => vi.fn(async () => { throw new Error("signed out"); }));
vi.mock("@/lib/declutter/orderTalk", async (orig) => ({ ...(await orig<object>()), fetchOrderTalk, fetchMyOrderTalks: vi.fn(async () => []) }));

import { OrderTalkFromLink } from "@/components/declutter/DeclutterOrderTalk";
import { DeclutterGuestBrowseJoin } from "@/components/declutter/DeclutterGuest";

afterEach(() => cleanup());

const ORDER = "11111111-2222-4333-8444-555555555555";
function at(url: string, node: JSX.Element) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("signed-out order, offer and chat links ask to log in (deep audit 1122 #3)", () => {
  it("every link-opened Declutter chat draws nothing for a guest", () => {
    const linkSheets: string[] = [];
    const offenders: string[] = [];
    for (const f of trackedFiles("src/components/declutter").filter((p) => /\.tsx$/.test(p) && !/\.test\.tsx$/.test(p))) {
      const code = blankComments(readFileSync(f, "utf8"));
      for (const m of code.matchAll(/export function (\w+FromLink)\(\)\s*\{/g)) {
        const start = m.index! + m[0].length;
        const body = code.slice(start, code.indexOf("\n}\n", start));
        linkSheets.push(`${f}: ${m[1]}`);
        if (!/useCurrentUser\(\)/.test(body) || !/!user\b/.test(body)) offenders.push(`${f}: ${m[1]} opens for a guest`);
      }
    }
    expect(offenders).toEqual([]);
    expect(linkSheets.length).toBeGreaterThan(1);
  });

  it("?order_talk= signed out: no chat sheet, no request, no false connection error", async () => {
    at(`/declutter?order_talk=${ORDER}`, <OrderTalkFromLink />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/couldn.t load this chat/i)).toBeNull();
    expect(fetchOrderTalk).not.toHaveBeenCalled();
  });

  it("at desktop width a guest with an order, offer or chat link gets the Log in card that comes back to the link", () => {
    for (const q of [`?offer=${ORDER}`, `?order=${ORDER}`, `?order_talk=${ORDER}`, `?talk=${ORDER}`]) {
      const { container, unmount } = at(`/declutter${q}`, <DeclutterGuestBrowseJoin />);
      const login = container.querySelector('[data-guest-join="browse"] a[href^="/login?redirect="]');
      expect(login, q).toBeTruthy();
      expect(decodeURIComponent(login!.getAttribute("href")!), q).toContain(q.slice(1));
      unmount();
    }
    // A plain Browse visit at desktop width: the top bar carries Log in / Sign up (owner 11-10), no card.
    const { container } = at("/declutter", <DeclutterGuestBrowseJoin />);
    expect(container.querySelector('[data-guest-join="browse"]')).toBeNull();
  });
});
