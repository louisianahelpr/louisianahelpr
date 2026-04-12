import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const email = "apple-reviewer@louisianahelpr.com";
  const password = "HelprReview2026!";

  // Create user with auto-confirmed email
  const { data: user, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Apple Reviewer", role: "customer" },
  });

  if (createError) {
    return new Response(JSON.stringify({ error: createError.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Update profile to approved
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      approval_status: "approved",
      full_name: "Apple Reviewer",
      location: "Baton Rouge, LA",
      phone: "555-000-0000",
      date_of_birth: "1990-01-01",
      bio: "Test account for Apple App Store review",
    })
    .eq("user_id", user.user.id);

  return new Response(
    JSON.stringify({ success: true, userId: user.user.id, profileError: profileError?.message }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
