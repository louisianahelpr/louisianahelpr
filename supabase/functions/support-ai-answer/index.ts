/**
 * support-ai-answer — Claude's help on support requests (owner 2026-11-03,
 * 3:30 PM: "integrate AI into support/help requests, because some you can
 * easily answer or Claude can"; Builder 70 via the lead).
 *
 * Two modes, both behind the 'ai_support_answers' switch for the VERIFIED
 * caller (requireFeature), both answering ONLY from the Help Center
 * (HELP_KNOWLEDGE, generated from the Help Center's own content):
 *
 *   { mode: "ask", subject, message }  a signed-in member on /support, BEFORE
 *     the ticket is sent. Returns { answered, answer }. Nothing is stored and
 *     nothing is sent: the app shows the answer with "This answered my
 *     question" / "Still send to the team", and the ticket goes through
 *     contact-support exactly as before unless the member says it was answered.
 *
 *   { mode: "draft", reportId }  an ADMIN in Admin Support. Returns
 *     { reply, needsAdmin } for one support ticket. Nothing is sent: the admin
 *     edits it in the reply box and presses Send (admin-support-reply). Each
 *     draft writes an admin_audit_log row (action 'support_ai_draft').
 *
 * Guardrails (supportAi.ts): the model has no tools, so it can change nothing;
 * the prompt holds only the ticket's subject and message with contact details
 * masked (never a name, email, id or account data); an answer that promises a
 * refund, payout or other action, or carries contact details, is dropped.
 * Rate limited per IP (6 a minute, then 20 an hour for "ask" and 60 an hour for
 * "draft", counted after every gate so a refused caller spends nothing).
 * Logged: one line per call (mode, outcome, sizes; never the text). It raises
 * no alert of any kind, so a test or seed account can never page the owner.
 */
import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { claudeFetch, claudeJson } from "../_shared/claudeMessages.ts";
import { fetchModelWithRetry } from "../declutter-ai-draft/modelRetry.ts";
import { HELP_KNOWLEDGE } from "../_shared/helpKnowledge.ts";
import {
  ASK_SCHEMA, ASK_SYSTEM_PROMPT, DRAFT_SCHEMA, DRAFT_SYSTEM_PROMPT,
  askUserText, draftUserText, sanitizeAsk, supportSystem, sanitizeDraft, ticketMessageOnly,
} from "../_shared/supportAi.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One log line per call; never the member's words or the answer. */
const logCall = (fields: Record<string, unknown>) => console.info("[support-ai-answer]", JSON.stringify(fields));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const minute = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 6, keyPrefix: "support-ai-answer" });
  if (!minute.allowed) return rateLimitResponse(minute.retryAfter!, corsHeaders);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!;
  const serviceKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "not_authenticated" }, 401);
  const userClient = createClient(url, anonKey);
  const { data: authData, error: authError } = await userClient.auth.getUser(authHeader.slice(7));
  if (authError || !authData?.user) return json({ error: "not_authenticated" }, 401);
  const user = authData.user;
  // An unconfirmed account still reaches the team through contact-support (exempt there);
  // only the AI answer is skipped, and the app then sends the ticket as before.
  const unconfirmed = refuseUnconfirmedEmail(user, corsHeaders);
  if (unconfirmed) return unconfirmed;

  const admin = createClient(url, serviceKey);
  const refused = await requireFeature(admin, "ai_support_answers", user, corsHeaders);
  if (refused) return refused;

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "draft" ? "draft" : body?.mode === "ask" ? "ask" : null;
  if (!mode) return json({ error: "bad_request" }, 400);

  try {
    let userText: string;
    let reportId: string | null = null;
    if (mode === "draft") {
      // Fails closed both ways: not an admin -> 403; could not check -> 503.
      const { data: isAdmin, error: roleError } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (roleError) {
        console.error("[support-ai-answer] has_role check failed:", roleError.message);
        return json({ error: "ai_unavailable" }, 503);
      }
      if (isAdmin !== true) return json({ error: "forbidden" }, 403);
      reportId = typeof body?.reportId === "string" ? body.reportId : "";
      if (!UUID_RE.test(reportId)) return json({ error: "ticket_not_found" }, 404);
      const { data: ticket, error: ticketError } = await admin.from("reports")
        .select("id, reported_type, reason, description").eq("id", reportId).maybeSingle();
      if (ticketError) {
        console.error("[support-ai-answer] ticket read failed:", ticketError.message);
        return json({ error: "ai_unavailable" }, 503);
      }
      if (!ticket || ticket.reported_type !== "support") return json({ error: "ticket_not_found" }, 404);
      // "[Issue Report] App freezes" -> "App freezes" (AdminSupport's subjectFromReason).
      const subject = (ticket.reason ?? "").replace(/^\[.*?\]\s*/, "");
      userText = draftUserText(subject, ticketMessageOnly(ticket.description));
    } else {
      const subject = typeof body?.subject === "string" ? body.subject : "";
      const message = typeof body?.message === "string" ? body.message : "";
      if (message.trim().length < 10) return json({ answered: false, answer: "" });
      userText = askUserText(subject, message);
    }

    // Counted after every gate, so a refused caller spends nothing.
    const hourly = await checkRateLimit(req, {
      windowMs: 3_600_000,
      maxRequests: mode === "draft" ? 60 : 20,
      keyPrefix: `support-ai-answer-${mode}-hour`,
    });
    if (!hourly.allowed) return rateLimitResponse(hourly.retryAfter!, corsHeaders);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    const callModel = async (): Promise<Response> => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25_000);
      try {
        return await claudeFetch(apiKey, {
          // The Help text first and cached (supportSystem), then this mode's rules.
          system: supportSystem(HELP_KNOWLEDGE, mode === "draft" ? DRAFT_SYSTEM_PROMPT : ASK_SYSTEM_PROMPT),
          turns: [{ role: "user", content: userText }],
          schema: mode === "draft" ? DRAFT_SCHEMA : ASK_SCHEMA,
          maxTokens: 1024,
        }, ctl.signal);
      } finally {
        clearTimeout(timer);
      }
    };
    const response = await fetchModelWithRetry(callModel, {
      onRetry: (status) => console.warn("[support-ai-answer] model busy, retrying once:", status),
    });
    if (!response.ok) {
      console.error("[support-ai-answer] model error:", response.status, (await response.text()).slice(0, 300));
      logCall({ mode, user: user.id, outcome: "model_error", status: response.status });
      return json({ error: "ai_unavailable" }, response.status === 429 ? 429 : 502);
    }
    const raw = claudeJson(await response.json());

    if (mode === "ask") {
      const ask = sanitizeAsk(raw);
      logCall({ mode, user: user.id, outcome: ask ? "answered" : "not_answered", chars: ask?.answer.length ?? 0 });
      return json(ask ? { answered: true, answer: ask.answer } : { answered: false, answer: "" });
    }

    const draft = sanitizeDraft(raw);
    logCall({ mode, user: user.id, report: reportId, outcome: draft ? "drafted" : "unusable", chars: draft?.reply.length ?? 0 });
    if (!draft) return json({ error: "ai_unavailable" }, 502);
    // Who asked the AI about which ticket. Not money and nothing was sent, so a
    // lost row is logged, not alerted (no owner-facing alert from this function).
    const { error: auditError } = await admin.from("admin_audit_log").insert({
      admin_id: user.id,
      action: "support_ai_draft",
      target_id: reportId,
      target_type: "report",
      details: { chars: draft.reply.length, needs_admin: draft.needsAdmin },
    });
    if (auditError) console.error("[support-ai-answer] audit row not written:", auditError.message);
    return json({ reply: draft.reply, needsAdmin: draft.needsAdmin });
  } catch (e) {
    console.error("[support-ai-answer] error:", caughtMessage(e));
    logCall({ mode, user: user.id, outcome: "error" });
    return json({ error: "ai_unavailable" }, 500);
  }
});
