/**
 * A REFUSED READ IS SENT ONCE (Q1164).
 *
 * The shared client policy (src/lib/queryClient.ts) has always meant "retry a
 * failing server once, never a 4xx". For Supabase reads the 4xx half never
 * worked: postgrest-js keeps the HTTP status on the response, so both shapes the
 * app throws into React Query (unwrap()'s Error copy, and a bare `throw error`
 * of the plain PostgREST object) reached the policy without one, and every
 * refused read went out twice. Measured on e2e-real-backend 37132155495
 * (nightly-red #2200): replaying eight of its page loads, 20 of 22 duplicate
 * GETs were a 401 PGRST301 from prod and its retry 0.6-1.0 s later, React
 * Query's retry timer in the stack.
 *
 * So this drives the REAL client stack: supabase-js with a fetch that answers
 * with PostgREST's own bodies (the 401 below is byte-for-byte what prod
 * returned), and asks the policy the queryClient actually uses, in both thrown
 * shapes. Then, from the source inventory, every `retry:` a query sets in src/
 * must be off or compose shouldRetryQuery, so no query re-opens the class.
 *
 * @mutate src/lib/queryRetry.ts | return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429; | return false;
 * @mutate src/lib/supabaseResult.ts |       thrown.status = result.status; |       void result.status;
 * @mutate src/hooks/useDashboardData.ts |         : shouldRetryQuery(failureCount, error, 2), |         : failureCount < 2,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { queryClient } from "@/lib/queryClient";
import { unwrap } from "@/lib/supabaseResult";
import { shouldRetryQuery } from "@/lib/queryRetry";
import { blankNonCode } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

type Answer = { status: number; body: string } | "network-down";

/** A supabase-js client whose every request gets `answer`. */
function clientAnswering(answer: Answer) {
  const fetchStub = async () => {
    if (answer === "network-down") throw new TypeError("Failed to fetch");
    return new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return createClient("https://example.supabase.co", "anon-key", {
    global: { fetch: fetchStub as typeof fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const pg = (code: string, message: string, details: string | null = null) => JSON.stringify({ code, details, hint: null, message });

/** Refused reads: PostgREST's 4xx answers, each from a code family the app meets. */
const REFUSED: [string, number, string][] = [
  ["forged or malformed JWT (measured from prod, Q1164)", 401, '{"code":"PGRST301","details":null,"hint":null,"message":"Expected 3 parts in JWT; got 1"}'],
  ["expired JWT", 401, pg("PGRST303", "JWT expired")],
  ["privilege denied, anonymous", 401, pg("42501", "permission denied for table jobs")],
  ["privilege denied, signed in", 403, pg("42501", "permission denied for table jobs")],
  ["single row requested, none found", 406, pg("PGRST116", "JSON object requested, multiple (or no) rows returned", "The result contains 0 rows")],
  ["function not found", 404, pg("PGRST202", "Could not find the function public.nope without parameters in the schema cache")],
  ["table not found", 404, pg("PGRST205", "Could not find the table 'public.nope' in the schema cache")],
  ["unparseable filter", 400, pg("PGRST100", "\"failed to parse filter (eq)\" (line 1, column 4)")],
  ["bad uuid", 400, pg("22P02", "invalid input syntax for type uuid: \"x\"")],
  ["guard raised by an RPC", 400, pg("P0001", "not authorized for this job")],
  ["unique violation", 409, pg("23505", "duplicate key value violates unique constraint")],
];

/** Failures a second attempt can outlive: retried, once. */
const TRANSIENT: [string, Answer][] = [
  ["database unreachable", { status: 503, body: pg("PGRST001", "Database client error. Retrying the connection.") }],
  ["pool timeout", { status: 504, body: pg("PGRST003", "Timed out acquiring connection from connection pool.") }],
  ["statement timeout", { status: 500, body: pg("57014", "canceling statement due to statement timeout") }],
  ["internal error", { status: 500, body: pg("XX000", "internal error") }],
  ["gateway HTML", { status: 502, body: "<html><body>Bad Gateway</body></html>" }],
  // 4xx, but "not now" rather than "no": they keep their retry.
  ["rate limited (429)", { status: 429, body: '{"message":"Too many requests"}' }],
  ["request timeout (408)", { status: 408, body: '{"message":"Request Timeout"}' }],
  ["network down", "network-down"],
];

/** Both shapes a failed read reaches React Query in. */
async function thrownShapes(answer: Answer): Promise<[string, unknown][]> {
  const result = await clientAnswering(answer).from("jobs").select("id");
  expect(result.error, "the stub must produce a failed result").not.toBeNull();
  let viaUnwrap: unknown;
  try {
    unwrap(result);
  } catch (e) {
    viaUnwrap = e;
  }
  return [
    ["unwrap()", viaUnwrap],
    ["throw error", result.error],
  ];
}

const sharedRetry = queryClient.getDefaultOptions().queries?.retry;

describe("the shared read-retry policy (Q1164)", () => {
  it("is a function the client actually uses", () => {
    expect(typeof sharedRetry).toBe("function");
  });

  const retry = (n: number, e: unknown) => (sharedRetry as (n: number, e: unknown) => boolean)(n, e);

  for (const [what, status, body] of REFUSED) {
    it(`never retries a ${status}: ${what}`, async () => {
      for (const [shape, err] of await thrownShapes({ status, body })) {
        expect(retry(0, err), `${shape} of a ${status} was retried`).toBe(false);
        expect(shouldRetryQuery(0, err, 2), `${shape} of a ${status} was retried by a 2-retry query`).toBe(false);
      }
    });
  }

  it("never retries a 4xx without a PostgREST code once unwrap() has carried the status", async () => {
    // The API gateway's own refusal has no code to map; only the status says 401.
    const [[, err]] = await thrownShapes({ status: 401, body: '{"message":"Invalid API key"}' });
    expect(retry(0, err)).toBe(false);
  });

  for (const [what, answer] of TRANSIENT) {
    it(`retries once, then stops: ${what}`, async () => {
      for (const [shape, err] of await thrownShapes(answer)) {
        expect(retry(0, err), `${shape}: first failure`).toBe(true);
        expect(retry(1, err), `${shape}: second failure`).toBe(false);
        expect(shouldRetryQuery(1, err, 2), `${shape}: a 2-retry query keeps its second retry`).toBe(true);
      }
    });
  }
});

/** The expression after `retry:` up to the end of the property. */
function valueAt(src: string, start: number): string {
  let depth = 0;
  let i = start;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) break;
  }
  return src.slice(start, i).trim().replace(/\s+/g, " ");
}

/**
 * A rule passes when it never retries (`false` / `0`), or when its LAST
 * expression is the shared call and nothing beside it can answer "retry"
 * on its own: no `||`, no `true`, no bare failureCount comparison
 * (`shouldRetryQuery(n, e) || n < 3` would resend a refused read).
 */
const composesSharedPolicy = (v: string) =>
  /^(false|0)$/.test(v) ||
  (/\bshouldRetryQuery\s*\([^()]*\)$/.test(v) && !/\|\||\btrue\b|\bfailureCount\s*[<>]/.test(v));

describe("every query retry rule in src/ composes the shared policy (Q1164)", () => {
  const ROOT = resolve(__dirname, "../..");
  const rules = walkSource([join(ROOT, "src")])
    .map((f) => relative(ROOT, f))
    .filter((rel) => !/\.test\.tsx?$/.test(rel) && !rel.startsWith("src/test/") && !rel.endsWith(".d.ts"))
    .flatMap((rel) => {
      const raw = readFileSync(join(ROOT, rel), "utf8");
      // React Query options only: a `retry:` in some other library's options is not this policy.
      if (!/from\s+["']@tanstack\/react-query["']/.test(raw)) return [];
      const code = blankNonCode(raw);
      return [...code.matchAll(/\bretry\s*:/g)].map((m) => ({ rel, value: valueAt(code, m.index! + m[0].length) }));
    });

  it("finds the retry rules", () => {
    // queryClient's query + mutation defaults, the dashboard feed, two `retry: false`.
    expect(rules.length).toBeGreaterThan(3);
    expect(rules.map((r) => r.rel)).toEqual(expect.arrayContaining(["src/lib/queryClient.ts", "src/hooks/useDashboardData.ts"]));
  });

  it("tells a composed rule from one that can still resend a 4xx", () => {
    expect(composesSharedPolicy("(failureCount, error: unknown) => shouldRetryQuery(failureCount, error)")).toBe(true);
    expect(composesSharedPolicy("(n, e) => e.message === \" \" ? false : shouldRetryQuery(n, e, 2)")).toBe(true);
    expect(composesSharedPolicy("(n, e) => shouldRetryQuery(n, e) || n < 3")).toBe(false);
    expect(composesSharedPolicy("(n, e) => isTimeout(e) ? true : shouldRetryQuery(n, e)")).toBe(false);
    expect(composesSharedPolicy("(failureCount) => failureCount < 2")).toBe(false);
    expect(composesSharedPolicy("2")).toBe(false);
  });

  it("each is off, or ends in shouldRetryQuery with nothing beside it that retries", () => {
    const offenders = rules.filter((r) => !composesSharedPolicy(r.value)).map((r) => `${r.rel}: retry: ${r.value.slice(0, 120)}`);
    expect(offenders, "a query retry rule that can resend a refused (4xx) read").toEqual([]);
  });
});
