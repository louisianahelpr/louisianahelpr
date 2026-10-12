/**
 * Two mints of ONE account never interleave (scripts/lib/adminSession.mjs).
 *
 * GoTrue keeps one recovery token per user: a second `generate_link` for the
 * same address replaces the first one's token, and the first `/verify` answers
 * 403 otp_expired "Email link is invalid or has expired". e2e/auth.spec.ts's two
 * sign-in tests ran on Playwright's two CI workers at the same moment, and in
 * every nightly e2e-real-backend run from 2026-10-09 to 2026-10-11 one of them
 * lost its token, was retried, and the job's request budget failed
 * "signIns 5 is over its budget 4" (runs 37918720667, 38066858570,
 * 38157783259 attempts 1 and 2).
 *
 * The fake GoTrue below keeps exactly that one-token-per-user state, with the
 * server-side effect landing after a network delay as it does on the wire. Two
 * concurrent mints of one account must both succeed, each with ONE verify.
 *
 * @mutate scripts/lib/adminSession.mjs |     const r = await withMintLock(email, once, { dir: lockDir, staleMs: 2 * timeoutMs + 10_000, waitMs: 4 * timeoutMs + 30_000 }); |     const r = await once();
 * The released-locks check is only as good as its floor: locks taken anywhere
 * but lockDir must turn it red too.
 * @mutate scripts/lib/adminSession.mjs | withMintLock(email, once, { dir: lockDir, | withMintLock(email, once, { dir: undefined,
 * A mint on ANOTHER runner (no shared lock file, Q1651) can still take the
 * token; that 403 otp_expired is re-minted once.
 * @mutate scripts/lib/adminSession.mjs | !(RETRYABLE(r.status) \|\| r.expired) | !RETRYABLE(r.status)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintAdminSession, withMintLock } from "../../scripts/lib/adminSession.mjs";

const EMAIL = "lock-test@example.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One recovery token per user, as GoTrue keeps it. */
function fakeGoTrue({ generateMs = 10, verifyMs = 30 } = {}) {
  const current = new Map<string, string>();
  let n = 0;
  const calls = { generate: 0, verify: 0, expired: 0 };
  const fetchImpl = async (url: string, init: { body?: string }) => {
    const body = JSON.parse(init.body ?? "{}");
    const json = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status });
    if (url.endsWith("/auth/v1/admin/generate_link")) {
      calls.generate++;
      await sleep(generateMs);
      const hash = `h${++n}`;
      current.set(body.email, hash);
      return json(200, { hashed_token: hash });
    }
    if (url.endsWith("/auth/v1/verify")) {
      calls.verify++;
      await sleep(verifyMs);
      const email = [...current.entries()].find(([, h]) => h === body.token_hash)?.[0];
      if (!email) {
        calls.expired++;
        return json(403, { code: 403, error_code: "otp_expired", msg: "Email link is invalid or has expired" });
      }
      current.delete(email);
      return json(200, { access_token: `a-${body.token_hash}`, refresh_token: "r", user: { id: "u1", email } });
    }
    return json(404, {});
  };
  return { fetchImpl, calls };
}

let lockDir: string;
beforeEach(() => {
  lockDir = mkdtempSync(join(tmpdir(), "lh-mint-lock-"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(lockDir, { recursive: true, force: true });
});

describe("mintAdminSession: one mint per account at a time", () => {
  it("the fake reproduces the race when two mints interleave (the guard can fail)", async () => {
    const { fetchImpl, calls } = fakeGoTrue();
    vi.stubGlobal("fetch", fetchImpl);
    // Two unlocked generate -> verify pairs, overlapped as the two CI workers did.
    const pair = async () => {
      const g = await fetch("https://x.supabase.co/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ email: EMAIL }) });
      const { hashed_token } = await g.json();
      return (await fetch("https://x.supabase.co/auth/v1/verify", { method: "POST", body: JSON.stringify({ token_hash: hashed_token }) })).status;
    };
    expect((await Promise.all([pair(), pair()])).sort()).toEqual([200, 403]);
    expect(calls.expired).toBe(1);
  });

  it("two concurrent mints of one account both sign in, one verify each", async () => {
    const { fetchImpl, calls } = fakeGoTrue();
    // The lock files this test expects released must be the ones the mints
    // took: read lockDir at every generate_link, while that mint holds it.
    const heldAtGenerate: number[] = [];
    vi.stubGlobal("fetch", (url: string, init: { body?: string }) => {
      if (url.endsWith("/auth/v1/admin/generate_link")) heldAtGenerate.push(readdirSync(lockDir).length);
      return fetchImpl(url, init);
    });
    const mint = () => mintAdminSession({ email: EMAIL, serviceKey: "service", supabaseUrl: "https://x.supabase.co", lockDir });
    const results = await Promise.allSettled([mint(), mint(), mint()]);
    expect(results.map((r) => (r.status === "rejected" ? String(r.reason) : "ok"))).toEqual(["ok", "ok", "ok"]);
    expect(calls).toEqual({ generate: 3, verify: 3, expired: 0 });
    // Floor: each of the three mints held exactly one lock file in lockDir,
    // so the empty directory below is locks released, not locks kept elsewhere.
    expect(heldAtGenerate).toHaveLength(3);
    expect(heldAtGenerate.every((n) => n === 1)).toBe(true);
    expect(readdirSync(lockDir)).toEqual([]); // every lock released
  });

  it("a lock left by a dead process is taken over once stale", async () => {
    let ran = false;
    // Learn the lock file's name by holding the lock once.
    let lockName = "";
    await withMintLock(EMAIL, async () => {
      lockName = readdirSync(lockDir)[0] ?? "";
    }, { dir: lockDir });
    expect(lockName).toMatch(/^[0-9a-f]{24}\.lock$/);
    expect(readdirSync(lockDir)).toEqual([]);
    // Plant it as a process that died mid-mint a minute ago would have left it.
    writeFileSync(join(lockDir, lockName), "999999 dead\n");
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(lockDir, lockName), old, old);
    await withMintLock(EMAIL, async () => {
      ran = true;
    }, { dir: lockDir, staleMs: 1_000, waitMs: 2_000 });
    expect(ran).toBe(true);
    expect(readdirSync(lockDir)).toEqual([]);
  });

  it("a live lock is waited on, not broken", async () => {
    const order: string[] = [];
    const a = withMintLock(EMAIL, async () => {
      order.push("a-start");
      await sleep(60);
      order.push("a-end");
    }, { dir: lockDir });
    await sleep(5);
    const b = withMintLock(EMAIL, async () => {
      order.push("b");
    }, { dir: lockDir });
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b"]);
  });

  it("different accounts do not wait on each other", async () => {
    const order: string[] = [];
    const a = withMintLock("one@example.com", async () => {
      await sleep(60);
      order.push("one");
    }, { dir: lockDir });
    await sleep(5);
    const b = withMintLock("two@example.com", async () => {
      order.push("two");
    }, { dir: lockDir });
    await Promise.all([a, b]);
    expect(order).toEqual(["two", "one"]);
  });

  it("a token lost to another runner is re-minted once (Q1651)", async () => {
    const { fetchImpl, calls } = fakeGoTrue();
    // The other runner's generate_link lands while this mint waits on /verify:
    // no lock file is shared, so only the token state on the server races.
    let raced = false;
    vi.stubGlobal("fetch", async (url: string, init: { body?: string }) => {
      if (url.endsWith("/auth/v1/verify") && !raced) {
        raced = true;
        await fetchImpl("https://x.supabase.co/auth/v1/admin/generate_link", { body: JSON.stringify({ email: EMAIL }) });
      }
      return fetchImpl(url, init);
    });
    const session = await mintAdminSession({ email: EMAIL, serviceKey: "service", supabaseUrl: "https://x.supabase.co", lockDir, retryDelayMs: 1 });
    expect(session.access_token).toMatch(/^a-h/);
    // ours + the other runner's + our re-mint; the first verify lost, the second won.
    expect(calls).toEqual({ generate: 3, verify: 2, expired: 1 });
  });

  it("a 403 that is not otp_expired is not retried", async () => {
    let verifies = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/auth/v1/admin/generate_link")) return new Response(JSON.stringify({ hashed_token: "h" }), { status: 200 });
      verifies++;
      return new Response(JSON.stringify({ error_code: "forbidden" }), { status: 403 });
    });
    await expect(mintAdminSession({ email: EMAIL, serviceKey: "service", supabaseUrl: "https://x.supabase.co", lockDir, retryDelayMs: 1 })).rejects.toThrow(/HTTP 403/);
    expect(verifies).toBe(1);
  });
});
