const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  
  // List all env vars that contain "LOVABLE" or "RUN"
  const envVars: Record<string, string> = {}
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (key.includes('LOVABLE') || key.includes('RUN') || key.includes('DEPLOY')) {
      envVars[key] = key === 'LOVABLE_API_KEY' ? '***redacted***' : value
    }
  }
  
  return new Response(JSON.stringify({ envVars }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
