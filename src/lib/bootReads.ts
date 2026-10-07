/**
 * The app side of the signed-in first-screen replay (Q1171); the entry side is
 * src/boot/signedInBootReads.ts, which explains the measurement and the design.
 *
 * Supabase's fetch goes through `bootReadsFetch`. For a read-only REST request
 * (a GET, or a POST to an `rpc/get_*` function) it:
 *   1. TAKES the entry's replayed response for the identical request, once,
 *      when the token is the one the entry used and the replay is fresh;
 *   2. otherwise asks the network as before;
 *   3. and, during the first seconds of a signed-in cold load, while the
 *      visitor is still on the path the app booted on, RECORDS the request
 *      (method, path+query, body, Accept, Prefer; never a header with a
 *      token) so the next cold load of that path can replay it.
 * Everything else (auth, storage, functions, writes) passes straight through.
 */

/** Copies of the entry module's constants (src/test/signedInBootReads.test.ts pins them equal). */
const STORE_KEY = "lh_boot_reads_v1";
const WINDOW_KEY = "__lhBootReads";
const PATHS = ["/home", "/jobs", "/posts", "/messages", "/profile"];
const MAX_RECORDED = 12;
/** A replay older than this is not handed out: the request goes to the network. */
export const BOOT_READ_MAX_AGE_MS = 15_000;
/** Requests made this long after navigation start are not part of the first screen. */
export const BOOT_READ_RECORD_MS = 8_000;

export type BootRead = { m: "GET" | "POST"; u: string; b?: string; a?: string; p?: string };

export function bootReadKey(r: BootRead): string {
  return `${r.m} ${r.u}\n${r.b ?? ""}\n${r.a ?? ""}\n${r.p ?? ""}`;
}

const RPC_READ = /^\/rest\/v1\/rpc\/get_[a-z0-9_]+$/;

/** The replay/record description of a request, or null when it is not a read we handle. */
export function describeRead(origin: string, url: string, method: string, headers: Headers, body: unknown): BootRead | null {
  if (!url.startsWith(`${origin}/rest/v1/`)) return null;
  const u = url.slice(origin.length);
  const m = method.toUpperCase();
  if (m === "GET") {
    return { m: "GET", u, ...(headers.get("accept") ? { a: headers.get("accept")! } : {}), ...(headers.get("prefer") ? { p: headers.get("prefer")! } : {}) };
  }
  if (m === "POST" && RPC_READ.test(u) && (body === undefined || typeof body === "string")) {
    return { m: "POST", u, b: (body as string | undefined) ?? "{}", ...(headers.get("accept") ? { a: headers.get("accept")! } : {}), ...(headers.get("prefer") ? { p: headers.get("prefer")! } : {}) };
  }
  return null;
}

type Replay = { at: number; token: string; pending: Record<string, Promise<Response>> };

/** The entry's response for this read, ONCE, or null. */
export function takeBootRead(read: BootRead, authorization: string | null, now: number = Date.now()): Promise<Response> | null {
  const w = window as unknown as Record<string, Replay | undefined>;
  const replay = w[WINDOW_KEY];
  if (!replay || now - replay.at > BOOT_READ_MAX_AGE_MS || authorization !== `Bearer ${replay.token}`) return null;
  const k = bootReadKey(read);
  const p = replay.pending[k];
  if (!p) return null;
  delete replay.pending[k];
  return p;
}

/** Sign-out: the learned URLs name this user's rows; a signed-out device keeps none. */
export function clearBootReads(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* storage blocked: there was nothing stored */
  }
  try {
    delete (window as unknown as Record<string, unknown>)[WINDOW_KEY];
  } catch {
    /* no window (tests): nothing to drop */
  }
}

function normalizePath(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

function sessionUid(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
      const s = JSON.parse(localStorage.getItem(k) ?? "null") as { user?: { id?: unknown } } | null;
      return typeof s?.user?.id === "string" ? s.user.id : null;
    }
  } catch {
    /* storage blocked: nothing is learned, nothing breaks */
  }
  return null;
}

/** Wrap Supabase's fetch (see the header). `realFetch` is looked up on each call so tests can stub it. */
export function bootReadsFetch(supabaseUrl: string, realFetch: () => typeof fetch = () => globalThis.fetch.bind(globalThis)) {
  const origin = supabaseUrl.replace(/\/$/, "");
  const bootPath = typeof window === "undefined" ? "" : normalizePath(window.location.pathname);
  const learning = PATHS.includes(bootPath);
  const recorded: BootRead[] = [];
  const seen = new Set<string>();
  if (learning && typeof window !== "undefined") {
    // Save what the first screen asked for, once it has asked.
    window.setTimeout(() => {
      const uid = sessionUid();
      if (!uid || recorded.length === 0) return;
      try {
        const store = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, unknown>;
        store[bootPath] = { uid, at: Date.now(), reads: recorded };
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch {
        /* storage full or blocked: the next load simply does not replay */
      }
    }, BOOT_READ_RECORD_MS + 500);
  }
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const read = describeRead(origin, url, method, headers, init?.body);
    if (read) {
      const replayed = takeBootRead(read, headers.get("authorization"));
      if (replayed) {
        try {
          return await replayed;
        } catch {
          /* the replay failed in flight: ask the network below, as if it never existed */
        }
      }
      if (
        learning &&
        recorded.length < MAX_RECORDED &&
        typeof performance !== "undefined" && performance.now() < BOOT_READ_RECORD_MS &&
        normalizePath(window.location.pathname) === bootPath
      ) {
        const k = bootReadKey(read);
        if (!seen.has(k)) {
          seen.add(k);
          recorded.push(read);
        }
      }
    }
    return realFetch()(input, init);
  };
}
