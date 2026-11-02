/**
 * Q2585: the Declutter stage preview's backend. While /admin/preview/declutter is open, every request the page makes
 * to Supabase is answered HERE from the stage's sample (declutterPreviewSamples.ts) and never reaches the network.
 *
 * It sits under supabase-js at the fetch layer (the client calls the global `fetch` at call time, src/lib/signOutAbort.ts),
 * so the real Buying and Selling views run unchanged. DENY BY DEFAULT:
 *  - a READ RPC on the allowlist below or in the sample's `reads` gets the sample; every other RPC (each write, and
 *    any read not listed) is answered with null WITHOUT being sent (audit 1102c P1: [] drew made-up states), and a
 *    read not listed is reported to declutterPreviewChecks.onUnlisted, which the page tests turn into a failure;
 *  - a GET on a table gets the sample's rows for the tables below or in the sample's `tables`, an empty list for any
 *    other (reported the same way); nothing is sent;
 *  - every POST / PATCH / PUT / DELETE on a table, every edge function and every storage call is answered without
 *    being sent;
 *  - only two kinds of request still go out: sign-in traffic (/auth/v1/), so the admin stays signed in, and a READ of
 *    the admin's OWN profiles / user_roles row (filtered by their id), so the admin gate and the chrome keep their
 *    real answer.
 * Guard: src/test/adminDeclutterPreviewIsInert.test.ts.
 */
import type { DeclutterPreviewSample } from "./declutterPreviewSamples";
import { DECLUTTER_PREVIEW_READ_RPCS } from "./declutterPreviewReads";

/** Tests set this to fail on a read the sample does not answer (the page passes every one here). */
export const declutterPreviewChecks: { onUnlisted?: (what: string) => void } = {};

export interface DeclutterPreviewLog {
  method: string;
  path: string;
  /** "sample": answered from the sample; "blocked": not sent, answered empty; "passed": sent. */
  outcome: "sample" | "blocked" | "passed";
}

const OWN_ROW_TABLES = new Set(["profiles", "user_roles"]);

/** The read RPCs the Buying / Selling views make that the sample answers. Anything else is never sent. */
function readRpc(name: string, body: Record<string, unknown>, s: DeclutterPreviewSample): unknown[] | Record<string, unknown> | undefined {
  switch (name) {
    case "declutter_my_cart": return s.cart;
    case "declutter_my_offers": return s.offers;
    case "declutter_my_paid_cents": return s.paidCents;
    case "declutter_haul_away_state": return s.haulAway;
    case "declutter_my_donations": return s.donations;
    case "declutter_my_handover": {
      const id = typeof body.p_order_id === "string" ? body.p_order_id : "";
      return s.handovers[id] as unknown as Record<string, unknown> | undefined;
    }
    case "get_safe_profiles": {
      const ids = Array.isArray(body.user_ids) ? (body.user_ids as string[]) : [];
      return s.profiles.filter((p) => ids.includes(p.id));
    }
    default: return undefined;
  }
}

function tableRows(table: string, s: DeclutterPreviewSample): unknown[] | undefined {
  if (Object.prototype.hasOwnProperty.call(s.tables, table)) return s.tables[table];
  switch (table) {
    case "declutter_items": return s.items;
    case "declutter_bookings": return s.bookings;
    case "declutter_problems": return s.problems;
    default: return undefined;
  }
}

function json(body: unknown, status = 200, count?: number): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (count !== undefined) headers["content-range"] = count === 0 ? "*/0" : `0-${count - 1}/${count}`;
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers });
}

function parts(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string; accept: string } {
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

export interface DeclutterPreviewFetchOptions {
  supabaseUrl: string;
  /** The current sample; read on every request, so switching stage needs no reinstall. */
  sample: () => DeclutterPreviewSample;
  /** The admin's own id: only their own profile / role reads pass through. */
  ownUserId: () => string | null;
  realFetch: typeof fetch;
  /**
   * A request answered without being sent. "write": a write or action the page tried ("Preview: this would ...");
   * "read": a read RPC the sample does not answer ("Preview: not loaded (<name>)", audit 1102c P7).
   */
  onBlocked: (what: string, kind: "write" | "read") => void;
  /** A read RPC or table the sample does not answer (Q2585 audit 1102c P1). Tests make it throw; the page notes it. */
  onUnlisted?: (what: string) => void;
}

/** A fetch that answers Supabase from the sample. `log` records every Supabase request it saw. */
export function createDeclutterPreviewFetch(o: DeclutterPreviewFetchOptions): { fetch: typeof fetch; log: DeclutterPreviewLog[] } {
  const base = o.supabaseUrl.replace(/\/+$/, "");
  const log: DeclutterPreviewLog[] = [];
  const previewFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, method, accept } = parts(input, init);
    // Not Supabase (the app's own assets): untouched.
    if (!base || !url.startsWith(base)) return o.realFetch(input, init);
    const u = new URL(url);
    const path = u.pathname;
    const note = (outcome: DeclutterPreviewLog["outcome"]) => log.push({ method, path, outcome });
    const s = o.sample();
    if (path.startsWith("/auth/v1/")) {
      note("passed");
      return o.realFetch(input, init);
    }
    const rpc = path.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
    if (rpc) {
      const name = decodeURIComponent(rpc[1]);
      if (Object.prototype.hasOwnProperty.call(s.reads, name)) {
        note("sample");
        const v = s.reads[name];
        return Array.isArray(v) ? json(v, 200, v.length) : json(v ?? null);
      }
      const out = readRpc(name, bodyJson(init), s);
      if (out !== undefined || name === "declutter_my_handover") {
        note("sample");
        return Array.isArray(out) ? json(out, 200, out.length) : json(out ?? null);
      }
      note("blocked");
      o.onUnlisted?.(`rpc ${name}`);
      o.onBlocked(name.replace(/^declutter_/, "").replace(/_/g, " "), DECLUTTER_PREVIEW_READ_RPCS.has(name) ? "read" : "write");
      // null, not []: most reads want an object or nothing, and [] drew made-up states (Invalid Date, crashes).
      return json(null);
    }
    const table = path.match(/^\/rest\/v1\/([^/]+)$/)?.[1];
    if (table && (method === "GET" || method === "HEAD")) {
      const own = o.ownUserId();
      if (OWN_ROW_TABLES.has(table) && own && Array.from(u.searchParams.values()).some((v) => v === `eq.${own}`)) {
        note("passed");
        return o.realFetch(input, init);
      }
      note("sample");
      const listed = tableRows(table, s);
      if (listed === undefined) o.onUnlisted?.(`table ${table}`);
      const rows = listed ?? [];
      if (method === "HEAD") return json(undefined, 200, rows.length);
      if (accept.includes("vnd.pgrst.object+json")) {
        return rows.length === 1 ? json(rows[0]) : json({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null }, 406);
      }
      return json(rows, 200, rows.length);
    }
    note("blocked");
    if (table) {
      o.onBlocked(`change ${table.replace(/^declutter_/, "").replace(/_/g, " ")}`, "write");
      const row = { id: "00000000-0000-4000-d000-0000000000ff" };
      return accept.includes("vnd.pgrst.object+json") ? json(row) : json([row], 200, 1);
    }
    if (method === "GET" || method === "HEAD") return json(null, 404);
    const fn = path.match(/^\/functions\/v1\/([^/]+)/)?.[1];
    o.onBlocked(fn ? fn.replace(/-/g, " ") : "send a request", "write");
    return json({});
  }) as typeof fetch;
  return { fetch: previewFetch, log };
}

/** Puts the preview fetch in place of the window's own; returns the undo. */
export function installDeclutterPreviewFetch(o: Omit<DeclutterPreviewFetchOptions, "realFetch">): { uninstall: () => void; log: DeclutterPreviewLog[] } {
  const realFetch = globalThis.fetch;
  const { fetch: previewFetch, log } = createDeclutterPreviewFetch({ ...o, realFetch: realFetch.bind(globalThis) });
  globalThis.fetch = previewFetch;
  return {
    log,
    uninstall: () => {
      if (globalThis.fetch === previewFetch) globalThis.fetch = realFetch;
    },
  };
}
