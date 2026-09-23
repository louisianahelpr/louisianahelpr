import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `track()` copies campaign parameters off the current URL onto every event.
 *
 * Before this existed, `analytics_events.url` stored `location.pathname` only,
 * so the first-party funnel could not answer "which post drove that signup"
 * even in principle — the tag arrived and was discarded on our own side.
 *
 * These tests exercise the real `track()` against a mocked Supabase insert, so
 * they cover the wiring (does track actually merge them) and not just the
 * helper. The allowlist test is the load-bearing one: it is what stops a future
 * query parameter carrying something private into an analytics table.
 */

const inserted: Record<string, unknown>[][] = [];

// analytics persists with a plain fetch (Q162); capture the POSTed rows.
vi.stubGlobal(
  "fetch",
  vi.fn(async (_url: string, init: { body: string }) => {
    inserted.push(JSON.parse(init.body) as Record<string, unknown>[]);
    return { ok: true, status: 201 } as Response;
  }),
);

/** Point the jsdom URL at a query string without reloading. */
function setSearch(search: string) {
  window.history.replaceState({}, "", `/signup${search}`);
}

/** Import fresh so the module-level queue never leaks between tests. */
async function freshTrack() {
  vi.resetModules();
  const mod = await import("./analytics");
  return mod;
}

/** track() debounces ~1.5s before flushing; run the timers and drain. */
async function flushed(): Promise<Record<string, unknown>> {
  await vi.advanceTimersByTimeAsync(2000);
  await Promise.resolve();
  const rows = inserted.flat();
  expect(rows.length, "expected exactly one queued event").toBe(1);
  return rows[0];
}

beforeEach(() => {
  inserted.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setSearch("");
});

describe("track() campaign capture", () => {
  it("copies utm parameters off the URL onto the event", async () => {
    setSearch("?utm_source=facebook&utm_medium=social&utm_campaign=launch-awareness-2026-09&utm_content=fb-3");
    const { track, AhaEvent } = await freshTrack();
    track(AhaEvent.SignupStarted);
    const props = (await flushed()).properties as Record<string, string>;
    expect(props.utm_source).toBe("facebook");
    expect(props.utm_medium).toBe("social");
    expect(props.utm_campaign).toBe("launch-awareness-2026-09");
    expect(props.utm_content).toBe("fb-3");
  });

  it("captures click ids, which is how paid traffic is identified", async () => {
    setSearch("?fbclid=abc123&gclid=xyz789");
    const { track, AhaEvent } = await freshTrack();
    track(AhaEvent.SignupStarted);
    const props = (await flushed()).properties as Record<string, string>;
    expect(props.fbclid).toBe("abc123");
    expect(props.gclid).toBe("xyz789");
  });

  it("copies ONLY allowlisted parameters — this is the security-relevant one", async () => {
    // A parameter nobody anticipated must not reach the analytics table just by
    // existing in a URL. An allowlist means a future `?token=` is ignored by
    // default rather than logged and discovered later.
    setSearch("?utm_source=facebook&token=super-secret&email=a@b.com&job=9f3&access_token=nope");
    const { track, AhaEvent } = await freshTrack();
    track(AhaEvent.SignupStarted);
    const props = (await flushed()).properties as Record<string, string>;
    expect(props.utm_source).toBe("facebook");
    expect(Object.keys(props).sort()).toEqual(["utm_source"]);
    expect(JSON.stringify(props)).not.toContain("super-secret");
    expect(JSON.stringify(props)).not.toContain("a@b.com");
  });

  it("adds nothing when the URL carries no campaign parameters", async () => {
    setSearch("");
    const { track, AhaEvent } = await freshTrack();
    track(AhaEvent.SignupStarted, { step: 2 });
    const props = (await flushed()).properties as Record<string, unknown>;
    expect(props).toEqual({ step: 2 });
  });

  it("lets an explicit prop win over one scraped from the URL", async () => {
    setSearch("?utm_campaign=from-url");
    const { track, AhaEvent } = await freshTrack();
    track(AhaEvent.SignupStarted, { utm_campaign: "from-caller" });
    const props = (await flushed()).properties as Record<string, string>;
    expect(props.utm_campaign).toBe("from-caller");
  });

  it("truncates an absurdly long value rather than storing it whole", async () => {
    setSearch(`?utm_campaign=${"x".repeat(5000)}`);
    const { track, AhaEvent } = await freshTrack();
    track(AhaEvent.SignupStarted);
    const props = (await flushed()).properties as Record<string, string>;
    expect(props.utm_campaign.length).toBe(200);
  });

  it("still records the pathname, and still does not record the query string", async () => {
    // `url` deliberately stays pathname-only. Attribution rides in `properties`,
    // where it is allowlisted, rather than in a raw captured URL.
    setSearch("?utm_source=facebook&token=secret");
    const { track, AhaEvent } = await freshTrack();
    track(AhaEvent.SignupStarted);
    const row = await flushed();
    expect(row.url).toBe("/signup");
    expect(String(row.url)).not.toContain("token");
  });
});

/* BLIND SPOTS. The Supabase insert is mocked, so this proves what track()
 * SENDS, never what the `analytics_events` row ends up holding — column
 * truncation, RLS on insert and the server's own handling of `properties` are
 * outside it. It also only ever sees `window.location.search`: a campaign tag
 * that arrived in the hash, or one the router rewrote before track() ran, is
 * not exercised. */

// THE SECURITY-RELEVANT LINE. An allowlist is the only reason a future
// `?token=` is dropped by default; reading whatever the URL happens to carry
// is how a secret reaches an analytics table.
// @mutate src/lib/analytics.ts | for (const key of CAMPAIGN_PARAMS) { | for (const key of q.keys()) {
// The bound on a hostile link's value.
// @mutate src/lib/analytics.ts | if (v) out[key] = v.slice(0, 200); | if (v) out[key] = v;
