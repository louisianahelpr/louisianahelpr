/**
 * The admin Messages preview's backend (/admin/preview/messages): while the preview is open, every request the
 * Messages page makes to Supabase is answered HERE, from the stage's sample (messagesPreviewSamples.ts), and never
 * reaches the network. The job preview's pattern (previewBackend.ts) and the Declutter preview's (B172):
 *  - a read RPC or table in the sample gets the sample (tables filtered by the request's eq / in / is filters);
 *  - an RPC not in the sample is answered null and a table not in it [], WITHOUT being sent, and both are reported
 *    to messagesPreviewChecks.onUnlisted, which the page test turns into a failure;
 *  - every POST / PATCH / PUT / DELETE on a table, every edge function and every storage call is answered without
 *    being sent ("Preview: this would ...");
 *  - only three kinds of request still go out: sign-in traffic (/auth/v1/), so the admin stays signed in; a READ of
 *    the admin's OWN profile or role row (profiles / user_roles filtered by their id), so the app chrome and the
 *    admin gate keep their real answer; and feature_switches_for_me (which switches are on). Never a write, never a
 *    message, never another person.
 * Guard: src/test/adminMessagesPreviewIsInert.test.tsx.
 */
import type { MessagesPreviewSample } from "./messagesPreviewSamples";

/** Tests set this to fail on a read the sample does not answer. */
export const messagesPreviewChecks: { onUnlisted?: (what: string) => void } = {};

export interface MessagesPreviewLog {
  method: string;
  path: string;
  outcome: "sample" | "blocked" | "passed";
}

export interface MessagesPreviewFetchOptions {
  supabaseUrl: string;
  sample: () => MessagesPreviewSample;
  ownUserId: () => string | null;
  realFetch: typeof fetch;
  onBlocked: (what: string) => void;
  onUnlisted?: (what: string) => void;
  /** A final action the sample answers (a block): the page shows its after-state (audit 1102e). */
  onAction?: (name: string) => void;
}

/**
 * Final actions answered with the success shape their screen expects, so the button finishes (audit 1102e:
 * "Blocking…" never did). Still never sent, still said.
 */
const ACTION_ANSWERS: Record<string, unknown> = { block_user_and_settle: { settled: [] } };
/**
 * Writes the page makes on its own as a thread opens (read receipts, notices marked read): answered, never sent,
 * and not said, because nothing was pressed to cause them (audit 1102e: "this would update notifications").
 */
const QUIET_WRITES = new Set(["PATCH notifications", "PATCH messages"]);

const OWN_ROW_TABLES = new Set(["profiles", "user_roles"]);
const PASS_THROUGH_RPC = new Set(["feature_switches_for_me"]);
const READ_RPC = /^(get_|list_|fetch_|can_|is_|has_|are_|count_|check_|search_)/;
const VERB: Record<string, string> = { POST: "save", PATCH: "update", PUT: "save", DELETE: "delete" };

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

/** The request's simple column filters (eq / in / is.null), applied to columns the sample rows carry. */
function applyFilters(rows: unknown[], url: URL): unknown[] {
  let out = rows as Array<Record<string, unknown>>;
  for (const [col, raw] of url.searchParams) {
    if (["select", "order", "limit", "offset", "or", "and"].includes(col)) continue;
    const v = decodeURIComponent(raw);
    const keep = (row: Record<string, unknown>) => {
      if (!(col in row)) return true;
      const cell = row[col];
      if (v.startsWith("eq.")) return String(cell) === v.slice(3);
      if (v.startsWith("neq.")) return String(cell) !== v.slice(4);
      if (v === "is.null") return cell === null || cell === undefined;
      if (v === "not.is.null") return cell !== null && cell !== undefined;
      if (v.startsWith("in.(")) return v.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(cell));
      return true;
    };
    out = out.filter(keep);
  }
  return out;
}

/** A fetch that answers Supabase from the sample. `log` records every Supabase request it saw. */
function createMessagesPreviewFetch(o: MessagesPreviewFetchOptions): { fetch: typeof fetch; log: MessagesPreviewLog[] } {
  const base = o.supabaseUrl.replace(/\/+$/, "");
  const log: MessagesPreviewLog[] = [];
  const previewFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, method, accept } = requestParts(input, init);
    if (!base || !url.startsWith(base)) return o.realFetch(input, init);
    const u = new URL(url);
    const path = u.pathname;
    const note = (outcome: MessagesPreviewLog["outcome"]) => log.push({ method, path, outcome });
    const s = o.sample();

    if (path.startsWith("/auth/v1/")) {
      note("passed");
      return o.realFetch(input, init);
    }
    const rpc = path.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
    if (rpc) {
      const name = decodeURIComponent(rpc[1]);
      if (PASS_THROUGH_RPC.has(name)) {
        note("passed");
        return o.realFetch(input, init);
      }
      if (Object.prototype.hasOwnProperty.call(ACTION_ANSWERS, name)) {
        note("blocked");
        o.onBlocked(`run "${name}"`);
        o.onAction?.(name);
        return json(ACTION_ANSWERS[name]);
      }
      if (Object.prototype.hasOwnProperty.call(s.reads, name)) {
        note("sample");
        const read = s.reads[name];
        const v = typeof read === "function" ? read(bodyJson(init)) : read;
        return Array.isArray(v) ? json(v, 200, v.length) : json(v ?? null);
      }
      // Not in the sample: null (never [], which drew made-up states, audit 1102c P1), never sent, and reported.
      note("blocked");
      o.onUnlisted?.(`rpc ${name}`);
      if (!READ_RPC.test(name)) o.onBlocked(`run "${name}"`);
      return json(null);
    }
    const table = path.match(/^\/rest\/v1\/([^/]+)$/)?.[1];
    if (table && (method === "GET" || method === "HEAD")) {
      const own = o.ownUserId();
      if (OWN_ROW_TABLES.has(table) && own && [...u.searchParams.values()].some((v) => v === `eq.${own}`)) {
        note("passed");
        return o.realFetch(input, init);
      }
      note("sample");
      const listed = Object.prototype.hasOwnProperty.call(s.tables, table) ? s.tables[table] : undefined;
      if (listed === undefined) o.onUnlisted?.(`table ${table}`);
      const rows = applyFilters(listed ?? [], u);
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
      if (!QUIET_WRITES.has(`${method} ${table}`)) o.onBlocked(`${VERB[method] ?? "change"} ${table.replace(/_/g, " ")}`);
      // An echo row, so a write that asks for its row back reads as done, not as a failed save.
      const body = bodyJson(init);
      const row = { id: "00000000-0000-4000-e000-00000000ffff", ...(Array.isArray(body) ? {} : body) };
      return accept.includes("vnd.pgrst.object+json") ? json(row) : json([row], 200, 1);
    }
    const fn = path.match(/^\/functions\/v1\/([^/]+)/)?.[1];
    o.onBlocked(fn ? `call ${fn}` : "send a request");
    return json({});
  }) as typeof fetch;
  return { fetch: previewFetch, log };
}

/** Puts the preview fetch in place of the window's own; returns the undo. */
export function installMessagesPreviewFetch(o: Omit<MessagesPreviewFetchOptions, "realFetch">): { uninstall: () => void; log: MessagesPreviewLog[] } {
  const realFetch = globalThis.fetch;
  const { fetch: previewFetch, log } = createMessagesPreviewFetch({ ...o, realFetch: realFetch.bind(globalThis) });
  globalThis.fetch = previewFetch;
  return {
    log,
    uninstall: () => {
      if (globalThis.fetch === previewFetch) globalThis.fetch = realFetch;
    },
  };
}
