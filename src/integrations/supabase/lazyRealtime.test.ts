import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B75 (11-01): in the production build supabase-js's RealtimeClient is lazyRealtime.ts's stand-in, so realtime-js
 * and phoenix leave the boot path. The real client is a fake here; each case checks what the stand-in hands it.
 */
// @mutate src/integrations/supabase/lazyRealtime.ts | for (const [type, filter, cb] of this.bindings) (ch.on as (...a: unknown[]) => unknown)(type, filter, cb); | for (const [type, filter, cb] of this.bindings) void [ch, type, filter, cb];
// @mutate src/integrations/supabase/lazyRealtime.ts | if (this.auth) void c.setAuth(this.auth.token); | if (this.auth) void c;
// @mutate src/integrations/supabase/lazyRealtime.ts |         if (this.removed) return; |         if (this.removed === null) return;
// @mutate src/integrations/supabase/lazyRealtime.ts |       if (this.removed) throw new Error("realtime channel removed before realtime-js loaded"); |
// @mutate src/integrations/supabase/lazyRealtime.ts |         if (!this.removed) callback?.("CHANNEL_ERROR", | if (this.removed) callback?.("CHANNEL_ERROR",

const made: FakeClient[] = [];
let failNext = false;

class FakeChannel {
  ons: unknown[][] = [];
  subscribed: unknown[] = [];
  sent: unknown[] = [];
  state = "closed";
  constructor(public topic: string) {}
  on(...a: unknown[]) { this.ons.push(a); return this; }
  subscribe(cb?: (s: string) => void) { this.subscribed.push(cb); this.state = "joined"; cb?.("SUBSCRIBED"); return this; }
  async send(p: unknown) { this.sent.push(p); return "ok"; }
  async track(p: unknown) { this.sent.push(["track", p]); return "ok"; }
  presenceState() { return { a: [1] }; }
}
class FakeClient {
  auth: unknown[] = [];
  channels: FakeChannel[] = [];
  removed: FakeChannel[] = [];
  constructor(public url: string, public opts: unknown) { made.push(this); }
  // As realtime-js does: a topic still open hands back that same channel.
  channel(topic: string) {
    const open = this.channels.find((x) => x.topic === `realtime:${topic}` && !this.removed.includes(x));
    if (open) return open;
    const c = new FakeChannel(`realtime:${topic}`); this.channels.push(c); return c;
  }
  async setAuth(t?: string | null) { this.auth.push(t); }
  async removeChannel(c: FakeChannel) { this.removed.push(c); return "ok" as const; }
}

vi.mock("supabase-realtime-real", () => ({
  get RealtimeClient() {
    if (failNext) { failNext = false; throw new Error("chunk failed"); }
    return FakeClient;
  },
}));

const { RealtimeClient } = await import("./lazyRealtime");
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("lazyRealtime (the build's realtime-js stand-in)", () => {
  beforeEach(() => { made.length = 0; failNext = false; });

  it("makes no real client until a channel subscribes, then replays its bindings in order and subscribes", async () => {
    const rt = new RealtimeClient("wss://x/realtime/v1", { params: { apikey: "k" } });
    const h1 = () => {}; const h2 = () => {};
    const ch = rt.channel("messages-u1").on("postgres_changes", { event: "INSERT" }, h1).on("broadcast", { event: "typing" }, h2);
    await tick();
    expect(made.length).toBe(0);
    const statuses: string[] = [];
    ch.subscribe((s) => statuses.push(s));
    await tick(); await tick();
    expect(made.length).toBe(1);
    const real = made[0].channels[0];
    expect(real.topic).toBe("realtime:messages-u1");
    expect(real.ons).toEqual([["postgres_changes", { event: "INSERT" }, h1], ["broadcast", { event: "typing" }, h2]]);
    expect(statuses).toEqual(["SUBSCRIBED"]);
    expect(ch.state).toBe("joined");
  });

  it("hands the real client the latest token supabase-js set while realtime was loading", async () => {
    const rt = new RealtimeClient("wss://x", {});
    await rt.setAuth("t1");
    await rt.setAuth("t2");
    rt.channel("a").subscribe();
    await tick(); await tick();
    expect(made[0].auth).toEqual(["t2"]);
  });

  it("never opens a channel removed before realtime loaded", async () => {
    const rt = new RealtimeClient("wss://x", {});
    const ch = rt.channel("gone");
    ch.subscribe();
    await rt.removeChannel(ch);
    await tick(); await tick();
    expect(made[0]?.channels[0]?.subscribed ?? []).toEqual([]);
    expect(rt.getChannels()).toEqual([]);
  });

  it("a fixed-name channel removed and reopened while realtime loads: the old removal never closes the new one's channel", async () => {
    // usePresence-style: remove the presence channel by its name and open it again before realtime-js has arrived.
    const rt = new RealtimeClient("wss://x", {});
    const old = rt.channel("online-users");
    old.subscribe();
    const removing = rt.removeChannel(old);
    const fresh = rt.channel("online-users");
    expect(fresh).not.toBe(old);
    const got: string[] = [];
    fresh.subscribe((s) => got.push(s));
    await removing;
    await tick(); await tick();
    expect(got).toEqual(["SUBSCRIBED"]);
    expect(made[0].channels.length).toBe(1);
    expect(made[0].removed).toEqual([]);
    expect(fresh.state).toBe("joined");
  });

  it("a failed load is a CHANNEL_ERROR (realtimeRecovery retries), and the next subscribe loads again", async () => {
    const rt = new RealtimeClient("wss://x", {});
    failNext = true;
    const got: string[] = [];
    rt.channel("one").subscribe((s) => got.push(s));
    await tick(); await tick();
    expect(got).toEqual(["CHANNEL_ERROR"]);
    rt.channel("two").subscribe((s) => got.push(s));
    await tick(); await tick();
    expect(got).toEqual(["CHANNEL_ERROR", "SUBSCRIBED"]);
  });

  it("send and track reach the real channel; the same topic is the same channel", async () => {
    const rt = new RealtimeClient("wss://x", {});
    const ch = rt.channel("presence-1");
    expect(rt.channel("presence-1")).toBe(ch);
    expect(await ch.send({ type: "broadcast", event: "typing", payload: {} })).toBe("ok");
    expect(await ch.track({ online_at: "now" })).toBe("ok");
    expect(made[0].channels[0].sent.length).toBe(2);
    expect(ch.presenceState()).toEqual({ a: [1] });
  });
});
