import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * A FAILED LOAD MUST NEVER SAY "NOTHING NEW YET."
 *
 * Owner report, 2026-09-14: during the prod outage the bell panel said
 * "Nothing new yet." for a poster with 313 unread notifications. The panel
 * already had an inline error card, but it was reachable only from ONE
 * failure shape — a resolved `{ error }` result. Every other way a load can
 * fail fell through to the empty state, which is a claim about the account:
 *
 *   - the query REJECTS (a thrown fetch, a custom fetch wrapper) — the async
 *     loader threw, nothing set `loadError`;
 *   - the session read comes back with an ERROR (an outage takes auth down with
 *     the database, so the token refresh fails) — treated as "signed out";
 *   - the request HANGS (a saturated nano instance) — no answer, and an
 *     unanswered question rendered as "nothing".
 *
 * Each scenario below opens the panel and asserts the error card (or, while a
 * request is genuinely in flight, a loading row) — never the empty state.
 */

type Mode = "ok" | "errorResult" | "reject" | "hang";
const state = vi.hoisted(() => ({
  mode: "ok" as Mode,
  sessionError: false,
}));

const chain = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === "then") {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          if (state.mode === "hang") return new Promise(() => {});
          if (state.mode === "reject") return Promise.reject(new TypeError("Failed to fetch")).then(resolve, reject);
          const result = state.mode === "errorResult"
            ? { data: null, error: { message: "boom" }, count: null }
            : { data: [], error: null, count: 0 };
          return Promise.resolve(result).then(resolve);
        };
      }
      return () => chain();
    },
    apply: () => chain(),
  });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () =>
        state.sessionError
          ? { data: { session: null }, error: { name: "AuthRetryableFetchError", message: "Failed to fetch" } }
          : { data: { session: { user: { id: "u1" } } }, error: null },
    },
    from: () => chain(),
    channel: () => chain(),
    removeChannel: () => {},
  },
}));
vi.mock("@/lib/realtimeRecovery", () => ({
  subscribeWithRecovery: () => ({ close: () => {} }),
}));
vi.mock("@/lib/pushNotifications", () => ({
  isPushSupported: () => false,
  registerServiceWorker: () => {},
  showLocalNotification: () => {},
  getPushPermission: () => "default",
}));
vi.mock("@/lib/nativePush", () => ({ useRequestPushPermission: () => async () => false }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }),
}));

import NotificationPanel from "./NotificationPanel";
import { __resetNotificationStore } from "./notificationPanel/notificationStore";

const EMPTY_COPY = "Nothing new yet.";
const ERROR_COPY = "Couldn't load notifications.";

const mountAndOpen = async (advanceMs = 900) => {
  render(
    <MemoryRouter>
      <NotificationPanel />
    </MemoryRouter>,
  );
  // The initial load is deferred 800ms after mount.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(advanceMs);
  });
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: /notifications/i })[0]);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
};

describe("NotificationPanel: a failed load renders the error card, never the empty state", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    __resetNotificationStore();
    state.mode = "ok";
    state.sessionError = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("control: a successful empty load DOES show the empty state", async () => {
    await mountAndOpen();
    expect(screen.queryByText(EMPTY_COPY)).not.toBeNull();
    expect(screen.queryByText(ERROR_COPY)).toBeNull();
  });

  it("a resolved { error } result shows the error card", async () => {
    state.mode = "errorResult";
    await mountAndOpen();
    expect(screen.queryByText(ERROR_COPY)).not.toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it("a REJECTED query shows the error card", async () => {
    state.mode = "reject";
    await mountAndOpen();
    expect(screen.queryByText(ERROR_COPY)).not.toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it("a session read that ERRORS (auth down in an outage) shows the error card", async () => {
    state.sessionError = true;
    await mountAndOpen();
    expect(screen.queryByText(ERROR_COPY)).not.toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it("a load still in flight does not claim the account is empty", async () => {
    state.mode = "hang";
    await mountAndOpen();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  /*
   * "LOADING" MUST BE SAYABLE TO A MACHINE, NOT ONLY DRAWN.
   *
   * The pending state renders a spinner and "Loading notifications…" but said
   * nothing a waiter could read, so anything that decides a screen is settled
   * — assistive tech, and every harness in this repo, all of which key on
   * `[aria-busy="true"]` — treated a panel that had not answered yet as a
   * panel with nothing in it. press-every-control run 35692554813 shows both
   * halves of the damage on ONE screen: two shards walked the /home bell
   * with zero rows in it and passed, a third enumerated 50 rows and then could
   * not find a single one of them again.
   */
  it("says it is BUSY while the first load is still in flight", async () => {
    state.mode = "hang";
    await mountAndOpen();
    expect(document.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
  });

  it("control: a panel that has answered is NOT busy", async () => {
    await mountAndOpen();
    expect(screen.queryByText(EMPTY_COPY)).not.toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("a HUNG load gives up and shows the error card", async () => {
    state.mode = "hang";
    await mountAndOpen();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.queryByText(ERROR_COPY)).not.toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });
});
// Proof this guard can fail (scripts/vacuity). Drop the one line that refuses
// to read an errored session as "signed out" and the outage shape from the
// owner's report is back: auth 500s, the store is cleared, and a poster with
// 313 unread is told "Nothing new yet."
// @mutate src/components/NotificationPanel.tsx | if (sessionError) throw sessionError; |
// And proof the aria-busy pair can fail: drop the attribute and the pending
// state goes back to looking settled to every waiter.
// @mutate src/components/NotificationPanel.tsx | aria-busy="true" | aria-busy={undefined}
