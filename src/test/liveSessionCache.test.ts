import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLiveCache, writeCache } from "../../e2e/liveSession";

// Gap closed 2026-09-12: a cached session whose GoTrue session was revoked
// still carried an unexpired JWT, so the harness reused it and signed-in specs
// quietly tested the logged-out screen. The cache must ask GoTrue, not the clock.
const fresh = () => ({ access_token: "garbage.revoked.jwt", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u" } });
const dir = () => mkdtempSync(join(tmpdir(), "lh-live-session-"));

describe("readLiveCache", () => {
  it("refuses an unexpired but revoked session and deletes the file so the caller re-mints", async () => {
    const file = join(dir(), "poster.json");
    writeCache(file, fresh());
    const got = await readLiveCache(file, { minFreshMs: 20 * 60_000, isAlive: async () => false });
    expect(got).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it("reuses a session GoTrue still accepts", async () => {
    const file = join(dir(), "poster.json");
    writeCache(file, fresh());
    expect(await readLiveCache(file, { minFreshMs: 20 * 60_000, isAlive: async () => true })).not.toBeNull();
  });

  it("treats a liveness check that throws (network) as dead", async () => {
    const file = join(dir(), "poster.json");
    writeCache(file, fresh());
    const got = await readLiveCache(file, {
      minFreshMs: 0,
      isAlive: async () => {
        throw new Error("offline");
      },
    });
    expect(got).toBeNull();
  });

  it("does not ask GoTrue about a near-expiry or corrupt cache: it is simply a miss", async () => {
    const d = dir();
    const near = join(d, "a.json");
    writeCache(near, { ...fresh(), expires_at: Math.floor(Date.now() / 1000) + 60 });
    const corrupt = join(d, "b.json");
    writeFileSync(corrupt, "{not json");
    let asked = 0;
    const isAlive = async () => {
      asked++;
      return true;
    };
    expect(await readLiveCache(near, { minFreshMs: 20 * 60_000, isAlive })).toBeNull();
    expect(await readLiveCache(corrupt, { minFreshMs: 0, isAlive })).toBeNull();
    expect(asked).toBe(0);
  });
});
