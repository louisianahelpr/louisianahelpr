/**
 * Owner polish 11-20 ("fill the empty space with useful rows"): signed-in Home adds, under Your sections,
 *   - "Recent messages": the last 3 conversations from the inbox's OWN query (shared cache), each opening its thread;
 *   - "Your active listings and jobs": open posted jobs and live Declutter listings, from Home's existing reads;
 * and shows "Near you" (jobs + Declutter items) on every settled day, not only a quiet one (newMemberHome1114.test.tsx).
 * All of it is a lazy chunk asked only once the page has settled, never with Home's first screen.
 *
 * @mutate src/pages/home/homeDashboard/HomeMoreRows.tsx |             onClick={() => navigate(conversationLink(c))} |             onClick={() => navigate("/messages")}
 * @mutate src/pages/home/homeDashboard/HomeMoreRows.tsx |             right={c.unread > 0 ? | right={c.unread >= 0 ?
 * @mutate src/pages/home/homeDashboard/HomeMoreRows.tsx |   if (rows.length === 0) return null;\n  return (\n    <div data-home-recent-messages=""> |   return (\n    <div data-home-recent-messages="">
 * @mutate src/pages/home/homeDashboard/homeActive.ts |     .filter((j) => j.status === "open") |     .filter((j) => j.status !== "completed")
 * @mutate src/pages/home/homeDashboard/homeActive.ts |     .filter((i) => i.status === "live") |     .filter(() => true)
 * @mutate src/pages/home/HomeDashboard.tsx |             {pageSettled && <Suspense fallback={null}><HomeMoreRows user={user} active={summary.active} /></Suspense>} |             <Suspense fallback={null}><HomeMoreRows user={user} active={summary.active} /></Suspense>
 * @mutate src/components/mobileNav/useRecentConversationsPreview.ts |     meta: { persist: false }, |
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

const preview = vi.hoisted(() => ({ recent: [] as unknown[], calls: [] as unknown[][] }));
vi.mock("@/components/mobileNav/useRecentConversationsPreview", () => ({
  useRecentConversationsPreview: (...a: unknown[]) => {
    preview.calls.push(a);
    return { recent: preview.recent.slice(0, 3), isLoading: false };
  },
}));

import HomeMoreRows, { ActiveRows, RecentMessagesRows } from "@/pages/home/homeDashboard/HomeMoreRows";
import { deriveHomeActive, type HomeActiveItem } from "@/pages/home/homeDashboard/homeActive";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}
const draw = (ui: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes>
    </MemoryRouter>,
  );

const convo = (n: number, extra: Record<string, unknown> = {}) => ({
  jobId: `j${n}`, otherUserId: `u${n}`, otherUserName: `Person ${n}`, jobTitle: `Job ${n}`, lastMessage: `Hello ${n}`, lastAt: "2026-11-20T10:00:00Z", unread: 0, ...extra,
});
const user = { id: "me" } as never;

afterEach(() => {
  cleanup();
  preview.recent = [];
  preview.calls = [];
  __resetLangForTests();
});

describe("Recent messages on Home (owner polish 11-20)", () => {
  it("the last 3 conversations, each opening its own thread; See all opens Messages", () => {
    preview.recent = [convo(1, { unread: 2 }), convo(2), convo(3), convo(4)];
    draw(<RecentMessagesRows user={user} />);
    // The inbox's own query, asked for this member (enabled).
    expect(preview.calls[0]).toEqual([user, true]);
    const rows = [...document.querySelectorAll("[data-home-recent-messages] button")].filter((b) => /Person/.test(b.textContent ?? ""));
    expect(rows.map((r) => r.textContent?.match(/Person \d/)?.[0])).toEqual(["Person 1", "Person 2", "Person 3"]);
    expect(rows[0].textContent).toContain("Hello 1");
    // Only the unread thread wears the dot.
    expect(document.querySelectorAll("[data-home-message-unread]").length).toBe(1);
    fireEvent.click(rows[1]);
    expect(screen.getByTestId("where").textContent).toBe("/messages?jobId=j2&userId=u2");
    fireEvent.click(screen.getByText("See all"));
    expect(screen.getByTestId("where").textContent).toBe("/messages");
  });

  it("draws nothing with no conversation", () => {
    const { container } = draw(<RecentMessagesRows user={user} />);
    expect(container.querySelector("[data-home-recent-messages]")).toBeNull();
  });
});

describe("Your active listings and jobs (owner polish 11-20)", () => {
  it("derives open posted jobs and live listings, newest first, from Home's own reads", () => {
    const out = deriveHomeActive(
      [
        { id: "a", title: "Old open", status: "open", created_at: "2026-11-01" },
        { id: "b", title: "Booked", status: "accepted", created_at: "2026-11-10" },
        { id: "c", title: "New open", status: "open", created_at: "2026-11-15" },
      ],
      { a: 2 },
      [
        { id: "i1", title: "Chair", status: "live", current_price_cents: 1500, live_at: "2026-11-02" },
        { id: "i2", title: "Sold lamp", status: "sold", current_price_cents: 900 },
        { id: "i3", title: "Free box", status: "live", current_price_cents: 0, live_at: "2026-11-12" },
      ],
    );
    expect(out.map((r) => r.title)).toEqual(["New open", "Old open", "Free box", "Chair"]);
    expect(out[1]).toMatchObject({ kind: "job", to: "/jobs/a", applicants: 2 });
    expect(out[3]).toMatchObject({ kind: "item", to: "/declutter/item/i1", priceCents: 1500 });
    expect(deriveHomeActive([], {}, [])).toEqual([]);
  });

  it("rows say what each is and open it; See all only when there are more than 3", () => {
    const active: HomeActiveItem[] = [
      { kind: "job", id: "job-a", title: "Mow my lawn", to: "/jobs/a", applicants: 2 },
      { kind: "job", id: "job-b", title: "Fix fence", to: "/jobs/b", applicants: 0 },
      { kind: "item", id: "item-i1", title: "Chair", to: "/declutter/item/i1", priceCents: 1500 },
    ];
    draw(<ActiveRows active={active} />);
    const block = document.querySelector("[data-home-active]") as HTMLElement;
    expect(block.textContent).toContain("Your active listings and jobs");
    expect(block.textContent).toContain("Open · 2 applicants");
    expect(block.textContent).toContain("Open · waiting for applicants");
    expect(block.textContent).toContain("$15");
    expect(screen.queryByText("See all")).toBeNull();
    fireEvent.click(screen.getByText("Chair"));
    expect(screen.getByTestId("where").textContent).toBe("/declutter/item/i1");
    cleanup();
    draw(<ActiveRows active={[...active, { kind: "item", id: "item-i2", title: "Lamp", to: "/declutter/item/i2", priceCents: 0 }]} />);
    expect(document.querySelectorAll("[data-home-active-kind]").length).toBe(3);
    fireEvent.click(screen.getByText("See all"));
    expect(screen.getByTestId("where").textContent).toBe("/declutter?tab=selling");
  });

  it("draws nothing with none, and the whole block tolerates a summary without the list", () => {
    const { container } = draw(<HomeMoreRows user={user} active={[]} />);
    expect(container.querySelector("[data-home-active]")).toBeNull();
    expect(container.querySelector("[data-home-recent-messages]")).toBeNull();
  });

  it("in Spanish", async () => {
    setLang("es");
    await ensureLangLoaded();
    preview.recent = [convo(1)];
    draw(<HomeMoreRows user={user} active={[{ kind: "job", id: "job-a", title: "Cortar césped", to: "/jobs/a", applicants: 1 }]} />);
    expect(screen.getByText("Mensajes recientes")).toBeTruthy();
    expect(screen.getByText("Sus anuncios y trabajos activos")).toBeTruthy();
    expect(screen.getByText("Abierto · 1 solicitante")).toBeTruthy();
  });
});

describe("Home loads the rows lazily, after the page settles", () => {
  const home = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));
  it("a lazy chunk, never a static import, drawn only once pageSettled, under Your sections", () => {
    expect(home).not.toMatch(/^import .*HomeMoreRows/m);
    expect(home).toContain('lazy(() => loadModule(() => import("./homeDashboard/HomeMoreRows"))');
    const at = home.indexOf("<HomeMoreRows user={user} active={summary.active} />");
    expect(at).toBeGreaterThan(home.indexOf("data-section-chips"));
    expect(home.slice(at - 60, at)).toContain("{pageSettled && <Suspense fallback={null}>");
  });
  it("the shared conversations read is never kept in IndexedDB", () => {
    const hook = blankComments(readFileSync("src/components/mobileNav/useRecentConversationsPreview.ts", "utf8"));
    expect(hook).toContain("queryKey: queryKeys.messages.conversations(uid),");
    expect(hook).toContain("meta: { persist: false },");
  });
});
