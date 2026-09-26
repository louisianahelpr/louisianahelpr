import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { sanitizeJob } from "./sanitize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Rate limit: 10 requests per minute per IP
  const { allowed, remaining, retryAfter } = await checkRateLimit(req, {
    windowMs: 60_000, maxRequests: 10, keyPrefix: "ai-job-builder",
  });
  if (!allowed) return rateLimitResponse(retryAfter!, corsHeaders);

  // This endpoint spends real money on every call (Gemini). It previously had
  // NO auth check — only the per-IP rate limit — and the publishable key it
  // accepts ships inside the public client bundle, so anyone could pull a full
  // completion billed to us. Verified against prod before this guard:
  // `curl -H "apikey: <publishable>" -d '{"messages":[...]}'` returned a
  // complete job posting. Require a real signed-in user first.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { messages, jobContext } = body ?? {};
    // Was `messages is not iterable` — a raw internal error handed to the
    // caller. Validate the shape and answer 400 instead.
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "`messages` must be an array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bound the payload on BOTH axes and validate each item (EF-3, hole hunt
    // 2026-09-15). The rate limit above caps request COUNT, not token SPEND: a
    // single call could previously carry hundreds of KB of `messages` spread
    // straight into the Gemini request, turning this into a general-purpose LLM
    // relay billed to GEMINI_API_KEY. `role` was never checked either, so a
    // caller could inject a second `system` turn after ours to steer the model.
    // Cap the item count and total content bytes, require string content, and
    // allow only conversational roles — an item is one turn of THIS form's
    // back-and-forth, so 8 turns and ~8 KB total is generous for the real use.
    const MAX_MESSAGES = 8;
    const MAX_TOTAL_CONTENT_BYTES = 8 * 1024;
    const ALLOWED_ROLES = new Set(["user", "assistant"]);
    if (messages.length > MAX_MESSAGES) {
      return new Response(JSON.stringify({ error: `Too many messages (max ${MAX_MESSAGES})` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let totalContentBytes = 0;
    for (const m of messages) {
      if (
        typeof m !== "object" || m === null ||
        typeof (m as { role?: unknown }).role !== "string" ||
        !ALLOWED_ROLES.has((m as { role: string }).role) ||
        typeof (m as { content?: unknown }).content !== "string"
      ) {
        return new Response(
          JSON.stringify({ error: "Each message must be { role: 'user'|'assistant', content: string }" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      totalContentBytes += new TextEncoder().encode((m as { content: string }).content).length;
    }
    if (totalContentBytes > MAX_TOTAL_CONTENT_BYTES) {
      return new Response(
        JSON.stringify({ error: "Message content too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // jobContext is client input interpolated into OUR system turn (A-002):
    // a plain string, one line, bounded, or nothing.
    const rawLocation = (jobContext as { location?: unknown } | null | undefined)?.location;
    const location = typeof rawLocation === "string"
      ? rawLocation.replace(/[\r\n]+/g, " ").trim().slice(0, 80)
      : "";

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const systemPrompt = `You are Helpr's AI Job Builder. You help users create job postings on Helpr, a local services marketplace.

CANONICAL NOUNS — house style, follow exactly: the person who does the job is
always "Helpr", capitalized, and never any other common noun for that role;
the person who posted the job is always "you" or "the person who posted this job" — never "customer"
or "client". Use these exact terms in the title, description and any special
requirements text you write.

Given a brief description of what the user needs help with, generate a complete job posting with:
1. A clear, concise title (target 24 chars or fewer — the form's title field hard-caps at exactly 32 and rejects anything longer, so aim well under the cap rather than skimming it)
2. A detailed description (2-3 paragraphs) covering scope, expectations, and any relevant details
3. A recommended category from: cleaning, yard_work, moving, errands, handyman, painting, delivery, pet_care, assembly, storm_prep, events, other
4. Estimated hours needed
5. A suggested budget range (min and max in USD)
6. Any special requirements or notes

${location ? `Additional context: Location is ${location}` : ''}

Always respond using the generate_job_posting tool.`;

    // Google Gemini via its OpenAI-compatible endpoint, so the tool-calling
    // request/response shape below stays identical to a standard OpenAI call.
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GEMINI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // gemini-2.5-flash was retired for NEW API keys: Google returns
        // 404 "no longer available to new users" and names 3.6-flash as the
        // replacement. The old model kept working for keys created before the
        // cutoff, which is why this only surfaced when a fresh key was issued
        // — the function looked fine right up until someone configured it.
        model: "gemini-3.6-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_job_posting",
              description: "Generate a complete job posting based on the user's description",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Job title, target 24 chars or fewer, hard cap 32" },
                  description: { type: "string", description: "Detailed job description" },
                  category: {
                    type: "string",
                    enum: ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "pet_care", "assembly", "storm_prep", "events", "other"],
                    description: "Best matching job category"
                  },
                  estimated_hours: { type: "number", description: "Estimated hours to complete" },
                  budget_min: { type: "number", description: "Minimum suggested budget in USD" },
                  budget_max: { type: "number", description: "Maximum suggested budget in USD" },
                  special_requirements: { type: "string", description: "Any special requirements or notes" },
                  is_group_job: { type: "boolean", description: "Whether multiple helprs are needed" },
                  helpers_needed: { type: "number", description: "Number of helprs needed if group job" },
                },
                required: ["title", "description", "category", "estimated_hours", "budget_min", "budget_max"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_job_posting" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      // Keep the upstream status (the client shows a code) but never echo the
      // raw upstream body to the caller — it is logged above (EF-5, 2026-09-15).
      return new Response(JSON.stringify({ error: `AI service error (${response.status})` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      // Whitelisted, type-checked and bounded (A-002); this also keeps the
      // title within FormStep's 32-char cap, which gemini-3.6-flash was
      // observed to overrun despite the prompt.
      const jobData = sanitizeJob(JSON.parse(toolCall.function.arguments));
      if (!jobData) {
        return new Response(JSON.stringify({ error: "Failed to generate job posting" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(jobData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Failed to generate job posting" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-job-builder error:", e);
    // Generic client-safe message; detail is logged above (EF-5, 2026-09-15).
    return new Response(JSON.stringify({ error: "Something went wrong generating your job. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
