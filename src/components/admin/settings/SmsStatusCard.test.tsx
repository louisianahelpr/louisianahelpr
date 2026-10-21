import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";

/**
 * Admin -> Settings: the SMS alerts log (20261021193738). Hidden while the
 * `sms_alerts` switch does not reach this admin; shows the counts and the
 * recent rows with no phone numbers; offline with nothing loaded is the
 * offline card, never "No texts yet" (Q571).
 */
// @mutate src/components/admin/settings/SmsStatusCard.tsx |   if (!enabled) return null; |   if (false) return null;
// @mutate src/components/admin/settings/SmsStatusCard.tsx |       {phase === "offline-empty" ? ( |       {false ? (

let switchOn = true;
let online = true;
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => switchOn }));
vi.mock("@/lib/useOnlineStatus", () => ({ useOnlineStatus: () => ({ online }) }));
const status = { audience: "testers", opted_in: 2, pending: 1, sent_24h: 3, failed_24h: 0, recent: [] as unknown[] };
const rpc = vi.fn(async (fn: string) => (fn === "admin_sms_status" ? { data: status, error: null } : { data: null, error: { message: `unexpected ${fn}` } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string) => rpc(fn), functions: { invoke: vi.fn() } } }));

import { SmsStatusCard } from "./SmsStatusCard";

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "online" } } })}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  switchOn = true;
  online = true;
  status.recent = [];
  rpc.mockClear();
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe("SmsStatusCard", () => {
  it("renders nothing and reads nothing while the switch does not reach this admin", () => {
    switchOn = false;
    const { container } = render(wrap(<SmsStatusCard />));
    expect(container.textContent).toBe("");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the counts and an empty log", async () => {
    render(wrap(<SmsStatusCard />));
    expect(await screen.findByText("No texts yet")).toBeTruthy();
    expect(screen.getByText("Opted in").previousSibling?.textContent).toBe("2");
    expect(screen.getByText("Waiting YES").previousSibling?.textContent).toBe("1");
    expect(rpc).toHaveBeenCalledWith("admin_sms_status");
  });

  it("names a skip reason in plain words", async () => {
    status.recent = [{ created_at: "2026-10-20T03:00:00Z", category: "messages", kind: "message", status: "skipped", reason: "quiet_hours", error_code: null }];
    render(wrap(<SmsStatusCard />));
    expect(await screen.findByText("Skipped: quiet hours")).toBeTruthy();
  });

  it("offline with nothing loaded is the offline card, not an empty log", async () => {
    // Offline for the app AND for React Query, so the read pauses (no data ever arrives).
    online = false;
    onlineManager.setOnline(false);
    render(wrap(<SmsStatusCard />));
    expect(await screen.findByText(/once you're back online/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByText("No texts yet")).toBeNull();
  });
});
