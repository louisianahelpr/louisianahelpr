import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

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

  try {
    const { messages, jobContext } = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const systemPrompt = `You are Helpr's AI Job Builder. You help users create job postings on Helpr, a local services marketplace.

Given a brief description of what the user needs help with, generate a complete job posting with:
1. A clear, concise title (max 60 chars)
2. A detailed description (2-3 paragraphs) covering scope, expectations, and any relevant details
3. A recommended category from: cleaning, yard_work, moving, errands, handyman, painting, delivery, pet_care, assembly, other
4. Estimated hours needed
5. A suggested budget range (min and max in USD)
6. Any special requirements or notes

${jobContext ? `Additional context: Location is ${jobContext.location || 'not specified'}` : ''}

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
                  title: { type: "string", description: "Job title, max 60 chars" },
                  description: { type: "string", description: "Detailed job description" },
                  category: { 
                    type: "string", 
                    enum: ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "pet_care", "assembly", "other"],
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
      return new Response(JSON.stringify({ error: `AI service error (${response.status}): ${t.slice(0, 200)}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const jobData = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(jobData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Failed to generate job posting" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-job-builder error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
