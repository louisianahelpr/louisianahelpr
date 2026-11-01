import { loadModule } from "@/lib/loadModule";
/**
 * supabase-js's RealtimeClient, without realtime-js and phoenix on the boot path (B75 speed, 11-01).
 *
 * createClient() builds a RealtimeClient in its constructor, so the client module (on every page's boot) carried
 * realtime-js + phoenix (~14 KB gz) although only chat, presence and live lists open a channel. In the production
 * build vite.config.ts aliases "@supabase/realtime-js" to this file and "supabase-realtime-real" to the package.
 * The real client is made on the first channel that subscribes, sends or tracks; a channel's `.on()` bindings made
 * before that are replayed onto the real channel, in order. Dev and tests use the real package unchanged.
 *
 * Only what supabase-js and the app call is here: client channel / setAuth / getChannels / removeChannel /
 * removeAllChannels; channel on / subscribe / send / track / untrack / presenceState / unsubscribe / topic / state.
 */
import type {
  RealtimeChannel as RealChannel,
  RealtimeChannelOptions,
  RealtimeClient as RealClient,
  RealtimeClientOptions,
} from "supabase-realtime-real";

// Loaded alone, then called: work chained straight onto import() runs inside Vite's preload wrapper, where a
// failure reads as a broken chunk (dynamicImportThenDoesNoWork).
const realtimeReal = () => loadModule(() => import("supabase-realtime-real"));

type RemoveResult = Awaited<ReturnType<RealClient["removeChannel"]>>;
type UnsubscribeResult = Awaited<ReturnType<RealChannel["unsubscribe"]>>;
type Status = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";
type SubscribeCallback = (status: Status, err?: Error) => void;
type Binding = [type: string, filter: Record<string, unknown>, callback: (...args: unknown[]) => void];

export class RealtimeChannel {
  private real: RealChannel | null = null;
  private making: Promise<RealChannel> | null = null;
  private readonly bindings: Binding[] = [];
  private removed = false;

  constructor(
    private readonly client: RealtimeClient,
    public readonly topic: string,
    private readonly params: RealtimeChannelOptions = { config: {} },
  ) {}

  /** The real channel, made (with the bindings so far) on first need. */
  private ensure(): Promise<RealChannel> {
    if (this.real) return Promise.resolve(this.real);
    this.making ??= this.client.real().then((c) => {
      // Removed while realtime was still loading: make nothing. realtime-js hands back the open channel of the same
      // topic, so a channel made here would be the one a NEWER stand-in of this name reuses (the presence channel is
      // removed and reopened by name), and this removal would then close it under that one (lead review, 11-01).
      if (this.removed) throw new Error("realtime channel removed before realtime-js loaded");
      const ch = c.channel(this.topic.replace(/^realtime:/, ""), this.params);
      for (const [type, filter, cb] of this.bindings) (ch.on as (...a: unknown[]) => unknown)(type, filter, cb);
      this.real = ch;
      return ch;
    });
    return this.making;
  }

  get state(): string {
    // Not made yet reads as closed, as a real channel before its first join does.
    return this.real ? this.real.state : "closed";
  }

  on(type: string, filter: Record<string, unknown>, callback: (...args: unknown[]) => void): this {
    if (this.real) (this.real.on as (...a: unknown[]) => unknown)(type, filter, callback);
    else this.bindings.push([type, filter, callback]);
    return this;
  }

  subscribe(callback?: SubscribeCallback, timeout?: number): this {
    this.ensure().then(
      (ch) => {
        // Removed while realtime was still loading: never open it.
        if (this.removed) return;
        ch.subscribe(callback, timeout);
      },
      (err: unknown) => {
        // realtime-js failed to load (offline, a deploy swapped the chunk): reported as a failed subscribe, so
        // realtimeRecovery's retry and outage banner run exactly as for a socket error.
        if (!this.removed) callback?.("CHANNEL_ERROR", err instanceof Error ? err : new Error(String(err)));
      },
    );
    return this;
  }

  async send(...args: Parameters<RealChannel["send"]>): ReturnType<RealChannel["send"]> {
    const ch = await this.ensure();
    return ch.send(...args);
  }

  async track(...args: Parameters<RealChannel["track"]>): ReturnType<RealChannel["track"]> {
    const ch = await this.ensure();
    return ch.track(...args);
  }

  async untrack(...args: Parameters<RealChannel["untrack"]>): ReturnType<RealChannel["untrack"]> {
    const ch = await this.ensure();
    return ch.untrack(...args);
  }

  presenceState(): ReturnType<RealChannel["presenceState"]> {
    return this.real ? this.real.presenceState() : {};
  }

  async unsubscribe(timeout?: number): Promise<UnsubscribeResult> {
    return this.real ? this.real.unsubscribe(timeout) : "ok";
  }

  /** RealtimeClient.removeChannel's half. */
  async remove(): Promise<RemoveResult> {
    this.removed = true;
    if (this.real) return this.client.removeReal(this.real);
    // Still loading: ensure() sees `removed` and makes no real channel, so there is nothing of ours to drop. Only a
    // real channel THIS stand-in made is ever removed, never one found by name.
    if (this.making) {
      const ch = await this.making.catch(() => null);
      if (ch && ch === this.real) return this.client.removeReal(ch);
    }
    return "ok";
  }
}

export class RealtimeClient {
  private inner: RealClient | null = null;
  private loading: Promise<RealClient> | null = null;
  private readonly channels: RealtimeChannel[] = [];
  private auth: { token: string | null | undefined } | null = null;

  constructor(
    private readonly endPoint: string,
    private readonly options?: RealtimeClientOptions,
  ) {}

  /** The real client, made once realtime-js has loaded. A failed load is retried on the next need. */
  real(): Promise<RealClient> {
    if (this.inner) return Promise.resolve(this.inner);
    this.loading ??= realtimeReal().then(
      (m) => {
        if (!m) throw new Error("realtime-js came back empty (a recovery reload is under way)");
        const c = new m.RealtimeClient(this.endPoint, this.options);
        // The latest token supabase-js handed over while realtime was still loading (sign-in, refresh, sign-out).
        if (this.auth) void c.setAuth(this.auth.token);
        this.inner = c;
        return c;
      },
    );
    const p = this.loading;
    p.catch(() => {
      // The waiting channel reports this as CHANNEL_ERROR; here only the cached failure is dropped so the next need retries.
      if (this.loading === p) this.loading = null;
    });
    return p;
  }

  channel(topic: string, params?: RealtimeChannelOptions): RealtimeChannel {
    const full = `realtime:${topic}`;
    // realtime-js hands back the existing channel for a topic still open; so does this.
    const existing = this.channels.find((c) => c.topic === full);
    if (existing) return existing;
    const ch = new RealtimeChannel(this, full, params);
    this.channels.push(ch);
    return ch;
  }

  setAuth(token?: string | null): Promise<void> {
    this.auth = { token };
    return this.inner ? this.inner.setAuth(token) : Promise.resolve();
  }

  getChannels(): RealtimeChannel[] {
    return [...this.channels];
  }

  removeChannel(channel: RealtimeChannel): Promise<RemoveResult> {
    const i = this.channels.indexOf(channel);
    if (i >= 0) this.channels.splice(i, 1);
    return channel.remove();
  }

  removeAllChannels(): Promise<RemoveResult[]> {
    return Promise.all([...this.channels].map((c) => this.removeChannel(c)));
  }

  /** RealtimeChannel.remove's half: the real client drops the real channel. */
  removeReal(ch: RealChannel): Promise<RemoveResult> {
    return this.inner ? this.inner.removeChannel(ch) : Promise.resolve("ok" as RemoveResult);
  }
}
