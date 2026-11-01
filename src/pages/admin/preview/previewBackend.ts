/**
 * The admin job-page preview's backend: while the preview is open, every request the page makes to Supabase is
 * answered HERE, from the stage's sample (jobPreviewSamples.ts), and never reaches the network.
 *
 * It sits under supabase-js at the fetch layer (the client's own fetch calls the global `fetch` at call time,
 * src/lib/signOutAbort.ts), so the job page's real code runs unchanged: its reads get the sample, and every write,
 * RPC and edge-function call is answered "done" without being sent. Only two kinds of request still go out:
 *  - sign-in traffic (/auth/v1/), so the admin stays signed in;
 *  - a READ of the admin's OWN profile or role row (profiles / user_roles filtered by their id), so the app chrome
 *    and the admin gate keep their real answer. Never a write, never an RPC, never a job.
 * Guard: src/test/adminJobPreviewIsInert.test.tsx.
 */
import type { PreviewSample } from "./jobPreviewSamples";

export interface PreviewRequestLog {
  method: string;
  path: string;
  /** "sample" (answered from the sample), "blocked" (a write or action, answered without sending), "passed" (sent). */
  outcome: "sample" | "blocked" | "passed";
}

export interface PreviewBackendOptions {
  supabaseUrl: string;
  /** The current stage's sample; read on every request, so switching stage needs no reinstall. */
  sample: () => PreviewSample;
  /** The admin's own user id: only their own profile/role reads pass through. */
  ownUserId: () => string | null;
  realFetch: typeof fetch;
  /** A write or action the page tried; the caller says "Preview: this would …". */
  onBlocked: (what: string) => void;
}

/** RPCs that only read. Everything else is treated as an action and never sent. */
const READ_RPC = /^(get_|list_|fetch_|can_|is_|has_|count_|check_|search_)|_candidates$|_state$|_stats$/;
const SCALAR_RPC = /^(can_|is_|has_|check_)/;
const OWN_ROW_TABLES = new Set(["profiles", "user_roles"]);

function json(body: unknown, status = 200, count?: number): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (count !== undefined) headers["content-range"] = count === 0 ? "*/0" : `0-${count - 1}/${count}`;
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers });
}

function requestParts(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string; accept: string } {
  const req = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const url = req ? req.url : input instanceof URL ? input.href : String(input);
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  const h = new Headers(init?.headers ?? req?.headers ?? undefined);
  return { url, method, accept: h.get("accept") ?? "" };
}

function bodyJson(init?: RequestInit): Record<string, unknown> {
  try {
    return typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  } catch {
    // Not JSON (a file upload): nothing to read, and it is never sent anyway.
    return {};
  }
}

/** "eq.<value>" filter on one column of a PostgREST URL, or null. */
function eqFilter(url: URL, column: string): string | null {
  const v = url.searchParams.get(column);
  return v?.startsWith("eq.") ? decodeURIComponent(v.slice(3)) : null;
}

function tableRows(table: string, url: URL, s: PreviewSample): unknown[] {
  const job = { ...s.job };
  switch (table) {
    case "jobs":
      return s.party ? [job] : [];
    case "open_jobs_browse":
      return job.status === "open" && !job.direct_offer_status ? [job] : [];
    case "applications": {
      const who = eqFilter(url, "helper_id");
      return s.applications.filter((a) => !who || a.helper_id === who).map((a) => ({ ...a, job_id: s.jobId }));
    }
    case "job_tracking":
      return s.trackingStatus ? [{ status: s.trackingStatus, job_id: s.jobId }] : [];
    case "group_job_helpers": {
      const who = eqFilter(url, "helper_id");
      return s.crew.filter((h) => !who || h === who).map((h, i) => ({ id: `00000000-0000-4000-c000-${String(i + 1).padStart(12, "0")}`, helper_id: h, job_id: s.jobId }));
    }
    default:
      return [];
  }
}

function rpcAnswer(name: string, body: Record<string, unknown>, s: PreviewSample): unknown {
  switch (name) {
    case "get_safe_profiles": {
      const ids = Array.isArray(body.user_ids) ? (body.user_ids as string[]) : [];
      return s.profiles.filter((p) => ids.includes(p.id));
    }
    case "get_my_pending_direct_offers":
      return s.pendingOffer ? [s.pendingOffer] : [];
    case "get_job_offer_targets":
      return s.offeredTo ? [{ job_id: s.jobId, offered_to_helper_id: s.offeredTo }] : [];
    case "instant_book_candidates":
      return s.viewer === "poster" ? s.candidates : [];
    case "get_jobs_for_my_applications":
      return !s.party && s.applications.some((a) => a.helper_id === s.userId) ? [{ ...s.job }] : [];
    default:
      return SCALAR_RPC.test(name) ? null : [];
  }
}

const VERB: Record<string, string> = { POST: "save", PATCH: "update", PUT: "save", DELETE: "delete" };

/** A fetch that answers Supabase from the sample. `log` records every Supabase request it saw. */
export function createPreviewFetch(o: PreviewBackendOptions): { fetch: typeof fetch; log: PreviewRequestLog[] } {
  const base = o.supabaseUrl.replace(/\/+$/, "");
  const log: PreviewRequestLog[] = [];
  const previewFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, method, accept } = requestParts(input, init);
    if (!base || !url.startsWith(base)) return o.realFetch(input, init);
    const u = new URL(url);
    const path = u.pathname;
    const note = (outcome: PreviewRequestLog["outcome"]) => log.push({ method, path, outcome });
    const s = o.sample();

    if (path.startsWith("/auth/v1/")) {
      note("passed");
      return o.realFetch(input, init);
    }
    const rpc = path.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
    if (rpc) {
      const name = decodeURIComponent(rpc[1]);
      if (READ_RPC.test(name)) {
        note("sample");
        const out = rpcAnswer(name, bodyJson(init), s);
        return json(out, 200, Array.isArray(out) ? out.length : undefined);
      }
      note("blocked");
      o.onBlocked(name.replace(/^rpc_/, "").replace(/_/g, " "));
      return json(null);
    }
    const table = path.match(/^\/rest\/v1\/([^/]+)$/)?.[1];
    if (table && (method === "GET" || method === "HEAD")) {
      const own = o.ownUserId();
      if (OWN_ROW_TABLES.has(table) && own && Object.values(Object.fromEntries(u.searchParams)).some((v) => v === `eq.${own}`)) {
        note("passed");
        return o.realFetch(input, init);
      }
      note("sample");
      const rows = tableRows(table, u, s);
      if (method === "HEAD") return json(undefined, 200, rows.length);
      if (accept.includes("vnd.pgrst.object+json")) {
        return rows.length === 1
          ? json(rows[0])
          : json({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null }, 406);
      }
      return json(rows, 200, rows.length);
    }
    if (!table && (method === "GET" || method === "HEAD")) {
      // A storage or function read: nothing in the sample, and nothing sent.
      note("sample");
      return json(null, 404);
    }
    note("blocked");
    if (table) {
      o.onBlocked(`${VERB[method] ?? "change"} ${table.replace(/_/g, " ")}`);
      // An echo row, so a write that asks for its row back (.select("id")) reads as done, not as a failed save.
      const body = bodyJson(init);
      const row = { id: s.jobId, ...(Array.isArray(body) ? {} : body) };
      return accept.includes("vnd.pgrst.object+json") ? json(row) : json([row], 200, 1);
    }
    const fn = path.match(/^\/functions\/v1\/([^/]+)/)?.[1];
    o.onBlocked(fn ? fn.replace(/-/g, " ") : "send a request");
    return json({});
  }) as typeof fetch;
  return { fetch: previewFetch, log };
}

/** Puts the preview fetch in place of the window's own; returns the undo. */
export function installPreviewFetch(o: Omit<PreviewBackendOptions, "realFetch">): { uninstall: () => void; log: PreviewRequestLog[] } {
  const realFetch = globalThis.fetch;
  const { fetch: previewFetch, log } = createPreviewFetch({ ...o, realFetch: realFetch.bind(globalThis) });
  globalThis.fetch = previewFetch;
  return {
    log,
    uninstall: () => {
      if (globalThis.fetch === previewFetch) globalThis.fetch = realFetch;
    },
  };
}
