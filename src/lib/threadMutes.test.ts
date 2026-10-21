/**
 * Thread mutes and snoozes (src/lib/threadMutes.ts). The server RPCs are the
 * truth and the local map mirrors them; only a not-deployed RPC (PGRST202)
 * falls back to the local map. Any other error throws (toggle, snooze,
 * unmute) or is reported (the bulk read), never silently read as "not muted".
 * A team thread is never muted.
 *
 * @mutate src/lib/threadMutes.ts |   if (isTeamThreadKey(jobId)) return false; |
 * @mutate src/lib/threadMutes.ts |     if (isMissingRpcNamed(error, "toggle_thread_mute")) { |     if (error) {
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const rpcs: unknown[][] = [];
  const supabase = {
    rpc: (name: string, args?: unknown) => {
      rpcs.push([name, args]);
      return Promise.resolve(queue.shift() ?? { data: null, error: null });
    },
  };
  return { queue, rpcs, supabase, report: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/errorLogger", () => ({ report: h.report }));

import { SNOOZE_PRESETS, getMutedThreadMap, snoozeRemainingLabel, snoozeThread, threadMuteKey, toggleThreadMute, unmuteThread } from "./threadMutes";

const KEY = "helpr_muted_threads_v2";
const LEGACY = "helpr_muted_threads_v1";
const MISSING = (rpc: string) => ({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${rpc}`, hint: null } });
const BOOM = { data: null, error: { code: "57014", message: "statement timeout" } };
const local = () => JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, { until: string | null }>;
const NOW = new Date("2026-10-19T12:00:00Z");
const pairs = [
  { jobId: "j1", otherUserId: "o1" },
  { jobId: "j2", otherUserId: "o2" },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  h.queue.length = 0;
  h.rpcs.length = 0;
  h.report.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("toggleThreadMute", () => {
  it("sends the thread to the RPC and mirrors the server's answer locally", async () => {
    h.queue.push({ data: true, error: null });
    await expect(toggleThreadMute("u", "j1", "o1")).resolves.toBe(true);
    expect(h.rpcs).toEqual([["toggle_thread_mute", { _job_id: "j1", _other_user_id: "o1" }]]);
    expect(local()).toEqual({ "u::j1::o1": { until: null } });
    h.queue.push({ data: false, error: null });
    await expect(toggleThreadMute("u", "j1", "o1")).resolves.toBe(false);
    expect(local()).toEqual({});
  });

  it("falls back to the local map only when the RPC is not deployed", async () => {
    h.queue.push(MISSING("toggle_thread_mute"));
    await expect(toggleThreadMute("u", "j1", "o1")).resolves.toBe(true);
    expect(local()).toEqual({ "u::j1::o1": { until: null } });
    h.queue.push(MISSING("toggle_thread_mute"));
    await expect(toggleThreadMute("u", "j1", "o1")).resolves.toBe(false);
    expect(local()).toEqual({});
    h.queue.push(BOOM);
    await expect(toggleThreadMute("u", "j1", "o1")).rejects.toMatchObject({ code: "57014" });
  });

  it("never mutes a team thread", async () => {
    await expect(toggleThreadMute("u", "team:abc", "o1")).resolves.toBe(false);
    expect(h.rpcs).toEqual([]);
  });
});

describe("snoozeThread", () => {
  it("snoozes until the server's timestamp, or forever for null", async () => {
    const until = new Date(NOW.getTime() + 3_600_000);
    h.queue.push({ data: "2026-10-19T13:00:00+00:00", error: null });
    await expect(snoozeThread("u", "j1", "o1", until)).resolves.toBe("2026-10-19T13:00:00+00:00");
    expect(h.rpcs).toEqual([["set_thread_snooze", { _job_id: "j1", _other_user_id: "o1", _until: until.toISOString() }]]);
    expect(local()["u::j1::o1"]).toEqual({ until: "2026-10-19T13:00:00+00:00" });

    h.queue.push({ data: null, error: null });
    await expect(snoozeThread("u", "j1", "o1", null)).resolves.toBeNull();
    expect(local()["u::j1::o1"]).toEqual({ until: null });

    h.queue.push({ data: null, error: null });
    await expect(snoozeThread("u", "j1", "o1", until)).resolves.toBe(until.toISOString());
    expect(local()["u::j1::o1"]).toEqual({ until: until.toISOString() });
  });

  it("a past timestamp clears the snooze", async () => {
    h.queue.push({ data: null, error: null });
    await expect(snoozeThread("u", "j1", "o1", new Date(NOW.getTime() - 1000))).resolves.toBe(new Date(NOW.getTime() - 1000).toISOString());
    expect(local()).toEqual({});
  });

  it("records locally when the RPC is not deployed, and throws on any other error", async () => {
    const until = new Date(NOW.getTime() + 60_000);
    h.queue.push(MISSING("set_thread_snooze"));
    await expect(snoozeThread("u", "j1", "o1", until)).resolves.toBe(until.toISOString());
    expect(local()["u::j1::o1"]).toEqual({ until: until.toISOString() });
    h.queue.push(MISSING("set_thread_snooze"));
    await expect(snoozeThread("u", "j1", "o1", new Date(NOW.getTime() - 1))).resolves.toBeNull();
    expect(local()).toEqual({});
    h.queue.push(BOOM);
    await expect(snoozeThread("u", "j1", "o1", until)).rejects.toMatchObject({ code: "57014" });
    await expect(snoozeThread("u", "team:abc", "o1", until)).resolves.toBeNull();
  });
});

describe("unmuteThread", () => {
  it("clears the mute on the server and locally; a not-deployed RPC still clears locally", async () => {
    localStorage.setItem(KEY, JSON.stringify({ "u::j1::o1": { until: null } }));
    h.queue.push({ data: null, error: null });
    await unmuteThread("u", "j1", "o1");
    expect(h.rpcs).toEqual([["clear_thread_mute", { _job_id: "j1", _other_user_id: "o1" }]]);
    expect(local()).toEqual({});
    localStorage.setItem(KEY, JSON.stringify({ "u::j1::o1": { until: null } }));
    h.queue.push(MISSING("clear_thread_mute"));
    await unmuteThread("u", "j1", "o1");
    expect(local()).toEqual({});
  });

  it("throws on a real error and leaves a team thread alone", async () => {
    h.queue.push(BOOM);
    await expect(unmuteThread("u", "j1", "o1")).rejects.toMatchObject({ code: "57014" });
    await unmuteThread("u", "team:abc", "o1");
    expect(h.rpcs).toHaveLength(1);
  });
});

describe("getMutedThreadMap", () => {
  it("is empty without a user or pairs, and makes no call", async () => {
    await expect(getMutedThreadMap("", pairs)).resolves.toEqual(new Map());
    await expect(getMutedThreadMap("u", [])).resolves.toEqual(new Map());
    expect(h.rpcs).toEqual([]);
  });

  it("returns the server's muted subset and reconciles the local mirror to it", async () => {
    localStorage.setItem(KEY, JSON.stringify({ "u::j2::o2": { until: null } }));
    h.queue.push({ data: [{ job_id: "j1", other_user_id: "o1", mute_until: "2026-10-19T20:00:00Z" }], error: null });
    const m = await getMutedThreadMap("u", pairs);
    expect(h.rpcs).toEqual([["get_muted_threads", { _pairs: [{ job_id: "j1", other_user_id: "o1" }, { job_id: "j2", other_user_id: "o2" }] }]]);
    expect([...m]).toEqual([[threadMuteKey("j1", "o1"), { muted: true, until: "2026-10-19T20:00:00Z" }]]);
    expect(local()).toEqual({ "u::j1::o1": { until: "2026-10-19T20:00:00Z" } });
  });

  it("falls back to live local mutes; reports a real failure, stays quiet for a missing RPC", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ "u::j1::o1": { until: null }, "u::j2::o2": { until: "2026-10-19T11:00:00Z" } }),
    );
    h.queue.push(MISSING("get_muted_threads"));
    const quiet = await getMutedThreadMap("u", pairs);
    expect([...quiet]).toEqual([["j1::o1", { muted: true, until: null }]]);
    expect(h.report).not.toHaveBeenCalled();

    h.queue.push(BOOM);
    const loud = await getMutedThreadMap("u", pairs);
    expect([...loud]).toEqual([["j1::o1", { muted: true, until: null }]]);
    expect(h.report).toHaveBeenCalledTimes(1);
    expect(h.report.mock.calls[0][1]).toMatchObject({ tags: { source: "threadMutes.get_muted_threads" }, context: { pair_count: 2 } });
  });

  it("migrates the v1 forever-mute list and survives a corrupt map", async () => {
    localStorage.setItem(LEGACY, JSON.stringify(["u::j1::o1", 7]));
    h.queue.push(MISSING("get_muted_threads"));
    const m = await getMutedThreadMap("u", pairs);
    expect([...m.keys()]).toEqual(["j1::o1"]);
    expect(local()).toEqual({ "u::j1::o1": { until: null } });

    localStorage.setItem(KEY, "{not json");
    h.queue.push(MISSING("get_muted_threads"));
    await expect(getMutedThreadMap("u", pairs)).resolves.toEqual(new Map());
  });
});

describe("snooze labels and presets", () => {
  it("says how long is left, null for forever, expired or junk", () => {
    expect(snoozeRemainingLabel(null)).toBeNull();
    expect(snoozeRemainingLabel("junk")).toBeNull();
    expect(snoozeRemainingLabel("2026-10-19T11:59:00Z")).toBeNull();
    expect(snoozeRemainingLabel("2026-10-19T12:45:00Z")).toBe("Muted for 45m");
    expect(snoozeRemainingLabel("2026-10-19T20:00:00Z")).toBe("Muted for 8h");
    expect(snoozeRemainingLabel("2026-10-22T12:00:00Z")).toBe("Muted for 3d");
  });

  it("resolves each preset at selection time", () => {
    const by = Object.fromEntries(SNOOZE_PRESETS.map((p) => [p.id, p.resolveUntil()]));
    expect(by["1h"]?.getTime()).toBe(NOW.getTime() + 3_600_000);
    expect(by["8h"]?.getTime()).toBe(NOW.getTime() + 8 * 3_600_000);
    expect(by.forever).toBeNull();
    const t = by.tomorrow as Date;
    expect(t.getHours()).toBe(8);
    expect(t.getMinutes()).toBe(0);
    expect(t.getTime()).toBeGreaterThan(NOW.getTime());
  });
});
