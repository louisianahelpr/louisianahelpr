import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const key = Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? "";
  return new Response(
    JSON.stringify({ publishable_key: key }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
