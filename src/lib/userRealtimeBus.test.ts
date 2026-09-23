/**
 * The shared per-user realtime channel (Q105) behaves as one channel: every
 * consumer beyond the first is free, events reach only their topic's
 * listeners, recovery reaches all of them, and the channel closes with its
 * last listener.
 *
 * @mutate src/lib/userRealtimeBus.ts | let bus = buses.get(userId); | let bus = undefined as Bus \| undefined;
 * @mutate src/lib/userRealtimeBus.ts | if (l.topic !== topic) continue; | void topic;
 * @mutate src/lib/userRealtimeBus.ts | queueMicrotask(() => { | ((f: () => void) => f())(() => {
 * @mutate src/lib/userRealtimeBus.ts | if (b.listeners.size === 0) { | if (b.listeners.size <= 1) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rig = vi.hoisted(() => ({
  opened: 0,
  closed: 0,
  names: [] as string[],
  handlers: new Map<string, (p: unknown) => void>(),
  recover: null as null | (() => void),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const chan = {
        on: (_e: string, cfg: { table: string }, h: (p: unknown) => void) => {
          rig.handlers.set(cfg.table, h);
          return chan;
        },
      };
      return chan;
    },
  },
}));
vi.mock("@/lib/realtimeRecovery", () => ({
  subscribeWithRecovery: (build: (n: string) => unknown, opts: { name: string; onRecovered?: () => void }) => {
    rig.opened++;
    rig.names.push(opts.name);
    rig.recover = opts.onRecovered ?? null;
    build(opts.name);
    return { close: () => { rig.closed++; } };
  },
}));

import { subscribeUserRealtime } from "./userRealtimeBus";

beforeEach(() => {
  rig.opened = 0;
  rig.closed = 0;
  rig.names = [];
  rig.handlers.clear();
  rig.recover = null;
});

describe("userRealtimeBus", () => {
  it("opens ONE channel for every consumer of one user, and closes it with the last", () => {
    const bell = vi.fn();
    const push = vi.fn();
    const badge = vi.fn();
    const u1 = subscribeUserRealtime("u", "notifications:insert", bell);
    const u2 = subscribeUserRealtime("u", "notifications:insert", push);
    const u3 = subscribeUserRealtime("u", "jobs:customer", badge);
    expect(rig.opened).toBe(1);
    expect(rig.names).toEqual(["user-realtime-u"]);
    u1();
    u2();
    expect(rig.closed).toBe(0);
    u3();
    expect(rig.closed).toBe(1);
    // Idempotent: a second call must not close a later channel.
    u3();
    expect(rig.closed).toBe(1);
  });

  it("delivers an event only to its topic, and recovery to everyone", () => {
    const onNotif = vi.fn();
    const onJobs = vi.fn();
    const rec1 = vi.fn();
    const rec2 = vi.fn();
    const a = subscribeUserRealtime("v", "notifications:insert", onNotif, { onRecovered: rec1 });
    const b = subscribeUserRealtime("v", "jobs:customer", onJobs, { onRecovered: rec2 });
    rig.handlers.get("notifications")!({ new: { id: 1 } });
    expect(onNotif).toHaveBeenCalledTimes(1);
    expect(onJobs).not.toHaveBeenCalled();
    rig.recover!();
    expect(rec1).toHaveBeenCalledTimes(1);
    expect(rec2).toHaveBeenCalledTimes(1);
    a();
    b();
  });

  it("a different user gets a different channel", () => {
    const a = subscribeUserRealtime("w1", "notifications:insert", vi.fn());
    const b = subscribeUserRealtime("w2", "notifications:insert", vi.fn());
    expect(rig.opened).toBe(2);
    a();
    b();
    expect(rig.closed).toBe(2);
  });
});

describe("userRealtimeBus: one consumer's throw does not starve the rest (Q104/Q105 review)", () => {
  it("delivers to every listener even when an earlier one throws", async () => {
    const thrown: unknown[] = [];
    const onErr = (e: unknown) => thrown.push(e);
    process.on("uncaughtException", onErr);
    const boom = vi.fn(() => { throw new Error("listener boom"); });
    const after = vi.fn();
    const u1 = subscribeUserRealtime("t", "notifications:insert", boom);
    const u2 = subscribeUserRealtime("t", "notifications:insert", after);
    expect(() => rig.handlers.get("notifications")!({ new: { id: 1 } })).not.toThrow();
    expect(boom).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    u1(); u2();
    await new Promise((r) => setTimeout(r, 0));
    process.off("uncaughtException", onErr);
    expect(thrown.map(String)).toEqual(["Error: listener boom"]);
  });
});
