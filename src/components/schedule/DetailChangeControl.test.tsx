/**
 * Q1254: the agreed-change control for a booked job's place and details. The
 * poster asks (only the changed fields are sent); a Helpr the request asked
 * gets the change list with Accept / Decline; a Helpr who accepted sees it
 * waiting on the others; a Helpr it did not ask sees nothing; an expired
 * request is not shown; a crew with nobody booked offers no Ask.
 *
 * @mutate src/lib/jobDetailChange.ts |   if (!row \|\| Date.parse(row.expires_at) <= now.getTime()) return null; |   if (!row) return null;
 * @mutate src/components/schedule/DetailChangeControl.tsx |   const askedOfMe = viewer === "helper" && mine?.answer === "pending"; |   const askedOfMe = viewer === "helper";
 * @mutate src/components/schedule/DetailChangeControl.tsx |     DETAIL_CHANGE_FIELDS.filter((f) => draft[f].trim() !== current[f].trim()) |     DETAIL_CHANGE_FIELDS.filter(() => true)
 * @mutate src/components/schedule/DetailChangeControl.tsx |   const posterCanAsk = viewer === "poster" && (!isCrew \|\| (crewBooked ?? 0) > 0); |   const posterCanAsk = viewer === "poster";
 * @mutate src/components/series/JobSeriesCardControls.tsx |         <DetailChangeControl | <span data-x
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const row = vi.hoisted(() => ({ value: null as unknown, roster: [] as unknown[] }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.not = () => c;
  c.maybeSingle = () => Promise.resolve({ data: row.value, error: null });
  c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: row.roster, error: null }).then(res);
  return { supabase: { from: () => c, rpc } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const geocode = vi.hoisted(() => vi.fn());
vi.mock("@/lib/geocode", () => ({ geocodeAddress: geocode }));
import { toast } from "sonner";

import { DetailChangeControl } from "./DetailChangeControl";

const POSTER = "poster-1";
const HELPR = "helpr-1";
const OTHER = "helpr-2";
const CURRENT = { title: "Paint the fence", description: "Two coats", location: "12 Oak St", materials_note: "" };
const req = (over: Record<string, unknown> = {}) => ({
  id: "r1", job_id: "j1", requested_by: POSTER, changed_fields: ["location"],
  old_title: "Paint the fence", new_title: null, old_description: "Two coats", new_description: null,
  old_location: "12 Oak St", new_location: "14 Oak St", old_materials_note: null, new_materials_note: null,
  status: "pending", expires_at: "2026-09-10T14:00:00Z",
  answers: [{ helper_id: HELPR, answer: "pending" }], ...over,
});
const renderIt = (userId: string, viewer: "poster" | "helper", isCrew = false) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DetailChangeControl jobId="j1" jobTitle="Paint the fence" userId={userId} viewer={viewer} isCrew={isCrew} current={CURRENT} />
    </QueryClientProvider>,
  );

describe("DetailChangeControl", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T17:00:00Z"));
    rpc.mockReset();
    geocode.mockReset();
    geocode.mockResolvedValue({ latitude: 30.46, longitude: -91.19 });
    row.value = null;
    row.roster = [];
  });
  afterEach(() => vi.useRealTimers());

  it("the Helpr asked sees what would change and Accept calls respond_job_detail_change", async () => {
    row.value = req();
    rpc.mockResolvedValue({ data: { status: "accepted" }, error: null });
    renderIt(HELPR, "helper");
    expect(await screen.findByText("14 Oak St")).toBeTruthy();
    expect(screen.getByText(/12 Oak St/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("respond_job_detail_change", { p_request_id: "r1", p_accept: true }));
  });

  it("a Helpr who already accepted sees it waiting on the others, with no buttons", async () => {
    row.value = req({ answers: [{ helper_id: HELPR, answer: "accepted" }, { helper_id: OTHER, answer: "pending" }] });
    renderIt(HELPR, "helper", true);
    expect(await screen.findByText(/You accepted the new details/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("a Helpr the request did not ask sees nothing", async () => {
    row.value = req({ answers: [{ helper_id: OTHER, answer: "pending" }] });
    const { container } = renderIt(HELPR, "helper", true);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-detail-change]")).toBeNull();
  });

  it("an expired request is not shown", async () => {
    row.value = req({ expires_at: "2026-09-05T16:00:00Z" });
    const { container } = renderIt(HELPR, "helper");
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-detail-change]")).toBeNull();
  });

  it("the poster asks with only the changed fields, and Send waits for a change", async () => {
    rpc.mockResolvedValue({ data: { asked: 1 }, error: null });
    renderIt(POSTER, "poster");
    fireEvent.click(await screen.findByRole("button", { name: "Ask to change the details" }));
    const send = await screen.findByRole("button", { name: "Send request" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "14 Oak St" } });
    fireEvent.change(screen.getByLabelText("Materials I'll provide"), { target: { value: "Paint and brushes" } });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("request_job_detail_change", {
        p_job_id: "j1",
        p_changes: { location: "14 Oak St", materials_note: "Paint and brushes", latitude: 30.46, longitude: -91.19 },
      }),
    );
  });

  it("a new address the map cannot find is not sent (Q1499: no pinless booked job)", async () => {
    geocode.mockResolvedValue(null);
    renderIt(POSTER, "poster");
    fireEvent.click(await screen.findByRole("button", { name: "Ask to change the details" }));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Nowhere Rd" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't find that address on the map/)));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a blank title cannot be sent", async () => {
    renderIt(POSTER, "poster");
    fireEvent.click(await screen.findByRole("button", { name: "Ask to change the details" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Send request" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the poster of a crew with nobody booked is offered no Ask; with a member booked, it is", async () => {
    const first = renderIt(POSTER, "poster", true);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "Ask to change the details" })).toBeNull();
    first.unmount();
    row.roster = [{ helper_id: HELPR }];
    renderIt(POSTER, "poster", true);
    expect(await screen.findByRole("button", { name: "Ask to change the details" })).toBeTruthy();
  });

  it("the poster sees their pending request and how many Helprs it waits on", async () => {
    row.value = req({ answers: [{ helper_id: HELPR, answer: "accepted" }, { helper_id: OTHER, answer: "pending" }] });
    row.roster = [{ helper_id: HELPR }, { helper_id: OTHER }];
    renderIt(POSTER, "poster", true);
    expect(await screen.findByText(/Waiting for 1 Helpr to accept/)).toBeTruthy();
  });

  it("both job cards carry it, beside the date/time request", () => {
    expect(readFileSync("src/components/series/JobSeriesCardControls.tsx", "utf8")).toMatch(/<DetailChangeControl\s/);
  });
});
