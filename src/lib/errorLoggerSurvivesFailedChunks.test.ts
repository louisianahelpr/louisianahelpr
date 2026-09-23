/**
 * Q161 — error reporting must survive a failed lazy chunk.
 *
 * A browser caches a failed dynamic import() for the life of the document. The
 * logger used to persist through the lazily imported supabase client, so ONE
 * transient failure of that chunk dropped every later report() in the session,
 * and the reports that would have explained the failure were the ones lost.
 * posthog / sentry / analytics failures were dropped by bare catches with no
 * trace at all.
 *
 * Contract:
 *   1. report() persists via a plain fetch POST to /rest/v1/error_logs, even
 *      when the supabase-client import rejects;
 *   2. a failed background import (here posthog) leaves exactly ONE
 *      "background import failed: posthog" row per session, however many
 *      times it fails;
 *   3. a non-2xx answer is counted, never reported (no recursion).
 * And, across the codebase: every backgroundImport() call names its module, so
 * that row can say which chunk went dark.
 */
// @mutate src/lib/errorLogger.ts | await postErrorLogs(batch); | await (await backgroundImport(() => import("@/integrations/supabase/client"), "supabase-client")).supabase.from("error_logs").insert(batch);
// @mutate src/lib/errorLogger.ts | if (!claimBackgroundFailureReport(name)) return; | claimBackgroundFailureReport(name);
// @mutate src/lib/errorLogger.ts | onBackgroundImportFailure(noteBackgroundImportFailure); | void noteBackgroundImportFailure;
// @mutate src/lib/chunkReload.ts | backgroundImportFailureListener?.(name, err); | void name;
// @mutate src/lib/errorLogger.ts | else persistStats.failed += batch.length; | else void 0;
// @mutate src/lib/analytics.ts | await backgroundImport(() => import("@/lib/posthog"), "posthog"); | await backgroundImport(() => import("@/lib/posthog"));
// @mutate src/lib/analytics.ts |     asUser ? batch : batch.map((r) => ({ ...r, user_id: null })), |     batch,
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const fetchSpy = vi.hoisted(() =>
  vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 })),
);
vi.stubGlobal("fetch", fetchSpy);

// The chunks that went dark. A throwing factory makes the dynamic import
// reject, exactly as a failed chunk fetch does in the browser.
vi.mock("@/integrations/supabase/client", () => {
  throw new Error("Failed to fetch dynamically imported module: /assets/client-x.js");
});
vi.mock("@/lib/posthog", () => {
  throw new Error("Failed to fetch dynamically imported module: /assets/posthog-x.js");
});
vi.mock("@/lib/sentry", () => ({ captureException: vi.fn() }));

import { report, _persistStats, _resetBackgroundFailureReportsForTests } from "./errorLogger";
import { track } from "./analytics";
import { __resetChunkReloadForTests } from "./chunkReload";

type SentRow = { message: string; user_id: unknown; tags: Record<string, unknown> };
const sentRows = (): SentRow[] =>
  fetchSpy.mock.calls.flatMap((c) => JSON.parse(String(c[1].body)) as SentRow[]);
const rowsWithMessage = (m: string) => sentRows().filter((r) => r.message === m);

const atProd = () =>
  Object.defineProperty(window, "location", {
    value: new URL("https://www.louisianahelpr.com/dashboard"),
    writable: true,
  });

beforeEach(() => {
  atProd();
  fetchSpy.mockClear();
  fetchSpy.mockImplementation(async () => new Response(null, { status: 201 }));
  __resetChunkReloadForTests();
  _resetBackgroundFailureReportsForTests();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("report() does not depend on a lazy chunk (Q161)", () => {
  it("persists a row via fetch while the supabase-client import rejects", async () => {
    await expect(import("@/integrations/supabase/client")).rejects.toThrow();

    report(new Error("q161 persisted without supabase-js"), { severity: "warning" });

    await vi.waitFor(() => expect(rowsWithMessage("q161 persisted without supabase-js")).toHaveLength(1), {
      timeout: 3000,
    });
    const call = fetchSpy.mock.calls.find((c) => String(c[1].body).includes("q161 persisted"))!;
    const [url, init] = call;
    // Mirrors what supabase.from("error_logs").insert(batch) sent.
    expect(url).toMatch(/^https:\/\/fncmgoasalhdgfwzhsqa\.supabase\.co\/rest\/v1\/error_logs\?columns=/);
    expect(decodeURIComponent(url.split("columns=")[1])).toBe(
      '"user_id","severity","message","stack","url","user_agent","tags","context"',
    );
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    expect(headers.apikey).toBe(key);
    // Signed out: the key is the bearer, as supabase-js does with no session.
    expect(headers.Authorization).toBe(`Bearer ${key}`);
    expect(headers["Content-Profile"]).toBe("public");
    // The server stamps user_id (Q106/Q110); the client never sends one.
    expect(rowsWithMessage("q161 persisted without supabase-js")[0].user_id).toBeNull();
  });

  it("sends the signed-in user's unexpired access token, and retries once as anon on a 401", async () => {
    localStorage.setItem(
      "sb-fncmgoasalhdgfwzhsqa-auth-token",
      JSON.stringify({ access_token: "user-access-token", expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    );
    fetchSpy.mockImplementationOnce(async () => new Response(null, { status: 401 }));

    report(new Error("q161 token row"));

    const ours = () => fetchSpy.mock.calls.filter((c) => String(c[1].body).includes("q161 token row"));
    await vi.waitFor(() => expect(ours()).toHaveLength(2), { timeout: 3000 });
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const auth = ours().map((c) => (c[1].headers as Record<string, string>).Authorization);
    expect(auth).toEqual(["Bearer user-access-token", `Bearer ${key}`]);
  });

  it("counts a non-2xx answer and never reports it (no recursion)", async () => {
    const before = _persistStats();
    fetchSpy.mockImplementation(async () => new Response("{}", { status: 500 }));

    report(new Error("q161 refused row"));

    await vi.waitFor(() => expect(_persistStats().failed).toBeGreaterThan(before.failed), { timeout: 3000 });
    // Give any recursive report a debounce window to show itself.
    await new Promise((r) => setTimeout(r, 400));
    const bodies = fetchSpy.mock.calls.map((c) => String(c[1].body));
    expect(bodies.filter((b) => b.includes("q161 refused row"))).toHaveLength(1);
    expect(bodies.join("\n")).not.toMatch(/error_logs|status=500/);
    expect(_persistStats().lastStatus).toBe(500);
  });
});

describe("a failed background import is visible, once per session (Q161)", () => {
  it("emits exactly one 'background import failed: posthog' row, however many times posthog fails", async () => {
    // Three independent callers that each load posthog: report()'s fan-out
    // (twice) and analytics track().
    report(new Error("q161 first"));
    report(new Error("q161 second"));
    track("q161_event", {});

    await vi.waitFor(() => expect(rowsWithMessage("q161 second")).toHaveLength(1), { timeout: 3000 });
    await vi.waitFor(() => expect(rowsWithMessage("background import failed: posthog")).toHaveLength(1), {
      timeout: 3000,
    });
    // Let every other failure land; still one.
    await new Promise((r) => setTimeout(r, 600));
    const rows = rowsWithMessage("background import failed: posthog");
    expect(rows).toHaveLength(1);
    expect(rows[0].tags).toMatchObject({ source: "backgroundImport", module: "posthog" });
    // sentry loaded fine, so it has no row.
    expect(rowsWithMessage("background import failed: sentry")).toHaveLength(0);
  });

  it("an analytics batch persists by fetch while the supabase-client import is failing (Q162)", async () => {
    // A stored session that has EXPIRED: analytics resolves a user_id from it,
    // but the request goes out as anon, so user_id must be dropped or RLS
    // (user_id null or auth.uid()) refuses the whole batch.
    localStorage.setItem(
      "sb-fncmgoasalhdgfwzhsqa-auth-token",
      JSON.stringify({ access_token: "expired.jwt.token", expires_at: 1, user: { id: "00000000-0000-0000-0000-0000000000aa" } }),
    );
    vi.useFakeTimers();
    track("q162_flush_event", {});
    // analytics flush is debounced 1.5s.
    await vi.advanceTimersByTimeAsync(2_000);
    vi.useRealTimers();
    await vi.waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes("/rest/v1/analytics_events?columns="));
      expect(call, "analytics_events POST").toBeTruthy();
      const rows = JSON.parse(String(call![1].body)) as Array<{ event: string; user_id: unknown }>;
      expect(rows.map((r) => r.event)).toContain("q162_flush_event");
      // Sent without a session: user_id must be null or RLS refuses the batch.
      expect(rows.every((r) => r.user_id === null)).toBe(true);
    }, { timeout: 3000 });
  });
});

/** Every non-test source file under src/. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !p.includes(`${join("src", "test")}`))
      out.push(p);
  }
  return out;
}

describe("every backgroundImport() call names its module (Q161)", () => {
  it("passes a name, so the once-per-session row says which chunk went dark", () => {
    const root = resolve(__dirname, "..");
    const calls: { file: string; named: boolean; text: string }[] = [];
    for (const file of sourceFiles(root)) {
      if (file.endsWith(join("lib", "chunkReload.ts"))) continue; // the definition
      const code = blankComments(readFileSync(file, "utf8"));
      const re = /backgroundImport\(\s*\(\)\s*=>\s*import\([^)]*\)\s*(,\s*"[a-z-]+"\s*)?\)/g;
      for (const m of code.matchAll(re)) calls.push({ file, named: !!m[1], text: m[0] });
      // A call the pattern above did not recognise must still be counted.
      const all = code.match(/backgroundImport\(/g)?.length ?? 0;
      const seen = [...code.matchAll(re)].length;
      if (all !== seen) calls.push({ file, named: false, text: `${all - seen} unrecognised backgroundImport( call(s)` });
    }
    // Inventory floor: errorLogger (sentry, posthog), analytics (posthog),
    // useLoginTracking (posthog) on 2026-09-23 (analytics' supabase-client
    // import went away with Q162's fetch path).
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.filter((c) => !c.named).map((c) => `${c.file}: ${c.text}`)).toEqual([]);
  });
});
