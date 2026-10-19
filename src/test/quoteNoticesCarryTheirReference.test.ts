/**
 * A quote notice carries a REFERENCE (its request, or its job), and where it
 * opens is decided when it is opened, by the reader's side (Q2177, lead
 * /code-review of wip/reds-1019-8, 2026-10-19).
 *
 * Before: quote_notify_about (20261018155222) wrote '/quotes' (+ '?user=<actor>')
 * on EVERY quote notice, with no job_id. /quotes was the hub whose default
 * view was the poster's, and since the hub was retired (QuotesHubRedirect) a
 * bare /quotes opens Posts: a quoter told "New counter-offer", "Quote
 * accepted", "Quote declined", "A counter-offer is waiting on you", "You're
 * booked", "Finish setup to start" or "Accept to start" landed on the
 * poster's page; the email of the same row carried the same link. Freezing a
 * view ('/quotes?view=mine') into the row repeats the mistake.
 *
 * THE CHECK, on the NEWEST definition of every SQL function
 * (effectiveFunctionDefs: any dollar-quote tag, rewrites and drops replayed):
 *   1. quote_notify_to is the only quote notice helper (quote_notify_about and
 *      quote_notify are dropped), and every call of it passes all 8 arguments.
 *   2. every call is about a request (p_request_id = the request it acts on,
 *      p_job_id NULL) or, in the hire trigger, about the paid job
 *      (p_job_id = NEW.id), and "Finish setup to start" alone opens the payout
 *      setup. A call with neither reference fails.
 *   3. quote_notify_to links '/quotes?request=<id>', '/jobs?job=<id>' or
 *      '/profile?tab=payment' (+ user=<actor>), writes job_id, emails that
 *      same link; no other function writes a '/quotes' link of its own.
 *   4. the client decides at open time: QuotesHubRedirect reads that ONE
 *      request (isMyQuoteRequest: by id AND poster_id = the reader) and sends
 *      '/quotes?request=<id>' through quoteRequestTarget (poster -> the
 *      request page, anyone else -> QUOTE_HOMES.myQuotes); signed out or with
 *      the quotes switch off it follows the old-link rule (no dead Retry),
 *      and the bell rebuilds '/jobs?job=' from job_id (notificationDestination).
 * Behaviour: src/test/pglite/quoteHireOnPay.pglite.mjs "links:" checks
 * (migrations applied 3x: 23/23 PASS; --links-before, i.e. without
 * 20261019043546: exactly the 3 link checks FAIL, 64 of 64 quote notices
 * without a reference).
 * Shown red on the old definitions: with 20261019043546 removed, checks 1-3
 * fail (every call is quote_notify_about / quote_notify, no reference).
 *
 * @mutate supabase/migrations/20261019043546_quote_notices_link_the_quoter_view.sql | ' on "' \|\| v_req.title \|\| '".', v_uid, true,\n      v_req.id, NULL, false); | ' on "' \|\| v_req.title \|\| '".', v_uid, true,\n      NULL, NULL, false);
 * @mutate supabase/migrations/20261019043546_quote_notices_link_the_quoter_view.sql | Finish your payout setup and ID check and you''re booked.',\n        NEW.customer_id, false, NULL, NEW.id, true); | Finish your payout setup and ID check and you''re booked.',\n        NEW.customer_id, false, NULL, NEW.id, false);
 * @mutate supabase/migrations/20261019043546_quote_notices_link_the_quoter_view.sql | WHEN p_request_id IS NOT NULL THEN '/quotes?request=' \|\| p_request_id::text | WHEN p_request_id IS NOT NULL THEN '/quotes?view=mine'
 * @mutate supabase/migrations/20261019043546_quote_notices_link_the_quoter_view.sql |   VALUES (p_user, p_title, p_message, 'new_offers', v_link, p_job_id) |   VALUES (p_user, p_title, p_message, 'new_offers', v_link, NULL)
 * @mutate supabase/migrations/20261019043546_quote_notices_link_the_quoter_view.sql | DROP FUNCTION IF EXISTS public.quote_notify_about(uuid, text, text, uuid, boolean);\n | \n
 * @mutate src/lib/quotes/homes.ts |   return isPoster ? | return true ?
 * @mutate src/components/quotes/QuotesHubRedirect.tsx | <Navigate to={quoteRequestTarget(requestId, own.data)} replace /> | <Navigate to={quotesHubTarget(search)} replace />
 * @mutate src/components/quotes/QuotesHubRedirect.tsx |     queryFn: () => isMyQuoteRequest(requestId!, uid!), |     queryFn: async () => false,
 * @mutate src/lib/quotes/api.ts |     await supabase.from("job_quote_requests").select("id").eq("id", requestId).eq("poster_id", userId).maybeSingle(), |     await supabase.from("job_quote_requests").select("id").eq("id", requestId).maybeSingle(),
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { notificationDestination } from "@/components/notificationPanel/notificationDestination";
import { QUOTE_HOMES, quoteRequestTarget } from "@/lib/quotes/homes";

const root = resolve(__dirname, "../..");
const EFFECTIVE = effectiveDefs(resolve(root, "supabase/migrations"));
const ws = (s: string) => s.replace(/\s+/g, " ").trim();
const code = (fn: string) => {
  const stmt = EFFECTIVE.get(fn)?.stmt;
  expect(stmt, `${fn} has a definition`).toBeTruthy();
  return ws(blankSqlComments(stmt ?? ""));
};

const CALL = /\bpublic\.(quote_notify_to|quote_notify_about|quote_notify)\s*\(/g;

/** Top-level arguments of the call whose '(' is at `open`, outside '…' literals. */
function callArgs(src: string, open: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let start = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") inStr = true;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        out.push(src.slice(start, i).trim());
        return out;
      }
    } else if (c === "," && depth === 1) {
      out.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error("unclosed call");
}

type Site = { fn: string; callee: string; args: string[] };
const sites: Site[] = [];
for (const [fn, def] of EFFECTIVE) {
  if (fn === "quote_notify_to") continue;
  const b = ws(blankSqlComments(def.stmt));
  for (const m of b.matchAll(CALL)) sites.push({ fn, callee: m[1], args: callArgs(b, m.index! + m[0].length - 1) });
}
const label = (s: Site) => `${s.fn}: ${s.callee}(${s.args[0]}, ${s.args[1]}, ... ${s.args.slice(5).join(", ")})`;
/** The request each function acts on, as its body names it. */
const REQUEST_REF: Record<string, string[]> = {
  submit_job_quote: ["v_req.id"],
  respond_to_job_quote: ["v_req.id"],
  sweep_quote_alerts: ["r.request_id", "r.id"],
};

describe("quote notices carry a reference; the reader's side picks the place when opened", () => {
  it("quote_notify_to is the only quote notice helper; every call passes all 8 arguments (cannot pass vacuously)", () => {
    expect(EFFECTIVE.has("quote_notify_about"), "quote_notify_about is dropped").toBe(false);
    expect(EFFECTIVE.has("quote_notify"), "quote_notify is dropped").toBe(false);
    expect(sites.length).toBeGreaterThan(9);
    expect(new Set(sites.map((s) => s.fn))).toEqual(
      new Set(["submit_job_quote", "respond_to_job_quote", "quote_job_funded_hires_quoter", "sweep_quote_alerts"]),
    );
    expect(sites.filter((s) => s.callee !== "quote_notify_to" || s.args.length !== 8).map(label)).toEqual([]);
  });

  it("each notice names the request it is about, or (the hire trigger) the paid job; only 'Finish setup to start' opens payout setup", () => {
    const wrong = sites.filter((s) => {
      const [, title, , , , req, job, payout] = s.args;
      if (s.fn === "quote_job_funded_hires_quoter") {
        return req !== "NULL" || job !== "NEW.id" || payout !== (title === "'Finish setup to start'" ? "true" : "false");
      }
      return !(REQUEST_REF[s.fn] ?? []).includes(req) || job !== "NULL" || payout !== "false";
    });
    expect(wrong.map(label)).toEqual([]);
    expect(sites.filter((s) => s.fn === "quote_job_funded_hires_quoter").map((s) => s.args[1]).sort()).toEqual(
      ["'Accept to start'", "'Finish setup to start'", "'You''re booked'"],
    );
  });

  it("quote_notify_to links the reference (request, job or payout setup), writes job_id and emails the same link", () => {
    const b = code("quote_notify_to");
    expect(b).toContain(
      "v_link := CASE WHEN COALESCE(p_payout_setup, false) THEN '/profile?tab=payment' " +
        "WHEN p_job_id IS NOT NULL THEN '/jobs?job=' || p_job_id::text " +
        "WHEN p_request_id IS NOT NULL THEN '/quotes?request=' || p_request_id::text ELSE '/quotes' END;",
    );
    expect(b).toContain("v_link := v_link || CASE WHEN position('?' IN v_link) > 0 THEN '&' ELSE '?' END || 'user=' || p_actor::text;");
    expect(b).toContain(
      "INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES (p_user, p_title, p_message, 'new_offers', v_link, p_job_id) RETURNING id, link INTO v_id, v_link;",
    );
    expect(b).toContain("'type', 'new_offers', 'link', v_link)");
    expect(b).toContain("jsonb_build_object('source', 'quote_notify_to', 'origin', 'server')");
    // No function writes a '/quotes' link of its own (a '/quotes' or
    // '/quotes?…' literal; submit_job_quote's '<uid>/quotes/%' photo path is
    // a storage folder, not a link).
    const writers = [...EFFECTIVE.entries()]
      .filter(([, d]) => /'\/quotes(?:'|\?)/.test(blankSqlComments(d.stmt)))
      .map(([fn]) => fn);
    expect(writers).toEqual(["quote_notify_to"]);
  });

  it("the client decides at open time: the poster gets the request page, anyone else their quotes; the bell rebuilds a job link", () => {
    const rid = "00000000-0000-4000-8000-0000000000aa";
    expect(quoteRequestTarget(rid, true)).toBe(`/quotes/request/${rid}`);
    expect(quoteRequestTarget(rid, false)).toBe(QUOTE_HOMES.myQuotes);
    const redirect = blankComments(readFileSync(resolve(root, "src/components/quotes/QuotesHubRedirect.tsx"), "utf8"));
    expect(redirect).toContain('const requestId = new URLSearchParams(search).get("request");');
    expect(redirect).toContain("queryFn: () => isMyQuoteRequest(requestId!, uid!),");
    expect(redirect).toContain("enabled: !!requestId && !!uid && quotes.on,");
    expect(redirect).toContain("if (!requestId || (isReady && !uid) || (quotes.settled && !quotes.on)) return fallback;");
    expect(redirect).toContain("<Navigate to={quoteRequestTarget(requestId, own.data)} replace />");
    // One row by id and the reader's own poster_id: never a capped list.
    const api = blankComments(readFileSync(resolve(root, "src/lib/quotes/api.ts"), "utf8"));
    expect(api).toContain('await supabase.from("job_quote_requests").select("id").eq("id", requestId).eq("poster_id", userId).maybeSingle(),');
    // A request link reaches the redirect untouched (no job_id on it).
    const reqLink = `/quotes?request=${rid}&user=00000000-0000-4000-8000-00000000000a`;
    expect(notificationDestination({ link: reqLink, job_id: null })).toBe(reqLink);
    // A job notice: the bell rebuilds it from job_id (Activity resolves the bucket).
    const job = "00000000-0000-4000-8000-0000000000cc";
    expect(notificationDestination({ link: `/jobs?job=${job}&user=00000000-0000-4000-8000-00000000000a`, job_id: job })).toBe(
      `/jobs?user=00000000-0000-4000-8000-00000000000a&job=${job}`,
    );
  });
});
